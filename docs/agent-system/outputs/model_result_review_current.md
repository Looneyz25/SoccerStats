# Model Result Review

Generated: 2026-05-18 10:30:26 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1590

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 404 | 219 | 185 | 54.2% | 160.22 | 124.65 | 35.57 |
| Cards | 378 | 226 | 152 | 59.8% | 143.06 | 120.28 | 22.78 |
| Goals | 404 | 225 | 179 | 55.7% | 160.84 | 135.74 | 25.1 |
| Winner | 404 | 200 | 204 | 49.5% | 159.16 | 224.64 | -65.48 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 143 | 76 | 67 | 53.1% | -5.25 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eredivisie | 165 | 92 | 73 | 55.8% | 4.36 |
| J1 League | 35 | 22 | 13 | 62.9% | 8.15 |
| LaLiga | 196 | 100 | 96 | 51.0% | -18.03 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 155 | 80 | 75 | 51.6% | -0.92 |
| MLS | 292 | 152 | 140 | 52.0% | 31.23 |
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
| MLS | Winner | 73 | 39.7% | -17.07 | review_weighting |
| Serie A | BTTS | 10 | 40.0% | -3.96 | review_weighting |
| LaLiga | Winner | 50 | 42.0% | -28.66 | review_weighting |
| Bundesliga | Cards | 35 | 42.9% | -20.89 | review_weighting |
| J1 League | BTTS | 9 | 44.4% | -0.38 | review_weighting |
| Primeira Liga | BTTS | 9 | 44.4% | 0 | review_weighting |
| Ligue 1 | Goals | 39 | 51.3% | -7.83 | review_weighting |
| Premier League | Winner | 37 | 51.3% | -8.69 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A Winner (10 settled, 30.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 906 |
| missing_model_probability | 635 |
| low_edge_hit | 18 |
| high_edge_miss | 17 |
| draw_pick | 14 |
