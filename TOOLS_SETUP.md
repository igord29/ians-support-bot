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

## 5. USTA tournament watcher

Notifies you on Telegram when USTA emails you about a tournament (e.g. published
/ sanctioned), and lets you reply "add it to the site" to create it on
unitedsets.com through the normal approval flow.

Why email? playtennis.usta.com (including the public pages) sits behind
Cloudflare bot protection — servers can't poll it. USTA's organizer emails are
the reliable signal.

1. Re-run the Gmail auth to add read permission (the scope list now includes
   gmail.readonly): locally run `node scripts/gmail-auth.js`, sign in, and
   replace `GMAIL_REFRESH_TOKEN` on Railway with the new token.
2. Set `USTA_WATCH=on`.
3. Optional: `USTA_EMAIL_QUERY` to tune which emails match
   (default: `from:(usta.com OR playtennis.usta.com OR clubspark.com) newer_than:3d`).

The bot checks every 15 minutes; each email is announced once.

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
