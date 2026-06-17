# Model Result Review

Generated: 2026-06-18 03:05:16 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 2757

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 648 | 372 | 276 | 57.4% | 356.35 | 244.61 | 111.74 |
| Cards | 612 | 405 | 207 | 66.2% | 260.45 | 191.03 | 69.42 |
| Corners | 201 | 133 | 68 | 66.2% | 15.11 | 14.01 | 1.1 |
| Goals | 648 | 368 | 280 | 56.8% | 349.07 | 274.66 | 74.41 |
| Winner | 648 | 326 | 322 | 50.3% | 348.41 | 459.6 | -111.19 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 9 | 2 | 7 | 22.2% | -5.53 |
| Allsvenskan | 35 | 25 | 10 | 71.4% | 21.42 |
| Brasileirão Betano | 100 | 53 | 47 | 53.0% | 8.1 |
| Bundesliga | 153 | 81 | 72 | 52.9% | -2.06 |
| CONMEBOL Libertadores | 80 | 46 | 34 | 57.5% | 4.76 |
| Championship | 114 | 72 | 42 | 63.2% | -2.63 |
| Eliteserien | 35 | 23 | 12 | 65.7% | 4.35 |
| Eredivisie | 188 | 101 | 87 | 53.7% | -5.56 |
| FIFA World Cup | 100 | 71 | 29 | 71.0% | 65.37 |
| International Friendly Games | 339 | 227 | 112 | 67.0% | 7.24 |
| J1 League | 181 | 115 | 66 | 63.5% | 1.06 |
| LaLiga | 246 | 133 | 113 | 54.1% | -3.41 |
| League One | 126 | 74 | 52 | 58.7% | 7.89 |
| League Two | 112 | 64 | 48 | 57.1% | -10.07 |
| Ligue 1 | 165 | 85 | 80 | 51.5% | -6.89 |
| MLS | 371 | 205 | 166 | 55.3% | 50.09 |
| Premier League | 210 | 114 | 96 | 54.3% | 8.94 |
| Primeira Liga | 43 | 25 | 18 | 58.1% | 2.8 |
| Scottish Premiership | 36 | 23 | 13 | 63.9% | 5.11 |
| Serie A | 90 | 50 | 40 | 55.6% | -3.76 |
| UEFA Champions League | 19 | 12 | 7 | 63.2% | 0.96 |
| UEFA Conference League | 5 | 3 | 2 | 60.0% | -2.7 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| CONMEBOL Libertadores | Winner | 16 | 25.0% | -25.14 | review_weighting |
| Eliteserien | Winner | 7 | 28.6% | -10.55 | review_weighting |
| Serie A | Winner | 20 | 30.0% | -26.51 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| Bundesliga | Winner | 38 | 36.8% | -5.95 | review_weighting |
| League One | BTTS | 32 | 37.5% | 1.67 | review_weighting |
| Brasileirão Betano | Goals | 20 | 40.0% | -7.88 | review_weighting |
| UEFA Champions League | BTTS | 5 | 40.0% | -2.65 | review_weighting |
| Eliteserien | Corners | 7 | 42.9% | 0 | review_weighting |
| Bundesliga | Cards | 37 | 43.2% | -19.22 | review_weighting |
| LaLiga | Winner | 60 | 43.3% | -33.84 | review_weighting |
| MLS | Winner | 89 | 43.8% | -13.59 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: CONMEBOL Libertadores Winner (16 settled, 25.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 1816 |
| missing_model_probability | 641 |
| high_edge_miss | 131 |
| low_edge_hit | 131 |
| draw_pick | 38 |
