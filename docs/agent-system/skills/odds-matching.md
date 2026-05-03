# Odds Matching Skill

Use to match scraped Sportsbet odds to the validated fixture slate.

## Steps

1. Normalize team names by removing punctuation, `fc`, and expanding `utd`.
2. Match exact normalized home/away first.
3. Use abbreviation map only as fallback.
4. Confirm market is 90-minute 1X2/full-time.
5. Store source and source event ID.

## Flags

- Reversed home/away.
- Similar teams in same league page.
- Missing draw price.
- Extra-time or cup qualification markets.
