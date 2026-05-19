import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');

let adminApp = null;
let cachedData = null;
let cachedDataAt = 0;
let inflightData = null;
const cachedDateData = new Map();
const inflightDateData = new Map();
const accessCache = new Map();
let cachedAllTimeSummary = null;
let cachedAllTimeSummaryAt = 0;
let inflightAllTimeSummary = null;
let cachedTeamOptions = null;
let cachedTeamOptionsAt = 0;
let inflightTeamOptions = null;

function summarizeAllTime(leagues) {
  const matches = (Array.isArray(leagues) ? leagues : []).flatMap((league) => Array.isArray(league.matches) ? league.matches : []);
  const markets = matches.flatMap((match) => Array.isArray(match.display_summary?.headlineMarkets) ? match.display_summary.headlineMarkets : []);
  const hits = markets.filter((market) => market?.result === 'hit').length;
  const oddsTotals = markets.reduce((totals, market) => {
    const odds = Number(market?.odds);
    if (!Number.isFinite(odds)) return totals;
    if (market.result === 'hit') totals.hit += odds;
    if (market.result === 'miss') totals.loss += odds;
    return totals;
  }, { hit: 0, loss: 0 });
  const finished = matches.filter((match) => match.status === 'FT').length;
  return {
    total: matches.length,
    finished,
    upcoming: matches.length - finished,
    settledMarkets: markets.length,
    marketHits: hits,
    marketMisses: markets.length - hits,
    accuracy: markets.length ? Math.round((hits / markets.length) * 100) : 0,
    oddsTotals: {
      hit: Math.round(oddsTotals.hit * 10) / 10,
      loss: Math.round(oddsTotals.loss * 10) / 10,
    },
  };
}

function getAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_SERVICE_ACCOUNT_PATH;
  }
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
    let allTimeSummary = fast.allTimeSummary || null;
    if (!allTimeSummary) {
      allTimeSummary = await loadAllTimeSummary();
    }
    const payload = {
      captured_at: fast.capturedAt || null,
      source: fast.source || null,
      availableDates: Array.isArray(fast.availableDates) ? fast.availableDates : [],
      allTimeSummary,
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

async function loadLeagueDocs() {
  const db = getFirestore(getAdminApp());
  const snap = await db
    .collection(META_DOC_PATH[0])
    .doc(META_DOC_PATH[1])
    .collection('leagues')
    .orderBy('index', 'asc')
    .get();
  return snap.docs.map((leagueDoc) => {
    const league = leagueDoc.data() || {};
    return {
      id: league.id,
      name: league.name,
      matches: Array.isArray(league.matches) ? league.matches : [],
    };
  });
}

function teamKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function loadTeamOptions() {
  const now = Date.now();
  if (cachedTeamOptions && now - cachedTeamOptionsAt < DATA_CACHE_TTL_MS) {
    return cachedTeamOptions;
  }
  if (inflightTeamOptions) return inflightTeamOptions;

  inflightTeamOptions = (async () => {
    const teams = new Map();
    const leagues = await loadLeagueDocs();
    leagues.forEach((league) => {
      (Array.isArray(league.matches) ? league.matches : []).forEach((match) => {
        [match.home?.name, match.away?.name].forEach((name) => {
          const key = teamKey(name);
          if (key && !teams.has(key)) teams.set(key, String(name).trim());
        });
      });
    });
    const options = [...teams.values()].sort((a, b) => a.localeCompare(b));
    cachedTeamOptions = options;
    cachedTeamOptionsAt = Date.now();
    return options;
  })().finally(() => {
    inflightTeamOptions = null;
  });

  return inflightTeamOptions;
}

async function loadAllTimeSummary() {
  const now = Date.now();
  if (cachedAllTimeSummary && now - cachedAllTimeSummaryAt < DATA_CACHE_TTL_MS) {
    return cachedAllTimeSummary;
  }
  if (inflightAllTimeSummary) return inflightAllTimeSummary;
  inflightAllTimeSummary = (async () => {
    const db = getFirestore(getAdminApp());
    const metaSnap = await db.collection(META_DOC_PATH[0]).doc(META_DOC_PATH[1]).get();
    const metaSummary = metaSnap.exists ? metaSnap.data()?.allTimeSummary : null;
    const summary = metaSummary || summarizeAllTime(await loadLeagueDocs());
    cachedAllTimeSummary = summary;
    cachedAllTimeSummaryAt = Date.now();
    return summary;
  })().finally(() => {
    inflightAllTimeSummary = null;
  });
  return inflightAllTimeSummary;
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
    let allTimeSummary = data.allTimeSummary || null;
    if (!allTimeSummary) {
      allTimeSummary = await loadAllTimeSummary();
    }
    const payload = {
      captured_at: data.capturedAt || null,
      source: data.source || null,
      date: data.date || safeDate,
      availableDates: Array.isArray(data.availableDates) ? data.availableDates : [],
      allTimeSummary,
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
    if (request.nextUrl.searchParams.get('teamOptions') === '1') {
      payload = { teamOptions: await loadTeamOptions() };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
        },
      });
    }

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
