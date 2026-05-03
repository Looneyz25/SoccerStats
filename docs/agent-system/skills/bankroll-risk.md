# Bankroll Risk Skill

Use to size stakes and cap exposure.

## Steps

1. Default to unit staking if bankroll is unknown.
2. Use smaller stakes for thin data, stale odds, or model disagreement.
3. Avoid stacking correlated markets from the same match.
4. Cap total exposure per slate.
5. Prefer no bet over marginal edge.

## Output

- Stake in units.
- Exposure by match and league.
- Correlation warnings.
- Risk grade.
