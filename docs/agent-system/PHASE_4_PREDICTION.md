# Phase 4: Prediction

Use this phase when the prompt asks for model probabilities, fair odds, predicted scorelines, or once odds and team context are attached and the analysis pipeline needs probabilities to drive value detection.

## Objective

For every fixture marked `ready_for_phase_4` in the Phase 3 team-context slate, compute Poisson-based win/draw/loss probabilities, BTTS, over/under 2.5 goals, fair (no-vig) odds, and edge vs the Phase 2 market price.

Phase 4 does not pick bets, size stakes, or compose recommendations. It produces probabilities and fair odds; Phase 5 turns those into value calls.

## Inputs

| Input | Path | Required |
| --- | --- | --- |
| Phase 3 team context | `docs/agent-system/outputs/phase3_team_context_current.csv` | yes |
| Phase 2 odds slate | `docs/agent-system/outputs/phase2_odds_slate_current.csv` | yes (joins on event_id) |

Only rows whose `phase3_status = ready_for_phase_4` are scored. Other rows are echoed through with `phase4_status = upstream_blocked`.

## Model

A capped Poisson scoreline grid (0..6 home, 0..6 away). Lambda construction:

```
lambda_home = 0.5 * (home_attack + away_defence) + HOME_ADV
lambda_away = 0.5 * (away_attack + home_defence) - HOME_ADV/4
```

Where attack/defence rates come from Phase 3 last-5:

```
home_attack  = home_gf5 / 5
home_defence = home_ga5 / 5
away_attack  = away_gf5 / 5
away_defence = away_ga5 / 5
HOME_ADV = 0.20
```

If either side has fewer than 3 form matches the Phase 3 row will not be `ready_for_phase_4` so we never hit that case.

Outputs derived from the scoreline grid:

- `p_home`, `p_draw`, `p_away` (1X2)
- `p_btts` (both teams to score)
- `p_over25` (over 2.5 goals)
- `fair_home`, `fair_draw`, `fair_away` (1 / p)
- `edge_home`, `edge_draw`, `edge_away` (market - fair, percentage points of probability)
- `model_pick` (highest-probability outcome)

## Required Agents

| Agent | Role In Phase 4 |
| --- | --- |
| Prediction Modeler | Compute lambdas, produce scoreline grid, derive 1X2/BTTS/O-U, fair odds, edge |

## Workflow

1. Prediction Modeler joins Phase 3 (form) and Phase 2 (odds) by `event_id`.
2. For each `ready_for_phase_4` row, compute `lambda_home` and `lambda_away`.
3. Build a 7x7 Poisson scoreline grid; aggregate to 1X2, BTTS, O/U 2.5.
4. Compute fair odds and edge vs Phase 2 prices.
5. Assign `phase4_status`.
6. Write the Phase 4 review workbook.

## Required Fields

Phase 1/2/3 identity fields plus:

| Field | Purpose |
| --- | --- |
| `lambda_home`, `lambda_away` | Expected goals input to grid |
| `p_home`, `p_draw`, `p_away` | Model probabilities for 1X2 |
| `p_btts`, `p_over25` | Model probabilities for BTTS and O2.5 |
| `model_pick` | Highest-probability 1X2 outcome (`home`/`draw`/`away`) |
| `fair_home`, `fair_draw`, `fair_away` | 1 / p (no-vig fair price) |
| `market_home`, `market_draw`, `market_away` | Sportsbet decimal odds carried from Phase 2 |
| `market_implied_home`, `market_implied_draw`, `market_implied_away` | 1/market price (carries vig) |
| `edge_home`, `edge_draw`, `edge_away` | `p_xxx - market_implied_xxx` (positive means model thinks it's underpriced) |
| `phase4_status` | Gate for whether the fixture can move to Phase 5 |
| `phase4_notes` | Short explanation for blocked or unusual rows |

## Phase 4 Status Values

| Status | Meaning |
| --- | --- |
| `ready_for_phase_5` | Probabilities and fair odds attached; market prices joined |
| `model_only` | Probabilities computed, but no Phase 2 market odds joined (cannot compute edge) |
| `upstream_blocked` | Phase 3 row was not `ready_for_phase_4` |

Only `ready_for_phase_5` rows should move to value detection.

## Excel Output

`docs/agent-system/outputs/Phase4_Predictions.xlsx`

Workbook sheets:

| Sheet | Contents |
| --- | --- |
| `Predictions` | All Phase 4 rows |
| `Ready For Phase 5` | Only `phase4_status = ready_for_phase_5` |
| `Model Only` | `model_only` rows (no market price to compare) |
| `Blocked` | `upstream_blocked` rows |
| `Run Notes` | Date window, totals, next action |

## Acceptance Criteria

- Every Phase 3 row appears in Phase 4 output with a `phase4_status`.
- Every `ready_for_phase_5` row has `lambda_home`, `lambda_away`, `p_home/draw/away` (sum to 1.0 ± 0.001 after capping), `fair_xxx`, `market_xxx`, `edge_xxx`.
- BTTS and O2.5 probabilities are reported.
- Lambdas are floored at 0.20 to avoid pathological zero-goal predictions.
