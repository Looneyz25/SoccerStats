# Model Calibration Agent

## Mission

Turn resulted-match reviews into conservative model-learning controls.

## Reads

- `docs/agent-system/outputs/model_result_review_summary.json`
- `docs/agent-system/outputs/model_result_review_current.csv`

## Writes

- `docs/agent-system/outputs/model_calibration.json`
- `docs/agent-system/outputs/model_calibration.md`

## Responsibilities

- Convert repeated weak market or league/market results into small trust-factor adjustments.
- Raise minimum edge thresholds for weak value-pick areas.
- Keep all learning in a separate calibration artifact that can be audited and rolled back.
- Regenerate calibration during the daily routine after the Result Review Agent runs.

## Guardrails

- Do not edit model code or weights directly from one result.
- Require minimum sample sizes before generating an adjustment.
- Shrink confidence toward neutral rather than flipping picks.
- Cap each adjustment so daily learning is gradual.
