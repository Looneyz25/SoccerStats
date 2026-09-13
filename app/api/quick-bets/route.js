import { resolveQuickBetDate } from '../../dashboard/quick-bets/quick-bets-utils.mjs';
import { getFirestore } from 'firebase-admin/firestore';
import { capMap, getAdminApp, verifyAccess } from '../_lib/firebase-admin.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUICK_BETS_DOC = 'quick_bets';
const DATA_CACHE_TTL_MS = 60 * 1000;
const DATA_CACHE_MAX = 50;
const dataCache = new Map();

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function loadQuickBets(date, lifecycle) {
  const db = getFirestore(getAdminApp());
  const metaSnap = await db.collection('dashboardData').doc(QUICK_BETS_DOC).get();
  if (!metaSnap.exists) throw new Error('quick_bets metadata missing');

  const meta = metaSnap.data() || {};
  const selectedDate = resolveQuickBetDate(meta, date, lifecycle);
  const dateSnap = (meta.availableDates || []).includes(selectedDate)
    ? await db.collection('dashboardData').doc(QUICK_BETS_DOC).collection('dates').doc(selectedDate).get() : null;
  if (dateSnap && !dateSnap.exists) throw new Error('Quick Bets date document missing');
  const matches = Array.isArray(dateSnap?.data()?.matches) ? dateSnap.data().matches : [];

  return {
    ...meta,
    selectedDate,
    matches,
  };
}

export async function GET(request) {
  try {
    await verifyAccess(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  const params = new URL(request.url).searchParams;
  const date = params.get('date') || '';
  const lifecycle = params.get('lifecycle') || 'upcoming';
  try {
    resolveQuickBetDate({}, date, lifecycle);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
  const cacheKey = `${lifecycle}:${date || 'default'}`;
  try {
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DATA_CACHE_TTL_MS) {
      return jsonResponse(cached.payload);
    }

    const payload = await loadQuickBets(date, lifecycle);
    dataCache.set(cacheKey, { payload, at: Date.now() });
    capMap(dataCache, DATA_CACHE_MAX);
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ error: 'data-unavailable', detail: err.message }, 503);
  }
}
