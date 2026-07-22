// Receives USTA tournaments from a Make.com scenario (which polls USTA's
// public GraphQL API — the bot can't, it's Cloudflare-blocked) and, for each
// genuinely new one, stages an approval-gated create_tournament and pings Ian
// on Telegram. He replies "yes" to publish it to unitedsets.com.
//
// Make posts the raw `paginatedPublishedTournaments.items` array. Dedupe is by
// USTA tournament id (seen_usta_tournaments table).

import { sendMarkdown } from "./telegram.js";
import { db } from "./db.js";

// Map a USTA tournament object to create_tournament input (unitedsets schema).
export function mapUstaTournament(t) {
  const loc = t.primaryLocation || {};
  const fee = t.events?.[0]?.pricing?.entryFee?.amount;
  return {
    name: t.name,
    start_date: t.timings?.startDate,
    end_date: t.timings?.endDate || t.timings?.startDate,
    registration_deadline: t.registrationRestrictions?.entriesCloseDate || t.timings?.startDate,
    location: loc.name || loc.town || "TBD",
    address: [loc.address1, loc.town, loc.postcode].filter(Boolean).join(", ") || "TBD",
    entry_fee: typeof fee === "number" ? fee : 0,
    type: "tournament",
    usta_registration_url: "https://playtennis.usta.com/Competitions/5dmedia/Tournaments/",
    description: `Imported from USTA (tournament ${t.id}).`
  };
}

export async function handleUstaWebhook(items = []) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const ownerId = process.env.ALLOWED_TELEGRAM_USER_IDS?.split(",")[0]?.trim();
  const summary = { received: items.length, new: 0, skipped: 0 };

  for (const t of items) {
    if (!t?.id || t.isCancelled) { summary.skipped++; continue; }
    if (db.hasSeenUstaTournament(t.id)) { summary.skipped++; continue; }
    db.markUstaTournamentSeen(t.id, t.name);
    summary.new++;

    const mapped = mapUstaTournament(t);
    if (ownerId && chatId) {
      // Stage the create so a plain "yes" executes it via the existing approval path
      db.savePendingAction({
        user_id: ownerId,
        chat_id: chatId.toString(),
        tool_name: "create_tournament",
        payload: mapped,
        summary: `Create tournament "${mapped.name}" on unitedsets.com (starts ${mapped.start_date}, from USTA)`
      });
      await sendMarkdown(chatId, [
        `🎾 *New USTA tournament published*`,
        `*${mapped.name}*`,
        `${mapped.start_date} → ${mapped.end_date}`,
        `${mapped.location}${mapped.entry_fee ? ` · entry ${mapped.entry_fee}` : ""}`,
        "",
        `Reply *yes* to add it to unitedsets.com, or *no* to skip.`
      ].join("\n"));
    }
    console.log(`[usta-webhook] new tournament staged: ${mapped.name}`);
  }
  return summary;
}
