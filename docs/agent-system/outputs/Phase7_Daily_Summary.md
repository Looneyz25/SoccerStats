# Soccer Stats Daily Summary

Generated: 2026-05-18 17:54 ACST
Date window: 2026-05-18 to 2026-05-19

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 1.34s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed. |
| 2 Odds | ok | 0 | 16.0s | total=3 ready_for_phase_3=1 unmatched=2 blocked=0 |
| 3 Team Context | ok | 0 | 21.89s | total=3 ready_for_phase_4=0 unresolved=1 upstream_blocked=2 |
| 4 Predictions | ok | 0 | 0.11s | total=3 ready_for_phase_5=0 model_only=0 upstream_blocked=3 |
| 5 Value & Risk | ok | 0 | 0.09s | total=3 bets=0 leans=0 no_value=0 upstream_blocked=3 scale=1.0 |
| 6 Settlement | ok | 0 | 2.34s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Result Review | ok | 0 | 0.11s | settled_market_rows=1594 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.08s | market_adjustments=4 league_market_adjustments=7 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 3 | 0 | Flashscore |
| 2 Odds | 1 | 2 | Sportsbet (mimic) |
| 3 Team Context | 0 | 3 | SofaScore (mimic) |
| 4 Predictions | 0 | 3 | model |
| 5 Value & Risk | 0 bets / 0 leans | 3 | model |
| 6 Settlement | 0 won / 0 lost | 0 | Flashscore |
| Result Review | 1594 | 12 | match_data.json |
| Model Calibration | 4 | 7 | model_calibration.json |

## Today's Bets

No bets above threshold.

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 1594
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 4
- League/market adjustments: 7
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
