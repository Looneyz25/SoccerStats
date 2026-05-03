# Phase 2: Odds Collection

Use this phase when the prompt asks to gather odds, refresh prices, attach Sportsbet, build a value/picks workflow, or move beyond a clean fixture slate.

## Objective

For every fixture marked `ready_for_phase_2` in the Phase 1 slate, attach decimal Win-Draw-Win (90-minute regular time) odds from Sportsbet AU, validate the source response, normalize team names to match the fixture row, and produce a Phase 2 odds slate later agents can trust for value detection.

Phase 2 does not produce predictions, value picks, fair odds, or stakes. It only collects and matches market prices.

## Inputs

| Input | Path | Required |
| --- | --- | --- |
| Phase 1 slate (current) | `docs/agent-system/outputs/phase1_fixture_slate_current.csv` | yes |
| Phase 1 workbook | `docs/agent-system/outputs/Phase1_Fixture_Slate.xlsx` | optional cross-check |
| Local store | `match_data.json` | optional team-name fallback |

Phase 2 only consumes rows whose `phase1_status = ready_for_phase_2`. All other rows are echoed through with no odds and a `phase2_status = upstream_blocked` note.

## Endpoint Priority

| Priority | Source | Endpoint | Use |
| --- | --- | --- | --- |
| 1 | Sportsbet AU | `https://www.sportsbet.com.au/betting/soccer/{league_slug}` (`window.__PRELOADED_STATE__`) | Primary WDW (1X2) odds for 90-minute regular time |
| 2 | Sportsbet AU event page | `/betting/soccer/{league_slug}/{event_slug}` | Optional re-fetch when a specific fixture is missing |

Sportsbet pages are scraped with `curl_cffi` browser impersonation. No additional bookmakers are added in Phase 2; second-source coverage is a future phase.

Markets matched: `Win-Draw-Win`, `Match Result`, `1X2`. Extra-time and anytime/specials markets are excluded.

## League Slugs

| Listed League | Sportsbet Slug |
| --- | --- |
| Premier League | `united-kingdom/english-premier-league` |
| Championship | `united-kingdom/english-championship` |
| League One | `united-kingdom/english-league-one` |
| League Two | `united-kingdom/english-league-two` |
| LaLiga | `spain/spanish-la-liga` |
| Bundesliga | `germany/german-bundesliga` |
| Ligue 1 | `france/french-ligue-1` |
| Eredivisie | `rest-of-europe/dutch-eredivisie` |
| UEFA Champions League | `uefa-competitions/uefa-champions-league` |
| MLS | `north-america/usa-major-league-soccer` |

## Required Agents

| Agent | Role In Phase 2 |
| --- | --- |
| Data Source Analyst | Inspect Sportsbet response shape, record outage or block, classify source health |
| Odds Collector | Fetch league pages, extract WDW prices, match fixtures, compute implied probabilities and overround |

All other agents wait until Phase 2 returns a validated odds slate.

## Required Skills

- [Endpoint Health Skill](skills/endpoint-health.md)
- [Odds Matching Skill](skills/odds-matching.md)

## Workflow

1. Data Source Analyst reads the latest Phase 1 CSV and confirms the per-league `ready_for_phase_2` row counts.
2. Data Source Analyst fetches each required Sportsbet league page once, records HTTP status, parse health, and event count.
3. Odds Collector parses `window.__PRELOADED_STATE__`, extracts WDW outcome prices, converts profit/stake fractions to decimal odds (`profit + 1`).
4. Odds Collector normalizes team names with the project abbreviation table and matches each Phase 1 fixture row to a Sportsbet event.
5. Odds Collector computes:
   - `implied_home`, `implied_draw`, `implied_away` (1 / decimal price)
   - `overround` (sum of implieds)
   - `fair_home`, `fair_draw`, `fair_away` (implied / overround)
6. Odds Collector assigns a `phase2_status` to every fixture row.
7. Odds Collector writes the Phase 2 review workbook.
8. Return the Phase 2 odds slate, unmatched fixtures, and source health.

## Required Fields

Every Phase 2 row must include the Phase 1 identity columns plus:

| Field | Purpose |
| --- | --- |
| `event_id` | Phase 1 event ID (carried through) |
| `league` | Listed league name |
| `date`, `time`, `timezone` | Adelaide-local kickoff |
| `home`, `away` | Fixture team names from Phase 1 |
| `odds_source` | `Sportsbet` or empty |
| `sportsbet_event_id` | Sportsbet's internal event ID when matched |
| `sportsbet_home_name`, `sportsbet_away_name` | Names as listed on Sportsbet (audit) |
| `home_odds`, `draw_odds`, `away_odds` | Decimal WDW prices |
| `implied_home`, `implied_draw`, `implied_away` | 1 / decimal price |
| `overround` | Sum of implieds |
| `fair_home`, `fair_draw`, `fair_away` | Implied / overround |
| `match_method` | `exact`, `alias`, `substring`, `none` |
| `match_score` | 0..1 confidence of the team-name match |
| `source_health` | `healthy`, `degraded`, `blocked` |
| `phase2_status` | Gate for whether the fixture can move to Phase 3 |
| `phase2_notes` | Short explanation for blocked or unusual rows |

## Phase 2 Status Values

| Status | Meaning |
| --- | --- |
| `ready_for_phase_3` | All three WDW prices present, overround in plausible range, match confidence acceptable |
| `unmatched_market` | Sportsbet page healthy but no event matched the fixture |
| `partial_market` | At least one of home/draw/away price is missing |
| `implausible_overround` | Overround outside `1.00 .. 1.25` (data quality flag) |
| `low_match_confidence` | Match score below threshold; needs manual review |
| `source_blocked` | Sportsbet page failed to load or parse for this league |
| `upstream_blocked` | Phase 1 row was not `ready_for_phase_2`; no odds attempted |

Only `ready_for_phase_3` rows should move to prediction, value, or risk phases.

## Excel Output

Create one current Excel workbook for human review:

`docs/agent-system/outputs/Phase2_Odds_Slate.xlsx`

Overwrite it on each `run_daily` Phase 2 run. Match-data JSON remains the app source of truth; Excel is the review and handoff file.

Workbook sheets:

| Sheet | Contents |
| --- | --- |
| `Odds` | All Phase 2 rows with prices and status |
| `Ready For Phase 3` | Only `phase2_status = ready_for_phase_3` |
| `Unmatched` | `unmatched_market`, `partial_market`, `low_match_confidence` |
| `Blocked` | `source_blocked`, `upstream_blocked`, `implausible_overround` |
| `League Summary` | Counts by league: total, matched, unmatched, blocked |
| `Source Health` | Per-league Sportsbet fetch status, parse health, record counts |
| `Run Notes` | Date window, source mode, totals, next action |

Optional dated CSV/Markdown snapshots may be created for audit history; the current Excel workbook is the Phase 2 handoff.

## Acceptance Criteria

- Every Phase 1 row appears in the Phase 2 output (carried through with status).
- Every `ready_for_phase_3` row has all three decimal prices and a fair-odds triplet.
- Decimal prices are calculated as Sportsbet `profit/stake + 1`, rounded to 2dp.
- Overround is reported on every matched row.
- Unmatched fixtures are visible with the candidate team names listed by Sportsbet for that league.
- Source failures are visible in Source Health with HTTP status or exception text.
- No fixture is sent to Phase 3 without three valid WDW prices.

## Phase 2 Output Template

```markdown
## Phase 2 Odds Slate

Date window: YYYY-MM-DD to YYYY-MM-DD, Australia/Adelaide
Source: Sportsbet AU (Win-Draw-Win, 90-min regular time)

Source health:
- Premier League page: healthy/degraded/blocked
- LaLiga page: healthy/degraded/blocked
- ...

Coverage:
- Phase 1 ready: N
- Phase 2 ready: N
- Unmatched: N
- Blocked: N

Picks-ready fixtures:
| League | Date | Time | Home | Away | Home | Draw | Away | Overround | Match |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Issues:
- ...
```
