import { google } from "googleapis";
import readline from "readline";
import dotenv from "dotenv";
dotenv.config();

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/gmail.send"],
  prompt: "consent",
});

console.log("\nSTEP 1: Open this URL in your browser:\n\n" + authUrl + "\n");
console.log("STEP 2: Sign in with your Gmail and approve.");
console.log("STEP 3: Copy the code shown.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste the code here: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n✅ Add this to your .env:\n");
    console.log("GMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
  } catch (err) {
    console.error("❌ Failed:", err.message);
  }
});