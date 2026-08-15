# Session handover — 2026-08-13

## THE ONE THING TO KNOW FIRST

**There are two Soccer Stats checkouts and two AIOS checkouts. Work only in `C:\Projects\...`.**

- Soccer Stats live root is now `C:\Projects\Betting\Soccer Stats` (consolidated this session).
  `C:\Users\lvora\OneDrive\Projects\Betting\Soccer Stats` is the OLD root — still receives manual
  copies only because the AIOS server has not restarted.
- AIOS app still lives at `C:\Users\lvora\OneDrive\Projects\AIOS` (not moved — user asked, not started).
- Editing the wrong root silently does nothing. Two changes were lost that way this session.

## BLOCKED ON THE USER (elevated shell required)

1. **Restart the AIOS server.** It runs elevated; `taskkill /F /T` on pids 2840 / 2256 / 23300 returns
   `Access is denied`. Until restarted it holds the OLD `soccerDir` in memory and reads the OneDrive
   Soccer Stats copy, so ops UI at `localhost:4317/apps/soccer` only updates when someone hand-copies
   `match_data.json` across. `config/aios.config.json` already says `C:/Projects/Betting/Soccer Stats`.
2. Optional: delete stale scheduled task `SoccerStats NoTouch` (Disabled, points at a third dead path
   `C:\Betting\Soccer Stats`).

## STATE AS OF HANDOVER

`C:\Projects\Betting\Soccer Stats\match_data.json`: 22 leagues, 1015 matches, 92 upcoming, 54 priced.
Brasileirão Betano removed (approved) — was 63 matches. Backups in the session scratchpad.

## DONE AND VERIFIED

- **ESPN 403 fixed.** ESPN now blocks `urllib` on TLS fingerprint. Added `espn_get_json` using
  `curl_cffi` impersonation (`scripts/soccer_phase1_fixtures.py`), also used by the ESPN summary fetch
  in `soccer_routine.py`. Fixture floor went 0 → 95 rows.
- **Fixtures restored.** Phase 1 `total=95 ready_for_phase_2=95 source=ESPN`. Saturday 2026-08-15 has
  39 fixtures incl. Championship. Slate had been frozen at 2026-08-12.
- **Silent failures made loud.** `phase_b_forecast` now prints per-day
  `WARNING: fixture source returned nothing for <date>` plus `FIXTURE SOURCE FAILURE: N/7 forecast days
  unreachable`. Patched at both call sites (Phase B and Seed B).
- **Fabricated 1X2 price removed.** The `{home:3.0, draw:3.2, away:3.0}` seed is no longer persisted as
  `winner.odds`. Unpriced rows now carry `odds: null`, `no_bookmaker_odds: true`.
  Verified: seed prices 40 → **0**; 38 rows correctly null; 54 real prices untouched.
- **Sportsbet slugs corrected** (`scripts/soccer_fetch_sportsbet.py`):
  `english-league-one` → `english-league-1`, `english-league-two` → `english-league-2`.
  The old slugs silently returned the **League Cup** page (23 cross-division events: Nottm Forest v
  Leeds, Sheff Wed v Wolves), which is why nothing matched. Verified by team names against the correct
  12-event pages. NOT yet verified in a run.
- **`verify-odds` checker extended** (`AIOS/checkers/verify-odds.js`): per-league `priceAudit`,
  `fallbackTotal`, `deadLeagues` in `state/missed-odds-latest.json`; `fail` on a league with zero real
  prices, `warn` on any seed-priced fixture. Dry-run output:
  `FAIL: 3 leagues with zero real 1X2 prices — Primeira Liga 0/9, League One 0/8, League Two 0/11`.
- **Crowd-vote orphan fix** (`app/api/match-votes/route.js`): `isUnresolvablePick` filters past-dated
  unresolved picks out of `popularPicks`/`followingPicks`. Measured 27 kept / 2 removed, both orphans
  (`sportsbet:10500468`, `espn:760437`). Scoring untouched.

## OPEN — HIGHEST VALUE FIRST

1. **Sportsbet odds refresh never completed.** `npm.cmd run get:data:sportsbet` ran 300s+ with a
   **zero-byte output file** and no prices landed (League One 0/8, League Two 0/11). Re-run and watch
   it. This is the gate on everything below — same zero-output signature as the other silent failures.
2. **EFL predictions are placeholders.** `home_elo=1500 away_elo=1500 h2h_n=0 odds_avail=false` →
   winner/BTTS/goals vary only in the 3rd decimal, and **`ou_cards` is a hardcoded 0.75 and
   `ou_corners` a 0.55 cap on EVERY row**. User decision: **when there is no h2h/team data, derive from
   the bookmaker price.** Prices should anchor winner/goals/BTTS automatically once they land
   (`apply_bookmaker_goal_market_blend` + `bookmaker_odds_available`) — VERIFY, do not assume.
   Cards/corners have no such path: either use the book's cards/corners markets where offered, or
   suppress the market. Do not publish the constants.
3. **Primeira Liga matches nothing** despite its page returning 8 real events — name-matching, not slug.
4. **Championship slug unverified** (`english-championship`, 12 events, 4/6 priced) — inferred correct
   from the count pattern, never confirmed by team names.
5. **`verify-odds` returning `fail` will cause a re-run loop.** AIOS self-heal retries on checker
   `fail`; Primeira Liga can't self-heal, so it will retry every tick. Decide: downgrade to `warn`, add
   a no-retry marker in `doTick`, or accept the wasted re-run.
6. Badge caching times out at 240s (`failed exit=null`) — source of the `PUBLISH failed` log line.
7. Upload drops unrecognised fields not in `MATCH_KEEP_FIELDS`: `result_check_note` (30),
   `market_settlement_repaired_at` (3), `sofascore_result_id` (2).

## RULE ESTABLISHED THIS SESSION

This is a bet-tipping business. **Never publish a number without a real basis.** An unpublished tip
costs nothing; a fabricated one damages the hit rate the product is sold on. Evidence: cards Over was
stated 66% and landed 44% across 145 settled picks (−15.4u) — a prior filling in for absent data.
Order of preference: real bookmaker price (no-vig) → real team history → publish nothing.
