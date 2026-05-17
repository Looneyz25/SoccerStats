# Model Result Review

Generated: 2026-05-17 19:12:59 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1380

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 351 | 191 | 160 | 54.4% | 114.17 | 80.76 | 33.41 |
| Cards | 327 | 183 | 144 | 56.0% | 86.12 | 104.93 | -18.81 |
| Goals | 351 | 195 | 156 | 55.6% | 108.41 | 94.49 | 13.92 |
| Winner | 351 | 172 | 179 | 49.0% | 99.51 | 166.26 | -66.75 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 143 | 76 | 67 | 53.1% | -5.25 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eredivisie | 130 | 67 | 63 | 51.5% | -7.13 |
| J1 League | 15 | 9 | 6 | 60.0% | 8.41 |
| LaLiga | 156 | 73 | 83 | 46.8% | -42.23 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 119 | 62 | 57 | 52.1% | -4.26 |
| MLS | 288 | 150 | 138 | 52.1% | 31.0 |
| Premier League | 124 | 68 | 56 | 54.8% | 6.5 |
| Primeira Liga | 35 | 20 | 15 | 57.1% | 0 |
| Scottish Premiership | 15 | 9 | 6 | 60.0% | 0 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| LaLiga | Winner | 40 | 35.0% | -34.46 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Bundesliga | Winner | 36 | 36.1% | -7.47 | review_weighting |
| Primeira Liga | Cards | 8 | 37.5% | 0 | review_weighting |
| MLS | Winner | 72 | 38.9% | -18.37 | review_weighting |
| Bundesliga | Cards | 35 | 42.9% | -20.89 | review_weighting |
| Primeira Liga | BTTS | 9 | 44.4% | 0 | review_weighting |
| Premier League | Cards | 31 | 45.2% | -7.88 | review_weighting |
| LaLiga | Goals | 40 | 47.5% | -6.17 | review_weighting |
| Ligue 1 | Cards | 29 | 48.3% | -7.73 | review_weighting |
| Ligue 1 | Goals | 30 | 53.3% | -5.03 | review_weighting |
| League Two | Winner | 27 | 59.3% | -5.35 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- First targeted review: LaLiga Winner (40 settled, 35.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 837 |
| missing_model_probability | 530 |
| draw_pick | 13 |
