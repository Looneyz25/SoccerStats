# Soccer Stats — Scheduled Tasks

The two schedules requested in the task brief cannot be created from inside a
scheduled-task run (the platform refuses with `Cannot create scheduled tasks
from within a scheduled task session`). Run the following two prompts from a
normal Cowork chat and Claude will create them for you.

---

## 1. Pre-match data gathering — runs daily at 07:00 local

```
Create a scheduled task with id `soccer-prematch-data-gather`
running daily at 07:00 local time (cron `0 7 * * *`) with the
following prompt:

PRE-MATCH DATA GATHERING — runs daily at 07:00 local.

Goal: refresh the dashboard with data for matches that have not yet kicked off.

Steps (work autonomously, no clarifying questions):

1. Open C:\Users\lvora\OneDrive\Betting\Soccer Stats and load match_data.json.
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

1. Load C:\Users\lvora\OneDrive\Betting\Soccer Stats\match_data.json.

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

5. Save outputs to C:\Users\lvora\OneDrive\Betting\Soccer Stats and report
   the matches that flipped from upcoming to FT in this run.
```

---

## Why these were not auto-installed

The current task (`data-gathereing`, cron `0 0 * * *`) is itself running as a
scheduled task — and the scheduler does not allow scheduled tasks to spawn new
schedules. Running either of the prompts above from a normal Cowork chat will
register them.
