# Phase 5: Value & Risk

Use this phase when the prompt asks for picks, value bets, edges, stakes, exposure, bankroll, or once predictions and odds are joined and the pipeline needs to convert them into bet decisions.

## Objective

For every fixture marked `ready_for_phase_5` in the Phase 4 output, evaluate each market outcome (home / draw / away) for value, size a recommended stake using fractional Kelly, and apply portfolio risk limits.

## Inputs

| Input | Path | Required |
| --- | --- | --- |
| Phase 4 predictions | `docs/agent-system/outputs/phase4_predictions_current.csv` | yes |

Only `phase4_status = ready_for_phase_5` rows are evaluated.

## Decision Rule

For each side `s in {home, draw, away}`:

```
edge_s   = p_s - 1/market_s          (probability points; positive = underpriced)
ev_s     = p_s * (market_s - 1) - (1 - p_s)
kelly_s  = max(0, (p_s * market_s - 1) / (market_s - 1))   if market_s > 1
stake_s  = bankroll * kelly_fraction * kelly_s
```

A side is a **bet** (`pick`) when `edge_s >= MIN_EDGE` and `ev_s > 0` and `market_s >= MIN_PRICE`.

A bet is a **lean** when `edge_s >= 0.5 * MIN_EDGE` but below the bet threshold.

Defaults:

| Constant | Value | Reason |
| --- | --- | --- |
| `MIN_EDGE` | `0.05` | 5pp probability gap to bookmaker implied |
| `MIN_PRICE` | `1.30` | Don't bet very-short prices where overround dominates |
| `KELLY_FRACTION` | `0.25` | Quarter Kelly to dampen variance |
| `MAX_STAKE_PCT` | `0.02` | Cap any single bet at 2% of bankroll |
| `MAX_EXPOSURE_PCT` | `0.10` | Cap total open stake at 10% of bankroll |
| `BANKROLL` | `1000` | Display unit; users override per session |

## Required Agents

| Agent | Role In Phase 5 |
| --- | --- |
| Value Betting Analyst | Compute edge / EV / Kelly per side, classify bet vs lean vs pass |
| Risk Manager | Apply per-bet cap, total-exposure cap, drop correlated/duplicate picks within same fixture |

## Workflow

1. Value Betting Analyst evaluates each side per fixture; tags as `bet`, `lean`, or `pass`.
2. Risk Manager: for each fixture, keep at most one `bet` (the highest-edge side); convert any other positive-edge sides to `lean`.
3. Risk Manager applies per-bet cap (`MAX_STAKE_PCT`) and total-exposure cap (`MAX_EXPOSURE_PCT`); if total stake exceeds the cap, scale all bets proportionally.
4. Write the Phase 5 review workbook.

## Required Fields

| Field | Purpose |
| --- | --- |
| Identity | `event_id`, `league`, `date`, `time`, `home`, `away` |
| Per-side metrics | `home_edge`, `home_ev`, `home_kelly`, `home_stake`, `home_decision` (and the same for `draw`/`away`) |
| Top pick | `top_decision` (`bet`/`lean`/`pass`), `top_side`, `top_market_odds`, `top_p`, `top_edge`, `top_stake` |
| Risk caps applied | `risk_scale_factor` (1.0 = no scale; <1.0 = scaled down to fit exposure cap) |
| `phase5_status` | Gate for whether the fixture has an actionable pick |
| `phase5_notes` | Short explanation |

## Phase 5 Status Values

| Status | Meaning |
| --- | --- |
| `bet` | One side meets bet criteria; stake recommended |
| `lean` | One side meets lean criteria but not bet criteria |
| `no_value` | No side meets edge / EV / price thresholds |
| `upstream_blocked` | Phase 4 row was not `ready_for_phase_5` |

## Excel Output

`docs/agent-system/outputs/Phase5_Value_Risk.xlsx`

Sheets: `Picks` (all rows), `Bets` (status=bet), `Leans`, `No Value`, `Blocked`, `Run Notes`.

## Acceptance Criteria

- Every Phase 4 row appears with a `phase5_status`.
- No fixture recommends multiple `bet` sides at once.
- Stakes never exceed `MAX_STAKE_PCT * BANKROLL` per bet.
- Total recommended stake does not exceed `MAX_EXPOSURE_PCT * BANKROLL`; if exceeded, all bets are scaled proportionally and `risk_scale_factor` records the multiplier.
- Edges and EVs are computed using model probability vs Phase 2 market price.
