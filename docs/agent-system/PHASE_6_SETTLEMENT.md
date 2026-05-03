# Phase 6: Settlement

Use this phase when the prompt asks for actuals, hits, misses, accuracy, ROI, win-rate, settled bets, or once matches that were picked have finished and the pipeline needs to record outcomes.

## Objective

For every fixture that received a `bet` or `lean` recommendation in Phase 5, look up the final 1X2 result, mark the recommendation as `won` / `lost` / `push` / `void`, compute realized return for `bet` rows, and append the outcome to a persistent settlement history.

## Inputs

| Input | Path | Required |
| --- | --- | --- |
| Phase 5 picks | `docs/agent-system/outputs/phase5_value_risk_current.csv` | yes |
| Flashscore feed | `https://2.flashscore.ninja/2/x/feed/f_1_0_3_en-uk_1` | yes (primary settlement source) |
| Settlement history | `docs/agent-system/outputs/phase6_settlement_history.jsonl` | created on first run |

Only `phase5_status in {bet, lean}` rows are settled. `no_value` and `upstream_blocked` rows are skipped (they had no recommendation to settle).

## Workflow

1. Results Settler fetches the live Flashscore feed once per run, parses events, indexes by Flashscore event ID.
2. For each Phase 5 row whose `event_id` starts with `flashscore:`, look up the corresponding event.
3. Settlement decision per recommendation:
   - If event status is FT and final score is parseable: compare to `top_side` and mark `won` / `lost` / `push`.
   - If event was postponed/cancelled/abandoned: mark `void` (refund stake).
   - If event is still upcoming or live: mark `pending`.
4. For `bet` rows resolved as `won`: realized return = `top_stake * (top_market_odds - 1)`; as `lost`: realized return = `-top_stake`; as `push` or `void`: realized return = `0`. Leans always have stake 0 so realized return is `0`.
5. Append settled rows (status != pending) to the history JSONL, deduplicated by `event_id`.
6. Compute cumulative accuracy and ROI from history.
7. Write Phase 6 review workbook.

## Required Fields (per row)

Identity: `event_id`, `league`, `date`, `time`, `home`, `away`.

Recommendation carried from Phase 5: `top_side`, `top_market_odds`, `top_p`, `top_edge`, `top_stake`, `phase5_status`.

Settlement:

| Field | Purpose |
| --- | --- |
| `actual_status` | `FT`, `postponed`, `cancelled`, `live`, `upcoming`, `unknown` |
| `actual_home_score`, `actual_away_score` | Final scoreline when FT |
| `actual_outcome` | `home`, `draw`, `away`, or empty if not FT |
| `phase6_status` | `won`, `lost`, `push`, `void`, `pending`, `not_found` |
| `realized_return` | Profit/loss on this row |
| `phase6_notes` | Short explanation |

## Phase 6 Status Values

| Status | Meaning |
| --- | --- |
| `won` | Bet/lean side matches the actual outcome |
| `lost` | Bet/lean side does not match the actual outcome |
| `push` | Should not occur for 1X2; reserved for future markets |
| `void` | Match cancelled/postponed; stake refunded |
| `pending` | Match not yet finished |
| `not_found` | Could not locate the event in the Flashscore feed |

## Excel Output

`docs/agent-system/outputs/Phase6_Settlement.xlsx`

Sheets:

| Sheet | Contents |
| --- | --- |
| `Settled` | Phase 5 rows with settlement attached |
| `Won`, `Lost`, `Pending` | Filtered views |
| `History Summary` | Cumulative bets, wins, ROI, hit rate from `phase6_settlement_history.jsonl` |
| `Run Notes` | Date window, totals, source health |

## Acceptance Criteria

- Every Phase 5 `bet` or `lean` row is echoed through with a `phase6_status`.
- Realized return is computed only for `bet` rows; `lean` rows always have `realized_return = 0`.
- Settlement history grows monotonically: a fixture is recorded once with its final outcome and never overwritten with `pending`.
- Accuracy and ROI in History Summary use only the historical JSONL, not the current run.
- Source failures (Flashscore feed blocked, parse errors) are visible in `Run Notes`.
