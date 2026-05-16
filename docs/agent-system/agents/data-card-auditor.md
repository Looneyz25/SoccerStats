# Data Card Auditor

## Mission

Verify every data card rendered on the dashboard is backed by real scraped data, not silent fallbacks, zeros, or `Unavailable` strings.

## Reads

- `app/page.jsx` (all card components: stats panels, advantage items, streak cards, actuals, comparison rows, fixture meta, prediction summary, match list cards)
- `match_data.json` (the fields each card binds to)
- `scripts/soccer_routine.py` and `scripts/soccer_fetch_*.py` (which scraper owns which field)
- Latest `logs/run_*.log` (to distinguish scrape failure from genuine absence)
- `scripts/audit_data_cards.mjs` (this agent's repeatable check)

## How To Run

```powershell
node scripts/audit_data_cards.mjs
```

Outputs per-field coverage, lists fixtures missing high-value fields, and exits non-zero when any required-by-status field drops below its threshold.

## Required Data Per Card

The dashboard renders the following cards. Each row lists the JSX location, the `match.*` fields it binds, the scraper that should populate them, and the threshold below which the card is considered broken.

### Match list view ([MatchCard](../../../app/page.jsx#L1905))

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| Header strip | page.jsx:1923-1936 | match.league, match.date, match.time, match.status | fixture-collector | always | 100% |
| Team + score | page.jsx:1941-1953 | home.name, away.name, home.goals, away.goals | fixture-collector / results-settler | always (goals only when FT/LIVE) | 100% |
| Winner pill | page.jsx:1956 | predictions.winner.pick, predictions.winner.odds | prediction-modeler | always | 100% |
| BTTS pill | page.jsx:1957 | predictions.btts.pick, predictions.btts.odds | prediction-modeler | always | 100% |
| Goals pill | page.jsx:1958 | predictions.ou_goals.pick, predictions.ou_goals.odds, .line | prediction-modeler | always | 100% |
| Cards pill | page.jsx:1959 | predictions.ou_cards.pick, predictions.ou_cards.odds, .line | prediction-modeler | always | 100% |
| Bookmaker odds row | page.jsx:1962-1975 | sportsbet_odds OR odds | odds-collector | upcoming | ≥95% upcoming |
| Confidence / quality | page.jsx:1977-1983 | derived from data quality | derived | always | 100% |
| Actuals footer | page.jsx:1985-1991 | actuals.corners_total, actuals.fouls_total, actuals.first_scorer | results-settler | FT | ≥95% FT |

### Match detail view ([MatchDetailView](../../../app/page.jsx#L1792))

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| Fixture meta | page.jsx:1823-1827 | league, date, time, status | fixture-collector | always | 100% |
| Home team card | page.jsx:1838-1840 | home.name, home.rank, home.pts | team-form-analyst | always | ≥95% |
| Away team card | page.jsx:1845-1847 | away.name, away.rank, away.pts | team-form-analyst | always | ≥95% |
| Venue | page.jsx:1860-1863 | match.venue | fixture-collector | always | ≥80% (currently 1% — gap) |
| Referee | page.jsx:1866-1871 | referee.name, referee.avg_yellow, referee.avg_red | data-source-analyst | optional | tolerate empty |
| Corners actual | page.jsx:1886 | actuals.corners_total | results-settler | FT | 100% |
| Fouls actual | page.jsx:1887 | actuals.fouls_total | results-settler | FT | 100% |
| Shots on target | page.jsx:1888 | actuals.home_sot, actuals.away_sot | results-settler | FT | 100% |
| Half time | page.jsx:1889 | actuals.ht_home, actuals.ht_away | results-settler | FT | 100% |

### H2H context ([H2HContextPanel](../../../app/page.jsx#L1608))

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| H2H advantage | page.jsx:1638-1645 | derived from h2h_streaks / meetings | streak-trends-analyst | always | ≥95% |
| Ground form | page.jsx:1638-1645 | home/away recent form (computed) | team-form-analyst | always | tolerate "Even" only when both teams have 0 prior home/away rows in dataset |
| Table edge | page.jsx:1638-1645 | home.rank, away.rank | team-form-analyst | always | ≥95% |
| Elo edge | page.jsx:1638-1645 | predictions.factors.home_elo, .away_elo | prediction-modeler | optional | accepts "Unavailable" |
| H2H streak card | page.jsx:1648-1665 | h2h_streaks[].label, .value, .team, .odds | streak-trends-analyst | always | ≥1 entry on ≥95% of fixtures |
| Last home/away win | page.jsx:1667-1668 | derived from meetings | streak-trends-analyst | when meetings exist | tolerate "No recent local win" |
| Meetings table row | page.jsx:1681-1689 | meeting.date, .score, .btts, .cards | streak-trends-analyst | when meetings exist | hide when empty |

### Streaks ([StreakList](../../../app/page.jsx#L1540))

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| Team streak card | page.jsx:1550-1561 | team_streaks[].label, .value, .team, .odds | streak-trends-analyst | always | ≥1 entry on ≥90% of fixtures |

### Prediction summary + comparison

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| Summary winner row | page.jsx:1723 | predictions.winner.pick + rationale | prediction-summary-auditor | always | 100% |
| Summary BTTS row | page.jsx:1724 | predictions.btts.pick | prediction-summary-auditor | always | 100% |
| Summary goals row | page.jsx:1725 | predictions.ou_goals.pick, .line | prediction-summary-auditor | always | 100% |
| Summary cards row | page.jsx:1726 | predictions.ou_cards.pick, .line | prediction-summary-auditor | always | 100% |
| Model vs bookmaker | page.jsx:1509-1537 | predictions.*.probability + odds/sportsbet_odds | value-betting-analyst | upcoming | ≥95% upcoming |

### Results review + summary tiles

| Card | File:line | Fields | Owner | Required when | Min coverage |
| --- | --- | --- | --- | --- | --- |
| Hit-rate per market | page.jsx:1577-1603 | predictions.*.result across recent FT | results-settler | always (recent FT) | 100% of recent FT settled |
| Winner hit rate tile | page.jsx:2262 | predictions.winner.result | results-settler | always | mirrors above |
| Odds hit / loss tile | page.jsx:2263-2273 | predictions.*.result + .odds | results-settler | always | mirrors above |

## Triage Rules

When the audit script flags a field below its threshold:

1. **Empty-source** — scraper ran but returned nothing for these fixtures → escalate to the listed `Owner` agent.
2. **Empty-placeholder** — the value is a real zero (e.g. PPG `0.0` for a team with no prior home matches in the window) → either widen the lookback or hide the card.
3. **Unbound** — the JSX reads a path that the pipeline never writes → either drop the binding or add the field to the pipeline.

For any card whose fallback string is `"Unavailable"`, `"No exact rows"`, `"-"`, `"0.0 PPG"`, `"Even"`, or empty: prefer hiding the card over rendering a placeholder, unless the placeholder is genuinely informative.

## Output Format

- Coverage table per status (`FT`, `upcoming`) with `field · current · threshold · status`.
- Per-fixture list of the worst offenders (IDs and team names).
- Recommended fixes split into: **dashboard-side** (hide / relabel) vs. **pipeline-side** (scrape / map / enrich).
- One-line addition to `.claude/progress.md` only when the audit causes a code change.

## Phase Role

Runs after Phase 6 (Settlement) and before Phase 7 (Display) — gates the dashboard publish step.
