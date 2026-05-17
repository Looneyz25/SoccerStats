# Soccer Stats Daily Summary

Generated: 2026-05-17 16:16 ACST
Date window: 2026-05-17 to 2026-05-18

## Phase Run Status

| Phase | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| 1 Fixtures | ok | 0 | 19.05s | NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed. |
| 2 Odds | ok | 0 | 36.52s | total=60 ready_for_phase_3=38 unmatched=22 blocked=0 |
| 3 Team Context | ok | 0 | 208.58s | total=60 ready_for_phase_4=34 unresolved=4 upstream_blocked=22 |
| 4 Predictions | ok | 0 | 0.12s | total=60 ready_for_phase_5=34 model_only=0 upstream_blocked=26 |
| 5 Value & Risk | ok | 0 | 0.11s | total=60 bets=5 leans=9 no_value=20 upstream_blocked=26 scale=1.0 |
| 6 Settlement | ok | 0 | 20.59s | settled_this_run=0 won=0 lost=0 pending=14 history_hit_rate=0.0 history_roi=-1.0 |
| Result Review | ok | 0 | 0.11s | settled_market_rows=1380 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the revie |
| Model Calibration | ok | 0 | 0.08s | market_adjustments=3 league_market_adjustments=11 |

## Phase Health

| Phase | Ready | Blocked | Source |
| --- | --- | --- | --- |
| 1 Fixtures | 60 | 0 | Flashscore |
| 2 Odds | 38 | 22 | Sportsbet (mimic) |
| 3 Team Context | 34 | 26 | SofaScore (mimic) |
| 4 Predictions | 34 | 26 | model |
| 5 Value & Risk | 5 bets / 9 leans | 46 | model |
| 6 Settlement | 0 won / 0 lost | 14 | Flashscore |
| Result Review | 1380 | 12 | match_data.json |
| Model Calibration | 3 | 11 | model_calibration.json |

## Today's Bets

| Date | Time | League | Match | Pick | Model p | Fair | Market | Edge | Stake |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-17 | 19:30 | Serie A | Como vs Parma | away | 0.19355830508474575 | 5.166 | 11.0 | 0.1026 | 20.0 |
| 2026-05-17 | 22:00 | Eredivisie | Sparta Rotterdam vs Excelsior | away | 0.46492481856603696 | 2.151 | 3.0 | 0.1316 | 20.0 |
| 2026-05-18 | 04:15 | Serie A | Udinese vs Cremonese | home | 0.5166484711779449 | 1.936 | 2.4 | 0.1 | 20.0 |
| 2026-05-18 | 04:30 | Ligue 1 | Strasbourg vs Monaco | home | 0.42364591065292095 | 2.36 | 3.0 | 0.0903 | 20.0 |
| 2026-05-18 | 04:45 | LaLiga | Barcelona vs Betis | away | 0.21563217634709592 | 4.638 | 9.5 | 0.1104 | 20.0 |

## Leans (below bet threshold)

| Match | Pick | Model p | Market | Edge |
| --- | --- | --- | --- | --- |
| Genoa vs AC Milan | home | 0.2571843012364181 | 5.0 | 0.0572 |
| Juventus vs Fiorentina | draw | 0.2464353880927423 | 5.5 | 0.0646 |
| Pisa vs Napoli | home | 0.18378077821011674 | 9.0 | 0.0727 |
| Utrecht vs Sittard | away | 0.24081564655916007 | 6.0 | 0.0741 |
| Brentford vs Crystal Palace | away | 0.2529180530373343 | 5.0 | 0.0529 |
| Osasuna vs Espanyol | away | 0.2836728987320498 | 4.33 | 0.0527 |
| Sassuolo vs Lecce | home | 0.42763439123578717 | 2.62 | 0.046 |
| Lille vs Auxerre | away | 0.19364614172916342 | 7.5 | 0.0603 |
| Lorient vs Le Havre | home | 0.44293367303609343 | 2.62 | 0.0613 |

## History

- Total settled bets: 2
- Won: 0  Lost: 2
- Hit rate: 0.0%
- ROI: -100.00% (staked 36.93 -> realized -36.93)

## Model Result Review

- Settled market rows reviewed: 1380
- Weak spots flagged: 12
- Top action: Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Full review: `docs/agent-system/outputs/model_result_review_current.md`

## Model Calibration

- Market adjustments: 3
- League/market adjustments: 11
- Full calibration: `docs/agent-system/outputs/model_calibration.md`

## Responsible Betting

Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.
