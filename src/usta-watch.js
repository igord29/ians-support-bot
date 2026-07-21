// USTA tournament watcher.
//
// playtennis.usta.com sits behind Cloudflare bot protection, so servers cannot
// poll the admin/public pages directly. Two signals reach us by email instead:
//   1. USTA's own organizer notification emails
//   2. A page-change monitor (e.g. Visualping, free tier) watching
//      https://playtennis.usta.com/Competitions/5dmedia/Tournaments/ — those
//      services run real browsers, so Cloudflare lets them through, and they
//      email when the page content changes.
// This watcher checks Gmail for either, notifies Ian on Telegram, and drops
// the email into conversation history so a reply like "add it to the site"
// lets Claude create the tournament via the approval-gated create_tournament
// tool. The bot itself never touches the USTA site.
//
// Enable with USTA_WATCH=on (requires the gmail.readonly scope — re-run
// scripts/gmail-auth.js after updating scopes). Optional: USTA_EMAIL_QUERY,
// USTA_WATCH_CRON.

import { listRecentEmails } from "./gmail.js";
import { sendMarkdown } from "./telegram.js";
import { db } from "./db.js";

const DEFAULT_QUERY =
  "from:(usta.com OR playtennis.usta.com OR clubspark.com OR visualping.io OR distill.io OR changedetection.io) newer_than:3d";

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

    const isPageMonitor = /visualping|distill|changedetection/i.test(email.from);
    const preview = email.body.replace(/\s+/g, " ").slice(0, 400);
    const note = [
      isPageMonitor ? `👀 *USTA tournaments page changed*` : `📬 *USTA update*`,
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
        `${isPageMonitor ? "USTA tournaments page-change alert" : "USTA email"} received — ` +
        `subject: "${email.subject}". Body: ${email.body.slice(0, 1200)}. ` +
        `If Ian asks to add this to the site, extract the tournament details (ask him for any that are missing, ` +
        `like the start date) and call create_tournament.`
      );
    }
    console.log(`[usta-watch] notified: ${email.subject}`);
  }
}
