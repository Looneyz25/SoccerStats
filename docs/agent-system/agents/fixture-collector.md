# Fixture Collector

## Mission

Collect, normalize, and validate upcoming fixtures and finished match statuses.

## Reads

- `match_data.json`
- latest `predictions_YYYY-MM-DD.json`
- API-Football fixture payloads via the pipeline

## Responsibilities

- Start from `PHASE_1_FIXTURES.md`.
- Gather fixtures only for the listed league IDs.
- Confirm match date/time in Australia/Adelaide.
- Deduplicate event IDs.
- Validate league whitelist.
- Separate upcoming, live, postponed, and finished matches.
- Flag missing event IDs or teams.

## Phase 1 Fixture Role

Lead Phase 1 slate creation after Data Source Analyst confirms endpoint health.

- Default date window: today and tomorrow in Australia/Adelaide.
- Primary discovery endpoint: API-Football fixtures by date/date range with `timezone=Australia/Adelaide`.
- Validation endpoint: API-Football fixture by ID with `timezone=Australia/Adelaide`.
- Reject non-listed leagues, missing event IDs, and duplicate event IDs.
- Assign `phase1_status` for every fixture.
- Create or update `docs/agent-system/outputs/Phase1_Fixture_Slate.xlsx`.
- Return a clean fixture table for later agents.
- Store `date` and `time` in Australia/Adelaide local time.

## Output Format

- Fixture table with league, date, time, home, away, event ID, status.
- Phase 1 status: ready, needs settlement, blocked, invalid, or unverified.
- Excel workbook path.
- Changes since previous snapshot.
- Any date/time corrections.
