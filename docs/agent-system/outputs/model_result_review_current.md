# Model Result Review

Generated: 2026-06-17 07:36:40 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 2732

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 645 | 370 | 275 | 57.4% | 351.95 | 242.41 | 109.54 |
| Cards | 602 | 396 | 206 | 65.8% | 255.86 | 189.03 | 66.83 |
| Corners | 195 | 128 | 67 | 65.6% | 15.11 | 14.01 | 1.1 |
| Goals | 645 | 365 | 280 | 56.6% | 344.0 | 274.66 | 69.34 |
| Winner | 645 | 323 | 322 | 50.1% | 344.58 | 459.6 | -115.02 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 9 | 2 | 7 | 22.2% | -5.53 |
| Allsvenskan | 35 | 25 | 10 | 71.4% | 21.42 |
| Brasileirão Betano | 100 | 53 | 47 | 53.0% | 8.1 |
| Bundesliga | 153 | 81 | 72 | 52.9% | -2.06 |
| CONMEBOL Libertadores | 77 | 44 | 33 | 57.1% | 4.93 |
| Championship | 114 | 72 | 42 | 63.2% | -2.63 |
| Eliteserien | 35 | 23 | 12 | 65.7% | 4.35 |
| Eredivisie | 188 | 101 | 87 | 53.7% | -5.56 |
| FIFA World Cup | 85 | 57 | 28 | 67.1% | 51.51 |
| International Friendly Games | 333 | 222 | 111 | 66.7% | 7.24 |
| J1 League | 180 | 114 | 66 | 63.3% | 1.06 |
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
| FIFA World Cup | Winner | 17 | 41.2% | 5.26 | review_weighting |
| Eliteserien | Corners | 7 | 42.9% | 0 | review_weighting |
| Bundesliga | Cards | 37 | 43.2% | -19.22 | review_weighting |
| LaLiga | Winner | 60 | 43.3% | -33.84 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: CONMEBOL Libertadores Winner (16 settled, 25.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 1798 |
| missing_model_probability | 641 |
| high_edge_miss | 130 |
| low_edge_hit | 125 |
| draw_pick | 38 |
