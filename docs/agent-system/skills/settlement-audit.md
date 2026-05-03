# Settlement Audit Skill

Use to check whether results and actuals are correctly recorded.

## Steps

1. Find matches with past date and non-FT status.
2. Try primary event status first.
3. Use fallback score fields when primary source is blocked.
4. Compute hit/miss for every predicted market.
5. Report missing actuals separately from missing scores.

## Phase 1 Boundary

During Phase 1, settle only enough to keep the fixture slate truthful.

- Mark a past fixture FT only when source status or fallback score is clear.
- Do not compute betting performance unless the prompt asks for settlement.
- Return uncertain fixtures as unresolved.

## Output

- Settled matches.
- Unsettled matches.
- Market hit/miss summary.
- Missing data by source.
