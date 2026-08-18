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

async function loadQuickBets() {
  const db = getFirestore(getAdminApp());
  const metaSnap = await db.collection('dashboardData').doc(QUICK_BETS_DOC).get();
  if (!metaSnap.exists) throw new Error('quick_bets metadata missing');

  const meta = metaSnap.data() || {};
  const dates = Array.isArray(meta.availableDates) ? meta.availableDates : [];
  const dateSnaps = await Promise.all(
    dates.map((date) => db.collection('dashboardData').doc(QUICK_BETS_DOC).collection('dates').doc(date).get()),
  );
  const matches = dateSnaps.flatMap((snap) => {
    if (!snap.exists) return [];
    const data = snap.data() || {};
    return Array.isArray(data.matches) ? data.matches : [];
  });

  return {
    ...meta,
    matches,
  };
}

export async function GET(request) {
  try {
    await verifyAccess(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  try {
    const cached = dataCache.get('current');
    if (cached && Date.now() - cached.at < DATA_CACHE_TTL_MS) {
      return jsonResponse(cached.payload);
    }

    const payload = await loadQuickBets();
    dataCache.set('current', { payload, at: Date.now() });
    capMap(dataCache, DATA_CACHE_MAX);
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ error: 'data-unavailable', detail: err.message }, 503);
  }
}
