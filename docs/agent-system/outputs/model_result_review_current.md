# Model Result Review

Generated: 2026-05-17 03:56:03 ACST
Settled market rows: 1255

## Market Summary

| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTTS | 319 | 194 | 125 | 60.8% | 309.1 | 202.02 | 107.08 |
| Cards | 298 | 114 | 184 | 38.3% | 169.47 | 239.18 | -69.71 |
| Goals | 319 | 182 | 137 | 57.0% | 289.22 | 244.78 | 44.44 |
| Winner | 319 | 142 | 177 | 44.5% | 262.73 | 406.5 | -143.77 |

## League Summary

| League | Settled | Hits | Misses | Hit Rate | Odds Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bundesliga | 143 | 75 | 68 | 52.4% | -4.51 |
| Championship | 109 | 54 | 55 | 49.5% | -22.14 |
| Eredivisie | 126 | 61 | 65 | 48.4% | -9.37 |
| LaLiga | 156 | 71 | 85 | 45.5% | -50.02 |
| League One | 121 | 61 | 60 | 50.4% | 13.18 |
| League Two | 107 | 45 | 62 | 42.1% | -22.74 |
| Ligue 1 | 119 | 55 | 64 | 46.2% | -27.92 |
| MLS | 236 | 128 | 108 | 54.2% | 29.67 |
| Premier League | 124 | 75 | 49 | 60.5% | 33.94 |
| UEFA Champions League | 14 | 7 | 7 | 50.0% | -2.05 |

## Weak Spots

| League | Market | Settled | Hit Rate | Odds Net | Action |
| --- | --- | ---: | ---: | ---: | --- |
| Championship | Cards | 25 | 20.0% | -32.94 | review_weighting |
| League One | Cards | 28 | 21.4% | -2.1 | review_weighting |
| League Two | Cards | 26 | 26.9% | -4.2 | review_weighting |
| Bundesliga | Cards | 35 | 31.4% | -23.9 | review_weighting |
| LaLiga | Winner | 40 | 32.5% | -47.94 | review_weighting |
| Eredivisie | Cards | 27 | 33.3% | -3.45 | review_weighting |
| Ligue 1 | Cards | 29 | 37.9% | -13.24 | review_weighting |
| Bundesliga | Winner | 36 | 38.9% | -23.89 | review_weighting |
| Ligue 1 | Goals | 30 | 40.0% | -13.84 | review_weighting |
| Championship | Winner | 28 | 42.9% | -13.61 | review_weighting |
| MLS | Winner | 59 | 44.1% | -6.71 | review_weighting |
| League Two | Winner | 27 | 44.4% | -13.3 | review_weighting |

## Recommendations

- Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.
- Reduce trust or raise the value threshold for Cards until its recent hit rate recovers.
- Reduce trust or raise the value threshold for Winner until its recent hit rate recovers.
- First targeted review: Championship Cards (25 settled, 20.0% hit rate).

## Review Flags

| Flag | Count |
| --- | ---: |
| retro_snapshot | 781 |
| missing_model_probability | 474 |
