// Long-term, human-readable memory for the bot — a markdown file the agent
// curates over time (durable facts and preferences about Ian). It's read into
// the system prompt at the start of every turn, and the `remember` tool /
// "remember that ..." appends to it.
//
// The file lives next to the SQLite DB (same data dir), so attaching a Railway
// Volume at that directory persists it across redeploys. Override with
// MEMORY_PATH if you want it elsewhere.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/agent.db");
const MEMORY_FILE = process.env.MEMORY_PATH || path.join(path.dirname(dbPath), "memory.md");

export const memoryFilePath = MEMORY_FILE;

export function readMemory() {
  try {
    return fs.readFileSync(MEMORY_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

// Append a concise fact as a bullet. Returns the full memory after writing.
export function rememberFact(note) {
  const clean = String(note ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return readMemory();
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(MEMORY_FILE, `- ${clean}  _(${date})_\n`);
  return readMemory();
}

export function clearMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, "");
  } catch { /* nothing to clear */ }
}
