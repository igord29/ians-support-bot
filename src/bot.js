import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendMarkdown, transcribeVoice } from "./telegram.js";
import { db } from "./db.js";
import { MODEL } from "./config.js";
import { runDiagnostics, formatResults } from "./diagnostics.js";
import { readMemory, rememberFact } from "./memory.js";
import { createCalendarEvent, listTodayEvents } from "./google-calendar.js";
import { draftEmail, sendEmail } from "./gmail.js";
import { addGoogleTask, listPendingTasks, completeTask } from "./google-tasks.js";
import * as unitedsets from "./unitedsets.js";
import * as github from "./github.js";
import * as vercel from "./vercel.js";
import * as web from "./web.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const API_TIMEOUT_MS = 30_000; // 30 seconds — if Claude hasn't responded, abort
const MAX_RETRIES = 2;

// Fold the persisted long-term memory into the system prompt each turn.
function buildSystemPrompt() {
  const memory = readMemory();
  return memory
    ? `${SYSTEM_PROMPT}\n\n# Long-term memory (durable notes about Ian — use when relevant)\n${memory}`
    : SYSTEM_PROMPT;
}

async function callClaude(messages, { retries = MAX_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await anthropic.messages.create(
        {
          model: MODEL,
          max_tokens: 4096, // headroom for tools that emit file contents (e.g. github_commit_file)
          system: buildSystemPrompt(),
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

// Conversation history is persisted in SQLite (survives restarts/crashes).
// We keep the last 20 turns within a 2-hour TTL window for context.
function getHistory(userId) {
  return db.getRecentConversation(userId, { limitTurns: 20, ttlHours: 2 });
}

function addToHistory(userId, role, content) {
  db.addConversationTurn(userId, role, content);
}

const DEFAULT_SYSTEM_PROMPT = `You are Ian's personal productivity agent. Ian is a solo developer, nonprofit founder, and marketing professional based in Westchester County / Long Island, NY. He runs Community Literacy Club (youth tennis & chess) and builds AI-powered applications. He's always on the move and sends you ideas, tasks, and thoughts throughout the day.

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

// Guidance for the action tools — appended to whichever persona prompt is active.
const TOOL_GUIDANCE = `

You also have action tools for UnitedSets (tournaments/match play in Supabase), GitHub (read files, commit to a branch, open PRs, check CI, list issues), Vercel (deploy status, build logs, trigger deploy), and the web (fetch a URL, search).

IMPORTANT — approval flow: write actions (updating/creating tournaments, adding match-play players, committing code, opening PRs, triggering deploys) do NOT execute immediately. The tool returns pending_approval: true with a summary. When that happens, relay the summary and ask for a "yes" to confirm. Never claim the action is done until it has actually executed. Read actions (listing, fetching, statuses, logs, search) run immediately.

GitHub safety: commits always go to a feature branch, never main. To ship a change: commit to a branch, open a PR, and share the PR link.

When asked to update the website for tournaments or match play, use the UnitedSets tools (the site reads from that database). Look up the tournament with list_tournaments first if you need its id.`;

// Per-deployment override. Set AGENT_SYSTEM_PROMPT to run a bot for someone
// else (e.g. a partner) without touching code. Falls back to the default above.
const SYSTEM_PROMPT = (process.env.AGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT) + TOOL_GUIDANCE;

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
  },

  // ── UnitedSets (unitedsets.com — Supabase) ────────────────────────────
  {
    name: "list_tournaments",
    description: "List tournaments and match-play events on unitedsets.com. Call this first when the user mentions an event by name, to find its id.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status, e.g. upcoming, open, in_progress, completed" },
        type: { type: "string", description: "Filter by type: tournament or match_play" },
        limit: { type: "number", default: 10 }
      }
    }
  },
  {
    name: "update_tournament",
    description: "Update a tournament or match-play event on unitedsets.com (dates, status, location, fee, featured, etc). Requires approval before it executes.",
    input_schema: {
      type: "object",
      properties: {
        tournament_id: { type: "number" },
        fields: {
          type: "object",
          description: "Only the fields to change. Allowed: name, description, start_date, end_date, registration_deadline, location, address, entry_fee, max_participants, status, featured, format, surface, type, rules, contact_email, contact_phone, image_url, usta_registration_url, use_external_registration"
        }
      },
      required: ["tournament_id", "fields"]
    }
  },
  {
    name: "create_tournament",
    description: "Create a new tournament or match-play event on unitedsets.com. Ask for at least name + start_date; sensible defaults fill the rest. Requires approval before it executes.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["tournament", "match_play"], default: "tournament" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD, defaults to start_date" },
        registration_deadline: { type: "string", description: "YYYY-MM-DD" },
        location: { type: "string" },
        address: { type: "string" },
        entry_fee: { type: "number" },
        max_participants: { type: "number" },
        description: { type: "string" },
        format: { type: "string", description: "e.g. single_elimination, round_robin" },
        surface: { type: "string", description: "e.g. hard, clay, grass" },
        featured: { type: "boolean" }
      },
      required: ["name", "start_date"]
    }
  },
  {
    name: "add_match_play_player",
    description: "Add a player to a match-play event on unitedsets.com. Requires approval before it executes.",
    input_schema: {
      type: "object",
      properties: {
        tournament_id: { type: "number", description: "The match-play event's id from list_tournaments" },
        player_name: { type: "string" },
        utr_rating: { type: "number" },
        wtn_rating: { type: "number" }
      },
      required: ["tournament_id", "player_name"]
    }
  },

  // ── GitHub ────────────────────────────────────────────────────────────
  {
    name: "github_get_file",
    description: "Read a file (or list a directory) from one of Ian's GitHub repos.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repo name only, e.g. ians-support-bot" },
        path: { type: "string", description: "File or directory path, e.g. src/index.js or src" },
        ref: { type: "string", description: "Branch or commit, defaults to the default branch" }
      },
      required: ["repo", "path"]
    }
  },
  {
    name: "github_commit_file",
    description: "Create or update ONE file in a repo, committing to a feature branch (never main). Requires approval before it executes.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        branch: { type: "string", description: "Feature branch name, e.g. bot/update-homepage. Created from the default branch if it doesn't exist." },
        path: { type: "string" },
        content: { type: "string", description: "FULL new file content (not a diff)" },
        message: { type: "string", description: "Commit message" }
      },
      required: ["repo", "branch", "path", "content", "message"]
    }
  },
  {
    name: "github_open_pr",
    description: "Open a pull request from a feature branch to the default branch. Requires approval before it executes.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        branch: { type: "string", description: "The feature branch with the changes" },
        title: { type: "string" },
        body: { type: "string" }
      },
      required: ["repo", "branch", "title"]
    }
  },
  {
    name: "github_check_ci",
    description: "Check CI/check-run status for a branch or commit in a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        ref: { type: "string", description: "Branch or commit, defaults to the default branch" }
      },
      required: ["repo"]
    }
  },
  {
    name: "github_list_issues",
    description: "List open issues in one of Ian's repos.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" }
      },
      required: ["repo"]
    }
  },

  // ── Vercel ────────────────────────────────────────────────────────────
  {
    name: "vercel_deploy_status",
    description: "Get the latest Vercel deployments and their states (READY/ERROR/BUILDING). Optionally filter by project name.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Vercel project name, optional" }
      }
    }
  },
  {
    name: "vercel_build_logs",
    description: "Get the tail of the build log for a specific deployment (use vercel_deploy_status first to get the deployment id).",
    input_schema: {
      type: "object",
      properties: {
        deployment_id: { type: "string" }
      },
      required: ["deployment_id"]
    }
  },
  {
    name: "vercel_trigger_deploy",
    description: "Trigger a fresh deploy of the main site via its deploy hook. Requires approval before it executes.",
    input_schema: { type: "object", properties: {} }
  },

  // ── Web ───────────────────────────────────────────────────────────────
  {
    name: "web_fetch",
    description: "Fetch a URL and return its readable text (e.g. to check a live page or read an article).",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    }
  },
  {
    name: "web_search",
    description: "Search the web and return the top results.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "remember",
    description: "Save a durable fact or preference to long-term memory so you recall it in future conversations (persists across restarts). Use when Ian shares a lasting preference, a recurring detail, or says 'remember ...'. Keep each note concise.",
    input_schema: {
      type: "object",
      properties: { note: { type: "string", description: "The fact to remember, phrased concisely" } },
      required: ["note"]
    }
  }
];

// ── Action tools: executors + approval gate ─────────────────────────────
// Write actions are proposed, summarized in Telegram, and only executed after
// an explicit "yes" (same pattern as email drafts). Reads run immediately.

const ACTION_EXECUTORS = {
  // UnitedSets
  list_tournaments: (i) => unitedsets.listTournaments(i),
  update_tournament: (i) => unitedsets.updateTournament(i.tournament_id, i.fields),
  create_tournament: (i) => unitedsets.createTournament(i),
  add_match_play_player: (i) => unitedsets.addMatchPlayPlayer(i),
  // GitHub
  github_get_file: (i) => github.getFile(i),
  github_commit_file: (i) => github.commitFile(i),
  github_open_pr: (i) => github.openPullRequest(i),
  github_check_ci: (i) => github.checkCI(i),
  github_list_issues: (i) => github.listIssues(i),
  // Vercel
  vercel_deploy_status: (i) => vercel.deployStatus(i),
  vercel_build_logs: (i) => vercel.buildLogs(i),
  vercel_trigger_deploy: () => vercel.triggerDeploy(),
  // Web
  web_fetch: (i) => web.webFetch(i),
  web_search: (i) => web.webSearch(i)
};

const APPROVAL_REQUIRED = new Set([
  "update_tournament",
  "create_tournament",
  "add_match_play_player",
  "github_commit_file",
  "github_open_pr",
  "vercel_trigger_deploy"
]);

function summarizeAction(toolName, input) {
  switch (toolName) {
    case "update_tournament":
      return `Update tournament #${input.tournament_id} on unitedsets.com: ${JSON.stringify(input.fields)}`;
    case "create_tournament":
      return `Create ${input.type || "tournament"} "${input.name}" on unitedsets.com starting ${input.start_date}`;
    case "add_match_play_player":
      return `Add player "${input.player_name}" to match-play event #${input.tournament_id}`;
    case "github_commit_file":
      return `Commit to ${input.repo} (branch ${input.branch}): ${input.path} — "${input.message}"`;
    case "github_open_pr":
      return `Open PR in ${input.repo} from branch ${input.branch}: "${input.title}"`;
    case "vercel_trigger_deploy":
      return `Trigger a fresh Vercel deploy of the site`;
    default:
      return `${toolName}: ${JSON.stringify(input).slice(0, 200)}`;
  }
}

async function executePendingAction(action) {
  const executor = ACTION_EXECUTORS[action.tool_name];
  if (!executor) throw new Error(`Unknown pending action tool: ${action.tool_name}`);
  return executor(action.payload);
}

async function executeTool(toolName, toolInput, userId, chatId) {
  console.log(`Executing tool: ${toolName}`, toolInput);

  // Action tools (UnitedSets / GitHub / Vercel / Web)
  if (ACTION_EXECUTORS[toolName]) {
    if (APPROVAL_REQUIRED.has(toolName)) {
      const summary = summarizeAction(toolName, toolInput);
      const id = db.savePendingAction({
        user_id: userId,
        chat_id: chatId.toString(),
        tool_name: toolName,
        payload: toolInput,
        summary
      });
      return {
        pending_approval: true,
        action_id: id,
        summary,
        instructions: "Not executed yet. Relay this summary and ask for a 'yes' to confirm."
      };
    }
    return ACTION_EXECUTORS[toolName](toolInput);
  }

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
    case "remember": {
      rememberFact(toolInput.note);
      return { success: true, remembered: toolInput.note };
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

  // Show the bot's long-term memory
  if (/^\/memory\b/i.test(text.trim())) {
    const mem = readMemory();
    await sendMarkdown(chatId, mem
      ? `🧠 *Long-term memory:*\n${mem}`
      : `🧠 Memory is empty. Say things like "remember that I prefer morning meetings" and I'll keep them.`);
    return;
  }

  // Self-diagnostics command — reports config/health from inside Telegram.
  // Restricted to authorized users (it reveals which env vars are set).
  if (/^\/(diag|health)\b/.test(text.trim())) {
    await sendMessage(chatId, null, "typing");
    try {
      const results = await runDiagnostics();
      await sendMarkdown(chatId, formatResults(results));
    } catch (err) {
      await sendMessage(chatId, `Diagnostics failed to run: ${err.message}`);
    }
    return;
  }

  // Add user message to history
  addToHistory(userId, "user", `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}] ${text}`);

  const history = getHistory(userId);

  // Check for approval/rejection of a pending action (site update, commit, deploy)
  const isApproval = /^(yes|approved?|go ahead|confirm|do it|send it|send)$/i.test(text.trim());
  const isRejection = /^(no|nope|cancel|reject|don'?t|stop)$/i.test(text.trim());
  if (isApproval || isRejection) {
    const action = db.getPendingAction(userId);
    if (action) {
      if (isRejection) {
        db.resolvePendingAction(action.id, "rejected");
        await sendMessage(chatId, `🚫 Cancelled: ${action.summary}`);
        addToHistory(userId, "assistant", `Cancelled pending action: ${action.summary}`);
        return;
      }
      await sendMessage(chatId, null, "typing");
      try {
        const result = await executePendingAction(action);
        db.resolvePendingAction(action.id, "executed");
        await sendMarkdown(chatId, `✅ Done: ${action.summary}\n\`${JSON.stringify(result).slice(0, 300)}\``);
        addToHistory(userId, "assistant", `Executed: ${action.summary}. Result: ${JSON.stringify(result).slice(0, 300)}`);
      } catch (err) {
        db.resolvePendingAction(action.id, "failed");
        await sendMessage(chatId, `❌ Failed: ${action.summary}\n${err.message}`);
        addToHistory(userId, "assistant", `Failed to execute: ${action.summary}. Error: ${err.message}`);
      }
      return;
    }
  }

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
