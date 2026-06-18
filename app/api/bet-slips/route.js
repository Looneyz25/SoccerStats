import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAdminApp, verifyAccess, loadMatch, capMap } from '../_lib/firebase-admin.mjs';
import { settleLegResult, computeSlipStatus } from '../_lib/match-scoring.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NOTE: must NOT match Firestore's reserved id pattern /^__.*__$/ — an id like
// '__draft__' throws INVALID_ARGUMENT ("reserved") on every read/write.
const DRAFT_ID = 'draft';
const PAGE_SIZE = 50;            // default saved slips returned per fetch (#1 pagination)
const MAX_PAGE = 500;            // hard cap on a single fetch (#1)
const MAX_SAVED_SLIPS = 200;     // per-user retention cap; oldest trimmed on save (#3)
const STALE_PENDING_DAYS = 7;    // void a still-unsettled leg after this many days (#2)
const CACHE_TTL_MS = 20 * 1000;  // short per-user GET cache (#4)
const CACHE_MAX = 2000;          // bound the GET cache (#5)
// GET payloads change only on a write, so cache them briefly per uid+limit and
// clear the whole cache on any POST.
const slipsCache = new Map();
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
  // Missing/zero leg probability is unknown, not impossible — treat it as the
  // neutral multiplier (1) like combinedOdds does, so one prob-less leg doesn't
  // collapse the whole combined probability to 0.
  return legs.reduce((p, l) => {
    const prob = Number(l.prob);
    return p * (Number.isFinite(prob) && prob > 0 ? prob : 1);
  }, 1);
}

function clampStake(value) {
  const stake = Number(value);
  if (!Number.isFinite(stake)) return 10;
  return Math.max(0, Math.min(100000, stake));
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
  const legs = data.legs || [];
  // Frozen once every leg has a result — even after the overall bet is decided
  // (e.g. lost on one leg) we keep scoring the other legs until none are pending,
  // so each leg shows its own outcome. Only short-circuit when all legs are in.
  if (!legs.some((l) => l.result == null)) return serializeSlip(doc);
  // Stale-pending guard (#2): a slip whose legs never reach FT (postponed,
  // abandoned, or match data rolled off the slate) would otherwise re-scan
  // Firestore on every open forever. After STALE_PENDING_DAYS, void whatever is
  // still unsettled so the slip freezes.
  const savedMs = data.savedAt?.toMillis?.()
    ?? (data.savedAt ? new Date(data.savedAt).getTime() : null);
  const expired = savedMs != null && Date.now() - savedMs > STALE_PENDING_DAYS * 86400000;
  let changed = false;
  const nextLegs = [];
  for (const leg of legs) {
    if (leg.result != null) { nextLegs.push(leg); continue; }
    const match = await loadMatch(db, leg.matchId, leg.date);
    // settleLegResult settles at FT (full hit/miss/void) and, while live, only
    // locks in a guaranteed hit (Over goals met, BTTS Yes met) — never a result
    // that still has time to flip to a miss.
    let result = settleLegResult(match, leg);
    if (!result && expired) result = 'void';
    if (result) { changed = true; nextLegs.push({ ...leg, result }); }
    else nextLegs.push(leg);
  }
  const status = computeSlipStatus(nextLegs);
  const stillPending = nextLegs.some((l) => l.result == null);
  if (changed || status !== data.status) {
    const update = { legs: nextLegs, status };
    if (!stillPending) update.settledAt = FieldValue.serverTimestamp();
    await ref.set(update, { merge: true });
    return { ...serializeSlip(doc), legs: nextLegs, status,
      settledAt: !stillPending ? new Date().toISOString() : (data.settledAt?.toDate?.()?.toISOString?.() || null) };
  }
  return serializeSlip(doc);
}

async function loadDraft(db, uid) {
  const snap = await slipsCollection(db, uid).doc(DRAFT_ID).get();
  const data = snap.exists ? snap.data() || {} : {};
  return { legs: data.legs || [], stake: data.stake ?? 10 };
}

// Newest-first, capped to `limit` (#1). Ordering by savedAt excludes the draft
// doc (no savedAt) automatically; we still filter by id defensively. Fetch one
// extra to report hasMore. Only the returned page is settled — older slips are
// frozen so they need no settlement work.
async function listSlips(db, uid, limit) {
  const snap = await slipsCollection(db, uid)
    .orderBy('savedAt', 'desc')
    .limit(limit + 1)
    .get();
  const docs = snap.docs.filter((d) => d.id !== DRAFT_ID);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const slips = await Promise.all(page.map((d) => settleSlip(db, d.ref, d)));
  return { slips, hasMore };
}

// Keep only the newest MAX_SAVED_SLIPS per user (#3); delete the oldest beyond it.
async function trimSavedSlips(db, uid) {
  const snap = await slipsCollection(db, uid).orderBy('savedAt', 'desc').get();
  const docs = snap.docs.filter((d) => d.id !== DRAFT_ID);
  if (docs.length <= MAX_SAVED_SLIPS) return;
  await Promise.all(docs.slice(MAX_SAVED_SLIPS).map((d) => d.ref.delete()));
}

async function payload(db, uid, limit) {
  const [draft, listed] = await Promise.all([loadDraft(db, uid), listSlips(db, uid, limit)]);
  return { draft, slips: listed.slips, hasMore: listed.hasMore };
}

function clampLimit(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_PAGE, n) : PAGE_SIZE;
}

export async function GET(request) {
  let user;
  try { user = await verifyAccess(request); }
  catch (err) { return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401); }
  const db = getFirestore(getAdminApp());
  const limit = clampLimit(request.nextUrl.searchParams.get('limit'));
  const cacheKey = `${user.uid}:${limit}`;
  const cached = slipsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return jsonResponse(cached.payload);
  const result = await payload(db, user.uid, limit);
  slipsCache.set(cacheKey, { payload: result, at: Date.now() });
  capMap(slipsCache, CACHE_MAX);
  return jsonResponse(result);
}

export async function POST(request) {
  let user;
  try { user = await verifyAccess(request); }
  catch (err) { return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401); }
  const db = getFirestore(getAdminApp());
  const body = await request.json().catch(() => ({}));
  const col = slipsCollection(db, user.uid);
  // Any write changes the slip set — drop the GET cache so the next read recomputes.
  slipsCache.clear();

  if (body.action === 'saveDraft') {
    const legs = sanitizeLegs(body.legs);
    await col.doc(DRAFT_ID).set({
      legs,
      stake: clampStake(body.stake),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return jsonResponse(await payload(db, user.uid, PAGE_SIZE));
  }

  if (body.action === 'saveSlip') {
    const legs = sanitizeLegs(body.legs);
    if (!legs.length) return jsonResponse({ error: 'empty-slip' }, 400);
    await col.add({
      legs,
      stake: clampStake(body.stake),
      combinedOdds: combinedOdds(legs),
      combinedProb: combinedProb(legs),
      status: 'pending',
      savedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
    await col.doc(DRAFT_ID).set({ legs: [], stake: 10, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await trimSavedSlips(db, user.uid);
    return jsonResponse(await payload(db, user.uid, PAGE_SIZE));
  }

  if (body.action === 'deleteSlip') {
    const slipId = String(body.slipId || '');
    if (!slipId || slipId === DRAFT_ID) return jsonResponse({ error: 'invalid-slip' }, 400);
    await col.doc(slipId).delete();
    return jsonResponse(await payload(db, user.uid, PAGE_SIZE));
  }

  return jsonResponse({ error: 'unknown-action' }, 400);
}
