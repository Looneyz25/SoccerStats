# Bet Slip Save + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the dashboard bet slip to the user's account, keep a history of saved slips, score each slip hit/miss (per leg and overall) as its matches resolve, and let any market be added to a slip from the match-detail view.

**Architecture:** Mirror the existing crowd-vote system (`app/api/match-votes/route.js`). Pure scoring/leg logic is extracted into ESM modules unit-tested with Node's built-in `node --test` (no new dependencies). A new authenticated API route (`app/api/bet-slips/route.js`) handles all slip reads/writes and live settlement, reusing helpers shared with the crowd-vote route. The `AccaSlip` modal gains Current/History tabs; `MatchDetailView` gets per-market add-to-slip buttons.

**Tech Stack:** Next.js 15 App Router, React 19, firebase-admin (server), Firestore, Tailwind, `node --test` for unit tests.

---

## Design reference

Spec: `docs/superpowers/specs/2026-06-18-bet-slip-save-history-design.md`

## File structure

| File | Responsibility | Action |
|---|---|---|
| `app/api/_lib/match-scoring.mjs` | Pure: `parseNumber`, `marketLine`, `marketActualResult`, `adelaideLocalToUtc`, `scoreLeg`, `computeSlipStatus`. No firebase-admin import. | Create |
| `app/api/_lib/match-scoring.test.mjs` | `node --test` unit tests for the pure module. | Create |
| `app/api/_lib/firebase-admin.mjs` | `getAdminApp`, `verifyAccess`, `loadMatch`. Firestore/admin-dependent. | Create |
| `app/api/match-votes/route.js` | Crowd votes. Refactored to import the extracted helpers. | Modify |
| `app/api/bet-slips/route.js` | New route: GET (draft + slips + settlement), POST (saveDraft/saveSlip/deleteSlip). | Create |
| `app/dashboard/bet-slip-utils.mjs` | Pure: `legFromMarketRow`, `accaLegKey`, `combinedFromLegs`, `slipReturns`. Client-side leg construction + math. | Create |
| `app/dashboard/bet-slip-utils.test.mjs` | `node --test` unit tests for leg construction. | Create |
| `app/dashboard/page.jsx` | `AccaSlip` tabs + API wiring; `MatchDetailView`/`PredictionSummaryCard` add buttons; draft persistence; prop threading. | Modify |

**Note on Windows shell:** commands below use `npx` and `git`; run them from the repo root `C:/Betting/Soccer Stats`. `node --test` ships with the project's Node (firebase-admin ^13 requires Node ≥18, where `node --test` is stable).

---

## Task 1: Pure scoring module + tests

**Files:**
- Create: `app/api/_lib/match-scoring.mjs`
- Test: `app/api/_lib/match-scoring.test.mjs`

This module holds the pure functions currently inline in `app/api/match-votes/route.js:102-108` (`marketLine`), `:296-303` (`parseNumber`), `:305-339` (`marketActualResult`), `:154-173` (`adelaideLocalToUtc`), plus two new slip functions (`scoreLeg`, `computeSlipStatus`).

- [ ] **Step 1: Write the failing tests**

Create `app/api/_lib/match-scoring.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumber,
  marketLine,
  marketActualResult,
  scoreLeg,
  computeSlipStatus,
} from './match-scoring.mjs';

const matchHomeWin = { home: { goals: 2 }, away: { goals: 0 }, actuals: { cards_total: 5, corners_total: 11 } };
const matchDraw = { home: { goals: 1 }, away: { goals: 1 }, actuals: { cards_total: 3, corners_total: 8 } };
const matchAwayWin = { home: { goals: 0 }, away: { goals: 3 }, actuals: { cards_total: 6, corners_total: 12 } };
const matchUpcoming = { home: {}, away: {}, actuals: {} };

test('parseNumber handles numbers, numeric strings, blanks', () => {
  assert.equal(parseNumber(3), 3);
  assert.equal(parseNumber('2.5'), 2.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('x'), null);
  assert.equal(parseNumber(NaN), null);
});

test('marketLine reads display_markets, falls back to predictions then default', () => {
  assert.equal(marketLine({ display_markets: { goals: { market: { line: 3.5 } } } }, 'goals', 2.5), 3.5);
  assert.equal(marketLine({ predictions: { ou_cards: { line: 5.5 } } }, 'cards', 4.5), 5.5);
  assert.equal(marketLine({}, 'corners', 10.5), 10.5);
});

test('marketActualResult scores the five standard markets (boolean|null)', () => {
  assert.equal(marketActualResult(matchHomeWin, 'winner', 'home'), true);
  assert.equal(marketActualResult(matchHomeWin, 'winner', 'away'), false);
  assert.equal(marketActualResult(matchDraw, 'winner', 'draw'), true);
  assert.equal(marketActualResult(matchHomeWin, 'btts', 'no'), true);
  assert.equal(marketActualResult(matchDraw, 'btts', 'yes'), true);
  assert.equal(marketActualResult(matchUpcoming, 'winner', 'home'), null);
});

test('scoreLeg: winner / btts / draw_no_bet', () => {
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'winner', selection: 'home' }), 'hit');
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'winner', selection: 'home' }), 'miss');
  assert.equal(scoreLeg(matchDraw, { marketKey: 'btts', selection: 'yes' }), 'hit');
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'draw_no_bet', selection: 'home' }), 'hit');
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'draw_no_bet', selection: 'home' }), 'miss');
  assert.equal(scoreLeg(matchDraw, { marketKey: 'draw_no_bet', selection: 'home' }), 'void');
  assert.equal(scoreLeg(matchUpcoming, { marketKey: 'draw_no_bet', selection: 'home' }), null);
});

test('scoreLeg: over/under uses the leg-captured line (incl. integer push)', () => {
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'over', line: 1.5 }), 'hit'); // total 2
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'under', line: 1.5 }), 'miss');
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'over', line: 2 }), 'void'); // total 2 == line 2
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'cards', selection: 'under', line: 5.5 }), 'hit'); // 5 cards
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'corners', selection: 'over', line: 10.5 }), 'hit'); // 12 corners
  assert.equal(scoreLeg(matchUpcoming, { marketKey: 'corners', selection: 'over', line: 10.5 }), null);
});

test('computeSlipStatus', () => {
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: null }]), 'pending');
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'miss' }]), 'lost');
  assert.equal(computeSlipStatus([{ result: null }, { result: 'miss' }]), 'lost'); // a miss settles the slip
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'hit' }]), 'won');
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'void' }]), 'won');
  assert.equal(computeSlipStatus([{ result: 'void' }, { result: 'void' }]), 'void');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test app/api/_lib/match-scoring.test.mjs`
Expected: FAIL — cannot resolve `./match-scoring.mjs` (module does not exist yet).

- [ ] **Step 3: Create the module**

Create `app/api/_lib/match-scoring.mjs`:

```javascript
// Pure prediction/market scoring helpers. No firebase-admin import so this
// module is unit-testable with `node --test` and safe to reason about in
// isolation. Shared by the crowd-vote route and the bet-slip route.

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marketLine(match, key, fallback) {
  const displayKey = key === 'goals' ? 'goals' : key;
  const market =
    match.display_markets?.[displayKey]?.market ||
    (key === 'goals'
      ? match.predictions?.ou_goals
      : key === 'cards'
        ? match.predictions?.ou_cards
        : key === 'corners'
          ? match.predictions?.ou_corners
          : null);
  return market?.line ?? fallback;
}

// Boolean|null scorer for the five crowd-vote markets. Contract unchanged from
// the original match-votes implementation (callers there rely on boolean|null).
export function marketActualResult(match, marketKey, value) {
  if (!match) return null;
  const homeGoals = parseNumber(match?.home?.goals);
  const awayGoals = parseNumber(match?.away?.goals);
  if (marketKey === 'winner') {
    if (homeGoals === null || awayGoals === null) return null;
    const actual = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
    return value === actual;
  }
  if (marketKey === 'btts') {
    if (homeGoals === null || awayGoals === null) return null;
    const actual = homeGoals > 0 && awayGoals > 0 ? 'yes' : 'no';
    return value === actual;
  }
  if (marketKey === 'goals') {
    if (homeGoals === null || awayGoals === null) return null;
    const line = Number(marketLine(match, 'goals', 2.5));
    if (!Number.isFinite(line)) return null;
    const total = homeGoals + awayGoals;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  if (marketKey === 'cards') {
    const total = parseNumber(match?.actuals?.cards_total);
    const line = Number(marketLine(match, 'cards', 4.5));
    if (total === null || !Number.isFinite(line)) return null;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  if (marketKey === 'corners') {
    const total = parseNumber(match?.actuals?.corners_total);
    const line = Number(marketLine(match, 'corners', 10.5));
    if (total === null || !Number.isFinite(line)) return null;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  return null;
}

// Bet-slip leg scorer: returns 'hit' | 'miss' | 'void' | null (null = pending).
// Scores over/under against the LINE CAPTURED ON THE LEG (leg.line), not the
// current match line, so a later line move can't rewrite a settled bet. Draw No
// Bet voids on a draw; an exact integer total pushes (voids) over/under.
export function scoreLeg(match, leg) {
  if (!match || !leg) return null;
  const h = parseNumber(match?.home?.goals);
  const a = parseNumber(match?.away?.goals);
  const { marketKey, selection, line } = leg;

  if (marketKey === 'winner') {
    if (h === null || a === null) return null;
    const actual = h > a ? 'home' : a > h ? 'away' : 'draw';
    return selection === actual ? 'hit' : 'miss';
  }
  if (marketKey === 'draw_no_bet') {
    if (h === null || a === null) return null;
    if (h === a) return 'void';
    return selection === (h > a ? 'home' : 'away') ? 'hit' : 'miss';
  }
  if (marketKey === 'btts') {
    if (h === null || a === null) return null;
    const actual = h > 0 && a > 0 ? 'yes' : 'no';
    return selection === actual ? 'hit' : 'miss';
  }

  const ln = Number(line);
  if (!Number.isFinite(ln)) return null;
  let total = null;
  if (marketKey === 'goals') {
    if (h === null || a === null) return null;
    total = h + a;
  } else if (marketKey === 'cards') {
    total = parseNumber(match?.actuals?.cards_total);
  } else if (marketKey === 'corners') {
    total = parseNumber(match?.actuals?.corners_total);
  }
  if (total === null) return null;
  if (total === ln) return 'void';
  const over = total > ln;
  return (selection === 'over' ? over : !over) ? 'hit' : 'miss';
}

// Overall slip status from per-leg results.
// A single miss settles the slip as lost even if other legs are still pending.
export function computeSlipStatus(legs) {
  const results = (legs || []).map((l) => l?.result ?? null);
  if (results.some((r) => r === 'miss')) return 'lost';
  if (results.some((r) => r == null)) return 'pending';
  const nonVoid = results.filter((r) => r !== 'void');
  if (nonVoid.length === 0) return 'void';
  return 'won';
}

// Adelaide-local kickoff → UTC Date (DST-aware). Used by the crowd-vote lock.
export function adelaideLocalToUtc(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) || !/^\d{2}:\d{2}$/.test(String(timeStr || ''))) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcGuess));
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const renderedAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  const offset = renderedAsUtc - utcGuess;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test app/api/_lib/match-scoring.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/api/_lib/match-scoring.mjs app/api/_lib/match-scoring.test.mjs
git commit -m "Add pure match-scoring module with bet-slip leg scoring + tests"
```

---

## Task 2: Extract admin helpers + refactor crowd-vote route

**Files:**
- Create: `app/api/_lib/firebase-admin.mjs`
- Modify: `app/api/match-votes/route.js` (replace inline copies with imports)

Goal: one source of truth for admin app, auth, match loading, and scoring. **No behavior change** to the crowd-vote route — verified by the Task 1 tests still passing and a runtime smoke check.

- [ ] **Step 1: Create the admin helper module**

Create `app/api/_lib/firebase-admin.mjs` by moving — verbatim — the following from `app/api/match-votes/route.js`: the constants `PROJECT_ID`, `DASHBOARD_DOC`, `OWNER_EMAIL`, `DEFAULT_SERVICE_ACCOUNT_PATH`, the `adminApp` singleton + `getAdminApp` (`route.js:28-41`), `verifyAccess` (`:53-84`), and `loadMatch` (`:196-217`). Add the required imports at the top:

```javascript
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'sports-predictions-f91fd';
const DASHBOARD_DOC = 'match_data';
const OWNER_EMAIL = 'l.vorabouth@gmail.com';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');

let adminApp = null;

export function getAdminApp() {
  /* …exact body from route.js:29-40… */
}

export async function verifyAccess(request) {
  /* …exact body from route.js:54-83… */
}

export async function loadMatch(db, matchId, date) {
  /* …exact body from route.js:197-216… */
}
```

Copy the bodies exactly from the current `route.js` (do not paraphrase). `loadMatch` references `DASHBOARD_DOC`; `verifyAccess` references `OWNER_EMAIL` and `getAdminApp`. Keep `OWNER_EMAIL` exported is not needed — it is only used inside `verifyAccess`.

- [ ] **Step 2: Refactor `match-votes/route.js` to import the shared helpers**

At the top of `app/api/match-votes/route.js`, after the existing firebase-admin imports, add:

```javascript
import { getAdminApp, verifyAccess, loadMatch } from '../_lib/firebase-admin.mjs';
import { parseNumber, marketLine, marketActualResult, adelaideLocalToUtc } from '../_lib/match-scoring.mjs';
```

Then **delete** the now-duplicated definitions from `route.js`: `getAdminApp`, `verifyAccess`, `loadMatch`, `parseNumber`, `marketLine`, `marketActualResult`, `adelaideLocalToUtc`, and the moved constants (`PROJECT_ID`, `DASHBOARD_DOC`, `OWNER_EMAIL`, `DEFAULT_SERVICE_ACCOUNT_PATH`, `adminApp`). Keep everything else (`VOTE_COLLECTION`, `VOTE_CUTOFF_MINUTES`, caches, `voteOptionsForMatch`, `voteLockState`, `buildVoteSummary*`, `leaderboardPayload`, `GET`, `POST`, etc.) unchanged — they now call the imported functions.

Note: `firebase-admin/firestore` is still imported in `route.js` for `FieldValue`/`getFirestore` used elsewhere — keep that import.

- [ ] **Step 3: Verify the pure tests still pass (extraction sanity)**

Run: `node --test app/api/_lib/match-scoring.test.mjs`
Expected: PASS (unchanged from Task 1).

- [ ] **Step 4: Build to confirm the route still compiles with the new imports**

Run: `npx next build` (or `npm.cmd run build`).
Expected: build completes without module-resolution or undefined-reference errors in `app/api/match-votes/route.js` or `app/api/_lib/*`.

If a full build is too slow in the loop, at minimum run `node --check` on the route after stripping JSX is not applicable (route is plain JS): `node --input-type=module -e "import('./app/api/match-votes/route.js').catch(e=>{console.error(e);process.exit(1)})"` is NOT reliable (Next-only globals). Prefer the build.

- [ ] **Step 5: Runtime smoke (crowd votes still work)**

Start dev (`npm.cmd run dev`), open a match detail in the dashboard, confirm the crowd-vote panel loads and a vote still saves (per the project `verify` flow). This guards the refactor since the route has no unit tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/_lib/firebase-admin.mjs app/api/match-votes/route.js
git commit -m "Extract shared admin/scoring helpers; rewire crowd-vote route to import them"
```

---

## Task 3: Bet-slips API route

**Files:**
- Create: `app/api/bet-slips/route.js`

Stores slips under `users/{uid}/betSlips`. `__draft__` doc = working slip; auto-id docs = saved slips. GET settles pending slips; POST handles `saveDraft` / `saveSlip` / `deleteSlip`.

- [ ] **Step 1: Create the route**

Create `app/api/bet-slips/route.js`:

```javascript
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAdminApp, verifyAccess, loadMatch } from '../_lib/firebase-admin.mjs';
import { scoreLeg, computeSlipStatus } from '../_lib/match-scoring.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DRAFT_ID = '__draft__';
const MAX_LEGS = 20;
const VALID_MARKETS = new Set(['winner', 'draw_no_bet', 'btts', 'goals', 'cards', 'corners']);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function slipsCollection(db, uid) {
  return db.collection('users').doc(uid).collection('betSlips');
}

function sanitizeLeg(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const marketKey = String(raw.marketKey || '');
  if (!VALID_MARKETS.has(marketKey)) return null;
  const matchId = String(raw.matchId || '');
  if (!matchId) return null;
  const book = Number(raw.book);
  const prob = Number(raw.prob);
  const lineNum = Number(raw.line);
  return {
    matchId,
    date: raw.date ? String(raw.date) : null,
    marketKey,
    selection: String(raw.selection || ''),
    line: Number.isFinite(lineNum) ? lineNum : null,
    label: String(raw.label || ''),
    pick: String(raw.pick || ''),
    matchLabel: String(raw.matchLabel || ''),
    league: raw.league ? String(raw.league) : null,
    book: Number.isFinite(book) && book > 1 ? book : null,
    priceEstimated: Boolean(raw.priceEstimated),
    prob: Number.isFinite(prob) ? prob : null,
    result: null,
  };
}

function sanitizeLegs(raw) {
  if (!Array.isArray(raw)) return [];
  const byMatch = new Map();
  for (const item of raw.slice(0, MAX_LEGS)) {
    const leg = sanitizeLeg(item);
    if (leg) byMatch.set(leg.matchId, leg); // one leg per match (last wins)
  }
  return [...byMatch.values()];
}

function combinedOdds(legs) {
  return legs.reduce((p, l) => p * (Number(l.book) || 1), 1);
}
function combinedProb(legs) {
  return legs.reduce((p, l) => p * (Number(l.prob) || 0), 1);
}

function serializeSlip(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    legs: data.legs || [],
    stake: data.stake ?? 10,
    combinedOdds: data.combinedOdds ?? null,
    combinedProb: data.combinedProb ?? null,
    status: data.status || 'pending',
    savedAt: data.savedAt?.toDate?.()?.toISOString?.() || null,
    settledAt: data.settledAt?.toDate?.()?.toISOString?.() || null,
  };
}

// Re-score pending legs against freshly-loaded matches; persist + freeze when
// the slip fully resolves. Returns the up-to-date serialized slip.
async function settleSlip(db, ref, doc) {
  const data = doc.data() || {};
  if (data.status && data.status !== 'pending') return serializeSlip(doc);
  const legs = data.legs || [];
  let changed = false;
  const nextLegs = [];
  for (const leg of legs) {
    if (leg.result) { nextLegs.push(leg); continue; }
    const match = await loadMatch(db, leg.matchId, leg.date);
    const result = match ? scoreLeg(match, leg) : null;
    if (result) { changed = true; nextLegs.push({ ...leg, result }); }
    else nextLegs.push(leg);
  }
  const status = computeSlipStatus(nextLegs);
  if (changed || status !== data.status) {
    const update = { legs: nextLegs, status };
    if (status !== 'pending') update.settledAt = FieldValue.serverTimestamp();
    await ref.set(update, { merge: true });
    return { ...serializeSlip(doc), legs: nextLegs, status,
      settledAt: status !== 'pending' ? new Date().toISOString() : null };
  }
  return serializeSlip(doc);
}

async function loadDraft(db, uid) {
  const snap = await slipsCollection(db, uid).doc(DRAFT_ID).get();
  const data = snap.exists ? snap.data() || {} : {};
  return { legs: data.legs || [], stake: data.stake ?? 10 };
}

async function listSlips(db, uid) {
  const snap = await slipsCollection(db, uid)
    .where('__name__', '!=', DRAFT_ID)
    .get();
  const docs = snap.docs.filter((d) => d.id !== DRAFT_ID);
  const settled = await Promise.all(docs.map((d) => settleSlip(db, d.ref, d)));
  return settled.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

async function payload(db, uid) {
  const [draft, slips] = await Promise.all([loadDraft(db, uid), listSlips(db, uid)]);
  return { draft, slips };
}

export async function GET(request) {
  let user;
  try { user = await verifyAccess(request); }
  catch (err) { return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401); }
  const db = getFirestore(getAdminApp());
  return jsonResponse(await payload(db, user.uid));
}

export async function POST(request) {
  let user;
  try { user = await verifyAccess(request); }
  catch (err) { return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401); }
  const db = getFirestore(getAdminApp());
  const body = await request.json().catch(() => ({}));
  const col = slipsCollection(db, user.uid);

  if (body.action === 'saveDraft') {
    const legs = sanitizeLegs(body.legs);
    const stake = Number(body.stake);
    await col.doc(DRAFT_ID).set({
      legs,
      stake: Number.isFinite(stake) ? stake : 10,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return jsonResponse(await payload(db, user.uid));
  }

  if (body.action === 'saveSlip') {
    const legs = sanitizeLegs(body.legs);
    if (!legs.length) return jsonResponse({ error: 'empty-slip' }, 400);
    const stake = Number(body.stake);
    await col.add({
      legs,
      stake: Number.isFinite(stake) ? stake : 10,
      combinedOdds: combinedOdds(legs),
      combinedProb: combinedProb(legs),
      status: 'pending',
      savedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
    await col.doc(DRAFT_ID).set({ legs: [], stake: 10, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return jsonResponse(await payload(db, user.uid));
  }

  if (body.action === 'deleteSlip') {
    const slipId = String(body.slipId || '');
    if (!slipId || slipId === DRAFT_ID) return jsonResponse({ error: 'invalid-slip' }, 400);
    await col.doc(slipId).delete();
    return jsonResponse(await payload(db, user.uid));
  }

  return jsonResponse({ error: 'unknown-action' }, 400);
}
```

Note on `listSlips`: the `where('__name__', '!=', DRAFT_ID)` inequality on document id avoids reading the draft as a slip; the post-filter is a belt-and-braces guard. If the Firestore SDK rejects the `__name__` inequality without an index, fall back to `await col.get()` then `docs.filter((d) => d.id !== DRAFT_ID)`.

- [ ] **Step 2: Build to confirm the route compiles**

Run: `npx next build`
Expected: build completes; `app/api/bet-slips/route.js` resolves its imports.

- [ ] **Step 3: Runtime smoke via curl with a real token**

Start dev. In the dashboard, grab a token in DevTools console: `await firebase.auth?.()` is not exposed; instead use the app's helper — easiest is to add the slip UI first. For now, verify the route responds 401 without a token:

Run: `curl -s -X GET http://localhost:3001/api/bet-slips`
Expected: `{"error":"missing-token"}` with HTTP 401.

(Full authenticated round-trip is exercised by the UI in Tasks 5–7 and the final verify.)

- [ ] **Step 4: Commit**

```bash
git add app/api/bet-slips/route.js
git commit -m "Add bet-slips API route: draft, save, delete, live settlement"
```

---

## Task 4: Client leg-construction utilities + tests

**Files:**
- Create: `app/dashboard/bet-slip-utils.mjs`
- Test: `app/dashboard/bet-slip-utils.test.mjs`

Pure helpers used by `page.jsx` to turn a rendered market row into a structured leg (matching the API's `Leg` shape) and to compute combined odds/returns for display. `accaLegKey` and `accaCombined` currently live inline in `page.jsx:1234-1243`; move `accaLegKey` here and add `legFromMarketRow`.

- [ ] **Step 1: Write the failing tests**

Create `app/dashboard/bet-slip-utils.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accaLegKey, marketKeyForLabel, selectionForRow, legFromMarketRow } from './bet-slip-utils.mjs';

const match = { id: 'm1', date: '2026-06-18', league: 'FIFA World Cup', home: { name: 'Portugal' }, away: { name: 'Congo DR' } };

test('accaLegKey is matchId::label', () => {
  assert.equal(accaLegKey('m1', 'BTTS'), 'm1::BTTS');
});

test('marketKeyForLabel maps display labels to scoring keys', () => {
  assert.equal(marketKeyForLabel('Winner'), 'winner');
  assert.equal(marketKeyForLabel('Draw No Bet'), 'draw_no_bet');
  assert.equal(marketKeyForLabel('BTTS'), 'btts');
  assert.equal(marketKeyForLabel('Goals'), 'goals');
  assert.equal(marketKeyForLabel('Cards'), 'cards');
  assert.equal(marketKeyForLabel('Corners'), 'corners');
});

test('selectionForRow derives home/draw/away/yes/no/over/under', () => {
  assert.equal(selectionForRow('winner', { pick: 'Portugal' }, match), 'home');
  assert.equal(selectionForRow('winner', { pick: 'Congo DR' }, match), 'away');
  assert.equal(selectionForRow('winner', { pick: 'Draw' }, match), 'draw');
  assert.equal(selectionForRow('draw_no_bet', { pick: 'Portugal DNB' }, match), 'home');
  assert.equal(selectionForRow('btts', { pick: 'Yes' }, match), 'yes');
  assert.equal(selectionForRow('goals', { pick: 'Over 2.5' }, match), 'over');
  assert.equal(selectionForRow('corners', { pick: 'Under 10.5' }, match), 'under');
});

test('legFromMarketRow builds the structured leg (real book price)', () => {
  const row = { label: 'Goals', pick: 'Over 2.5', book: 1.83, prob: 0.62, line: 2.5 };
  const leg = legFromMarketRow(row, match);
  assert.deepEqual(leg, {
    matchId: 'm1', date: '2026-06-18', marketKey: 'goals', selection: 'over',
    line: 2.5, label: 'Goals', pick: 'Over 2.5', matchLabel: 'Portugal v Congo DR',
    league: 'FIFA World Cup', book: 1.83, priceEstimated: false, prob: 0.62,
  });
});

test('legFromMarketRow flags estimated price when only model odds exist', () => {
  const row = { label: 'Corners', pick: 'Over 10.5', modelOdds: 1.95, prob: 0.51, line: 10.5 };
  const leg = legFromMarketRow(row, match);
  assert.equal(leg.book, 1.95);
  assert.equal(leg.priceEstimated, true);
});

test('legFromMarketRow returns null for an unscorable row', () => {
  assert.equal(legFromMarketRow({ label: 'Mystery', pick: 'x' }, match), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test app/dashboard/bet-slip-utils.test.mjs`
Expected: FAIL — `./bet-slip-utils.mjs` not found.

- [ ] **Step 3: Create the module**

Create `app/dashboard/bet-slip-utils.mjs`:

```javascript
// Pure bet-slip leg construction + combined math. No React import so it is
// unit-testable with `node --test` and importable from the client bundle.

const LABEL_TO_KEY = {
  winner: 'winner',
  'draw no bet': 'draw_no_bet',
  btts: 'btts',
  goals: 'goals',
  cards: 'cards',
  corners: 'corners',
};

export function accaLegKey(matchId, label) {
  return `${matchId}::${label}`;
}

export function marketKeyForLabel(label) {
  return LABEL_TO_KEY[String(label || '').trim().toLowerCase()] || null;
}

export function selectionForRow(marketKey, market, match) {
  const pick = String(market?.pick || '').trim();
  const lower = pick.toLowerCase();
  if (marketKey === 'btts') return lower.startsWith('y') ? 'yes' : 'no';
  if (marketKey === 'goals' || marketKey === 'cards' || marketKey === 'corners') {
    return lower.startsWith('over') ? 'over' : 'under';
  }
  if (marketKey === 'winner' || marketKey === 'draw_no_bet') {
    if (lower === 'draw') return 'draw';
    const home = String(match?.home?.name || '').toLowerCase();
    const away = String(match?.away?.name || '').toLowerCase();
    const cleaned = lower.replace(/\s+dnb$/, '').trim();
    if (home && cleaned.includes(home)) return 'home';
    if (away && cleaned.includes(away)) return 'away';
    return null;
  }
  return null;
}

export function legFromMarketRow(row, match) {
  const marketKey = marketKeyForLabel(row?.label);
  if (!marketKey) return null;
  const selection = selectionForRow(marketKey, row, match);
  if (!selection) return null;
  const realBook = Number(row?.book);
  const modelOdds = Number(row?.modelOdds);
  const hasBook = Number.isFinite(realBook) && realBook > 1;
  const book = hasBook ? realBook : Number.isFinite(modelOdds) && modelOdds > 1 ? modelOdds : null;
  if (book === null) return null;
  const lineNum = Number(row?.line);
  const prob = Number(row?.prob);
  return {
    matchId: String(match?.id || ''),
    date: match?.date ? String(match.date) : null,
    marketKey,
    selection,
    line: Number.isFinite(lineNum) ? lineNum : null,
    label: String(row.label),
    pick: String(row.pick || ''),
    matchLabel: `${match?.home?.name || 'Home'} v ${match?.away?.name || 'Away'}`,
    league: match?.league ? String(match.league) : null,
    book,
    priceEstimated: !hasBook,
    prob: Number.isFinite(prob) ? prob : null,
  };
}

export function combinedFromLegs(legs) {
  if (!legs.length) return null;
  const odds = legs.reduce((p, l) => p * Number(l.book), 1);
  const prob = legs.reduce((p, l) => p * Number(l.prob), 1);
  return { odds, prob, ev: prob * odds - 1 };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test app/dashboard/bet-slip-utils.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/bet-slip-utils.mjs app/dashboard/bet-slip-utils.test.mjs
git commit -m "Add pure client bet-slip leg-construction utilities + tests"
```

---

## Task 5: Wire `page.jsx` to use the shared utils + account draft

**Files:**
- Modify: `app/dashboard/page.jsx` (`:1234-1243`, `:1354-1362`, `:6565-6615`)

Replace the inline `accaLegKey`/`accaCombined` and the localStorage draft persistence with the shared utils + account-backed draft, and make `toggleAccaLeg` produce structured legs.

- [ ] **Step 1: Import the utils**

Near the top imports of `page.jsx`, add:

```javascript
import { accaLegKey, legFromMarketRow, combinedFromLegs } from './bet-slip-utils.mjs';
```

Then **delete** the inline `accaLegKey` (`:1234-1236`) and `accaCombined` (`:1238-1243`). Replace remaining `accaCombined(` call sites with `combinedFromLegs(`.

- [ ] **Step 2: Make value-board + buttons produce structured legs**

In `ValueBoard` (`page.jsx:1352-1362`), change `onToggleLeg({...})` to build the leg via the shared helper. The value pick `p` has `{ match, label, pick, book, prob }` and the market line is on `p` if available — pass a row object:

```javascript
onClick={() => {
  const leg = legFromMarketRow(
    { label: p.label, pick: p.pick, book: p.book, prob: p.prob, line: p.line ?? p.market?.line ?? null },
    p.match,
  );
  if (leg) onToggleLeg(leg);
}}
```

(`valueBoardPicks` already carries `book`, `prob`, `label`, `pick`; add `line: row.market?.line ?? null` to the pushed object in `valueBoardPicks` at `page.jsx:1224` so the leg captures the line.)

Update `valueBoardPicks` push (`page.jsx:1224`):

```javascript
picks.push({ match: m, label: row.label, pick: formatMarketDetail(row.market), book, prob, ev, kelly, line: row.market?.line ?? null, marketObj: row.market });
```

- [ ] **Step 3: Replace localStorage draft with account draft sync**

Replace the two localStorage effects (`page.jsx:6566-6577`) with: load draft from the API on mount, and debounce-save the draft on change. Add a small fetch helper near the other auth fetches:

```javascript
// Bet slip (accumulator) — persisted to the user's account.
useEffect(() => {
  let active = true;
  (async () => {
    try {
      const { getFirebaseAuth } = await import('../firebase');
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/bet-slips', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (active && res.ok && Array.isArray(data?.draft?.legs)) setAccaLegs(data.draft.legs);
    } catch {}
  })();
  return () => { active = false; };
}, []);

const draftSaveTimer = useRef(null);
useEffect(() => {
  if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
  draftSaveTimer.current = setTimeout(async () => {
    try {
      const { getFirebaseAuth } = await import('../firebase');
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) return;
      await fetch('/api/bet-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'saveDraft', legs: accaLegs, stake: 10 }),
      });
    } catch {}
  }, 800);
  return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
}, [accaLegs]);
```

Ensure `useRef` is imported from React (it is widely used; confirm it's in the existing React import). Remove the `ACCA_LEGS_STORAGE_KEY` constant (`page.jsx:76`) and any remaining references.

- [ ] **Step 4: Build + runtime check**

Run: `npx next build` → expect success.
Start dev, add a value-board pick to the slip, reload the page → the leg persists (loaded from the account draft, not localStorage). Confirm the slip legs now carry `marketKey`/`selection`/`line` (inspect via the slip rendering in Task 6, or `console.log` temporarily).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.jsx
git commit -m "Use shared bet-slip utils; persist working slip to the account"
```

---

## Task 6: `AccaSlip` Current/History tabs

**Files:**
- Modify: `app/dashboard/page.jsx` (`AccaSlip`, `:1379-1476`; render site `:7752`)

Add tabs, fetch slips on open, Save→clear→History, and history rendering with per-leg hit/miss + overall badge.

- [ ] **Step 1: Extend `AccaSlip` props and state**

Change the render site (`page.jsx:7752`) to pass what the modal needs to save and clear:

```javascript
<AccaSlip legs={accaLegs} onRemoveLeg={removeAccaLeg} onClear={clearAcca} onSaved={() => setAccaLegs([])} />
```

In `AccaSlip` (`page.jsx:1379`), add:

```javascript
function AccaSlip({ legs, onRemoveLeg, onClear, onSaved }) {
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(10);
  const [tab, setTab] = useState('current');
  const [slips, setSlips] = useState([]);
  const [slipsLoading, setSlipsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // …existing body-scroll-lock effect…
```

- [ ] **Step 2: Fetch slips when the modal opens or the tab switches to history**

Add inside `AccaSlip`:

```javascript
const token = useCallback(async () => {
  const { getFirebaseAuth } = await import('../firebase');
  return getFirebaseAuth().currentUser?.getIdToken();
}, []);

const loadSlips = useCallback(async () => {
  setSlipsLoading(true);
  setError('');
  try {
    const t = await token();
    if (!t) throw new Error('Sign in again to load slips.');
    const res = await fetch('/api/bet-slips', { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Could not load slips.');
    setSlips(Array.isArray(data.slips) ? data.slips : []);
  } catch (e) {
    setError(e.message || 'Could not load slips.');
  } finally {
    setSlipsLoading(false);
  }
}, [token]);

useEffect(() => { if (open) loadSlips(); }, [open, loadSlips]);
```

- [ ] **Step 3: Save handler (Save → snapshot → clear → History)**

```javascript
const saveSlip = useCallback(async () => {
  setBusy(true);
  setError('');
  try {
    const t = await token();
    if (!t) throw new Error('Sign in again to save.');
    const res = await fetch('/api/bet-slips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: 'saveSlip', legs, stake: Number(stake) || 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Could not save slip.');
    setSlips(Array.isArray(data.slips) ? data.slips : []);
    onSaved?.();        // clears accaLegs in the parent (and the account draft via its effect)
    setTab('history');
  } catch (e) {
    setError(e.message || 'Could not save slip.');
  } finally {
    setBusy(false);
  }
}, [token, legs, stake, onSaved]);

const deleteSlip = useCallback(async (slipId) => {
  try {
    const t = await token();
    if (!t) return;
    const res = await fetch('/api/bet-slips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: 'deleteSlip', slipId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setSlips(Array.isArray(data.slips) ? data.slips : []);
  } catch {}
}, [token]);
```

- [ ] **Step 4: Render tabs + history**

Replace the modal body. Keep the existing builder markup as the `current` tab content; add the tab bar and history list. The "Done" button (`page.jsx:1469`) becomes "Save slip" calling `saveSlip` (disabled when `!legs.length || busy`). Add a tab bar under the header:

```jsx
<div className="flex border-b border-line px-4">
  {[['current', `Current${legs.length ? ` · ${legs.length}` : ''}`], ['history', 'History']].map(([id, label]) => (
    <button key={id} type="button" onClick={() => setTab(id)}
      className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
      {label}
    </button>
  ))}
</div>
```

History list (reuses the Resulted Picks hit/miss colour idiom):

```jsx
{tab === 'history' && (
  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
    {slipsLoading ? (
      <p className="text-sm text-muted">Loading slips…</p>
    ) : !slips.length ? (
      <p className="text-sm text-muted">No saved slips yet. Build one in Current and tap Save slip.</p>
    ) : (
      <ul className="space-y-3">
        {slips.map((slip) => {
          const tone = slip.status === 'won' ? 'border-emerald-500/40 bg-emerald-500/5'
            : slip.status === 'lost' ? 'border-red-500/40 bg-red-500/5'
            : slip.status === 'void' ? 'border-line bg-field'
            : 'border-line bg-surface';
          const returns = slip.status === 'won' ? (Number(slip.stake) * Number(slip.combinedOdds || 0)) : 0;
          return (
            <li key={slip.id} className={`rounded-lg border ${tone} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {slip.legs.length} legs · {Number(slip.combinedOdds || 0).toFixed(2)}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    slip.status === 'won' ? 'bg-emerald-500 text-white'
                    : slip.status === 'lost' ? 'bg-red-500 text-white'
                    : slip.status === 'void' ? 'bg-field text-muted'
                    : 'bg-amber-500/80 text-white'}`}>
                    {slip.status.toUpperCase()}
                  </span>
                  <button type="button" onClick={() => deleteSlip(slip.id)} aria-label="Delete slip"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-muted hover:text-red-500">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {slip.legs.map((l, i) => (
                  <li key={`${l.matchId}-${i}`} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-muted">
                      <span className="text-ink">{l.matchLabel}</span> · {l.label} {l.pick}
                      {l.priceEstimated ? ' (est.)' : ''} @ {Number(l.book).toFixed(2)}
                    </span>
                    <span className={`shrink-0 font-semibold ${
                      l.result === 'hit' ? 'text-emerald-500'
                      : l.result === 'miss' ? 'text-red-500'
                      : l.result === 'void' ? 'text-muted' : 'text-amber-500'}`}>
                      {l.result ? l.result : 'pending'}
                    </span>
                  </li>
                ))}
              </ul>
              {slip.status === 'won' && (
                <p className="mt-2 text-[12px] text-muted">Returns <span className="font-mono font-semibold text-ink">{returns.toFixed(2)}</span> from stake {Number(slip.stake).toFixed(0)}</p>
              )}
            </li>
          );
        })}
      </ul>
    )}
  </div>
)}
{error && <p className="px-4 pb-2 text-[12px] text-red-500">{error}</p>}
```

Wrap the existing builder markup (legs list + combined + stake + footer) in `{tab === 'current' && ( … )}`. In the footer, rename the "Done" action:

```jsx
<button type="button" onClick={saveSlip} disabled={!legs.length || busy}
  className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-header text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50">
  {busy ? 'Saving…' : 'Save slip'}
</button>
```

Keep `combined` derived via `combinedFromLegs(legs)`. If any leg `priceEstimated`, add a one-line note under the combined stats: `Includes model-estimated prices (est.).`

- [ ] **Step 5: Build + runtime verify**

Run: `npx next build` → success.
Start dev. Build a slip, open the modal → Current tab shows legs; switch to History (empty). Tap Save slip → slip clears, History shows the slip as `pending` with per-leg `pending`. Reload → draft empty, History persists.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.jsx
git commit -m "Add Current/History tabs to bet slip; save to account and render hit/miss"
```

---

## Task 7: Add-to-slip on every market in the detail view

**Files:**
- Modify: `app/dashboard/page.jsx` (`MatchDetailView` `:5599` + render sites `:6300`, `:7265`; `PredictionSummaryCard` render at `:5852`)

Thread `accaKeys` + `onToggleLeg` into `MatchDetailView`, then into `PredictionSummaryCard`, and render a per-market add/remove toggle.

- [ ] **Step 1: Thread props from the dashboard root to both `MatchDetailView` sites**

`accaKeys` and `toggleAccaLeg` exist at the dashboard root (`page.jsx:6601`, `:6603`). Pass them down through whatever component owns each `<MatchDetailView>`:
- Render site `page.jsx:7265` and `page.jsx:6300`: add `accaKeys={accaKeys}` and `onToggleLeg={toggleAccaLeg}` to both. If the immediate parent of `:6300` does not receive these (it is a split-view wrapper), add them to that wrapper's props and forward — follow the existing prop chain the same way `favoriteTeams`/`onToggleFavoriteTeam` are threaded (they reach the same sites, so mirror their path exactly).

- [ ] **Step 2: Accept the props in `MatchDetailView` and forward to `PredictionSummaryCard`**

In the `MatchDetailView` signature (`page.jsx:5599`) add `accaKeys`, `onToggleLeg`:

```javascript
function MatchDetailView({ match, onBack, allMatches, bookmakerId, onBookmakerChange, favoriteTeams = [], onToggleFavoriteTeam, isPlatformOwner = false, onMatchImported, onVoteSaved, embedded = false, accaKeys, onToggleLeg }) {
```

At the `PredictionSummaryCard` render (`page.jsx:5852`), pass them through:

```jsx
<PredictionSummaryCard match={match} allMatches={allMatches} voteState={voteState} accaKeys={accaKeys} onToggleLeg={onToggleLeg} />
```

- [ ] **Step 3: Render the per-market toggle in `PredictionSummaryCard`**

Locate `PredictionSummaryCard` (search `function PredictionSummaryCard`). It renders the winner card and the secondary market rows (BTTS/Goals/Cards/Corners, and Draw No Bet) from market objects. For each market row that has a `label` in {Winner, Draw No Bet, BTTS, Goals, Cards, Corners} and a usable price, render an add/remove button next to the row. Build the leg with the shared helper and reflect in-slip state via `accaKeys`:

```jsx
// inside the row render, given `row = { label, market, comparison, modelProbability }`
{onToggleLeg && (() => {
  const book = Number(row.comparison?.bookmaker?.odds) || Number(row.market?.odds);
  const modelOdds = Number(row.comparison?.model?.odds) || (row.modelProbability ? 1 / Number(row.modelProbability) : NaN);
  const leg = legFromMarketRow({
    label: row.label,
    pick: formatMarketDetail(row.market),
    book: Number.isFinite(book) && book > 1 ? book : undefined,
    modelOdds: Number.isFinite(modelOdds) && modelOdds > 1 ? modelOdds : undefined,
    prob: row.modelProbability ?? row.market?.model_probability,
    line: row.market?.line ?? null,
  }, match);
  if (!leg) return null;
  const inSlip = accaKeys?.has(accaLegKey(match.id, row.label));
  return (
    <button type="button" onClick={() => onToggleLeg(leg)} aria-pressed={inSlip}
      aria-label={inSlip ? 'Remove from bet slip' : 'Add to bet slip'}
      className={`ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition active:scale-90 ${
        inSlip ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-muted hover:text-ink'}`}>
      {inSlip ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : '+'}
    </button>
  );
})()}
```

`PredictionSummaryCard` must import/destructure `accaKeys`, `onToggleLeg` in its signature, and `legFromMarketRow`/`accaLegKey`/`formatMarketDetail` are module-scope (already available). If `PredictionSummaryCard` builds the winner from a different shape, map its winner pick label the same way the secondary rows are mapped (the shared `legFromMarketRow` handles label→key and pick→selection).

- [ ] **Step 4: Build + runtime verify**

Run: `npx next build` → success.
Start dev, open a match detail. Each market shows a `+`. Add BTTS → the floating slip count increments and the leg appears in Current. Add Goals for the **same** match → it **swaps** (one leg per match; BTTS toggle deselects, Goals selected). Add a market that has no book price (model-only) → it adds with an "(est.)" note in the slip.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.jsx
git commit -m "Add per-market add-to-slip buttons in the match detail view"
```

---

## Task 8: End-to-end settlement verification

**Files:** none (verification only)

- [ ] **Step 1: Build a mixed slip and save it**

In the dashboard, add legs from both the value board and a match detail (different matches), including one Draw No Bet leg. Save → confirm it lands in History as `pending` with all legs `pending`.

- [ ] **Step 2: Settle via real or imported results**

Either wait for matches to resolve, or (as platform owner) use the existing Match Result Import panel (`MatchResultImportPanel`, used at `page.jsx:5829`) to set `home.goals`/`away.goals` and `actuals` for the slip's matches. Then reopen the modal History tab (triggers `GET /api/bet-slips` → settlement).

- [ ] **Step 3: Confirm per-leg + overall scoring**

Expected:
- Winner/BTTS/Goals/Cards/Corners legs show `hit`/`miss` per `scoreLeg`.
- A Draw No Bet leg on a drawn match shows `void` and does not sink the slip.
- Overall badge: `won` only if every non-void leg hit; `lost` if any miss; `void` if all void.
- Returns shown for a `won` slip = stake × combinedOdds.

- [ ] **Step 4: Confirm freezing**

Navigate the dashboard date filter so a settled slip's match is no longer in the loaded slate; reopen History → the slip's results remain (frozen via the persisted `status`/`settledAt`).

- [ ] **Step 5: Final regression smoke**

- Crowd votes still load and save (Task 2 refactor).
- `node --test app/api/_lib/match-scoring.test.mjs app/dashboard/bet-slip-utils.test.mjs` → all PASS.
- `npx next build` → success.

- [ ] **Step 6: Append progress note (per standing directive) and commit**

Append one line to `.claude/progress.md` if it exists in this project (it may not — skip silently if absent):
`2026-06-18 — Bet slip now saves to account with scored history — app/dashboard/page.jsx, app/api/bet-slips`

```bash
git add -A
git commit -m "Verify bet-slip save/history settlement end-to-end"
```

---

## Self-review notes

- **Spec coverage:** account-only persistence (Tasks 3,5) · modal Current/History tabs (Task 6) · Save→clear (Tasks 3 saveSlip + 6 onSaved) · add-to-slip on all markets in detail (Task 7) · one-leg-per-match (sanitizeLegs + existing `toggleAccaLeg`) · model-only "est." price (Task 4 `legFromMarketRow`, surfaced in Task 6) · Draw No Bet void (Task 1 `scoreLeg`) · shared helper extraction (Task 2) · live settlement + freeze (Task 3 `settleSlip`, Task 8 verify).
- **Type consistency:** Leg shape is identical across `sanitizeLeg` (route), `legFromMarketRow` (client), and the `scoreLeg` reader (`marketKey`, `selection`, `line`, `book`, `prob`, `result`). `accaLegKey(matchId, label)` is the single in-memory identity everywhere.
- **No new dependencies:** tests use `node --test`; runtime uses existing firebase-admin + Next.
