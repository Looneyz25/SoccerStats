# Soccer Stats Daily Summary

Generated: 2026-05-18 04:09 ACST
Date window: 2026-05-18 to 2026-05-18

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 3.61s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed. |
| 2 Odds | ok | 0 | 24.02s | total=23 ready_for_phase_3=19 unmatched=4 blocked=0 |
| 3 Team Context | ok | 0 | 375.94s | total=23 ready_for_phase_4=0 unresolved=19 upstream_blocked=4 |
| 4 Predictions | ok | 0 | 0.12s | total=23 ready_for_phase_5=0 model_only=0 upstream_blocked=23 |
| 5 Value & Risk | ok | 0 | 0.11s | total=23 bets=0 leans=0 no_value=0 upstream_blocked=23 scale=1.0 |
| 6 Settlement | ok | 0 | 3.02s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Result Review | ok | 0 | 0.12s | settled_market_rows=1490 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.08s | market_adjustments=4 league_market_adjustments=8 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 23 | 0 | Flashscore |
| 2 Odds | 19 | 4 | Sportsbet (mimic) |
| 3 Team Context | 0 | 23 | SofaScore (mimic) |
| 4 Predictions | 0 | 23 | model |
| 5 Value & Risk | 0 bets / 0 leans | 23 | model |
| 6 Settlement | 0 won / 0 lost | 0 | Flashscore |
| Result Review | 1490 | 12 | match_data.json |
| Model Calibration | 4 | 8 | model_calibration.json |

## Today's Bets

No bets above threshold.

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 1490
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 4
- League/market adjustments: 8
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
