# Model Result Review

Generated: 2026-05-21 18:02:58 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1634

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 414 | 227 | 187 | 54.8% | 166.78 | 129.41 | 37.37 |
| Cards | 387 | 230 | 157 | 59.4% | 144.97 | 125.45 | 19.52 |
| Corners | 5 | 3 | 2 | 60.0% | 1.67 | 0 | 1.67 |
| Goals | 414 | 232 | 182 | 56.0% | 167.69 | 141.79 | 25.9 |
| Winner | 414 | 202 | 212 | 48.8% | 162.29 | 234.27 | -71.98 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Allsvenskan | 5 | 4 | 1 | 80.0% | 0 |
| Bundesliga | 143 | 76 | 67 | 53.1% | -5.25 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eliteserien | 15 | 9 | 6 | 60.0% | 0 |
| Eredivisie | 168 | 92 | 76 | 54.8% | -2.32 |
| J1 League | 35 | 22 | 13 | 62.9% | 8.15 |
| LaLiga | 196 | 100 | 96 | 51.0% | -18.03 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 155 | 80 | 75 | 51.6% | -0.92 |
| MLS | 296 | 155 | 141 | 52.4% | 35.11 |
| Premier League | 160 | 90 | 70 | 56.2% | 16.92 |
| Primeira Liga | 40 | 23 | 17 | 57.5% | 2.8 |
| Scottish Premiership | 26 | 18 | 8 | 69.2% | 12.46 |
| Serie A | 40 | 18 | 22 | 45.0% | -11.17 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Serie A | Winner | 10 | 30.0% | -12.16 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Bundesliga | Winner | 36 | 36.1% | -7.47 | review_weighting |
| Serie A | BTTS | 10 | 40.0% | -3.96 | review_weighting |
| MLS | Winner | 74 | 40.5% | -15.02 | review_weighting |
| LaLiga | Winner | 50 | 42.0% | -28.66 | review_weighting |
| Bundesliga | Cards | 35 | 42.9% | -20.89 | review_weighting |
| J1 League | BTTS | 9 | 44.4% | -0.38 | review_weighting |
| Eredivisie | Goals | 44 | 47.7% | -6.03 | review_weighting |
| Premier League | Winner | 40 | 50.0% | -12.84 | review_weighting |
| Ligue 1 | Goals | 39 | 51.3% | -7.83 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A Winner (10 settled, 30.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 936 |
| missing_model_probability | 641 |
| high_edge_miss | 23 |
| low_edge_hit | 18 |
| draw_pick | 16 |
