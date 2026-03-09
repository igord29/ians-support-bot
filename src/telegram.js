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

export async function transcribeVoice(fileId) {
  // 1. Get file path from Telegram
  const fileInfo = await call("getFile", { file_id: fileId });
  if (!fileInfo.ok) throw new Error(`Telegram getFile failed: ${fileInfo.description}`);

  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

  // 2. Download the audio file
  const audioRes = await fetch(fileUrl);
  if (!audioRes.ok) throw new Error(`Failed to download voice file: ${audioRes.status}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  // 3. Send to OpenAI Whisper for transcription
  const formData = new FormData();
  formData.append("file", new File([audioBuffer], "voice.ogg", { type: "audio/ogg" }));
  formData.append("model", "whisper-1");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData
  });

  const result = await whisperRes.json();
  if (result.error) throw new Error(`Whisper: ${result.error.message}`);
  return result.text;
}
