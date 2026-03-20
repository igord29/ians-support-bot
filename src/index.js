import "dotenv/config";
import express from "express";
import { handleTelegramUpdate } from "./bot.js";
import { runDailyDigest, runMorningBriefing } from "./scheduler.js";
import { db } from "./db.js";
import { sendMessage, setWebhook } from "./telegram.js";
import cron from "node-cron";

// --- Process-level crash protection ---
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION — process staying alive:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION — process staying alive:", reason);
});

const app = express();
app.use(express.json());

// Telegram webhook endpoint
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  console.log("Webhook received:", JSON.stringify(req.body?.message?.text || req.body?.edited_message?.text || "non-text"));
  try {
    await handleTelegramUpdate(req.body);
    console.log("Webhook processed successfully");
  } catch (err) {
    console.error("Webhook error:", err.status || err.code, err.message);
    // Notify Ian on Telegram about the error
    const chatId = req.body?.message?.chat?.id || req.body?.edited_message?.chat?.id;
    if (chatId) {
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `⚠️ Error: ${err.message?.slice(0, 200)}` })
      }).catch(() => {});
    }
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

// Safe cron wrapper — prevents unhandled rejections from killing the process
function safeCron(schedule, name, fn) {
  cron.schedule(schedule, () => {
    console.log(`[cron] ${name} starting...`);
    fn().catch(err => console.error(`[cron] ${name} failed:`, err));
  });
}

safeCron("0 18 * * *", "evening-digest", () => runDailyDigest());
safeCron("0 8 * * *", "morning-briefing", () => runMorningBriefing());
safeCron("0 10,12,14,16 * * *", "pending-check", () => runDailyDigest({ pendingOnly: true }));

// Check for due reminders every minute
cron.schedule("* * * * *", async () => {
  try {
    const due = db.getDueReminders();
    for (const reminder of due) {
      await sendMessage(reminder.chat_id, `⏰ Reminder: ${reminder.message}`);
      db.markReminderSent(reminder.id);
      console.log(`Reminder sent: "${reminder.message}"`);
    }
  } catch (err) {
    console.error("Reminder check error:", err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Ian's agent running on port ${PORT}`);

  // Re-register webhook on every startup — ensures Telegram delivers updates
  // even after a crash/restart where Telegram may have backed off
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await setWebhook(`${webhookUrl}/webhook`);
      console.log(`Webhook registered: ${webhookUrl}/webhook`);
    } catch (err) {
      console.error("Failed to register webhook:", err.message);
    }
  } else {
    console.warn("No WEBHOOK_URL set — webhook not auto-registered");
  }
});
