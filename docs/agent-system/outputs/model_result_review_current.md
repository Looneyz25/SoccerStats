# Model Result Review

Generated: 2026-05-17 13:40:09 ACST
Settled market rows: 1372

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 349 | 211 | 138 | 60.5% | 322.97 | 208.1 | 114.87 |
| Cards | 325 | 128 | 197 | 39.4% | 182.82 | 249.1 | -66.28 |
| Goals | 349 | 198 | 151 | 56.7% | 299.54 | 256.13 | 43.41 |
| Winner | 349 | 156 | 193 | 44.7% | 270.88 | 427.21 | -156.33 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-League Men | 4 | 1 | 3 | 25.0% | 0 |
| Bundesliga | 143 | 75 | 68 | 52.4% | -4.51 |
| Championship | 109 | 54 | 55 | 49.5% | -22.14 |
| Eredivisie | 130 | 63 | 67 | 48.5% | -6.16 |
| J1 League | 11 | 5 | 6 | 45.5% | 0 |
| LaLiga | 156 | 71 | 85 | 45.5% | -50.02 |
| League One | 121 | 61 | 60 | 50.4% | 13.18 |
| League Two | 107 | 45 | 62 | 42.1% | -22.74 |
| Ligue 1 | 119 | 55 | 64 | 46.2% | -27.92 |
| MLS | 284 | 152 | 132 | 53.5% | 24.09 |
| Premier League | 124 | 75 | 49 | 60.5% | 33.94 |
| Primeira Liga | 35 | 20 | 15 | 57.1% | 0 |
| Scottish Premiership | 15 | 9 | 6 | 60.0% | 0 |
| UEFA Champions League | 14 | 7 | 7 | 50.0% | -2.05 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Championship | Cards | 25 | 20.0% | -32.94 | review_weighting |
| League One | Cards | 28 | 21.4% | -2.1 | review_weighting |
| League Two | Cards | 26 | 26.9% | -4.2 | review_weighting |
| Bundesliga | Cards | 35 | 31.4% | -23.9 | review_weighting |
| Eredivisie | Cards | 28 | 32.1% | -3.45 | review_weighting |
| LaLiga | Winner | 40 | 32.5% | -47.94 | review_weighting |
| Primeira Liga | Cards | 8 | 37.5% | 0 | review_weighting |
| Ligue 1 | Cards | 29 | 37.9% | -13.24 | review_weighting |
| Bundesliga | Winner | 36 | 38.9% | -23.89 | review_weighting |
| Ligue 1 | Goals | 30 | 40.0% | -13.84 | review_weighting |
| MLS | Winner | 71 | 40.8% | -21.32 | review_weighting |
| Championship | Winner | 28 | 42.9% | -13.61 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Reduce trust or raise the value threshold for Cards until its recent hit rate recovers.
- Reduce trust or raise the value threshold for Winner until its recent hit rate recovers.
- First targeted review: Championship Cards (25 settled, 20.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| retro_snapshot | 781 |
| missing_model_probability | 526 |
| none | 65 |
