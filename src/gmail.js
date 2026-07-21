import { google } from "googleapis";

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return oauth2;
}

function makeRawEmail({ to, subject, body, cc, from }) {
  const lines = [
    `From: ${from || process.env.GMAIL_FROM_ADDRESS}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function draftEmail({ to, subject, body, cc }) {
  // Returns the draft object — actual sending requires explicit approval
  return { to, subject, body, cc, status: "draft" };
}

export async function sendEmail({ to, subject, body, cc }) {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const raw = makeRawEmail({ to, subject, body, cc });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });
}

// Extract the text/plain body from a Gmail message payload (walks MIME parts)
function extractBody(payload) {
  if (payload.body?.data && (payload.mimeType || "").startsWith("text/plain")) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts || []) {
    const found = extractBody(part);
    if (found) return found;
  }
  // Fallback: first HTML part, tags stripped
  if (payload.body?.data && (payload.mimeType || "").startsWith("text/html")) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// List recent messages matching a Gmail search query. Requires the
// gmail.readonly scope (re-run scripts/gmail-auth.js if you get a 403).
export async function listRecentEmails(query, maxResults = 10) {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });

  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
  const out = [];
  for (const ref of list.data.messages || []) {
    const msg = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
    const headers = Object.fromEntries(
      (msg.data.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value])
    );
    out.push({
      id: ref.id,
      from: headers.from || "",
      subject: headers.subject || "(no subject)",
      date: headers.date || "",
      body: extractBody(msg.data.payload || {}).slice(0, 2000)
    });
  }
  return out;
}
