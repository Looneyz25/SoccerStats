# Phase 9: Display & Automation

Use this phase when the prompt asks to run all phases, refresh the daily slate, generate a human-readable summary, schedule the pipeline, or wire the agent system into a daily batch.

## Objective

Run Phases 1-8 in order, capture each phase's exit status and headline counts, produce a single human-readable daily summary, and publish dashboard data to Firestore.

Phase 9 owns orchestration and presentation. It does not collect data, score, value, settle, or recalibrate on its own.

## Inputs

All Phase 1-8 outputs in `docs/agent-system/outputs/`.

## Workflow

1. Automation Operator runs phases sequentially via `scripts/soccer_phases_routine.py`. A failure in an early phase does not abort later phases — every phase that has an input file runs and reports its own status.
2. Capture each phase's stdout last line (totals) and any non-zero exit code.
3. Read final outputs and compose `docs/agent-system/outputs/Phase7_Daily_Summary.md` with:
   - Date window
   - Per-phase health table (rows ready, blocked, source health)
   - Today's recommended bets (Phase 5 `bet` rows) with model vs market
   - Cumulative history accuracy + ROI
   - Result Review Agent top model-feedback action
   - Model Calibration Agent adjustment counts
4. Upload dashboard data to Firestore with `scripts/upload_match_data_to_firestore.mjs`. Do not prepare or rely on public JSON for the live dashboard.
5. Before upload, check newly added leagues for display completeness: every match should have the same five-card market shape as established leagues (`Suggested pick`, `BTTS`, `Goals`, `Cards`, `Corners`). If a card has `No pick`, the generated data must include an explicit source/model blocker; it must not be missing only because the league is new.

## Firestore Data Publish

For normal daily operations, use:

```powershell
npm.cmd run get:data
```

This is the full data-only refresh. It runs the routine across the 7-day fixture window, updates generated local artifacts and phase outputs, and uploads `match_data.json` to Firestore as small per-league documents through `scripts/upload_match_data_to_firestore.mjs`.

It must not commit, push, build, or deploy unless the user explicitly asks for those steps. If Firestore credentials are missing, the local data refresh can still complete, but the upload will fail with instructions to restore `.secrets/firebase-service-account.json` or configure `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SERVICE_ACCOUNT_JSON`.

For scheduled result checks, use:

```powershell
npm.cmd run get:data:results
```

This is the smaller automation loop after the initial 7-day pull. It writes `docs/agent-system/outputs/result_check_schedule_latest.md`, checks only unresolved matches whose kickoff time plus the completion buffer has passed, settles/backfills finished matches, prunes stale unresolved matches outside the result lookback window, runs result review/calibration, and uploads Firestore. Each run should reduce the today/overdue remaining count as matches become `FT`. When that count reaches zero, it seeds day+1 once instead of re-running the full 7-day pull.

## Required Agents

| Agent | Role In Phase 7 |
| --- | --- |
| Automation Operator | Run the routine, capture exit codes, surface failures |
| Dashboard Product Agent | Compose the daily summary and verify the Next.js dashboard data handoff |
| Compliance and Responsible Betting Reviewer | Verify summary uses probability/edge/uncertainty language and includes a responsible-betting note |

## Outputs

| File | Purpose |
| --- | --- |
| `docs/agent-system/outputs/Phase7_Daily_Summary.md` | One-page human-readable slate |
| `docs/agent-system/outputs/Phase7_Run_Log.json` | Per-phase exit code, last stdout line, duration |
| `docs/agent-system/outputs/model_result_review_current.md` | Daily model-feedback review from resulted matches |
| `docs/agent-system/outputs/model_calibration.md` | Conservative automatic-learning controls |
| Firestore `dashboardData/match_data/leagues/*` | Live dashboard data |

## Acceptance Criteria

- Every phase script runs (subject to its own input requirements); a missing input is reported as `skipped` not `failed`.
- The daily summary lists every Phase 5 `bet` row with: match, model probability, model fair odds, market price, edge, recommended stake.
- The daily summary names the source for each odds price.
- The daily summary includes a responsible-betting note ("Estimates only. No guarantees. Stake within limits.").
- The daily summary includes the Result Review Agent's top model-feedback action.
- The run log records exit codes and timing for each phase.
- The workflow does not modify `index.html`; the legacy static dashboard has been removed.
- Newly added leagues are fetched, predicted, reviewed, and published through the same routine as current leagues. A valid new-league fixture with teams and odds should not reach Firestore as fixture-only data with empty prediction cards unless a real upstream blocker is recorded.

## Daily Summary Template

```markdown
# Soccer Stats Daily Summary

Generated: YYYY-MM-DD HH:MM Australia/Adelaide
Date window: YYYY-MM-DD to YYYY-MM-DD

## Phase Health
| Phase | Ready | Blocked | Source Health |
| --- | --- | --- | --- |
| 1 Fixtures | N | N | healthy/degraded/blocked |
| 2 Odds | N | N | ... |
| 3 Team Context | N | N | ... |
| 4 Predictions | N | N | n/a |
| 5 Value & Risk | N bets / N leans | N | n/a |
| 6 Settlement | N pending | N not_found | Flashscore healthy/blocked |
| Result Review | N settled markets | N weak spots | match_data.json |
| Model Calibration | N markets | N league/markets | model_calibration.json |

## Today's Bets
| Match | Pick | Model p | Fair | Market | Edge | Stake |

## History
- Total settled bets: N
- Hit rate: X.X%
- ROI: X.X%

## Model Result Review
- Settled market rows reviewed: N
- Weak spots flagged: N
- Top action: ...

## Model Calibration
- Market adjustments: N
- League/market adjustments: N
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

Responsible betting: Estimates only. No guarantees. Stake within limits.
```
