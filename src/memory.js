// Long-term, human-readable memory the bot curates across conversations.
//
// Primary store: Supabase (public.bot_memory, single row id=1) — persists
// forever, survives redeploys with no Railway volume, and is viewable in the
// Supabase dashboard. Uses the same UNITEDSETS_SUPABASE_* credentials the bot
// already has (override with MEMORY_SUPABASE_URL / MEMORY_SUPABASE_SERVICE_KEY).
//
// Fallback: if no Supabase creds are set, a local memory.md next to the DB
// (persistent only on a Railway volume).
//
// The content is markdown (bulleted facts). It's read into the system prompt
// each turn via a small in-process cache (refreshMemory → getMemory), and the
// `remember` tool / "remember that ..." appends to it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/agent.db");
const MEMORY_FILE = process.env.MEMORY_PATH || path.join(path.dirname(dbPath), "memory.md");

let cache = "";

function supabase() {
  const url = process.env.MEMORY_SUPABASE_URL || process.env.UNITEDSETS_SUPABASE_URL;
  const key = process.env.MEMORY_SUPABASE_SERVICE_KEY || process.env.UNITEDSETS_SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function sbHeaders(c, extra = {}) {
  return { apikey: c.key, Authorization: `Bearer ${c.key}`, ...extra };
}

// ── local file fallback ──
function readFile() {
  try { return fs.readFileSync(MEMORY_FILE, "utf8").trim(); } catch { return ""; }
}
function writeFile(text) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, text);
}

// Sync accessor for the system prompt — returns the last-loaded value.
export function getMemory() {
  return cache;
}

// Pull the latest memory into the cache. Call once per incoming message.
export async function refreshMemory() {
  const c = supabase();
  if (!c) { cache = readFile(); return cache; }
  try {
    const res = await fetch(`${c.url}/rest/v1/bot_memory?select=content&id=eq.1`, {
      headers: sbHeaders(c), signal: AbortSignal.timeout(10_000)
    });
    const rows = await res.json();
    cache = (rows?.[0]?.content || "").trim();
  } catch { /* keep previous cache on transient failure */ }
  return cache;
}

// Append a concise fact and persist. Returns the full memory after writing.
export async function rememberFact(note) {
  const clean = String(note ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return cache;
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${clean}  _(${date})_`;

  const c = supabase();
  if (!c) {
    const updated = (readFile() ? readFile() + "\n" : "") + line;
    writeFile(updated);
    cache = updated.trim();
    return cache;
  }

  const current = await refreshMemory();
  const updated = ((current ? current + "\n" : "") + line).trim();
  await fetch(`${c.url}/rest/v1/bot_memory?id=eq.1`, {
    method: "PATCH",
    headers: sbHeaders(c, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ content: updated, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(10_000)
  });
  cache = updated;
  return cache;
}

export async function clearMemory() {
  const c = supabase();
  if (!c) { writeFile(""); cache = ""; return; }
  await fetch(`${c.url}/rest/v1/bot_memory?id=eq.1`, {
    method: "PATCH",
    headers: sbHeaders(c, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ content: "", updated_at: new Date().toISOString() })
  });
  cache = "";
}
