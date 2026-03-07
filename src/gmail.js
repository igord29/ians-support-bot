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
