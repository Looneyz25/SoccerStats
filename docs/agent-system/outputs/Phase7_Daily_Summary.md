# Soccer Stats Daily Summary

Generated: 2026-05-22 17:58 ACST
Date window: 2026-05-22 to 2026-05-23

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 2.17s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed. |
| 2 Odds | ok | 0 | 18.75s | total=3 ready_for_phase_3=2 unmatched=1 blocked=0 |
| 3 Team Context | ok | 0 | 42.34s | total=3 ready_for_phase_4=0 unresolved=2 upstream_blocked=1 |
| 4 Predictions | ok | 0 | 0.11s | total=3 ready_for_phase_5=0 model_only=0 upstream_blocked=3 |
| 5 Value & Risk | ok | 0 | 0.11s | total=3 bets=0 leans=0 no_value=0 upstream_blocked=3 scale=1.0 |
| 6 Settlement | ok | 0 | 2.25s | settled_this_run=0 won=0 lost=0 pending=0 history_hit_rate=0.0 history_roi=-1.0 |
| Promote Phase Fixtures | ok | 0 | 10.42s | added=0 removed_duplicates=0 to match_data.json |
| Result Review | ok | 0 | 0.11s | settled_market_rows=1659 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.06s | market_adjustments=4 league_market_adjustments=8 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 3 | 0 | Flashscore |
| 2 Odds | 2 | 1 | Sportsbet (mimic) |
| 3 Team Context | 0 | 3 | SofaScore (mimic) |
| 4 Predictions | 0 | 3 | model |
| 5 Value & Risk | 0 bets / 0 leans | 3 | model |
| 6 Settlement | 0 won / 0 lost | 0 | Flashscore |
| Result Review | 1659 | 12 | match_data.json |
| Model Calibration | 4 | 8 | model_calibration.json |

## Today's Bets

No bets above threshold.

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 1659
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 4
- League/market adjustments: 8
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
