# Soccer Stats Daily Summary

Generated: 2026-05-20 09:58 ACST
Date window: 2026-05-22 to 2026-05-24

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 24.83s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY and Flashscore returned no fixtures; used TheSportsDB v1 fallback. |
| 2 Odds | ok | 0 | 16.62s | total=6 ready_for_phase_3=5 unmatched=1 blocked=0 |
| 3 Team Context | ok | 0 | 97.7s | total=6 ready_for_phase_4=0 unresolved=5 upstream_blocked=1 |
| 4 Predictions | ok | 0 | 0.11s | total=6 ready_for_phase_5=0 model_only=0 upstream_blocked=6 |
| 5 Value & Risk | ok | 0 | 0.11s | total=6 bets=0 leans=0 no_value=0 upstream_blocked=6 scale=1.0 |
| 6 Settlement | ok | 0 | 1.5s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Result Review | ok | 0 | 0.12s | settled_market_rows=1606 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.06s | market_adjustments=4 league_market_adjustments=7 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 6 | 0 | Flashscore |
| 2 Odds | 5 | 1 | Sportsbet (mimic) |
| 3 Team Context | 0 | 6 | SofaScore (mimic) |
| 4 Predictions | 0 | 6 | model |
| 5 Value & Risk | 0 bets / 0 leans | 6 | model |
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
