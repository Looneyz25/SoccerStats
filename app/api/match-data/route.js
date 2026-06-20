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
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');

let adminApp = null;
const accessCache = new Map();
// Slate payload is identical for every authorised user and only changes when
// the routine re-uploads (~every 15 min), so cache it briefly to skip Firestore
// reads on repeat requests. Keyed by date ('fast' for the default slate).
const DATA_CACHE_TTL_MS = 60 * 1000;
const dataCache = new Map();
const CACHE_MAX = 2000; // bound the in-memory caches (#5)

// Bound an insertion-ordered Map to `max` entries (FIFO eviction of oldest).
function capMap(map, max) {
  if (map.size <= max) return;
  for (const key of map.keys()) {
    if (map.size <= max) break;
    map.delete(key);
  }
}

function pricedMarketOdds(market) {
  if (market?.odds_estimated) return null;
  const odds = Number(market?.odds);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function marketReturnTotals(markets) {
  // Flat 1-unit stake P&L: a winner banks (odds - 1) profit, a loser forfeits
  // its 1-unit stake, so `hit - loss` is the true net return.
  return (markets || []).reduce((totals, market) => {
    const odds = pricedMarketOdds(market);
    if (!odds) return totals;
    if (market.result === 'hit') totals.hit += odds - 1;
    if (market.result === 'miss') totals.loss += 1;
    totals.priced += 1;
    return totals;
  }, { hit: 0, loss: 0, priced: 0 });
}

function summarizeAllTime(leagues) {
  const matches = (Array.isArray(leagues) ? leagues : []).flatMap((league) => Array.isArray(league.matches) ? league.matches : []);
  const markets = matches.flatMap((match) => Array.isArray(match.display_summary?.headlineMarkets) ? match.display_summary.headlineMarkets : []);
  const hits = markets.filter((market) => market?.result === 'hit').length;
  const oddsTotals = marketReturnTotals(markets);
  const finished = matches.filter((match) => match.status === 'FT').length;
  const upcoming = matches.filter((match) => match.status === 'upcoming').length;
  return {
    total: matches.length,
    finished,
    upcoming,
    settledMarkets: markets.length,
    marketHits: hits,
    marketMisses: markets.length - hits,
    accuracy: markets.length ? Math.round((hits / markets.length) * 100) : 0,
    oddsTotals: {
      hit: Math.round(oddsTotals.hit * 10) / 10,
      loss: Math.round(oddsTotals.loss * 10) / 10,
      priced: oddsTotals.priced,
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
  capMap(accessCache, CACHE_MAX);
  return { uid, allowed };
}

async function loadFastDoc() {
  const db = getFirestore(getAdminApp());
  const snap = await db.collection(FAST_DOC_PATH[0]).doc(FAST_DOC_PATH[1]).get();
  if (!snap.exists) throw new Error('match_data_fast missing');
  const fast = snap.data() || {};
  if (fast.format !== 'single_doc_v1' || !Array.isArray(fast.leagues)) {
    const fallback = await loadDefaultDateDoc();
    if (fallback) return fallback;
    throw new Error('match_data_fast format unexpected');
  }
  let allTimeSummary = fast.allTimeSummary || null;
  if (!allTimeSummary) {
    allTimeSummary = await loadAllTimeSummary();
  }
  return {
    captured_at: fast.capturedAt || null,
    source: fast.source || null,
    availableDates: Array.isArray(fast.availableDates) ? fast.availableDates : [],
    allTimeSummary,
    leagues: fast.leagues,
  };
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
  return [...teams.values()].sort((a, b) => a.localeCompare(b));
}

async function loadAllTimeSummary() {
  const db = getFirestore(getAdminApp());
  const metaSnap = await db.collection(META_DOC_PATH[0]).doc(META_DOC_PATH[1]).get();
  const metaSummary = metaSnap.exists ? metaSnap.data()?.allTimeSummary : null;
  return metaSummary || summarizeAllTime(await loadLeagueDocs());
}

function adelaideTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function loadDefaultDateDoc() {
  const db = getFirestore(getAdminApp());
  const metaSnap = await db.collection(META_DOC_PATH[0]).doc(META_DOC_PATH[1]).get();
  const availableDates = Array.isArray(metaSnap.data()?.availableDates) ? metaSnap.data().availableDates : [];
  const today = adelaideTodayIso();
  const candidates = [today, ...availableDates.slice().sort((a, b) => b.localeCompare(a))];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const payload = await loadDateDoc(candidate);
    if (payload) return payload;
  }
  return null;
}

async function loadDateDoc(date) {
  const safeDate = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return null;
  const db = getFirestore(getAdminApp());
  const snap = await db
    .collection(META_DOC_PATH[0])
    .doc(META_DOC_PATH[1])
    .collection('dates')
    .doc(safeDate)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if ((data.format && data.format !== 'date_doc_v1') || !Array.isArray(data.leagues)) return null;
  let allTimeSummary = data.allTimeSummary || null;
  if (!allTimeSummary) {
    allTimeSummary = await loadAllTimeSummary();
  }
  return {
    captured_at: data.capturedAt || data.generated_at || null,
    source: data.source || null,
    date: data.date || safeDate,
    availableDates: Array.isArray(data.availableDates) ? data.availableDates : [],
    allTimeSummary,
    leagues: data.leagues,
  };
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
          'Cache-Control': 'no-store',
        },
      });
    }

    const requestedDate = request.nextUrl.searchParams.get('date');
    const cacheKey = requestedDate || 'fast';
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DATA_CACHE_TTL_MS) {
      payload = cached.payload;
    } else {
      payload = requestedDate ? await loadDateDoc(requestedDate) : null;
      if (!payload) payload = await loadFastDoc();
      dataCache.set(cacheKey, { payload, at: Date.now() });
      capMap(dataCache, CACHE_MAX);
    }
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
      'Cache-Control': 'no-store',
    },
  });
}
