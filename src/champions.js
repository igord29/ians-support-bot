// Champion intake — the Telegram half of the Hall of Champions pipeline.
//
// You text the bot a player photo plus details; this module hosts the photo at
// a public URL (Canva's asset upload requires a URL) and stages a row in
// public.pending_champions. The Canva card is produced separately — see
// CLAUDE.md — and only then does the champion go live in public.champions.
//
// Needs UNITEDSETS_SUPABASE_URL, UNITEDSETS_SUPABASE_SERVICE_KEY and
// CHAMPION_UPLOAD_SECRET (the champion-upload edge function's shared secret).

const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

// The project URL is all the edge function needs; the service key is only
// required for direct PostgREST access.
function baseUrl() {
  const url = process.env.UNITEDSETS_SUPABASE_URL;
  if (!url) throw new Error("UNITEDSETS_SUPABASE_URL is not set");
  return url.replace(/\/$/, "");
}

function config() {
  const key = process.env.UNITEDSETS_SUPABASE_SERVICE_KEY;
  if (!key) throw new Error("UNITEDSETS_SUPABASE_SERVICE_KEY is not set");
  return { base: baseUrl(), key };
}

async function rest(method, path, body) {
  const { base, key } = config();
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: TIMEOUT(20_000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Copy an image (e.g. a Telegram file URL) into the champions bucket and
// return its public URL.
export async function uploadImage({ source_url, folder = "photos", filename }) {
  const base = baseUrl();
  const secret = process.env.CHAMPION_UPLOAD_SECRET;
  if (!secret) throw new Error("CHAMPION_UPLOAD_SECRET is not set");

  const res = await fetch(`${base}/functions/v1/champion-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-champion-secret": secret },
    body: JSON.stringify({ source_url, folder, filename }),
    signal: TIMEOUT(45_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`Photo upload failed: ${data.error || res.status}`);
  return data.public_url;
}

// Stage a champion for card creation. Returns the pending row.
export async function stageChampion(fields) {
  const allowed = ["photo_url", "name", "venue", "event_dates", "level", "age_group", "category", "flight", "notes"];
  const row = {};
  for (const k of allowed) if (fields[k] !== undefined && fields[k] !== null) row[k] = fields[k];
  if (!row.photo_url) throw new Error("photo_url is required — send the player photo first");
  const rows = await rest("POST", "pending_champions", row);
  return rows[0];
}

export async function listPendingChampions() {
  return rest(
    "GET",
    "pending_champions?select=id,name,venue,event_dates,level,age_group,category,flight,photo_url,created_at" +
      "&status=eq.awaiting_card&order=created_at.desc&limit=20"
  );
}
