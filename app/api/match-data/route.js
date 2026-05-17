import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ID = 'sports-predictions-f91fd';
const FAST_DOC_PATH = ['dashboardData', 'match_data_fast'];
const META_DOC_PATH = ['dashboardData', 'match_data'];
const ACCESS_CACHE_TTL_MS = 60 * 1000;
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;

let adminApp = null;
let cachedData = null;
let cachedDataAt = 0;
let inflightData = null;
const cachedDateData = new Map();
const inflightDateData = new Map();
const accessCache = new Map();

function getAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault();
  adminApp = initializeApp({ projectId: PROJECT_ID, credential });
  return adminApp;
}

async function verifyAccess(idToken) {
  const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
  const uid = decoded.uid;
  const email = decoded.email || '';
  if (email === 'l.vorabouth@gmail.com') return { uid, allowed: true };

  const cached = accessCache.get(uid);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) {
    return { uid, allowed: cached.allowed };
  }

  const userSnap = await getFirestore(getAdminApp()).collection('users').doc(uid).get();
  const allowed = Boolean(
    userSnap.exists &&
      (userSnap.get('hasAccess') || userSnap.get('isPlatformOwner') || userSnap.get('manualAccess')),
  );
  accessCache.set(uid, { allowed, at: Date.now() });
  return { uid, allowed };
}

async function loadFastDoc() {
  const now = Date.now();
  if (cachedData && now - cachedDataAt < DATA_CACHE_TTL_MS) {
    return cachedData;
  }
  if (inflightData) return inflightData;

  inflightData = (async () => {
    const db = getFirestore(getAdminApp());
    const snap = await db.collection(FAST_DOC_PATH[0]).doc(FAST_DOC_PATH[1]).get();
    if (!snap.exists) throw new Error('match_data_fast missing');
    const fast = snap.data() || {};
    if (fast.format !== 'single_doc_v1' || !Array.isArray(fast.leagues)) {
      throw new Error('match_data_fast format unexpected');
    }
    const payload = {
      captured_at: fast.capturedAt || null,
      source: fast.source || null,
      availableDates: Array.isArray(fast.availableDates) ? fast.availableDates : [],
      leagues: fast.leagues,
    };
    cachedData = payload;
    cachedDataAt = Date.now();
    return payload;
  })().finally(() => {
    inflightData = null;
  });

  return inflightData;
}

async function loadDateDoc(date) {
  const safeDate = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return null;
  const now = Date.now();
  const cached = cachedDateData.get(safeDate);
  if (cached && now - cached.at < DATA_CACHE_TTL_MS) return cached.payload;
  if (inflightDateData.has(safeDate)) return inflightDateData.get(safeDate);

  const pending = (async () => {
    const db = getFirestore(getAdminApp());
    const snap = await db
      .collection(META_DOC_PATH[0])
      .doc(META_DOC_PATH[1])
      .collection('dates')
      .doc(safeDate)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data.format !== 'date_doc_v1' || !Array.isArray(data.leagues)) {
      throw new Error('date doc format unexpected');
    }
    const payload = {
      captured_at: data.capturedAt || null,
      source: data.source || null,
      date: data.date || safeDate,
      availableDates: Array.isArray(data.availableDates) ? data.availableDates : [],
      leagues: data.leagues,
    };
    cachedDateData.set(safeDate, { payload, at: Date.now() });
    return payload;
  })().finally(() => {
    inflightDateData.delete(safeDate);
  });

  inflightDateData.set(safeDate, pending);
  return pending;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return new Response(JSON.stringify({ error: 'missing-token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let access;
  try {
    access = await verifyAccess(match[1]);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid-token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!access.allowed) {
    return new Response(JSON.stringify({ error: 'no-access' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload;
  try {
    const requestedDate = request.nextUrl.searchParams.get('date');
    payload = requestedDate ? await loadDateDoc(requestedDate) : null;
    if (!payload) payload = await loadFastDoc();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'data-unavailable', detail: err.message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=600',
    },
  });
}
