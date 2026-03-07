import { sendMarkdown } from "./telegram.js";
import { db } from "./db.js";
import { listPendingTasks } from "./google-tasks.js";
import { listTodayEvents } from "./google-calendar.js";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Ian's personal chat ID

export async function runDailyDigest({ pendingOnly = false } = {}) {
  if (!CHAT_ID) {
    console.warn("No TELEGRAM_CHAT_ID set, skipping digest");
    return;
  }

  try {
    const tasks = await listPendingTasks("all");
    const ideas = db.getUnreviewedIdeas(process.env.ALLOWED_TELEGRAM_USER_IDS?.split(",")[0]);

    if (pendingOnly && tasks.length === 0) return; // Nothing to follow up on

    const lines = [];

    if (!pendingOnly) {
      lines.push("📋 *Evening Digest*\n");
    } else {
      lines.push("⏰ *Pending Items Check-in*\n");
    }

    if (tasks.length > 0) {
      lines.push(`*Open Tasks (${tasks.length}):*`);
      tasks.slice(0, 8).forEach(t => {
        const overdue = t.due && new Date(t.due) < new Date();
        lines.push(`• ${overdue ? "🔴 " : ""}${t.title}`);
      });
      if (tasks.length > 8) lines.push(`_...and ${tasks.length - 8} more_`);
    } else {
      lines.push("✅ No open tasks — clean slate!");
    }

    if (!pendingOnly && ideas.length > 0) {
      lines.push(`\n💡 *Captured Ideas Today (${ideas.length}):*`);
      ideas.slice(0, 5).forEach(i => {
        lines.push(`• ${i.idea}`);
      });
    }

    if (!pendingOnly) {
      lines.push("\n_Reply with task titles to mark them done, or ask me anything._");
    } else {
      lines.push("\n_Anything from this list you want to knock out? Or mark done?_");
    }

    await sendMarkdown(CHAT_ID, lines.join("\n"));
  } catch (err) {
    console.error("Digest error:", err);
  }
}

export async function runMorningBriefing() {
  if (!CHAT_ID) return;

  try {
    const [events, tasks] = await Promise.all([
      listTodayEvents(),
      listPendingTasks("all")
    ]);

    const lines = ["☀️ *Good morning, Ian! Here's your day:*\n"];

    if (events.length > 0) {
      lines.push("*📅 Today's Calendar:*");
      events.forEach(e => {
        const time = e.start
          ? new Date(e.start).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York"
            })
          : "All day";
        lines.push(`• ${time} — ${e.title}`);
      });
    } else {
      lines.push("📅 No calendar events today.");
    }

    const highPriority = tasks.filter(t => t.title?.startsWith("🔴"));
    if (highPriority.length > 0) {
      lines.push(`\n*🔴 High Priority (${highPriority.length}):*`);
      highPriority.forEach(t => lines.push(`• ${t.title.replace("🔴 ", "")}`));
    }

    const overdue = tasks.filter(t => t.due && new Date(t.due) < new Date());
    if (overdue.length > 0) {
      lines.push(`\n*⚠️ Overdue (${overdue.length}):*`);
      overdue.forEach(t => lines.push(`• ${t.title}`));
    }

    lines.push(`\n_${tasks.length} total open tasks. Have a great day!_`);

    await sendMarkdown(CHAT_ID, lines.join("\n"));
  } catch (err) {
    console.error("Morning briefing error:", err);
  }
}
