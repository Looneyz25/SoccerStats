# Fixture Normalization Skill

Use to validate fixtures before analysis.

## Steps

1. Read `PHASE_1_FIXTURES.md`.
2. Confirm event ID exists.
3. Confirm league ID is in the listed league table.
4. Convert timestamp to Australia/Adelaide, or request the API response with `timezone=Australia/Adelaide` when supported.
5. Deduplicate by event ID.
6. Mark match as upcoming or FT based on source status.
7. Preserve source name and validation status for later agents.
8. Assign exactly one `phase1_status`.
9. Write rows into the Phase 1 Excel workbook sheets.

## Required Fixture Fields

- `id`
- `league.id`
- `league.name`
- `date`
- `time`
- `timezone`
- `utc_timestamp`, when available
- `status`
- `home.name`
- `home.short`
- `home.team_id`
- `away.name`
- `away.short`
- `away.team_id`
- `source`
- `source_health`
- `phase1_status`
- `phase1_notes`

## Phase 1 Status Rules

- Use `ready_for_phase_2` only when event ID, league ID, date/time, status, home/away names, and team IDs are valid.
- Use `needs_settlement` for past non-FT fixtures.
- Use `missing_team_id` when either team ID is missing.
- Use `missing_event_id` when event ID is missing.
- Use `wrong_league` when the league ID is outside the listed league table.
- Use `duplicate_event_id` when the event ID appears more than once.
- Use `source_unverified` when the source endpoint could not validate the fixture.
- Use `postponed_or_cancelled` when the fixture should not progress.
- Use `missing_datetime` when date/time cannot be normalized.

## Timezone Rule

Store fixture `date` and `time` in Australia/Adelaide local time only.

- Set `timezone` to `Australia/Adelaide`.
- Preserve UTC/source timestamps in `utc_timestamp` if useful.
- Do not mix UTC display fields with local display fields.
- If API-Football returns local time using the timezone parameter, still verify the value before writing.

## Reject Or Flag

- Missing event ID.
- Team names that do not match across sources.
- Dates shifted by timezone conversion.
- Non-whitelisted tournaments.
