# Model Result Review

Generated: 2026-05-18 06:26:16 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1558

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 396 | 214 | 182 | 54.0% | 151.78 | 119.76 | 32.02 |
| Cards | 370 | 218 | 152 | 58.9% | 128.71 | 120.28 | 8.43 |
| Goals | 396 | 220 | 176 | 55.6% | 152.49 | 130.48 | 22.01 |
| Winner | 396 | 194 | 202 | 49.0% | 147.86 | 218.32 | -70.46 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 143 | 76 | 67 | 53.1% | -5.25 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eredivisie | 165 | 92 | 73 | 55.8% | 4.36 |
| J1 League | 35 | 22 | 13 | 62.9% | 8.15 |
| LaLiga | 180 | 87 | 93 | 48.3% | -33.36 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 143 | 71 | 72 | 49.6% | -11.33 |
| MLS | 288 | 150 | 138 | 52.1% | 31.0 |
| Premier League | 148 | 85 | 63 | 57.4% | 22.41 |
| Primeira Liga | 35 | 20 | 15 | 57.1% | 0 |
| Scottish Premiership | 26 | 18 | 8 | 69.2% | 12.46 |
| Serie A | 40 | 18 | 22 | 45.0% | -11.17 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Serie A | Winner | 10 | 30.0% | -12.16 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Bundesliga | Winner | 36 | 36.1% | -7.47 | review_weighting |
| Primeira Liga | Cards | 8 | 37.5% | 0 | review_weighting |
| MLS | Winner | 72 | 38.9% | -18.37 | review_weighting |
| LaLiga | Winner | 46 | 39.1% | -29.96 | review_weighting |
| Serie A | BTTS | 10 | 40.0% | -3.96 | review_weighting |
| Bundesliga | Cards | 35 | 42.9% | -20.89 | review_weighting |
| J1 League | BTTS | 9 | 44.4% | -0.38 | review_weighting |
| Primeira Liga | BTTS | 9 | 44.4% | 0 | review_weighting |
| LaLiga | Goals | 46 | 47.8% | -5.92 | review_weighting |
| Ligue 1 | Goals | 36 | 50.0% | -8.93 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A Winner (10 settled, 30.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 903 |
| missing_model_probability | 611 |
| high_edge_miss | 17 |
| draw_pick | 14 |
| low_edge_hit | 13 |
