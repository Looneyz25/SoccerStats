# Phase 1 Fixture Slate

Timezone: Australia/Adelaide

## Run Notes

| Item | Value |
| --- | --- |
| date_window | 2026-05-07 to 2026-05-08 |
| timezone | Australia/Adelaide |
| source_mode | local fallback |
| total_fixtures | 9 |
| ready_for_phase_2 | 0 |
| needs_settlement | 1 |
| blocked_or_invalid | 8 |
| source_issues | 1 |
| next_action | Set API_FOOTBALL_KEY or APISPORTS_KEY before run_daily for live Phase 1 collection. |

## Source Health

| Source | Endpoint | Date | League | Health | Records | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Flashscore | https://2.flashscore.ninja/2/x/feed/f_1_0_3_en-uk_1 | 2026-05-07 to 2026-05-08 | listed leagues | healthy | 0 | events=356 league_hit=0 skipped_women=0 out_of_window=0 matched=0 by_league={} sample_leagues=[&#x27;Albania|ALBANIA: Abissnet Superiore&#x27;, &#x27;Angola|ANGOLA: Girabola&#x27;, |
| API-Football | /fixtures |  |  | blocked | 0 | Missing API_FOOTBALL_KEY/APISPORTS_KEY; used local match_data.json fallback. |

## Fixtures

| Date | Time | League | Home | Away | Event ID | Status | Phase 1 Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-02 | 12:00 | Eredivisie | Roda JC Kerkrade | RKC Waalwijk | 16072838 | upcoming | needs_settlement | Fallback row from current match_data.json; API-Football key not available. Past fixture is still not confirmed FT. |
| 2026-05-07 | 02:15 | Eredivisie | Almere City FC | De Graafschap | 16115794 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-07 | 04:30 | UEFA Champions League | FC Bayern München | Paris Saint-Germain | 15632634 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 04:00 | Bundesliga | Borussia Dortmund | Eintracht Frankfurt | 14065245 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 04:15 | Ligue 1 | RC Lens | Nantes | 14064514 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 04:30 | Championship | Hull City | Millwall | 16116799 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 04:30 | LaLiga | Levante UD | Osasuna | 14083568 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 21:00 | Championship | Middlesbrough | Southampton | 16116800 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
| 2026-05-09 | 21:00 | Premier League | Liverpool FC | Chelsea | 14024024 | upcoming | source_unverified | Fallback row from current match_data.json; API-Football key not available. Primary source did not validate this fixture. |
