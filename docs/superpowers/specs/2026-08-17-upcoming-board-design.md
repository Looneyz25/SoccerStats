# Upcoming Board — design

Date: 2026-08-17
Status: approved (design), not yet implemented

## Purpose

A short-window betting board showing what is about to start, across soccer and
tennis, priced straight from Sportsbet. The operator uses it to find quick
short-odds bets on the day — not to consume model output.

This surface deliberately carries **no predictions**. It is a live view of the
book, not a view of our opinion of the book.

## Scope

In scope:

- One new scraper reading Sportsbet only, covering soccer and ATP/WTA main-tour
  singles tennis.
- A new `Upcoming` nav item and board view in the dashboard.
- Wiring the scrape into both the full routine pass and the results-only pass.

Out of scope (explicitly, not "later in this change"):

- Predictions, model probabilities, value/edge tiles, confidence.
- Hit-rate tracking, settlement, results feeds, calibration history.
- Any read or write of `match_data.json` or `dashboardData/match_data`.
- Deep market books (totals, handicaps, BTTS). Head-to-head prices only.

## Source and filtering

`scripts/fetch_upcoming_board.py` imports its Sportsbet helpers from
`scripts/soccer_fetch_sportsbet.py` rather than duplicating them:
`preloaded_state_from_html`, `fetch_page_data`, `to_decimal`, the impersonation
profile list, and the `LEAGUE_PAGES` slug map. Importing that module is safe —
it only writes `match_data.json` from `main()`, which we never call.

Note that `has_kicked_off` is **not** reusable here: it reads `m["date"]` and
`m["time"]` off a store match, not a Sportsbet event. This scraper works from
`startTime.milliseconds` on the event itself and compares it to now directly.

**Soccer.** The 22 slugs in `LEAGUE_PAGES`. Prices come from each league page's
`Win-Draw-Win` / `Match Result` / `1X2` market (90-minute regular time only,
matching the existing scraper's rule). Four slugs currently redirect and yield
nothing — UEFA Europa League, UEFA Conference League, A-League Men,
International Friendlies. That is a pre-existing gap in `LEAGUE_PAGES`, not
introduced here; the board inherits it and logs each redirect.

**Tennis.** The `/betting/tennis` hub, whose `__PRELOADED_STATE__` has the same
shape as the soccer league pages. Events carry `participant1`, `participant2`,
`startTime.milliseconds`, and `competitionId`; the only market present at hub
level is `Match Betting`, a two-way head-to-head.

Tennis competitions are filtered to ATP/WTA main tour singles by **excluding**
any competition name matching, case-insensitively:

- `challenger`
- `itf`
- `utr`
- `doubles`
- a trailing ` q` (qualifying draws)

Grand Slam competitions (`Mens Australian Open`, `Ladies Wimbledon`, etc.) are
kept, but only ever contribute events that actually have a Match Betting market
— out of season they carry outright/futures books and produce no rows.

**Window.** Two distinct numbers, deliberately:

- `UPCOMING_COLLECT_HOURS` (default 12) — how far ahead the **scrape** collects.
- `UPCOMING_VIEW_HOURS` (default 3) — how far ahead the **board shows** by
  default.

Collecting wider than the default view is what lets the "show next 12 hours"
expander widen the client filter without issuing a second request. Events whose
start time is already in the past are excluded at scrape time by comparing
`startTime.milliseconds` to now.

## Data shape

Written to `upcoming_data.json` at the repo root (a generated artifact, same
role as `match_data.json`):

```json
{
  "generated_at": "2026-08-17T01:20:00Z",
  "collect_hours": 12,
  "view_hours": 3,
  "events": [
    {
      "sport": "soccer",
      "competition": "Premier League",
      "event_id": "10824183",
      "event_url": "https://www.sportsbet.com.au/betting/soccer/...",
      "start_utc": "2026-08-17T04:30:00Z",
      "start_local": "2026-08-17 14:00",
      "participants": { "home": "Arsenal", "away": "Coventry" },
      "prices": { "home": 1.18, "draw": 7.25, "away": 15.0 },
      "shortest": { "side": "home", "label": "Arsenal", "price": 1.18 }
    },
    {
      "sport": "tennis",
      "competition": "ATP Cincinnati",
      "event_id": "10824214",
      "event_url": "https://www.sportsbet.com.au/betting/tennis/...",
      "start_utc": "2026-08-17T05:06:00Z",
      "start_local": "2026-08-17 14:36",
      "participants": { "home": "Taylor Fritz", "away": "Alex Michelsen" },
      "prices": { "home": 1.30, "away": 3.40 },
      "shortest": { "side": "home", "label": "Taylor Fritz", "price": 1.30 }
    }
  ]
}
```

Tennis rows have no `draw` key — absence is the signal, rather than a null the
UI has to special-case. `start_local` is Australia/Adelaide, matching the rest
of the pipeline.

## Storage and upload

Uploaded to a new Firestore doc, `dashboardData/upcoming`, as a single document.
At a 3-hour window this is a few dozen events — well inside the 1 MB document
limit, so no chunking and no `fast` companion doc.

The upload path is separate from `scripts/upload_match_data_to_firestore.mjs`
and shares no state with it. Nothing in this feature reads, writes, or locks
`match_data.json`, so it cannot race the soccer pipeline.

## UI

**Nav.** A fifth item, `Upcoming`, added to both `navItems` arrays —
`app/dashboard/page.jsx:6396` (`MobileBottomNav`) and `:6435`
(`DesktopSidePanel`). The mobile nav grid changes `grid-cols-4` → `grid-cols-5`.

**Board.** New file `app/dashboard/upcoming-board.jsx`. It shares no logic with
the prediction cards, so keeping it out of the 8,133-line `page.jsx` costs
nothing and avoids growing that file further.

Behaviour:

- Rows sorted by start time, soonest first.
- Each row: start time and countdown, competition, participants, all prices,
  the shortest price emphasised, and a link to the Sportsbet event.
- Sport toggle chips: All / Soccer / Tennis.
- Price filter chips: All / ≤2.00 / ≤1.60.
- The client re-filters on `start_utc > now` at render time, so a late routine
  run drops kicked-off events instead of displaying them.
- If `generated_at` is older than 30 minutes, show a "prices last refreshed
  {n} min ago" note rather than implying they are live.

**Empty state.** A 3-hour window is often genuinely empty. The board says
"Nothing starting in the next 3 hours" and offers a "show next 12 hours"
expander, which widens the client-side filter over the already-fetched
`collect_hours` payload — no second request.

## Routine wiring

- New npm script `data:refresh:upcoming` → `node scripts/run-python.js
  scripts/fetch_upcoming_board.py` followed by the Firestore upload.
- Invoked from `scripts/get-data-with-log.mjs` in both the full pass and the
  `--results-only` pass.
- Each invocation writes its stage into
  `docs/agent-system/outputs/routine_progress_latest.{md,json}` before it starts
  and after it completes, as CLAUDE.md requires of every wrapper stage.
- `run_notouch.bat` picks it up through those existing stages; no new scheduler
  job.

Cost per pass is roughly 23 HTTP requests (22 league pages plus the tennis hub)
with the existing ~1s courtesy sleep, so about 30–40 seconds. The no-touch
controller runs every 15 minutes, which absorbs that comfortably.

## Failure modes

- **A league page redirects or 404s.** Log it, skip that competition, keep the
  rest of the board. Never abort the run — a partial board beats no board.
- **Sportsbet changes the preloaded-state shape.** `preloaded_state_from_html`
  returns `None`; the scraper exits non-zero with a clear message and leaves the
  previous `upcoming_data.json` in place rather than writing an empty board.
- **Zero events in window.** A valid result, not an error. Write the file with
  an empty `events` array and a fresh `generated_at` so the UI can distinguish
  "nothing on" from "scrape broken".
- **Firestore upload fails.** Non-zero exit, previous doc left intact; the next
  15-minute pass retries.

## Verification

1. Run the scraper standalone and assert: every event starts in the future and
   inside `collect_hours`;
   no tennis competition matches the exclusion list; every tennis row lacks
   `draw`; every soccer row has all three prices.
2. Hash `match_data.json` before and after the run and confirm it is byte
   identical.
3. Upload, then read `dashboardData/upcoming` back and compare to the local
   file.
4. Run the app locally, open Upcoming, and confirm both sports render, the sport
   and price chips filter correctly, and the empty state appears when the window
   is genuinely empty.
5. Confirm Dashboard and Matches are visually and behaviourally unchanged.

## Known limitations

- Tennis horizon is naturally short; Sportsbet opens match markets a day or two
  ahead. Inside a 3-hour window this is not a constraint.
- Board prices come from league/hub pages and are captured independently of the
  odds attached to predictions in `match_data.json`. The same soccer fixture can
  show a slightly different price on the Upcoming board than on a match card if
  the book moved between runs. This is expected, and is the cost of the board
  being a live view of the source rather than a view of our stored slate.
- The four redirecting league slugs contribute nothing until that separate
  `LEAGUE_PAGES` gap is fixed.

## Single-source rule

Sportsbet is the **only** source for this board. No SofaScore, no Flashscore, no
secondary feed for fixtures, prices, names, or results — not as a fallback, not
as an enrichment pass. If Sportsbet does not list an event, it does not appear
on the board.

This is a deliberate constraint, not an omission. The board's value is that it
shows exactly what is bettable at the book right now; blending in a second
source would introduce fixtures with no price and names that need cross-feed
matching, which is precisely the complexity this surface exists to avoid.

## 2026-08-18 AIOS Quick Bets lifecycle extension

Sportsbet remains the only source for Upcoming fixture identity and captured
prices. Once a captured row reaches kickoff, AIOS freezes that capture into its
separate Quick Bets lifecycle and may use verified canonical, ESPN, or
Flashscore score evidence to show Live and Results. Those result feeds never
add fixtures or replace the captured odds. This extension supersedes only the
earlier statement that result feeds were out of scope; the Soccer Stats
customer board and `match_data.json` ownership remain unchanged.
