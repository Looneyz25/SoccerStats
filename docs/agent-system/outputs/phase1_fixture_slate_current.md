# Phase 1 Fixture Slate

Timezone: Australia/Adelaide

## Run Notes

| Item | Value |
| --- | --- |
| date_window | 2026-05-18 to 2026-05-24 |
| timezone | Australia/Adelaide |
| source_mode | Flashscore |
| total_fixtures | 3 |
| ready_for_phase_2 | 3 |
| needs_settlement | 0 |
| blocked_or_invalid | 0 |
| source_issues | 0 |
| next_action | Set API_FOOTBALL_KEY/APISPORTS_KEY for richer Phase 1 collection; TheSportsDB free API is available as fallback. |

## Source Health

| Source | Endpoint | Date | League | Health | Records | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Flashscore | https://www.flashscore.com.au/x/feed/f_1_0_3_en-au_1 | 2026-05-18 to 2026-05-24 | listed leagues | healthy | 3 | events=200 league_hit=3 skipped_women=0 out_of_window=0 matched=3 by_league={&#x27;Premier League&#x27;: 1, &#x27;MLS&#x27;: 2} sample_leagues=[&#x27;Argentina|ARGENTINA: Liga Prof |

## Fixtures

| Date | Time | League | Home | Away | Event ID | Status | Phase 1 Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-18 | 09:30 | MLS | Nashville SC | Los Angeles FC | flashscore:lnSvmTkR | live | ready_for_phase_2 | Keyless Flashscore fixture feed. |
| 2026-05-18 | FT | MLS | Inter Miami | Portland Timbers | flashscore:rZdvkkLE | FT | ready_for_phase_2 | Keyless Flashscore fixture feed. |
| 2026-05-19 | 04:30 | Premier League | Arsenal | Burnley | flashscore:Gxt6zm15 | live | ready_for_phase_2 | Keyless Flashscore fixture feed. |
