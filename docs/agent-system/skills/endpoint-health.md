# Endpoint Health Skill

Use to inspect data-source reliability and coverage.

## Steps

1. Read the latest log in `logs/`.
2. Search scripts for endpoint strings.
3. Count populated fields in `match_data.json`.
4. Report blocked, unused, degraded, and healthy sources.

## Phase 1 Fixture Checks

Use these checks before Fixture Collector builds the slate:

1. Confirm `scripts/soccer_routine.py` uses API-Football fixtures for fixture discovery.
2. Confirm the listed league IDs match `PHASE_1_FIXTURES.md`.
3. Check the latest log for API-Football auth, rate-limit, timeout, or empty response clues.
4. Confirm whether fallback score sources are needed for stale/past fixtures.
5. Mark odds and xG sources as out of scope for fixture discovery.

## Key Checks

- API-Football auth/rate-limit/timeout/empty fixture response.
- Sportsbet unmatched events.
- Understat zero-match extraction.
- TheSportsDB/Flashscore fallback not consumed by settlement.
