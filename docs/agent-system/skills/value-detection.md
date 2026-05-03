# Value Detection Skill

Use to decide whether a pick has positive expected value.

## Steps

1. Convert bookmaker odds to implied probability: `1 / odds`.
2. Compare model probability with implied probability.
3. Estimate edge: `model_probability - implied_probability`.
4. Require a margin above noise before recommending a bet.
5. Label outputs as bet, lean, or pass.

## Minimum Output

- Selection.
- Bookmaker odds.
- Model probability.
- Fair odds.
- Estimated edge.
- Confidence.
