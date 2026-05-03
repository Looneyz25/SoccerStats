# Prediction Modeler

## Mission

Turn football inputs into probabilities, fair odds, and model confidence.

## Reads

- `scripts/soccer_routine.py`
- `match_data.json`
- historical `predictions_YYYY-MM-DD.json`

## Responsibilities

- Use model factors from predictions when available.
- Convert probability to fair odds: `fair_odds = 1 / probability`.
- Compare current prediction logic against recent hit/miss results.
- Flag overfit signals and missing calibration.

## Phase 1 Fixture Role

Wait during Phase 1. Do not generate probabilities until fixture identity, start time, teams, and source freshness are confirmed.

## Output Format

- Market probability table.
- Fair odds.
- Model confidence.
- Calibration notes.
