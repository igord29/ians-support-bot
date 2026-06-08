# Setting Up a Second Bot (e.g. for a partner)

This bot is built to run as **multiple independent deployments from one codebase**.
You keep a single repo; each person gets their own Railway service with their own
environment variables, their own Telegram bot, their own database, and their own
Google account. Nothing is shared except the code and (optionally) the Claude /
OpenAI API keys.

This guide assumes you already have the original bot running and you're adding a
second one. Where it says **"her"**, substitute whoever the new bot is for.

---

## What you'll end up with

| Resource              | Yours (existing)        | Hers (new)                          | Shared? |
| --------------------- | ----------------------- | ----------------------------------- | ------- |
| Codebase / repo       | `igord29/ians-support-bot` | same repo                        | ✅ shared |
| Railway service       | existing service        | **new service**                     | ❌ separate |
| Telegram bot          | `@ians_support_bot`     | **new bot via @BotFather**          | ❌ separate |
| Database (SQLite)     | her service's volume    | **new, isolated**                   | ❌ separate |
| Claude API key        | yours                   | reuse yours                         | ✅ shared |
| OpenAI key (voice)    | yours                   | reuse yours                         | ✅ shared |
| Google account        | yours                   | **her own** (calendar/tasks/gmail)  | ❌ separate |

The code already reads everything from environment variables, so a second
deployment is mostly **filling in a new set of env vars** — no code edits needed.

---

## Step 0 — One-time persona setup (already done in code)

The persona is now configurable so the same code can address a different person:

- `AGENT_OWNER_NAME` — the name used in greetings (defaults to `Ian`).
- `AGENT_SYSTEM_PROMPT` — a full system-prompt override (defaults to Ian's prompt).

You'll set both on her service in Step 5. Write her prompt like the default one
in `src/bot.js` but about her. Example:

```
You are Sarah's personal productivity agent. Sarah is a [role] based in [place].
She [context about her work/life]. She sends you ideas, tasks, and thoughts
throughout the day.

Your job:
1. Capture ideas and tasks from natural language.
2. Detect intent: task, calendar event, email draft, reminder, question, or venting.
3. Take action using your tools when intent is clear.
4. Confirm before sending emails or creating events (unless she says "just do it").
5. Be concise. Short messages, bullet points when listing.

Respond in plain text. Use markdown only for lists. Keep responses under 150 words.
```

---

## Step 1 — Create her Telegram bot

1. In Telegram, open **@BotFather** → `/newbot`.
2. Give it a name and a username (must end in `bot`, e.g. `sarahs_support_bot`).
3. BotFather replies with a **bot token** — save it → this is her `TELEGRAM_BOT_TOKEN`.
4. Have **her** open the new bot and send it any message (this creates the chat).
5. Get her IDs from **@userinfobot** (she messages it):
   - Her **user ID** → `ALLOWED_TELEGRAM_USER_IDS`
   - The **chat ID** (same as her user ID for a 1:1 chat) → `TELEGRAM_CHAT_ID`

---

## Step 2 — Her Google credentials (the involved part)

Her calendar, tasks, and email are *her* Google identity, so this part can't be
copied from your keys. You have two routes:

### Route A — Her own service account (cleanest, fully isolated) ✅ recommended

1. Go to **console.cloud.google.com**, signed in as **her** (or create a project for her).
2. Create a **new project** (e.g. "Sarah Assistant").
3. **Enable APIs**: Google Calendar API, Google Tasks API, Gmail API.
4. **Create a service account** → create a **JSON key** → download it.
   - From the JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
     `private_key` → `GOOGLE_SERVICE_ACCOUNT_KEY` (paste the whole value, including
     the `\n`s — the code converts them).
5. **Share her calendar with the service account**: Google Calendar → her calendar
   → Settings → "Share with specific people" → add the `client_email` with
   "Make changes to events". Then set `GOOGLE_CALENDAR_ID` to her calendar's ID
   (Calendar settings → "Integrate calendar" → Calendar ID; often her email).

### Route B — Reuse your existing service account (faster, but watch isolation) ⚠️

You *can* point her bot at your existing `GOOGLE_SERVICE_ACCOUNT_EMAIL` /
`GOOGLE_SERVICE_ACCOUNT_KEY` and just change `GOOGLE_CALENDAR_ID` to her calendar
(after sharing her calendar with that service account). **Calendar isolates fine
this way.** The catch is **Tasks**: both bots authenticate as the *same* service
account, so they'd read/write the *same* task list unless you give her a distinct
`GOOGLE_TASKLIST_ID`. For a partner, Route A avoids this entirely.

> ⚠️ **Gmail caveat for both routes:** sending email needs a per-user OAuth
> refresh token (next step) — that part is always her own, regardless of A or B.

---

## Step 3 — Her Gmail send token

Email sending uses OAuth, not the service account. She needs her own refresh token.

1. You need an OAuth client (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`).
   You can reuse yours **if** you add her Google account as a **Test user** on the
   OAuth consent screen (Google Cloud Console → OAuth consent screen → Test users),
   or create a fresh OAuth client in her project (Route A).
2. Locally, in a checkout of the repo, put those client values in `.env`, then run:
   ```bash
   node scripts/gmail-auth.js
   ```
3. Open the printed URL **while signed in as her**, approve, paste the code back.
4. It prints `GMAIL_REFRESH_TOKEN=...` → save that as her `GMAIL_REFRESH_TOKEN`.
5. Set `GMAIL_FROM_ADDRESS` to her email and `GMAIL_USER_ID=me`.

> If the auth URL errors with something about `oob`/redirect, tell me — that flow
> has been tightened by Google and we may need a tiny tweak to the script.

---

## Step 4 — Create the second Railway service

1. In Railway, open your project (or a new one) → **New → GitHub Repo** → pick
   `igord29/ians-support-bot`. Deploy from the **same `main` branch**.
2. Name it clearly, e.g. `sarah-support-bot`.
3. (Recommended) **Add a Volume** mounted at `/app/data` so her SQLite database
   survives redeploys. Then set `DB_PATH=/app/data/agent.db`. Without a volume the
   DB (tasks, reminders, conversation memory) resets on every redeploy.
4. Don't set the webhook yet — you need the service's public URL first (Step 6).

---

## Step 5 — Set her environment variables

In the new Railway service → **Variables**, set:

```
# Shared with you
ANTHROPIC_API_KEY=<your existing key>
OPENAI_API_KEY=<your existing key>

# Her Telegram bot (Step 1)
TELEGRAM_BOT_TOKEN=<her bot token>
TELEGRAM_CHAT_ID=<her chat id>
ALLOWED_TELEGRAM_USER_IDS=<her telegram user id>

# Her Google service account (Step 2)
GOOGLE_SERVICE_ACCOUNT_EMAIL=<...>
GOOGLE_SERVICE_ACCOUNT_KEY=<full private key>
GOOGLE_CALENDAR_ID=<her calendar id>
GOOGLE_TASKLIST_ID=            # optional; leave blank for her default list

# Her Gmail (Step 3)
GMAIL_FROM_ADDRESS=<her email>
GMAIL_USER_ID=me
GOOGLE_OAUTH_CLIENT_ID=<...>
GOOGLE_OAUTH_CLIENT_SECRET=<...>
GMAIL_REFRESH_TOKEN=<her refresh token>

# Her persona
AGENT_OWNER_NAME=<her name>
AGENT_SYSTEM_PROMPT=<her full prompt from Step 0, optional>

# App
DB_PATH=/app/data/agent.db     # if you attached a volume; else ./data/agent.db
WEBHOOK_URL=                    # fill in after Step 6
```

---

## Step 6 — Deploy, register webhook, verify

1. After the service deploys, copy its **public URL** (Railway → Settings →
   Networking → Generate Domain if needed), e.g.
   `https://sarah-support-bot-production.up.railway.app`.
2. Set `WEBHOOK_URL` to that URL (no trailing slash). The bot **auto-registers the
   webhook on startup** (`src/index.js`), so just redeploy. If you'd rather do it
   manually: `npm run setup-webhook -- https://<her-url>/webhook`.
3. Have her send `/diag` to her bot. You want all ✅ and:
   - `Anthropic: model "claude-sonnet-4-6" responded`
   - `Webhook: https://<her-url>/webhook`
4. Then have her try a real message: *"remind me to call the dentist tomorrow at 2pm"*.

---

## Troubleshooting

- **Silent bot** → she sends `/diag`. The Webhook line is the usual culprit.
- **Calendar/Tasks errors** → the service account isn't shared on her calendar, or
  the Calendar/Tasks APIs aren't enabled in her project.
- **Email fails** → bad/expired `GMAIL_REFRESH_TOKEN`, or her account isn't a Test
  user on the OAuth consent screen. Re-run `scripts/gmail-auth.js` as her.
- **Data resets on redeploy** → attach a Railway Volume and point `DB_PATH` at it
  (Step 4.3).

---

## Keeping both bots in sync

Both services deploy from the same repo, so any fix you push to `main` updates both
on their next deploy. The only per-person differences live in environment
variables — never in the code.
