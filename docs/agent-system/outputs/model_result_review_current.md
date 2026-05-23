# Model Result Review

Generated: 2026-05-24 02:58:41 ACST
Prediction tracking start: 2026-04-22
Settled market rows: 1730

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 433 | 232 | 201 | 53.6% | 172.38 | 155.65 | 16.73 |
| Cards | 406 | 246 | 160 | 60.6% | 152.25 | 129.28 | 22.97 |
| Corners | 25 | 17 | 8 | 68.0% | 4.69 | 5.31 | -0.62 |
| Goals | 433 | 240 | 193 | 55.4% | 178.77 | 163.25 | 15.52 |
| Winner | 433 | 211 | 222 | 48.7% | 183.68 | 258.86 | -75.18 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 9 | 2 | 7 | 22.2% | -5.53 |
| Allsvenskan | 35 | 23 | 12 | 65.7% | 0.5 |
| Bundesliga | 148 | 78 | 70 | 52.7% | -8.86 |
| Championship | 114 | 72 | 42 | 63.2% | -2.63 |
| Eliteserien | 15 | 9 | 6 | 60.0% | 0 |
| Eredivisie | 178 | 95 | 83 | 53.4% | -10.45 |
| J1 League | 66 | 39 | 27 | 59.1% | -17.07 |
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
| Serie A | Winner | 11 | 27.3% | -15.04 | review_weighting |
| J1 League | BTTS | 15 | 33.3% | -8.23 | review_weighting |
| Primeira Liga | Cards | 9 | 33.3% | 0 | review_weighting |
| Bundesliga | Winner | 37 | 35.1% | -9.2 | review_weighting |
| League One | BTTS | 31 | 35.5% | 0 | review_weighting |
| Serie A | BTTS | 11 | 36.4% | -6.36 | review_weighting |
| J1 League | Goals | 15 | 40.0% | -5.8 | review_weighting |
| MLS | Winner | 74 | 40.5% | -15.02 | review_weighting |
| LaLiga | Winner | 50 | 42.0% | -28.66 | review_weighting |
| Allsvenskan | Winner | 7 | 42.9% | 4.54 | review_weighting |
| Bundesliga | Cards | 36 | 44.4% | -19.22 | review_weighting |
| Eredivisie | Goals | 46 | 45.6% | -9.13 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.
- First targeted review: Serie A Winner (11 settled, 27.3% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| none | 1003 |
| missing_model_probability | 641 |
| high_edge_miss | 43 |
| low_edge_hit | 26 |
| draw_pick | 17 |
