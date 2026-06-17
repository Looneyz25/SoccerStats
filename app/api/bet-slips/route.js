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
  if (data.status && data.status !== 'pending') return serializeSlip(doc);
  const legs = data.legs || [];
  let changed = false;
  const nextLegs = [];
  for (const leg of legs) {
    if (leg.result != null) { nextLegs.push(leg); continue; }
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
  const snap = await slipsCollection(db, uid).get();
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
    await col.doc(DRAFT_ID).set({
      legs,
      stake: clampStake(body.stake),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return jsonResponse(await payload(db, user.uid));
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
