// Shared, read-only health checks for the bot's delivery chain.
// Used by `scripts/diagnose.js` (CLI) and the in-Telegram `/diag` command.
// Nothing here sends a message or mutates state.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { MODEL } from "./config.js";

const TG = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function tg(method) {
  const res = await fetch(`${TG()}/${method}`);
  return res.json();
}

// Returns an array of { status: "ok"|"warn"|"fail", name, message }.
export async function runDiagnostics() {
  const r = [];
  const ok = (name, message) => r.push({ status: "ok", name, message });
  const warn = (name, message) => r.push({ status: "warn", name, message });
  const fail = (name, message) => r.push({ status: "fail", name, message });

  // Env vars
  for (const key of ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN"]) {
    if (process.env[key]) ok(key, "set");
    else fail(key, "MISSING — bot cannot function");
  }
  for (const key of ["WEBHOOK_URL", "ALLOWED_TELEGRAM_USER_IDS", "TELEGRAM_CHAT_ID"]) {
    if (process.env[key]) ok(key, "set");
    else warn(key, "not set");
  }

  // Database
  try {
    const tasks = db.getPendingTasks("diagnostic-noop");
    ok("SQLite", `reachable (test query returned ${tasks.length} rows)`);
  } catch (err) {
    fail("SQLite", err.message);
  }

  // Telegram token + webhook
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const me = await tg("getMe");
      if (me.ok) ok("Telegram token", `valid — @${me.result.username}`);
      else fail("Telegram token", me.description);
    } catch (err) {
      fail("Telegram token", `network error: ${err.message}`);
    }

    try {
      const info = await tg("getWebhookInfo");
      if (info.ok) {
        const w = info.result;
        if (!w.url) fail("Webhook", "no URL registered — Telegram has nowhere to deliver messages");
        else ok("Webhook", w.url);
        if (w.pending_update_count > 0) warn("Webhook backlog", `${w.pending_update_count} undelivered updates`);
        if (w.last_error_message)
          fail("Webhook delivery", `"${w.last_error_message}" (${new Date(w.last_error_date * 1000).toISOString()})`);
      } else {
        fail("Webhook", info.description);
      }
    } catch (err) {
      fail("Webhook", `network error: ${err.message}`);
    }
  }

  // Anthropic API + model
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await anthropic.messages.create(
        { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "ping" }] },
        { signal: AbortSignal.timeout(30_000) }
      );
      ok("Anthropic", `model "${MODEL}" responded (${resp.stop_reason})`);
    } catch (err) {
      let hint = "";
      if (err.status === 401) hint = " — invalid/expired ANTHROPIC_API_KEY";
      if (err.status === 404) hint = ` — model "${MODEL}" not found/retired`;
      fail("Anthropic", `${err.status || ""} ${err.message}${hint}`.trim());
    }
  }

  return r;
}

const ICON = { ok: "✅", warn: "⚠️", fail: "❌" };

export function formatResults(results) {
  const lines = results.map((x) => `${ICON[x.status]} *${x.name}*: ${x.message}`);
  const fails = results.filter((x) => x.status === "fail").length;
  lines.push("");
  lines.push(fails === 0 ? "All critical checks passed." : `${fails} problem(s) found — start with the first ❌.`);
  return lines.join("\n");
}
