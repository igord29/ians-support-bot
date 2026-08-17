# Champion Pipeline — Agent Instructions

Automation for adding champions to the Hall of Champions on unitedsets.com:
create the branded graphic in Canva, upload it to Supabase Storage, insert the
database record.

> **Status:** the Canva → export → Storage chain is **verified working**
> (tested end-to-end). See "Verified facts" for the exact IDs, and "Open gaps"
> for what still needs a human.

## Required MCP Connectors

- **Canva** — design duplication, text editing, image replacement, export
- **Supabase** — database inserts (project `azxnvsytmmcdcrlgpagz`)

## Input Format

1. **Player photo** — must be reachable at a **public URL** (Canva's asset
   upload takes a URL, not a local file)
2. **Player name**
3. **Tournament venue** (see Venue Mapping)
4. **Event date** (e.g. "June 13-14, 2026")
5. **Level** (L5, L6)
6. **Age group** (U10, U12, U14, U16, U18)
7. **Category** (Boys, Girls, or "sportsmanship")
8. **Flight** — only for higher-tier tournaments; general tournaments have no flight
9. Optionally: **notes**

---

## Step 1: Create the Canva Champion Graphic

### Source Design
- **Design ID:** `DAHJlkLgZNY` — "Spring 2926 champions " (sic), 941×1672, 26 pages

### Venue / Flight Page Map (verified from thumbnails)

| Venue | Pages | Flight badge? | Date & venue |
|---|---|---|---|
| Chelsea Piers, Stamford, CT | 1–16, 23–26 | No | **Baked into background art** |
| VIP Country Club, New Rochelle, NY | 17–18 | No | Editable text elements |
| Mamaroneck Beach & Yacht Club | 19, 20, 21, 22 | **Yes — Flight 1/2/3/4 respectively** | Editable text elements |

⚠️ **Flight art is part of the background image, not a text element** — it
cannot be removed or changed via the API. Pages 19–22 are Flight 1–4 only.
For a **general (no-flight)** Mamaroneck card, a flight-free page must be
created manually in Canva first, then added to this map.

⚠️ **Chelsea Piers pages have the date and venue baked into the background.**
Only use a page whose baked-in date matches the event, or the card will show
the wrong date.

**New venue:** duplicate a VIP page (17) — it has the fullest set of editable
text elements (name, date, venue) with no flight badge.

### Editing Workflow (verified)

1. `copy-design` with `page_numbers: [N]` — never edit the original.
2. `read-design` on the copy with `open_transaction: true` → returns
   `transaction_id` and locator IDs.
3. `edit-design` with `finalize: "keep_open"` and the operations below.
4. Validate: compare thumbnails and the returned `document`.
5. `edit-design` with `finalize: "commit"` and `operations: []`
   (operations and finalize **cannot** be combined).
6. `get-export-formats`, then `export-design` (`type: "jpg"`, `pages: [1]`).

### Verified locator IDs — Mamaroneck page 19

Locators are `<page_id>-<element_id>`; the page prefix changes in each copy, so
always re-read them from the copy. Structure is stable:

| Element | Trailing ID | Notes |
|---|---|---|
| Player photo | `LBPMWRX4jDrtvyCL` | RECT, `fill: IMAGE`, 511×1637 (largest) |
| Logo watermark | `LBlxHlNlWwyt3M9P` | RECT, opacity 0.49 — leave alone |
| Player name | `LBP07P8GtlLmmR52` | TEXT, ~109px, white, 2 lines ("First \nLast") |
| Date | `LBGfhD7NZ25HrtnK` | TEXT, ~37px bold white |
| Venue | `LBkYnwKfb4RJ84Pc` | TEXT, ~25px bold white |
| Category | `LB4xktfv5qjPTPm9` | TEXT, ~53px bold `#011124` (e.g. "L5 U16") |

Chelsea Piers pages have only **name** + **category** as text.

### Operations

- `replace_text` — name (use `"First \nLast"` to keep the two-line layout), date,
  venue, category
- `format_text` with `link: ""` — **always strip the hyperlink from the name.**
  Chelsea Piers pages link the name to the previous player's USTA profile;
  leaving it would point at the wrong person.
- `update_fill` — swap the player photo (upload the photo first with
  `upload-asset-from-url`, then pass the returned `asset_id`)

---

## Step 2: Upload the Image to Supabase Storage

Supabase Storage has **no MCP upload tool**, and direct SQL deletes on
`storage.objects` are blocked by the platform. Use the deployed edge function:

**`POST https://azxnvsytmmcdcrlgpagz.supabase.co/functions/v1/champion-upload`**
Header: `x-champion-secret: <secret>` (stored outside this repo — this repo is public)

```jsonc
// upload
{ "source_url": "<canva export url>", "filename": "champion-1786943000000.jpg" }
// -> { ok, path, public_url, bytes, content_type }

// delete (for removing a bad card)
{ "action": "delete", "paths": ["images/champion-….jpg"] }
```

It stores to bucket `champions` at `images/champion-{timestamp}.jpg` with
`Cache-Control: 31536000`, and returns the public URL for `image_url`.
Bucket limit is **5 MB**; a 941×1672 JPG at quality 95 is ~460 KB.

---

## Step 3: Create the Champion Database Record

```sql
INSERT INTO champions (
  name, tournament, year, month, date, location,
  tournament_type, age_group, format, system, level,
  category, wins, image_url, notes
) VALUES (…);
```

| Column | Required | Notes |
|---|---|---|
| name | Yes | Player full name |
| tournament | Yes | `UnitedSets Junior Tour - {Venue}` |
| year | Yes | e.g. 2026 |
| month | Yes | e.g. "June" (capitalized) |
| date | Yes | Day of month (last day for multi-day) |
| location | Yes | "Venue, City, ST" |
| tournament_type | Yes | "individual" |
| age_group | Yes | U10–U18 |
| format | Yes | usually "singles" |
| system | Yes | usually "round_robin" |
| level | Yes | L5, L6 |
| category | Yes | "Boys", "Girls", "sportsmanship" |
| wins | Yes | default 1 |
| image_url | No | Storage public URL |
| notes | No | e.g. "Flight 1" |

### Venue Addresses

| Venue | Location | Address |
|---|---|---|
| Chelsea Piers | Chelsea Piers, Stamford, CT | 1 Blachley Rd, Stamford, CT 06902 |
| VIP Country Club | VIP Country Club, New Rochelle, NY | 600 Davenport Ave, New Rochelle, NY 10805 |
| Mamaroneck Beach & Yacht Club | Mamaroneck Beach & Yacht Club, Mamaroneck, NY | 555 S Barry Ave, Mamaroneck, NY 10543 |
| Oak Lane Tennis Club | Oak Lane Tennis Club, Woodbridge, CT | 1027 Racebrook Rd, Woodbridge, CT 06525 |
| Tennis Club of Hastings | Tennis Club of Hastings, Hastings-On-Hudson, NY | 100 River St, Hastings-On-Hudson, NY 10706 |

---

## Step 4: Confirm to User

Report: champion name/details, Canva link, Storage image URL, DB record ID, and
the page: `https://www.unitedsets.com/tournaments/hall-of-champions.html`

---

## Special Cases

- **Sportsmanship:** `category = "sportsmanship"` (lowercase); renders in the
  gold section at the bottom of the page. Everything else is the same.
- **Multiple champions:** process each fully; distinct timestamps in filenames.
- **New venues:** base on VIP page 17; add to the map above.

---

## Photo intake via Telegram (built)

Text the bot a player photo and it hosts it automatically, then stages the
champion — no manual URL wrangling:

1. Send the photo (a caption with the details works, or the bot will ask).
2. The bot uploads it to `champions/photos/…` and gets a public URL.
3. Give it the details; it calls `stage_champion`, writing a row to
   `public.pending_champions` (`status = 'awaiting_card'`).
4. Later, run the Canva steps above for each pending row, insert into
   `champions`, then set that row's `status = 'published'` and `champion_id`.

Ask the bot "any pending champions?" (`list_pending_champions`) to see the queue.
Requires `CHAMPION_UPLOAD_SECRET` on the bot, matching the edge function.

## Open gaps (need a human)

1. **Flight-free Mamaroneck template** — flight art is baked into pages 19–22.
   Someone must create a no-flight page in the Canva editor for general
   tournaments.
2. **Canva render step** — Canva editing is only reachable through the Canva MCP
   (an assistant session), not from the bot. The bot queues champions; the card
   is still produced in a session. Automating it end-to-end would need the Canva
   Connect API (OAuth app + brand-template autofill).
3. **Social posting** — not built here. The Make scenario
   *"UnitedSets Tennis 2 Social Media"* already has live Instagram Business,
   Facebook Pages, Buffer, and OpenAI connections to hook into.
4. **Other aspect ratios** — the template is 9:16 (native for Stories/Reels/
   TikTok). Feed (1:1, 4:5), Facebook (1.91:1) and X (16:9) need a real
   re-layout; try Canva `resize-design` and eyeball the result before trusting it.
