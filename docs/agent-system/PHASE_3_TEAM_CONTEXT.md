# Phase 3: Team Context (Form, Streaks, H2H)

Use this phase when the prompt asks for team form, streaks, trends, recent results, head-to-head, or once odds are attached and the analysis pipeline needs football context.

## Objective

For every fixture marked `ready_for_phase_3` in the Phase 2 odds slate, attach SofaScore-derived team context: last-N form, streak labels, BTTS / over-under counts, clean sheets, and head-to-head.

Phase 3 does not produce probabilities, fair odds, or value picks. It only collects football context the modeler will consume.

## Inputs

| Input | Path | Required |
| --- | --- | --- |
| Phase 2 odds slate | `docs/agent-system/outputs/phase2_odds_slate_current.csv` | yes |
| Local store | `match_data.json` | optional team-ID hint cache |

Only rows whose `phase2_status = ready_for_phase_3` are processed. Other rows are echoed through with `phase3_status = upstream_blocked`.

## Endpoint Priority

| Priority | Source | Endpoint | Use |
| --- | --- | --- | --- |
| 1 | SofaScore | `/api/v1/search/teams/{query}` | Resolve fixture team names to SofaScore team IDs |
| 2 | SofaScore | `/api/v1/team/{team_id}/events/last/0` | Last completed matches per team |
| 3 | SofaScore | `/api/v1/team/{home_id}/h2h/{away_id}` | Optional head-to-head events when both IDs resolved |

All SofaScore requests must run through the smart-mimic session: a `curl_cffi` Session with a fixed browser impersonation profile, warmed by hitting `https://www.sofascore.com/`, sending `Referer: https://www.sofascore.com/`, AU/EN locale headers, jittered sleeps, and exponential backoff on transient errors.

## Listed Leagues

Same 10 leagues as Phase 1 / Phase 2. No additional league mapping required at this phase — fixtures are already filtered upstream.

## Required Agents

| Agent | Role In Phase 3 |
| --- | --- |
| Team Form Analyst | Fetch last-N matches, summarize form, compute BTTS/over/clean-sheet counts |
| Streak and Trends Analyst | Derive streak labels from each team's last completed matches |
| Data Source Analyst | Inspect SofaScore endpoint health, classify failures as healthy/degraded/blocked |

## Required Skills

- [Endpoint Health Skill](skills/endpoint-health.md)

## Workflow

1. Data Source Analyst opens a smart-mimic SofaScore session (homepage warmup, fixed UA per session).
2. Team Form Analyst resolves each fixture's home and away team to a SofaScore `team_id` via search; cache by normalized name.
3. Team Form Analyst fetches up to 10 most recent completed matches per team; cache by team_id.
4. Team Form Analyst computes per-team form summary: W/D/L over last 5 and last 10, goals for / against, goal difference, BTTS count, over-2.5 count, clean-sheet count, failed-to-score count.
5. Streak and Trends Analyst derives streak labels (Wins N, No losses N, Without clean sheet N, Both teams scoring N/M, More than 2.5 goals N/M, ...).
6. Optional: head-to-head pull for the home_id vs away_id pair.
7. Assign `phase3_status` per fixture row.
8. Write the Phase 3 review workbook.
9. Return the Phase 3 team-context slate, unresolved teams, and source health.

## Required Fields

| Field | Purpose |
| --- | --- |
| `event_id` | Phase 1/2 event ID (carried through) |
| `league`, `date`, `time`, `home`, `away` | Fixture identity |
| `home_sofa_id`, `away_sofa_id` | Resolved SofaScore team IDs |
| `home_form_n`, `away_form_n` | Number of form matches retrieved |
| `home_w5`, `home_d5`, `home_l5` | Last-5 W/D/L for home team |
| `away_w5`, `away_d5`, `away_l5` | Last-5 W/D/L for away team |
| `home_gf5`, `home_ga5`, `home_gd5` | Last-5 goals for / against / diff |
| `away_gf5`, `away_ga5`, `away_gd5` | Last-5 goals for / against / diff |
| `home_btts5`, `away_btts5` | Last-5 BTTS counts |
| `home_over25_5`, `away_over25_5` | Last-5 over-2.5 counts |
| `home_cs5`, `away_cs5` | Last-5 clean-sheet counts |
| `home_streaks`, `away_streaks` | Pipe-joined streak labels |
| `h2h_count`, `h2h_home_wins`, `h2h_away_wins`, `h2h_draws` | H2H summary when available |
| `source_health` | `healthy`, `degraded`, `blocked` |
| `phase3_status` | Gate for whether the fixture can move to Phase 4 |
| `phase3_notes` | Short explanation for blocked or unusual rows |

## Phase 3 Status Values

| Status | Meaning |
| --- | --- |
| `ready_for_phase_4` | Both teams resolved with at least 3 form matches each |
| `partial_form` | At least one team resolved but with fewer than 3 form matches |
| `team_unresolved` | One or both team names could not be resolved on SofaScore |
| `source_blocked` | SofaScore endpoint failed for this fixture |
| `upstream_blocked` | Phase 2 row was not `ready_for_phase_3`; no context attempted |

Only `ready_for_phase_4` rows should move to prediction.

## Excel Output

`docs/agent-system/outputs/Phase3_Team_Context.xlsx`

Workbook sheets:

| Sheet | Contents |
| --- | --- |
| `Form` | One row per fixture with summary metrics |
| `Streaks` | Per-fixture, pipe-joined streak labels for both teams |
| `H2H` | Summary of head-to-head record per fixture when available |
| `Ready For Phase 4` | Only `phase3_status = ready_for_phase_4` |
| `Unresolved` | `team_unresolved`, `partial_form` |
| `Source Health` | SofaScore endpoint status, request counts, blocked endpoints |
| `Run Notes` | Date window, totals, next action |

## Acceptance Criteria

- Every Phase 2 row is echoed through with a `phase3_status`.
- Every `ready_for_phase_4` row has both team IDs and last-5 form metrics for both teams.
- SofaScore is accessed only through the smart-mimic session.
- Source failures are visible in Source Health with HTTP status / exception text.
- No fixture is sent to Phase 4 without home and away form metrics.
