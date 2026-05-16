# Result Review Calibration Skill

Use after results have settled and before changing prediction logic.

## Steps

1. Review only markets with `result` equal to `hit` or `miss`.
2. Split performance by market first, then by league and market.
3. Separate live pre-match predictions from retro snapshots.
4. Check whether model probability was stored for each market.
5. Flag overconfidence only when a miss had a strong recorded edge or probability.
6. Recommend one targeted model review item at a time.

## Output

- Market hit-rate and odds-net summary.
- League hit-rate and odds-net summary.
- Weak spots that meet a minimum sample threshold.
- Missing calibration fields.
- One top model-review action.

## Avoid

- Reweighting from tiny samples.
- Treating bookmaker odds profit/loss as model calibration by itself.
- Hiding missing actuals inside model misses.
