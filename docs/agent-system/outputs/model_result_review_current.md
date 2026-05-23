# Model Result Review

Generated: 2026-05-23 17:29:47 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1695

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 426 | 230 | 196 | 54.0% | 168.48 | 146.67 | 21.81 |
| Cards | 399 | 241 | 158 | 60.4% | 150.47 | 127.45 | 23.02 |
| Corners | 18 | 14 | 4 | 77.8% | 4.69 | 1.58 | 3.11 |
| Goals | 426 | 238 | 188 | 55.9% | 175.16 | 153.66 | 21.5 |
| Winner | 426 | 205 | 221 | 48.1% | 169.59 | 255.11 | -85.52 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Allsvenskan | 25 | 17 | 8 | 68.0% | -4.01 |
| Bundesliga | 148 | 78 | 70 | 52.7% | -8.86 |
| Championship | 109 | 68 | 41 | 62.4% | -12.14 |
| Eliteserien | 15 | 9 | 6 | 60.0% | 0 |
| Eredivisie | 178 | 95 | 83 | 53.4% | -10.45 |
| J1 League | 51 | 32 | 19 | 62.7% | -4.08 |
| LaLiga | 196 | 100 | 96 | 51.0% | -18.03 |
| League One | 121 | 69 | 52 | 57.0% | 0 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 155 | 80 | 75 | 51.6% | -0.92 |
| MLS | 296 | 155 | 141 | 52.4% | 35.11 |
| Premier League | 160 | 90 | 70 | 56.2% | 16.92 |
| Primeira Liga | 40 | 23 | 17 | 57.5% | 2.8 |
| Scottish Premiership | 31 | 21 | 10 | 67.7% | 11.84 |
| Serie A | 45 | 21 | 24 | 46.7% | -11.13 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Allsvenskan | Winner | 5 | 20.0% | 0.54 | review_weighting |
| Serie A | Winner | 11 | 27.3% | -15.04 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| Bundesliga | Winner | 37 | 35.1% | -9.2 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Serie A | BTTS | 11 | 36.4% | -6.36 | review_weighting |
| MLS | Winner | 74 | 40.5% | -15.02 | review_weighting |
| J1 League | BTTS | 12 | 41.7% | -2.83 | review_weighting |
| LaLiga | Winner | 50 | 42.0% | -28.66 | review_weighting |
| Bundesliga | Cards | 36 | 44.4% | -19.22 | review_weighting |
| Eredivisie | Goals | 46 | 45.6% | -9.13 | review_weighting |
| Premier League | Winner | 40 | 50.0% | -12.84 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Allsvenskan Winner (5 settled, 20.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 981 |
| missing_model_probability | 641 |
| high_edge_miss | 34 |
| low_edge_hit | 22 |
| draw_pick | 17 |
