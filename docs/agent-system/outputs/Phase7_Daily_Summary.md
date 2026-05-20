# Soccer Stats Daily Summary

Generated: 2026-05-20 17:58 ACST
Date window: 2026-05-21 to 2026-05-27

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 22.83s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY and live fallbacks returned no fixtures; used local match_data.json fallbac |
| 2 Odds | ok | 0 | 7.88s | total=71 ready_for_phase_3=0 unmatched=0 blocked=71 |
| 3 Team Context | ok | 0 | 3.2s | total=71 ready_for_phase_4=0 unresolved=0 upstream_blocked=71 |
| 4 Predictions | ok | 0 | 0.11s | total=71 ready_for_phase_5=0 model_only=0 upstream_blocked=71 |
| 5 Value & Risk | ok | 0 | 0.11s | total=71 bets=0 leans=0 no_value=0 upstream_blocked=71 scale=1.0 |
| 6 Settlement | ok | 0 | 2.38s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Result Review | ok | 0 | 5.11s | settled_market_rows=1606 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.06s | market_adjustments=4 league_market_adjustments=7 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 0 | 71 | Flashscore |
| 2 Odds | 0 | 71 | Sportsbet (mimic) |
| 3 Team Context | 0 | 71 | SofaScore (mimic) |
| 4 Predictions | 0 | 71 | model |
| 5 Value & Risk | 0 bets / 0 leans | 71 | model |
| 6 Settlement | 0 won / 0 lost | 0 | Flashscore |
| Result Review | 1606 | 12 | match_data.json |
| Model Calibration | 4 | 7 | model_calibration.json |

## Today's Bets

No bets above threshold.

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 1606
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 4
- League/market adjustments: 7
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
