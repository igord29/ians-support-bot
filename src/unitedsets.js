// UnitedSets tournament & match-play tools — talks to the Supabase project
// (tables: tournaments, match_play_participants) via the PostgREST API.
// Requires: UNITEDSETS_SUPABASE_URL, UNITEDSETS_SUPABASE_SERVICE_KEY.
// All writes are approval-gated in bot.js before these functions are called.

const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

function headers() {
  const key = process.env.UNITEDSETS_SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

function base() {
  const url = process.env.UNITEDSETS_SUPABASE_URL;
  if (!url || !process.env.UNITEDSETS_SUPABASE_SERVICE_KEY) {
    throw new Error("UnitedSets is not configured — set UNITEDSETS_SUPABASE_URL and UNITEDSETS_SUPABASE_SERVICE_KEY");
  }
  return `${url.replace(/\/$/, "")}/rest/v1`;
}

async function rest(method, path, body) {
  const res = await fetch(`${base()}/${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: TIMEOUT(20_000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Admin user id recorded on rows the bot creates (created_by is NOT NULL)
const adminId = () => parseInt(process.env.UNITEDSETS_ADMIN_USER_ID || "1", 10);

export async function listTournaments({ status, type, limit = 10 } = {}) {
  const cols = "id,name,type,status,start_date,end_date,registration_deadline,location,entry_fee,max_participants,current_participants,featured";
  let q = `tournaments?select=${cols}&order=start_date.desc&limit=${limit}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  if (type) q += `&type=eq.${encodeURIComponent(type)}`;
  return rest("GET", q);
}

export async function updateTournament(id, fields) {
  // Only allow known columns through — nothing structural
  const allowed = [
    "name", "description", "start_date", "end_date", "registration_deadline",
    "location", "address", "entry_fee", "max_participants", "status", "featured",
    "format", "surface", "type", "rules", "contact_email", "contact_phone",
    "image_url", "usta_registration_url", "use_external_registration"
  ];
  const patch = {};
  for (const k of allowed) if (fields[k] !== undefined) patch[k] = fields[k];
  if (Object.keys(patch).length === 0) throw new Error("No updatable fields provided");
  patch.updated_at = new Date().toISOString();
  const rows = await rest("PATCH", `tournaments?id=eq.${id}`, patch);
  if (!rows?.length) throw new Error(`Tournament ${id} not found`);
  return rows[0];
}

export async function createTournament(input) {
  // The table has many NOT NULL columns; fill safe defaults for anything
  // not dictated over Telegram so a quick message can still create an event.
  const row = {
    name: input.name,
    description: input.description || input.name,
    start_date: input.start_date,
    end_date: input.end_date || input.start_date,
    registration_deadline: input.registration_deadline || input.start_date,
    location: input.location || "TBD",
    address: input.address || "TBD",
    entry_fee: input.entry_fee ?? 0,
    max_participants: input.max_participants ?? 32,
    categories: input.categories || [],
    format: input.format || "single_elimination",
    surface: input.surface || "hard",
    status: input.status || "upcoming",
    prizes: input.prizes || {},
    rules: input.rules || "TBD",
    contact_email: input.contact_email || process.env.UNITEDSETS_CONTACT_EMAIL || "",
    contact_phone: input.contact_phone || process.env.UNITEDSETS_CONTACT_PHONE || "",
    image_url: input.image_url || "",
    usta_registration_url: input.usta_registration_url || "",
    featured: input.featured ?? false,
    type: input.type || "tournament",
    use_external_registration: input.use_external_registration ?? false,
    created_by: adminId()
  };
  const rows = await rest("POST", "tournaments", row);
  return rows[0];
}

export async function addMatchPlayPlayer({ tournament_id, player_name, utr_rating, wtn_rating, user_id }) {
  const rows = await rest("POST", "match_play_participants", {
    tournament_id,
    user_id: user_id ?? adminId(),
    player_name,
    utr_rating: utr_rating ?? 0,
    wtn_rating: wtn_rating ?? 0,
    source: "telegram_bot",
    created_by: adminId()
  });
  return rows[0];
}
