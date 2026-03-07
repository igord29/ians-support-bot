const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function sendMessage(chatId, text, action) {
  if (action === "typing") {
    return call("sendChatAction", { chat_id: chatId, action: "typing" });
  }
  if (!text) return;
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown"
  });
}

export async function sendMarkdown(chatId, text) {
  // Escape problematic markdown chars for Telegram's parser
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown"
  });
}

export async function setWebhook(url) {
  return call("setWebhook", { url });
}
