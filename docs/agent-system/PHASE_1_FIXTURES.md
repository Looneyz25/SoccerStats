# Phase 1: Fixture Collection

Use this phase when the prompt asks to get fixtures, refresh the slate, gather matches, inspect fixture endpoints, or start a betting analysis run.

## Objective

Collect fixtures for the listed leagues only, validate the source endpoint behavior, store all fixture dates/times in Australia/Adelaide local time, and produce a clean fixture slate that later agents can trust.

Phase 1 is a `run_daily` foundation phase. It does not form streaks, predictions, value picks, or stakes.

## Listed Leagues

| Legacy League ID | League |
| --- | --- |
| 17 | Premier League |
| 8 | LaLiga |
| 35 | Bundesliga |
| 34 | Ligue 1 |
| 7 | UEFA Champions League |
| 37 | Eredivisie |
| 242 | MLS |
| 18 | Championship |
| 24 | League One |
| 25 | League Two |

## Endpoint Priority

| Priority | Source | Endpoint | Use |
| --- | --- | --- | --- |
| 1 | API-Football | `/fixtures?date={YYYY-MM-DD}&timezone=Australia/Adelaide` or date-range equivalent | Primary daily fixture discovery, status, teams, league, score |
| 2 | API-Football | `/fixtures?id={fixture_id}&timezone=Australia/Adelaide` | Validate fixture status, teams, league, timestamp, score |
| 3 | Flashscore | `https://2.flashscore.ninja/2/x/feed/f_1_0_3_en-uk_1` | Fallback score/status hint only |
| 4 | TheSportsDB | `/eventsday.php?d={YYYY-MM-DD}&s=Soccer` | Fallback score/status hint only |

Do not use Sportsbet or Understat to discover fixtures. They are later-phase sources. SofaScore is no longer a required Phase 1 source because it is blocked.

## API-Football Configuration

Phase 1 expects one of these environment variables:

- `API_FOOTBALL_KEY`
- `APISPORTS_KEY`

If neither variable is set, the Phase 1 script still writes the Excel workbook from current `match_data.json`, but rows are marked as local fallback data. Past fallback rows become `needs_settlement`; future fallback rows become `source_unverified` until API-Football is configured.

## Required Agents

| Agent | Role In Phase 1 |
| --- | --- |
| Data Source Analyst | Inspect fixture endpoints, source health, response shape, failures, and coverage |
| Fixture Collector | Build the fixture slate and normalize it |
| Automation Operator | Run the routine or scripts when the prompt asks for execution |
| Results Settler | Support only when past fixtures must be marked FT |

All other agents wait until Phase 1 returns a validated slate.

## Required Skills

- [Endpoint Health Skill](skills/endpoint-health.md)
- [Fixture Normalization Skill](skills/fixture-normalization.md)
- [Settlement Audit Skill](skills/settlement-audit.md), only when fixture status may be stale or past-dated

## Workflow

1. Data Source Analyst reads `scripts/soccer_routine.py` and confirms current fixture endpoints.
2. Data Source Analyst checks latest run logs for endpoint failures, especially API-Football auth, rate-limit, timeout, or empty fixture responses.
3. Fixture Collector reads current `match_data.json` and latest snapshot to establish the existing slate.
4. Fixture Collector gathers scheduled events for the date window requested by the prompt. Default window is today and tomorrow in Australia/Adelaide.
5. Fixture Collector filters events to the listed league IDs only.
6. Fixture Collector validates each candidate with API-Football fixture-by-ID when available.
7. Fixture Collector normalizes:
   - `id`
   - `date`
   - `time`
   - `status`
   - `home.name`
   - `home.short`
   - `home.team_id`
   - `away.name`
   - `away.short`
   - `away.team_id`
   - league name and league ID
8. Fixture Collector deduplicates by event ID.
9. Results Settler marks past-date finished matches only when source status confirms finished or a fallback score source is clearly matched.
10. Fixture Collector assigns a `phase1_status` to every fixture.
11. Fixture Collector writes the current Excel review workbook.
12. Return the Phase 1 fixture slate and unresolved data issues.

## Required Fields

Every Phase 1 fixture row must include:

| Field | Purpose |
| --- | --- |
| `run_timestamp` | Shows when the slate was collected |
| `source` | Primary source used for the fixture |
| `source_health` | Whether the source was healthy, degraded, blocked, or unverified |
| `league_id` | Confirms the fixture belongs to the listed leagues |
| `league` | Human-readable competition name |
| `event_id` | Stable key for all later phases |
| `date` | Australia/Adelaide local date |
| `time` | Australia/Adelaide local time |
| `timezone` | Must be `Australia/Adelaide` |
| `utc_timestamp` | Optional original UTC/source timestamp for audit |
| `status` | Upcoming, live, FT, postponed, cancelled, or unresolved |
| `home` | Home team name |
| `home_team_id` | Team ID for later form/streak/standings phases |
| `away` | Away team name |
| `away_team_id` | Team ID for later form/streak/standings phases |
| `is_duplicate` | Flags duplicate event IDs |
| `is_stale` | Flags past fixtures still not settled |
| `missing_fields` | Lists missing event/team/date/status fields |
| `phase1_status` | Gate for whether the fixture can move to Phase 2 |
| `phase1_notes` | Short explanation for blocked or unusual rows |

## Phase 1 Status Values

Use exactly these status values:

| Status | Meaning |
| --- | --- |
| `ready_for_phase_2` | Fixture is clean and can move to odds collection |
| `needs_settlement` | Past fixture is still not confirmed FT |
| `missing_team_id` | Home or away team ID is missing |
| `missing_event_id` | Event ID is missing |
| `wrong_league` | Fixture is not in the listed league table |
| `duplicate_event_id` | Event ID appears more than once |
| `source_unverified` | Source endpoint could not validate the fixture |
| `postponed_or_cancelled` | Fixture should not move to betting analysis |
| `missing_datetime` | Date or time is missing or could not be normalized |

Only `ready_for_phase_2` rows should move to odds, form, streak, prediction, value, or risk phases.

## Excel Output

Create one current Excel workbook for human review:

`docs/agent-system/outputs/Phase1_Fixture_Slate.xlsx`

Overwrite it on each `run_daily` Phase 1 run. JSON remains the app source of truth; Excel is the review and handoff file.

Workbook sheets:

| Sheet | Contents |
| --- | --- |
| `Fixtures` | All Phase 1 fixture rows and status fields |
| `Ready For Phase 2` | Only `phase1_status = ready_for_phase_2` |
| `Needs Settlement` | Past or stale fixtures that need score/status settlement |
| `Blocked Or Invalid` | Missing IDs, wrong league, duplicate, unverified, postponed, cancelled |
| `League Summary` | Counts by league and Phase 1 status |
| `Source Health` | Endpoint status, failures, fallback usage, run timestamp |
| `Run Notes` | Human-readable notes, unresolved issues, and next recommended action |

Optional dated CSV or Markdown snapshots may be created for audit history, but the current Excel workbook is the Phase 1 handoff.

## Acceptance Criteria

- Every fixture belongs to one listed league.
- Every fixture has a stable event ID.
- Dates and times are Australia/Adelaide local.
- The stored `timezone` is `Australia/Adelaide`.
- Any UTC/source timestamp is preserved separately and never replaces local display fields.
- Home and away teams are not flipped.
- Home and away team IDs are present.
- No duplicate event IDs exist.
- Upcoming and finished statuses are separated.
- Any source failure is visible in the output.
- Every fixture has a `phase1_status`.
- Only `ready_for_phase_2` fixtures are passed to later agents.
- The Excel workbook is updated.
- Later agents receive a fixture slate, not raw endpoint payloads.

## Phase 1 Output Template

```markdown
## Phase 1 Fixture Slate

Date window: YYYY-MM-DD to YYYY-MM-DD, Australia/Adelaide

Source health:
- API-Football fixtures: healthy/degraded/blocked
- API-Football fixture validation: healthy/degraded/blocked
- Fallback scores: not used/used

Coverage:
- Total fixtures:
- Upcoming:
- Finished:
- Unresolved:
- Ready for Phase 2:
- Needs settlement:
- Blocked or invalid:

Fixtures:
| League | Date | Time | Home | Away | Event ID | Status | Phase 1 Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Issues:
- ...
```
