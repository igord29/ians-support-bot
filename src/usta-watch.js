// USTA tournament watcher.
//
// playtennis.usta.com sits behind Cloudflare bot protection, so servers cannot
// poll the admin/public pages directly. Instead we watch Gmail for USTA
// notification emails (tournament published/sanctioned/etc), notify Ian on
// Telegram, and drop the email into conversation history so a reply like
// "add it to the site" lets Claude create it via the approval-gated
// create_tournament tool.
//
// Enable with USTA_WATCH=on (requires the gmail.readonly scope — re-run
// scripts/gmail-auth.js after updating scopes). Optional: USTA_EMAIL_QUERY.

import { listRecentEmails } from "./gmail.js";
import { sendMarkdown } from "./telegram.js";
import { db } from "./db.js";

const DEFAULT_QUERY = "from:(usta.com OR playtennis.usta.com OR clubspark.com) newer_than:3d";

export async function checkUstaEmails() {
  if ((process.env.USTA_WATCH || "").toLowerCase() !== "on") return;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const query = process.env.USTA_EMAIL_QUERY || DEFAULT_QUERY;
  const emails = await listRecentEmails(query, 10);
  const ownerId = process.env.ALLOWED_TELEGRAM_USER_IDS?.split(",")[0]?.trim();

  for (const email of emails) {
    if (db.hasSeenEmail(email.id)) continue;
    db.markEmailSeen(email.id, email.subject);

    const preview = email.body.replace(/\s+/g, " ").slice(0, 400);
    const note = [
      `📬 *USTA update*`,
      `*${email.subject}*`,
      `_${email.from}_`,
      "",
      preview,
      "",
      `_Reply "add it to the site" to create this on unitedsets.com, or ignore._`
    ].join("\n");

    await sendMarkdown(chatId, note);

    // Give Claude the context so a follow-up reply can act on it
    if (ownerId) {
      db.addConversationTurn(
        ownerId,
        "assistant",
        `USTA email received — subject: "${email.subject}". Body: ${email.body.slice(0, 1200)}. ` +
        `If Ian asks to add this to the site, extract the tournament details and call create_tournament.`
      );
    }
    console.log(`[usta-watch] notified: ${email.subject}`);
  }
}
