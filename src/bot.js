import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendMarkdown, transcribeVoice } from "./telegram.js";
import { db } from "./db.js";
import { createCalendarEvent, listTodayEvents } from "./google-calendar.js";
import { draftEmail, sendEmail } from "./gmail.js";
import { addGoogleTask, listPendingTasks, completeTask } from "./google-tasks.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const API_TIMEOUT_MS = 30_000; // 30 seconds — if Claude hasn't responded, abort
const MAX_RETRIES = 2;

async function callClaude(messages, { retries = MAX_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages
        },
        { signal: AbortSignal.timeout(API_TIMEOUT_MS) }
      );
      return response;
    } catch (err) {
      const isLastAttempt = attempt === retries;
      const isRetryable =
        err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        err.status === 529 || // Anthropic overloaded
        err.status === 503 ||
        err.status === 500 ||
        err.error?.type === "overloaded_error";

      if (isRetryable && !isLastAttempt) {
        const delay = Math.min(1000 * 2 ** attempt, 8000); // 1s, 2s, 4s, max 8s
        console.warn(`Claude API attempt ${attempt + 1} failed (${err.name || err.status}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err; // Non-retryable or exhausted retries
    }
  }
}

// In-memory conversation history per user (TTL: 2 hours)
const conversationCache = new Map();

function getHistory(userId) {
  const entry = conversationCache.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.ts > 2 * 60 * 60 * 1000) {
    conversationCache.delete(userId);
    return [];
  }
  return entry.messages;
}

function addToHistory(userId, role, content) {
  const existing = getHistory(userId);
  const updated = [...existing, { role, content }].slice(-20); // keep last 20 turns
  conversationCache.set(userId, { messages: updated, ts: Date.now() });
}

const SYSTEM_PROMPT = `You are Ian's personal productivity agent. Ian is a solo developer, nonprofit founder, and marketing professional based in Westchester County / Long Island, NY. He runs Community Literacy Club (youth tennis & chess) and builds AI-powered applications. He's always on the move and sends you ideas, tasks, and thoughts throughout the day.

Your job:
1. Capture ideas and tasks from natural language — Ian should never have to format things
2. Detect intent: task creation, calendar event, email draft, reminder, question, or just venting/thinking out loud
3. Take action using your tools when clear intent exists
4. Ask for confirmation before sending emails or creating events (unless Ian says "just do it")
5. Follow up on pending items — "Did you get to X?" 
6. Be concise. Ian is busy. Short messages, bullet points when listing, no fluff.
7. Remember context within the conversation. Connect the dots.

Current date/time context will be injected per message. 

When Ian says things like:
- "I need to call..." → create a task
- "Set up a meeting with..." → create calendar event  
- "Send [person] an email about..." → draft email, confirm before sending
- "Remind me to..." → create task with reminder flag
- "What do I have going on?" → list today's calendar + pending tasks
- "Mark that done" / "done" → complete the most recent task

Always confirm destructive or send actions. For task creation, just do it and confirm after.

Respond in plain text. Use markdown only for lists. Keep responses under 150 words unless Ian asks for detail.`;

const TOOLS = [
  {
    name: "create_calendar_event",
    description: "Create a Google Calendar event",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "ISO 8601 date string" },
        duration_minutes: { type: "number" },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Email addresses" }
      },
      required: ["title", "date"]
    }
  },
  {
    name: "add_task",
    description: "Add a task to Google Tasks",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due_date: { type: "string", description: "ISO 8601 date string, optional" },
        priority: { type: "string", enum: ["high", "normal"], default: "normal" }
      },
      required: ["title"]
    }
  },
  {
    name: "draft_email",
    description: "Draft an email for Ian to review and approve before sending",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "send_email",
    description: "Send an email that Ian has approved",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "list_tasks",
    description: "List pending tasks from Google Tasks",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "high_priority", "overdue"], default: "all" }
      }
    }
  },
  {
    name: "complete_task",
    description: "Mark a task as completed",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        task_title: { type: "string", description: "Used for confirmation message" }
      },
      required: ["task_id", "task_title"]
    }
  },
  {
    name: "list_calendar_today",
    description: "Get today's calendar events",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "save_idea",
    description: "Save a raw idea or note to the ideas log for later review",
    input_schema: {
      type: "object",
      properties: {
        idea: { type: "string" },
        category: { type: "string", enum: ["business", "nonprofit", "personal", "technical", "other"] }
      },
      required: ["idea"]
    }
  },
  {
    name: "set_reminder",
    description: "Set a timed reminder that will notify Ian at the specified time. Use America/New_York timezone.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The reminder message to send" },
        remind_at: { type: "string", description: "ISO 8601 datetime for when to send the reminder, in America/New_York timezone. Example: 2026-03-08T22:00:00-05:00" }
      },
      required: ["message", "remind_at"]
    }
  }
];

async function executeTool(toolName, toolInput, userId, chatId) {
  console.log(`Executing tool: ${toolName}`, toolInput);

  switch (toolName) {
    case "create_calendar_event": {
      const event = await createCalendarEvent(toolInput);
      return { success: true, event_id: event.id, link: event.htmlLink };
    }
    case "add_task": {
      const task = await addGoogleTask(toolInput);
      // Also save to our DB for tracking
      await db.saveTask({ ...toolInput, google_task_id: task.id, user_id: userId, status: "pending" });
      return { success: true, task_id: task.id };
    }
    case "draft_email": {
      // Store draft, don't send yet
      const draftId = await db.saveDraft({ ...toolInput, user_id: userId });
      return { success: true, draft_id: draftId, status: "draft_saved" };
    }
    case "send_email": {
      await sendEmail(toolInput);
      return { success: true, sent: true };
    }
    case "list_tasks": {
      const tasks = await listPendingTasks(toolInput.filter);
      return { tasks };
    }
    case "complete_task": {
      await completeTask(toolInput.task_id);
      await db.markTaskComplete(toolInput.task_id);
      return { success: true };
    }
    case "list_calendar_today": {
      const events = await listTodayEvents();
      return { events };
    }
    case "save_idea": {
      await db.saveIdea({ ...toolInput, user_id: userId, timestamp: new Date().toISOString() });
      return { success: true };
    }
    case "set_reminder": {
      const remindAt = new Date(toolInput.remind_at).toISOString();
      const id = db.saveReminder({
        user_id: userId,
        chat_id: chatId.toString(),
        message: toolInput.message,
        remind_at: remindAt
      });
      return { success: true, reminder_id: id, remind_at: remindAt };
    }
    default:
      return { error: "Unknown tool" };
  }
}

export async function handleTelegramUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  let text = msg.text;

  // Handle voice messages — transcribe to text
  if (!text && msg.voice) {
    await sendMessage(chatId, null, "typing");
    try {
      text = await transcribeVoice(msg.voice.file_id);
      console.log("Voice transcribed:", text);
      await sendMessage(chatId, `🎤 _"${text}"_`);
    } catch (err) {
      console.error("Transcription error:", err);
      await sendMessage(chatId, `Voice transcription failed: ${err.message}\nTry again or type it out.`);
      return;
    }
  }

  if (!text) return;

  // Don't process messages from unknown users
  const allowedUsers = process.env.ALLOWED_TELEGRAM_USER_IDS?.split(",") || [];
  if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
    await sendMessage(chatId, "Sorry, I don't recognize you.");
    return;
  }

  // Add user message to history
  addToHistory(userId, "user", `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}] ${text}`);

  const history = getHistory(userId);

  // Check for approval of pending draft
  if (/^(yes|send it|send|approved?|go ahead|confirm)$/i.test(text.trim())) {
    const pendingDraft = await db.getPendingDraft(userId);
    if (pendingDraft) {
      await sendEmail(pendingDraft);
      await db.clearPendingDraft(userId);
      await sendMessage(chatId, `✅ Email sent to ${pendingDraft.to}`);
      addToHistory(userId, "assistant", `Email sent to ${pendingDraft.to}`);
      return;
    }
  }

  // Check for task completion confirmation
  if (/^(done|finished|completed?|mark.*done)$/i.test(text.trim())) {
    const recentTask = await db.getMostRecentTask(userId);
    if (recentTask) {
      await completeTask(recentTask.google_task_id);
      await db.markTaskComplete(recentTask.google_task_id);
      await sendMessage(chatId, `✅ Marked complete: "${recentTask.title}"`);
      addToHistory(userId, "assistant", `Completed task: ${recentTask.title}`);
      return;
    }
  }

  // Send typing indicator
  await sendMessage(chatId, null, "typing");

  // Agentic loop with overall timeout — never let a single message hang the bot
  const LOOP_TIMEOUT_MS = 120_000; // 2 minutes max for entire request
  let messages = history.map(h => ({ role: h.role, content: h.content }));
  let finalResponse = "";
  let iterations = 0;

  const loopTimeout = setTimeout(() => {}, LOOP_TIMEOUT_MS); // reference for cleanup
  const deadline = Date.now() + LOOP_TIMEOUT_MS;

  try {
    while (iterations < 5) {
      if (Date.now() > deadline) {
        console.warn(`Agentic loop timed out for user ${userId} after ${iterations} iterations`);
        finalResponse = finalResponse || "Sorry, that took too long. Try again or simplify your request.";
        break;
      }

      iterations++;

      const response = await callClaude(messages);

      // Collect any text
      const textBlocks = response.content.filter(b => b.type === "text");
      if (textBlocks.length > 0) {
        finalResponse = textBlocks.map(b => b.text).join("\n");
      }

      // If no tool use, we're done
      if (response.stop_reason !== "tool_use") break;

      // Process tool calls
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        try {
          const result = await executeTool(toolUse.name, toolUse.input, userId, chatId);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        } catch (toolErr) {
          console.error(`Tool ${toolUse.name} failed:`, toolErr.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: toolErr.message }),
            is_error: true
          });
        }
      }

      // Add assistant response + tool results to messages
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults }
      ];
    }
  } catch (err) {
    console.error(`Agentic loop error for user ${userId}:`, err.message);
    finalResponse = "Something went wrong on my end. Try again in a moment.";
  } finally {
    clearTimeout(loopTimeout);
  }

  if (finalResponse) {
    await sendMarkdown(chatId, finalResponse);
    addToHistory(userId, "assistant", finalResponse);
  } else {
    await sendMessage(chatId, "Done.");
    addToHistory(userId, "assistant", "Done.");
  }
}
