# Soccer Stats — Scheduled Tasks

> Scheduled tasks cannot be created from inside a scheduled-task run (the
> platform refuses with `Cannot create scheduled tasks from within a scheduled
> task session`). Create them from a normal Cowork chat.

---

## ACTIVE — Due-time result check (`soccer-due-time-result-check`)

- **Status:** installed and enabled (Cowork scheduled task).
- **Schedule:** hourly — cron `30 * * * *` (dispatch lands near :36 past the hour due to scheduler jitter). Local timezone.
- **Runner:** delegates the whole routine to a Sonnet agent (Agent tool, `model: sonnet`, `subagent_type: general-purpose`).
- **Conforms to:** the current `AGENTS.md` routine spec + `docs/agent-function-dependency-map.md`.
- **Self-gating:** no-ops when no match's score-check time (kickoff + 3h, Adelaide) has passed and nothing is pending past expected finish; otherwise settles the due match(es).

What each run does (full prompt lives in the task's `SKILL.md`):

1. Read order — `docs/agent-function-dependency-map.md` first, then `routine_progress_latest.md` as the stage marker.
2. Compile the Adelaide-day match queue, then filter to due `DUE @` rows (score-check = kickoff + 3h).
3. Settle due results via `node scripts/get-data-with-log.mjs --results-only` (SofaScore primary, Sportsbet fallback, IDs isolated; postponed/cancelled → `postponed_or_cancelled` + void).
4. Market settlement gate before any upload: `node scripts/verify_market_settlement.mjs` (unresolved must be 0; never fabricate actuals).
5. Firestore is source of truth: verify `dashboardData/match_data/dates/<today>`, upload only if it's missing clean local results, then the post-upload Firestore verification gate; +6 horizon is provisional until Firestore confirms it.
6. Stuck-upload recovery: kill only stuck `soccer_routine|get-data-with-log|upload_match_data|cache_badges|run-python.js` processes, rerun the REST small-batch uploader.
7. Finalize `routine_progress_latest.{md,json}` accurately (never left "running"; gate computed from verification, not hand-written; artifacts stay labeled `codex 5.3`).

Hard constraints: never commit/push/build/deploy; never fabricate results; never bypass provider blocking. Sandbox caveats: `pip install curl_cffi --break-system-packages` if the python step errors; skip the badge-cache step if it hangs (>~30s). Firestore reads/writes work in the sandbox; provider fetch + badge cache are most reliable on the Windows host (`run_notouch.bat`, which calls the same `get:data:results` entry point).

To recreate from a normal Cowork chat: ask Claude to create a scheduled task `soccer-due-time-result-check`, cron `30 * * * *`, running the routine above via a Sonnet agent, conformed to `AGENTS.md`.

---

## LEGACY (superseded — kept for reference)

> Sections 1 and 2 below predate the Firestore + `codex 5.3` routine. They
> target removed artifacts (`build_xlsx.py`, the static `Soccer_Stats_Dashboard.html`,
> the public `match_data.json` browser source). The live app now reads Firestore
> only, and result checking is handled by the ACTIVE task above plus
> `npm.cmd run get:data` / `get:data:results`. Do not run these as written.

---

## 1. Pre-match data gathering — runs daily at 07:00 local

```
Create a scheduled task with id `soccer-prematch-data-gather`
running daily at 07:00 local time (cron `0 7 * * *`) with the
following prompt:

PRE-MATCH DATA GATHERING — runs daily at 07:00 local.

Goal: refresh the dashboard with data for matches that have not yet kicked off.

Steps (work autonomously, no clarifying questions):

1. Open C:\Betting\Soccer Stats and load match_data.json.
   Note today's date.

2. For SofaScore Premier League season 76986 (tournament 17), and the parallel
   LaLiga / Bundesliga / Championship pages, gather data for any match whose
   status is "upcoming" or whose date is >= today.
   - Preferred path: use Claude in Chrome browser tools — navigate to
     https://www.sofascore.com/football/tournament/england/premier-league/17#id:76986
     and equivalent league pages. Use screenshots / read_page to avoid bot
     detection. Click each match in the Matches panel and capture
     Head-to-head / Matches / Head-to-head streaks / Streaks /
     Goal distribution / Odds.
   - If no browser is connected and api.sofascore.com is blocked, log a notice
     and skip the network refresh — keep the existing match_data.json.

3. Update match_data.json `captured_at` and merge any new matches.

4. Re-run /sessions/.../outputs/build_xlsx.py (or regenerate it) to refresh
   PL_Predictions_vs_Outcomes.xlsx — sheets: Matches (Date | Time | Match |
   Streaks | Prediction | Odds | Result | Hit/Miss), Raw Data, Summary.

5. Re-run the dashboard rebuild that embeds match_data.json into
   Soccer_Stats_Dashboard.html (left panel = league/round dropdowns + match
   list; right panel = match card with H2H / Matches / Streaks /
   Goal distribution / Odds / Predictions). Use the SofaScore color theme
   (dark navy bg #14181f, panel #1a1f2e, pitch-green accent #2eb360).

6. Produce a brief written summary of what changed.
```

---

## 2. Post-match result checker — runs every 2 hours, 18:00–02:00 daily

```
Create a scheduled task with id `soccer-postmatch-result-check`
running every 2 hours from 18:00 to 02:00 (cron `0 18,20,22,0,2 * * *`)
with the following prompt:

POST-MATCH RESULT CHECK — refresh results for completed matches.

Steps (work autonomously, no clarifying questions):

1. Load C:\Betting\Soccer Stats\match_data.json.

2. For every match where `status != "FT"` and the kickoff is more than 2.5 hours
   in the past, look up the final score:
   - Preferred: Claude in Chrome — open the SofaScore match page and capture
     the score plus card/goal totals from the page.
   - Otherwise: fall back to last cached values.

3. Update each completed match's `home.goals`, `away.goals`, and `status` to
   "FT". Update the `predictions` block:
     • winner.result   → hit/miss
     • btts.result     → hit/miss
     • ou_goals.result → hit/miss; record actual goals
     • ou_cards.result → hit/miss when card data is available

4. Re-run build_xlsx.py and the dashboard rebuild so the Hit/Miss column,
   Summary tab, and the right-side "Predictions vs Outcome" card all show
   ✓ for positive outcomes and ✗ for misses.

5. Save outputs to C:\Betting\Soccer Stats and report
   the matches that flipped from upcoming to FT in this run.
```

---

## Why these were not auto-installed

The current task (`data-gathereing`, cron `0 0 * * *`) is itself running as a
scheduled task — and the scheduler does not allow scheduled tasks to spawn new
schedules. Running either of the prompts above from a normal Cowork chat will
register them.
