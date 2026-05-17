# Model Result Review

Generated: 2026-05-17 16:47:23 ACST
Prediction tracking start: 2026-04-24
Settled market rows: 599

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 152 | 86 | 66 | 56.6% | 114.17 | 80.76 | 33.41 |
| Cards | 143 | 63 | 80 | 44.1% | 86.12 | 104.93 | -18.81 |
| Goals | 152 | 86 | 66 | 56.6% | 108.41 | 94.49 | 13.92 |
| Winner | 152 | 65 | 87 | 42.8% | 99.51 | 166.26 | -66.75 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 71 | 36 | 35 | 50.7% | -5.25 |
| Championship | 16 | 7 | 9 | 43.8% | -12.14 |
| Eredivisie | 58 | 27 | 31 | 46.6% | -7.13 |
| J1 League | 15 | 9 | 6 | 60.0% | 8.41 |
| LaLiga | 78 | 31 | 47 | 39.7% | -42.23 |
| League One | 16 | 5 | 11 | 31.2% | 0 |
| League Two | 16 | 5 | 11 | 31.2% | -9.11 |
| Ligue 1 | 51 | 25 | 26 | 49.0% | -4.26 |
| MLS | 168 | 95 | 73 | 56.5% | 31.0 |
| Premier League | 48 | 27 | 21 | 56.2% | 6.5 |
| Primeira Liga | 35 | 20 | 15 | 57.1% | 0 |
| Scottish Premiership | 15 | 9 | 6 | 60.0% | 0 |
| UEFA Champions League | 8 | 3 | 5 | 37.5% | -4.02 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Bundesliga | Cards | 17 | 17.6% | -20.89 | review_weighting |
| LaLiga | Winner | 20 | 20.0% | -34.46 | review_weighting |
| Eredivisie | Cards | 13 | 30.8% | -3.83 | review_weighting |
| Premier League | Cards | 12 | 33.3% | -7.88 | review_weighting |
| Ligue 1 | Cards | 12 | 33.3% | -7.73 | review_weighting |
| MLS | Winner | 42 | 35.7% | -18.37 | review_weighting |
| Primeira Liga | Cards | 8 | 37.5% | 0 | review_weighting |
| Ligue 1 | Goals | 13 | 38.5% | -5.03 | review_weighting |
| LaLiga | Goals | 20 | 40.0% | -6.17 | review_weighting |
| Bundesliga | Winner | 18 | 44.4% | -7.47 | review_weighting |
| Primeira Liga | BTTS | 9 | 44.4% | 0 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Reduce trust or raise the value threshold for Cards until its recent hit rate recovers.
- Reduce trust or raise the value threshold for Winner until its recent hit rate recovers.
- First targeted review: Bundesliga Cards (17 settled, 17.6% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| missing_model_probability | 530 |
| none | 69 |
