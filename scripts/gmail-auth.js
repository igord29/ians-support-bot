// Generate a Gmail refresh token for the bot (send + read scopes).
// Uses the modern loopback (localhost) OAuth flow — the old "oob" flow was
// shut off by Google in 2023.
//
// Run:  node scripts/gmail-auth.js
//
// Requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.
// The redirect URI below (http://localhost:PORT) must be allowed on your OAuth
// client. Desktop-app clients allow loopback automatically; for a Web-app
// client, add it under Google Cloud → Clients → (your client) → Authorized
// redirect URIs.

import "dotenv/config";
import http from "http";
import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT || 42813);
const REDIRECT_URI = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly"
  ],
  prompt: "consent" // force a refresh_token even on re-auth
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/") { res.writeHead(404); res.end(); return; }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) {
    res.end(`Auth error: ${error}. You can close this tab.`);
    console.error(`\n❌ Google returned: ${error}`);
    server.close(); process.exit(1);
  }
  if (!code) { res.writeHead(400); res.end("No code."); return; }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end("✅ Success! Refresh token captured. Close this tab and return to the terminal.");
    if (tokens.refresh_token) {
      console.log("\n✅ Copy this into Railway → Variables (and your local .env):\n");
      console.log("GMAIL_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
    } else {
      console.log("\n⚠️ Google didn't return a refresh_token (you've authorized before).");
      console.log("   Revoke this app at https://myaccount.google.com/permissions, then run again.\n");
    }
  } catch (e) {
    res.end("Token exchange failed: " + e.message);
    console.error("\n❌ Token exchange failed:", e.message);
  } finally {
    server.close(); process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log(`\nListening on ${REDIRECT_URI}`);
  console.log(`\nIf you get "redirect_uri_mismatch", add this exact URI to your OAuth client's`);
  console.log(`Authorized redirect URIs (Google Cloud → Clients → your client):\n  ${REDIRECT_URI}`);
  console.log(`\n➡️  Open this URL in your browser, sign in as the SENDING Gmail, and approve:\n\n${authUrl}\n`);
});
