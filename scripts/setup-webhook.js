// Run once after deployment: node scripts/setup-webhook.js <url>
import "dotenv/config";
import { setWebhook } from "../src/telegram.js";

const WEBHOOK_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`
  : process.argv[2]; // Pass URL as argument

if (!WEBHOOK_URL) {
  console.error("Usage: WEBHOOK_URL=https://your-app.railway.app node scripts/setup-webhook.js");
  process.exit(1);
}

const result = await setWebhook(WEBHOOK_URL);
console.log("Webhook set:", result);
