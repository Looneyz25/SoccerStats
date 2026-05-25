# Get Data Run Log

Run ID: 20260525T021341Z
Mode: results-only
Started: 2026-05-25T02:13:41.309Z
Completed: 2026-05-25T02:30:52.707Z
Status: ok

## Firestore

- Upload status: ok
- Last line: Uploaded fast dashboard doc dashboardData/match_data_fast as metadata-only fallback (27.2 KB); app will use date/league docs.
- Firestore format: league_docs_v1
- Captured at: 2026-05-25
- Source: sofascore.com
- Leagues: 22
- Matches: 578
- Largest league doc: 318435 bytes
- Date window: 2026-04-22 to 2026-05-31
- Status counts: FT=527, upcoming=51
- Result due now: 1
- Result remaining tracked: 4
- Result schedule: `docs\agent-system\outputs\result_check_schedule_latest.md`

## Routine Decision

- Action: results
- Reason: 3 matches due for result check
- Due: 2026-05-24 21:30 League One Stockport County vs Bolton Wanderers (DUE @ 00:00)
- Due: 2026-05-25 08:30 MLS Inter Miami CF vs Philadelphia Union (DUE @ 11:00)
- Due: 2026-05-25 09:00 Brasileirão Betano Vasco da Gama vs Red Bull Bragantino (DUE @ 11:30)

## Steps

| Step | Status | Exit | Duration | Last line |
| --- | --- | --- | --- | --- |
| Apply manual result imports | ok | 0 | 1.72s | Manual result imports reapplied to match_data.json: 3/3 |
| Settle due results | ok | 0 | 21.44s | === TOTAL: 578  FT: 527  upcoming: 51  / winner hit: 247  miss: 251  pending: 80 === |
| Run result review | ok | 0 | 0.16s | settled_market_rows=2052 weak_spots=12 top_action=Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to  |
| Run model calibration | ok | 0 | 0.11s | market_adjustments=3 league_market_adjustments=6 |
| Cache badges to Firebase Storage | ok | 0 | 805.73s | predictions_2026-05-25.json: cached=0 skipped=1077 failed=101 |
| Upload league docs to Firestore | ok | 0 | 202.21s | Uploaded fast dashboard doc dashboardData/match_data_fast as metadata-only fallback (27.2 KB); app will use date/league docs. |

## Output Files

- JSON log: `docs\agent-system\outputs\get_data_latest.json`
- Transcript: `docs\agent-system\outputs\get_data_20260525T021341Z.log`
- Phase run log: `docs\agent-system\outputs\Phase7_Run_Log.json`
- Phase daily summary: `docs\agent-system\outputs\Phase7_Daily_Summary.md`

