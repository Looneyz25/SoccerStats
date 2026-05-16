# Dashboard QA Skill

Use when changing or reviewing the betting dashboard.

## Steps

1. Confirm `public/data/match_data.json` was prepared from the latest generated `match_data.json`.
2. Check summary counts in the Next.js dashboard match `match_data.json`.
3. Verify hit/miss/pending labels.
4. Check mobile and desktop layout.
5. Confirm source/date labels are visible where decisions depend on freshness.

## Watch For

- Model picks presented as value bets.
- Missing odds hidden from cards.
- Text overflow in match cards.
- Stale snapshot dates.
