# Model Result Review

Generated: 2026-05-25 12:45:18 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 2052

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 498 | 271 | 227 | 54.4% | 236.2 | 203.1 | 33.1 |
| Cards | 470 | 286 | 184 | 60.9% | 214.76 | 164.85 | 49.91 |
| Corners | 88 | 61 | 27 | 69.3% | 6.42 | 10.45 | -4.03 |
| Goals | 498 | 275 | 223 | 55.2% | 235.47 | 220.85 | 14.62 |
| Winner | 498 | 247 | 251 | 49.6% | 259.16 | 335.85 | -76.69 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 9 | 2 | 7 | 22.2% | -5.53 |
| Allsvenskan | 43 | 23 | 20 | 53.5% | -11.84 |
| Brasileirão Betano | 45 | 17 | 28 | 37.8% | -17.52 |
| Bundesliga | 148 | 78 | 70 | 52.7% | -8.86 |
| Championship | 114 | 72 | 42 | 63.2% | -2.63 |
| Eliteserien | 30 | 22 | 8 | 73.3% | 8.33 |
| Eredivisie | 188 | 101 | 87 | 53.7% | -5.56 |
| J1 League | 85 | 54 | 31 | 63.5% | -8.11 |
| LaLiga | 246 | 133 | 113 | 54.1% | -3.41 |
| League One | 126 | 74 | 52 | 58.7% | 7.89 |
| League Two | 107 | 61 | 46 | 57.0% | -9.11 |
| Ligue 1 | 155 | 80 | 75 | 51.6% | -0.92 |
| MLS | 366 | 203 | 163 | 55.5% | 54.98 |
| Premier League | 210 | 114 | 96 | 54.3% | 8.94 |
| Primeira Liga | 40 | 23 | 17 | 57.5% | 2.8 |
| Scottish Premiership | 31 | 21 | 10 | 67.7% | 11.84 |
| Serie A | 95 | 54 | 41 | 56.8% | -0.36 |
| UEFA Champions League | 14 | 8 | 6 | 57.1% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Brasileirão Betano | Goals | 9 | 11.1% | -13.64 | review_weighting |
| Brasileirão Betano | BTTS | 9 | 22.2% | -9.83 | review_weighting |
| Serie A | Winner | 21 | 33.3% | -23.11 | review_weighting |
| Allsvenskan | BTTS | 9 | 33.3% | -9.84 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| Bundesliga | Winner | 37 | 35.1% | -9.2 | review_weighting |
| League One | BTTS | 32 | 37.5% | 1.67 | review_weighting |
| J1 League | BTTS | 19 | 42.1% | -5.03 | review_weighting |
| LaLiga | Winner | 60 | 43.3% | -33.84 | review_weighting |
| MLS | Winner | 88 | 44.3% | -9.89 | review_weighting |
| Bundesliga | Cards | 36 | 44.4% | -19.22 | review_weighting |
| Allsvenskan | Goals | 9 | 44.4% | -6.72 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Brasileirão Betano Goals (9 settled, 11.1% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 1242 |
| missing_model_probability | 641 |
| high_edge_miss | 76 |
| low_edge_hit | 66 |
| draw_pick | 27 |
