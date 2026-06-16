# Soccer Stats Daily Summary

Generated: 2026-06-05 19:29 ACST
Date window: 2026-06-05 to 2026-06-06

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 1.8s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed. |
| 2 Odds | ok | 0 | 9.56s | total=21 ready_for_phase_3=14 unmatched=7 blocked=0 |
| 3 Team Context | ok | 0 | 275.5s | total=21 ready_for_phase_4=0 unresolved=14 upstream_blocked=7 |
| 4 Predictions | ok | 0 | 0.09s | total=21 ready_for_phase_5=0 model_only=0 upstream_blocked=21 |
| 5 Value & Risk | ok | 0 | 0.09s | total=21 bets=0 leans=0 no_value=0 upstream_blocked=21 scale=1.0 |
| 6 Settlement | ok | 0 | 2.62s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Promote Phase Fixtures | ok | 0 | 12.38s | added=3 removed_duplicates=0 to match_data.json |
| Result Review | ok | 0 | 0.12s | settled_market_rows=2439 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.06s | market_adjustments=3 league_market_adjustments=7 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 21 | 0 | Flashscore |
| 2 Odds | 14 | 7 | Sportsbet (mimic) |
| 3 Team Context | 0 | 21 | SofaScore (mimic) |
| 4 Predictions | 0 | 21 | model |
| 5 Value & Risk | 0 bets / 0 leans | 21 | model |
| 6 Settlement | 0 won / 0 lost | 0 | Flashscore |
| Result Review | 2439 | 12 | match_data.json |
| Model Calibration | 3 | 7 | model_calibration.json |

## Today's Bets

No bets above threshold.

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 2439
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 3
- League/market adjustments: 7
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
