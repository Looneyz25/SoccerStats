# Model Result Review

Generated: 2026-05-22 17:58:11 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1659

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 419 | 227 | 192 | 54.2% | 166.78 | 138.12 | 28.66 |
| Cards | 392 | 234 | 158 | 59.7% | 148.74 | 127.45 | 21.29 |
| Corners | 10 | 7 | 3 | 70.0% | 3.27 | 1.58 | 1.69 |
| Goals | 419 | 234 | 185 | 55.9% | 171.32 | 146.69 | 24.63 |
| Winner | 419 | 204 | 215 | 48.7% | 167.44 | 240.47 | -73.03 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Allsvenskan | 10 | 8 | 2 | 80.0% | 3.12 |
| Bundesliga | 148 | 78 | 70 | 52.7% | -8.86 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eliteserien | 15 | 9 | 6 | 60.0% | 0 |
| Eredivisie | 178 | 95 | 83 | 53.4% | -10.45 |
| J1 League | 35 | 22 | 13 | 62.9% | 8.15 |
| LaLiga | 196 | 100 | 96 | 51.0% | -18.03 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 155 | 80 | 75 | 51.6% | -0.92 |
| MLS | 296 | 155 | 141 | 52.4% | 35.11 |
| Premier League | 160 | 90 | 70 | 56.2% | 16.92 |
| Primeira Liga | 40 | 23 | 17 | 57.5% | 2.8 |
| Scottish Premiership | 31 | 21 | 10 | 67.7% | 11.84 |
| Serie A | 40 | 18 | 22 | 45.0% | -11.17 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Serie A | Winner | 10 | 30.0% | -12.16 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| Bundesliga | Winner | 37 | 35.1% | -9.2 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Serie A | BTTS | 10 | 40.0% | -3.96 | review_weighting |
| MLS | Winner | 74 | 40.5% | -15.02 | review_weighting |
| LaLiga | Winner | 50 | 42.0% | -28.66 | review_weighting |
| Bundesliga | Cards | 36 | 44.4% | -19.22 | review_weighting |
| J1 League | BTTS | 9 | 44.4% | -0.38 | review_weighting |
| Eredivisie | Goals | 46 | 45.6% | -9.13 | review_weighting |
| Premier League | Winner | 40 | 50.0% | -12.84 | review_weighting |
| Ligue 1 | Goals | 39 | 51.3% | -7.83 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A Winner (10 settled, 30.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 954 |
| missing_model_probability | 641 |
| high_edge_miss | 26 |
| low_edge_hit | 21 |
| draw_pick | 17 |
