# Bet Slip — Save to Account + History with Hit/Miss Scoring

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation plan

## Problem

The bet slip (accumulator) on the dashboard is ephemeral:

- Legs are persisted only to `localStorage` (`ACCA_LEGS_STORAGE_KEY`), not to the user's account.
- The modal's "Done" button (`app/dashboard/page.jsx:1469`) only closes the modal — it saves nothing.
- There is no way to review past slips, and no scoring of how a saved slip performed once its matches resolve.
- Legs can only be added from the "Today's value" board (positive-EV picks). Other markets, and the match-detail view, have no add-to-slip affordance.

Users want to: **save the current slip to their account, keep a history of saved slips, and see each slip scored hit/miss (per leg and overall) as its matches resolve** — and be able to add **any** market to a slip from the match-detail view.

## Context: the pattern already exists

The crowd-vote system (`app/api/match-votes/route.js`) already solves "save a pick to the user + score it hit/miss as the match resolves":

- `marketActualResult(match, marketKey, value)` — canonical scorer for `winner | btts | goals | cards | corners`.
- `loadMatch(db, matchId, date)` — reloads a match (with `actuals`) from Firestore.
- `marketLine(match, key, fallback)` — resolves the over/under line for a market.
- `verifyAccess(request)` / `getAdminApp()` — Bearer-token auth + admin app bootstrap.
- The leaderboard payload reloads matches and computes hits/misses live; the dashboard's "Resulted Picks" section renders the hit/miss treatment.

The dashboard is fully behind auth + subscription (`app/auth-gate.jsx`: `if (!user) return <sign-in>`, then access check, else render children). **Every dashboard viewer is already signed in**, so "account-only" persistence is the natural state — `localStorage` was only a convenience cache behind an already-gated page.

This design mirrors the crowd-vote architecture rather than inventing a parallel one.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Where saved slips open | **Tabs inside the bet-slip modal**: `Current` (default, primary CTA) + `History`. |
| Persistence | **Account-only.** Working draft + saved slips both live under the user. `localStorage` is dropped as source of truth (may remain as an optional instant-reload mirror). |
| After Save | **Snapshot to History, then clear Current** (start fresh). |
| Where legs can be added | Value board (existing) **plus every market in `MatchDetailView`**. |
| Legs per match | **One leg per match** preserved. Adding a second market for the same match **swaps** the leg. (Keeps the product-of-probabilities combined model % valid; same-game correlated multis are explicitly out of scope.) |
| Markets without book odds | Addable. Leg captures model fair odds flagged `priceEstimated: true`; the slip notes which legs are estimated. Real book price used whenever available. |
| Draw No Bet | A draw **voids** that leg (excluded from the accumulator); win/loss otherwise. |

## Architecture

### Data model — `users/{uid}/betSlips` subcollection

**`__draft__` doc** — the current working slip:

```
{
  legs: Leg[],
  stake: number,
  updatedAt: serverTimestamp
}
```

**Auto-id docs** — saved slips:

```
{
  legs: Leg[],            // frozen copy at save time, results filled in as matches resolve
  stake: number,
  combinedOdds: number,   // product of leg prices at save time
  combinedProb: number,   // product of leg model probabilities at save time
  status: 'pending' | 'won' | 'lost' | 'void',
  savedAt: serverTimestamp,
  settledAt: serverTimestamp | null
}
```

**`Leg` shape** (structured for deterministic scoring — never parse display text):

```
{
  matchId: string,
  date: string,           // 'YYYY-MM-DD', for loadMatch lookup
  marketKey: 'winner' | 'draw_no_bet' | 'btts' | 'goals' | 'cards' | 'corners',
  selection: string,      // 'home'|'draw'|'away' | 'yes'|'no' | 'over'|'under'
  line: number | null,    // for goals/cards/corners; null otherwise
  label: string,          // display, e.g. 'BTTS'
  pick: string,           // display, e.g. 'Yes' / 'Over 2.5'
  matchLabel: string,     // 'Portugal v Congo DR'
  league: string,
  book: number,           // price used (real book odds, or model fair odds if estimated)
  priceEstimated: boolean,
  prob: number,           // model probability of this selection
  result: 'hit' | 'miss' | 'void' | null   // null = pending; filled by settlement
}
```

`accaLegKey(matchId, label)` remains the in-memory identity key (one leg per match).

### API route — `app/api/bet-slips/route.js`

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. All reads/writes/scoring go through here with Bearer-token auth, mirroring `match-votes`.

- **GET** → `{ draft, slips }`.
  - Returns the `__draft__` doc (or empty draft).
  - Lists saved slips, newest first.
  - **Settlement pass:** for each slip with `status === 'pending'`, reload each pending leg's match via `loadMatch`, score via the shared scorer, and write newly-known `leg.result` back. Recompute overall `status` (below). Persist `status` + `settledAt` once fully resolved (results then frozen, surviving the match dropping off the slate).
- **POST**, dispatched on `body.action`:
  - `saveDraft` `{ legs, stake }` → upsert `__draft__`.
  - `saveSlip` `{ legs, stake }` → validate legs, create a saved slip (`status: 'pending'`, compute `combinedOdds`/`combinedProb`), then **clear `__draft__`**. Returns updated `{ draft, slips }`.
  - `deleteSlip` `{ slipId }` → delete a saved slip (lets users prune history).

### Shared helpers — extract from `match-votes`

To avoid ~150 lines of duplication, extract into a shared module (e.g. `app/api/_lib/match-scoring.js`):

- `getAdminApp`, `verifyAccess`
- `loadMatch`, `marketLine`, `adelaideLocalToUtc`
- `marketActualResult` — **extended** to handle `draw_no_bet`:
  - draw → `void`; otherwise hit iff the picked side won (DNB has no draw outcome).

Both `match-votes/route.js` and `bet-slips/route.js` import from it. This is an in-scope cleanup of code we're modifying, not unrelated refactoring.

### Overall slip status

Given leg results:

- Any `miss` → **lost**.
- All non-void legs `hit` (≥1 non-void) → **won**.
- All legs `void` → **void**.
- Otherwise → **pending**.

Returns shown in History use only non-void legs' combined odds × stake.

## Leg construction (client)

A single helper builds a `Leg` from a market row, used by both entry points:

- **Value board** (`valueBoardPicks`, `page.jsx:1212`): rows already carry `key`, `label`, `market`, `book`, `prob`. Map `key` → `marketKey`, derive `selection`/`line` from the market object.
- **Match detail** (`MatchDetailView`, `page.jsx:5599`): the market rows (`marketRowsForMatch`, `page.jsx:2041`) carry `label`, `market` (with pick/line/odds), `comparison`, `modelProbability`. Derive the same structured fields. Use real book odds when present (`comparison.bookmaker.odds` / market odds); else model fair odds with `priceEstimated: true`.

`selection` derivation:
- winner: map the market pick to `home`/`draw`/`away` by comparing to `match.home`/`match.away`/draw.
- draw_no_bet: the picked side (`home`/`away`).
- btts: `yes`/`no`.
- goals/cards/corners: `over`/`under` + `line`.

## UI changes — `app/dashboard/page.jsx`

### `AccaSlip` (`page.jsx:1379`) — tabbed modal

- New `activeTab` state: `'current' | 'history'`, default `'current'`.
- Fetch `{ draft, slips }` from `GET /api/bet-slips` when the modal opens (Bearer token, same pattern as `MatchDetailView`'s vote load).
- **Current tab:** existing builder (legs list, combined odds/EV/model, stake input). "Done" → **"Save slip"**: `POST saveSlip`, clear local legs, switch to `History`. Show estimated-price note if any leg `priceEstimated`.
- **History tab:** list saved slips. Each: legs with per-leg `hit`/`miss`/`void`/`pending` chips (reuse Resulted Picks colors), overall `Won`/`Lost`/`Pending`/`Void` badge, stake → returns. Delete control per slip.
- Draft persistence: replace the `localStorage` load/save effects (`page.jsx:6565-6577`). Load draft from API on mount; `POST saveDraft` on modal close and after leg/stake changes (debounced). Optional: keep `localStorage` as an instant-reload mirror.

### Add-to-slip in `MatchDetailView` (`page.jsx:5599`)

- Thread `accaKeys` + `onToggleLeg` props in (currently only `ValueBoard` receives them; both are already available at the dashboard root, `page.jsx:6578-6588`).
- Add a compact add/remove toggle on each market tile in the overview, reflecting in-slip state via `accaKeys`. Building a leg uses the shared leg-construction helper. One leg per match — adding a different market for a match in the slip swaps it; button states reflect which market is the active leg.

### Wiring

`onToggleLeg` (`toggleAccaLeg`, `page.jsx:6579`) and `accaLegs` state are unchanged in spirit; the draft now also syncs to the account. The `MatchDetailView` render site must pass the slip props through (find where `<MatchDetailView .../>` is rendered and add them).

## Error handling

- API: 401/403 on auth failure (reuse `verifyAccess`); 400 on invalid leg/market; `no-store` cache headers.
- Client: if the slip API fails, the Current builder still works from in-memory state; show a non-blocking error (mirror `voteError`). Saving while offline surfaces a retry message rather than silently dropping the slip.
- Settlement is idempotent: a leg already `hit`/`miss`/`void` is never re-scored; only `null` legs are evaluated.
- A leg whose match can't be reloaded stays `pending` (same limitation as crowd votes) — never guessed.

## Testing / verification

- Build a slip from both the value board and the match-detail markets; confirm one-leg-per-match swap behavior.
- Save → Current clears, slip appears in History as `pending`.
- After a match resolves (or via a test fixture with `actuals`), GET settles the relevant legs; verify per-leg hit/miss and overall status, including a Draw No Bet `void` on a drawn match.
- Confirm a model-only market adds with `priceEstimated` and an "est." note.
- Verify results freeze (settled slip unchanged after its match leaves the slate).
- Manual run-through in the deployed dashboard (per the project's verify flow).

## Out of scope (YAGNI)

- Same-game / correlated multi-market parlays (would require a correlation-aware probability model).
- Sharing slips to the crowd / public leaderboards (slips are private to the user).
- Editing a saved slip's legs after saving (delete + rebuild instead).
- Stake/bankroll accounting beyond the per-slip returns display.
