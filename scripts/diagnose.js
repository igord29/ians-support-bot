// Diagnose why the bot isn't responding.
// Run on the same machine/env as the bot so it sees the same env vars:
//   npm run diagnose
//
// Read-only: checks env vars, the DB, the Telegram token + webhook (the #1
// cause of silence), and a live Anthropic call with the bot's exact model.

import "dotenv/config";
import { runDiagnostics } from "../src/diagnostics.js";

const ICON = { ok: "✅", warn: "⚠️ ", fail: "❌" };

const results = await runDiagnostics();
for (const x of results) console.log(`${ICON[x.status]} ${x.name}: ${x.message}`);

const fails = results.filter((x) => x.status === "fail").length;
console.log("\n" + "─".repeat(50));
if (fails === 0) console.log("✅ All critical checks passed. Still silent? Check `pm2 logs` / your host's logs.");
else console.log(`❌ ${fails} problem(s) found — start with the first ❌ above.`);
process.exit(fails === 0 ? 0 : 1);
