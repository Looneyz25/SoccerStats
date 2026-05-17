# Model Result Review

Generated: 2026-05-18 01:57:20 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1490

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 379 | 206 | 173 | 54.4% | 137.96 | 104.13 | 33.83 |
| Cards | 353 | 206 | 147 | 58.4% | 106.55 | 110.67 | -4.12 |
| Goals | 379 | 212 | 167 | 55.9% | 138.65 | 115.1 | 23.55 |
| Winner | 379 | 188 | 191 | 49.6% | 131.41 | 196.34 | -64.93 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 143 | 76 | 67 | 53.1% | -5.25 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eredivisie | 165 | 92 | 73 | 55.8% | 4.36 |
| J1 League | 35 | 22 | 13 | 62.9% | 8.15 |
| LaLiga | 156 | 73 | 83 | 46.8% | -42.23 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 119 | 62 | 57 | 52.1% | -4.26 |
| MLS | 288 | 150 | 138 | 52.1% | 31.0 |
| Premier League | 144 | 81 | 63 | 56.2% | 15.51 |
| Primeira Liga | 35 | 20 | 15 | 57.1% | 0 |
| Scottish Premiership | 26 | 18 | 8 | 69.2% | 12.46 |
| Serie A | 24 | 11 | 13 | 45.8% | -6.14 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Serie A | BTTS | 6 | 33.3% | -4.24 | review_weighting |
| LaLiga | Winner | 40 | 35.0% | -34.46 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Bundesliga | Winner | 36 | 36.1% | -7.47 | review_weighting |
| Primeira Liga | Cards | 8 | 37.5% | 0 | review_weighting |
| MLS | Winner | 72 | 38.9% | -18.37 | review_weighting |
| Bundesliga | Cards | 35 | 42.9% | -20.89 | review_weighting |
| J1 League | BTTS | 9 | 44.4% | -0.38 | review_weighting |
| Primeira Liga | BTTS | 9 | 44.4% | 0 | review_weighting |
| LaLiga | Goals | 40 | 47.5% | -6.17 | review_weighting |
| Ligue 1 | Cards | 29 | 48.3% | -7.73 | review_weighting |
| Premier League | Winner | 36 | 50.0% | -10.89 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A BTTS (6 settled, 33.3% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 882 |
| missing_model_probability | 572 |
| high_edge_miss | 14 |
| draw_pick | 13 |
| low_edge_hit | 9 |
