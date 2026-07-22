# Action Tools — Setup

The bot has four groups of action tools. Each activates when its env vars are
set on Railway (missing config = the tool explains what's needed, nothing breaks).
**Every write action requires you to reply "yes" in Telegram before it executes**
("no"/"cancel" rejects it; proposals expire after 1 hour).

## 1. UnitedSets (tournaments & match play)

Tools: `list_tournaments`, `update_tournament`*, `create_tournament`*,
`add_match_play_player`* (* = approval-gated)

Writes to the `Unitedsets` Supabase project (`tournaments`,
`match_play_participants` tables).

1. supabase.com → Unitedsets project → **Settings → API**
2. Copy the **URL** → `UNITEDSETS_SUPABASE_URL` (https://azxnvsytmmcdcrlgpagz.supabase.co)
3. Copy the **service_role key** → `UNITEDSETS_SUPABASE_SERVICE_KEY`
   (⚠️ full DB access — that's why writes are approval-gated; never expose it client-side)
4. Optional: `UNITEDSETS_ADMIN_USER_ID` (your `users.id`, used for `created_by`;
   defaults to 1), `UNITEDSETS_CONTACT_EMAIL`, `UNITEDSETS_CONTACT_PHONE`
   (defaults for bot-created tournaments).

Try: *"what tournaments are on the site?"* → *"mark the July 26th one as featured"* → reply **yes**.

## 2. GitHub

Tools: `github_get_file`, `github_commit_file`*, `github_open_pr`*,
`github_check_ci`, `github_list_issues`

1. github.com → Settings → Developer settings → **Fine-grained tokens** → Generate new token
2. Repository access: **All repositories** (or select specific ones)
3. Permissions: **Contents: Read and write**, **Pull requests: Read and write**
4. Token → `GITHUB_TOKEN`. Set `GITHUB_OWNER=igord29`.
5. Optional: `GITHUB_ALLOWED_REPOS=repo1,repo2` to restrict which repos the bot
   may touch (blank = all repos under GITHUB_OWNER). The bot can never touch
   other accounts' repos, and never commits to a default branch — it always
   uses a feature branch, then opens a PR you merge.

Try: *"read the README in ians-support-bot"* or *"fix the typo on the 5DHomepage hero and open a PR"*.

## 3. Vercel

Tools: `vercel_deploy_status`, `vercel_build_logs`, `vercel_trigger_deploy`*

1. vercel.com → Account Settings → **Tokens** → create → `VERCEL_TOKEN`
2. If your projects are in a team: team's Settings → General → Team ID → `VERCEL_TEAM_ID`
3. For deploys: the site's project → Settings → Git → **Deploy Hooks** →
   create one for the production branch → URL → `VERCEL_DEPLOY_HOOK_URL`

Try: *"did the last deploy succeed?"* → *"show me the build log"*.

## 4. Web

Tools: `web_fetch` (no key needed), `web_search`

For search: free API key at brave.com/search/api → `BRAVE_API_KEY`.

Try: *"check what the live unitedsets homepage says about the next tournament"*.

## 5. USTA → UnitedSets auto-import (Make.com) ⭐ primary

Automatically surfaces newly-published USTA tournaments (for **both** your org
sections) and offers to add them to unitedsets.com — you just reply "yes."

**How it works.** USTA's site is Cloudflare-protected, so the bot can't poll it.
A **Make.com scenario** (already created in your account: *"USTA → UnitedSets
bot (tournament watcher)"*) calls USTA's public GraphQL API once a day, for both
org IDs, and POSTs the results to the bot's `/usta-webhook`. The bot dedupes by
tournament id and, for anything new, stages an approval-gated `create_tournament`
and pings you on Telegram.

- **Endpoint** (public, no auth): `POST https://prd-usta-kube-tournaments.clubspark.pro/`
- **Org IDs watched:** `467ea6c1-b0f5-4a97-85b2-1f0ac196cbbb` and `88d20618-3292-40a0-9539-94baa993fed4`

### Setup

1. On Railway set **`USTA_HOOK_SECRET`** to exactly: `5dmedia-usta-7Kq2Zpv9x`
   (this matches the `x-usta-secret` header the Make scenario already sends; change
   both together if you want a different value).
2. Deploy the bot (merge to `main`) so the `/usta-webhook` route exists.
3. The Make scenario is already **active** and runs daily at 8:00 AM. To test now,
   open it in Make and click **Run once**.

> **First run note:** the first successful run treats *all current* tournaments as
> new, so you may get several Telegram prompts at once — approve the real ones,
> ignore the rest. After that, only genuinely new tournaments are surfaced.
> If multiple are staged, reply "yes" once per tournament (each "yes" confirms the
> most recent prompt).

### If you change org sections

Edit the scenario's two HTTP modules (module 1 and 3) and swap the
`organisationId` in the request body. To watch more sections, duplicate the
fetch+forward module pair.

## 6. USTA tournament watcher (email fallback)

Notifies you on Telegram when the USTA tournaments page changes (or when USTA
emails you directly), and lets you reply "add it to the site" to create the
tournament on unitedsets.com through the normal approval flow.

**How it works — and why.** playtennis.usta.com is behind Cloudflare bot
protection, so the bot cannot poll the page itself (every server request gets
a 403). And no website offers true "push on change" to outsiders — all change
detection is someone polling. So we let a monitoring service do the watching
with a real browser (which Cloudflare allows), have it email you on change,
and the bot turns that email into a Telegram alert. The bot never hits the
USTA site.

### Setup

1. **Page monitor (free):** create a visualping.io account (or Distill.io)
   → add the page `https://playtennis.usta.com/Competitions/5dmedia/Tournaments/`
   → check frequency: daily is plenty (free tier) → alert email: the Gmail
   the bot reads.
2. **Gmail read permission:** locally run `node scripts/gmail-auth.js`
   (scopes now include gmail.readonly), sign in, replace `GMAIL_REFRESH_TOKEN`
   on Railway with the new token.
3. Set `USTA_WATCH=on`.
4. Optional:
   - `USTA_EMAIL_QUERY` — tune which emails match (default matches USTA
     domains + visualping/distill/changedetection senders, last 3 days).
   - `USTA_WATCH_CRON` — how often the bot checks its own inbox for these
     alerts (default every 15 min; e.g. `0 */2 * * *` for every 2 hours).
     This is a cheap Gmail API call, not a hit on the USTA site.

Each alert is announced once. USTA's own organizer emails (sanction/publish
confirmations) are caught by the same watcher.

```
Bot:  📬 USTA update — "Your tournament is now published: 5D Summer Open" ...
      Reply "add it to the site" to create this on unitedsets.com, or ignore.
You:  add it to the site
Bot:  ⏳ Proposed — Create tournament "5D Summer Open" starting 2026-08-09 ...
You:  yes
Bot:  ✅ Done
```

## How the approval flow works

```
You:  move the Summer Slam to August 2nd
Bot:  ⏳ Proposed — Update tournament #12 on unitedsets.com:
      {"start_date":"2026-08-02"} — reply "yes" to confirm
You:  yes
Bot:  ✅ Done: Update tournament #12 ...
```

All proposals and outcomes are logged in the `pending_actions` table in SQLite.
