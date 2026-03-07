import "dotenv/config";
import express from "express";
import { handleTelegramUpdate } from "./bot.js";
import { runDailyDigest, runMorningBriefing } from "./scheduler.js";
import cron from "node-cron";

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
    const chatId = req.body?.message?.chat?.id;
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

// Daily digest at 6:00 PM
cron.schedule("0 18 * * *", () => {
  console.log("Running evening digest...");
  runDailyDigest();
});

// Morning briefing at 8:00 AM
cron.schedule("0 8 * * *", () => {
  console.log("Running morning briefing...");
  runMorningBriefing();
});

// Pending item follow-up check every 2 hours during day
cron.schedule("0 10,12,14,16 * * *", () => {
  console.log("Checking pending items...");
  runDailyDigest({ pendingOnly: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ian's agent running on port ${PORT}`));
