# Model Auto Learning Skill

Use when wiring prediction-vs-result feedback into the model.

## Steps

1. Read the Result Review Agent summary.
2. Require enough settled rows before learning from a market.
3. Convert weak hit-rate evidence into trust-factor and edge-threshold adjustments.
4. Store adjustments in `docs/agent-system/outputs/model_calibration.json`.
5. Make prediction scripts read the calibration file, not hard-code learned changes.
6. Keep generated calibration visible in Markdown for audit.

## Safe Adjustment Types

- Shrink weak market probabilities toward neutral.
- Raise the minimum edge required before a bet is recommended.
- Apply league/market adjustments only when that combination has enough sample size.

## Avoid

- Reversing picks automatically.
- Learning from retro snapshots as if they were live predictions.
- Reweighting from tiny samples.
- Hiding generated learning inside source code.
