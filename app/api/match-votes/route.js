import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ID = 'sports-predictions-f91fd';
const DASHBOARD_DOC = 'match_data';
const VOTE_COLLECTION = 'matchVotes';
const VOTE_CUTOFF_MINUTES = 5;
const OWNER_EMAIL = 'l.vorabouth@gmail.com';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');

let adminApp = null;

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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function verifyAccess(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('missing-token'), { status: 401 });

  const decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
  if (decoded.email === OWNER_EMAIL) return { uid: decoded.uid, email: decoded.email || '', allowed: true };

  const userSnap = await getFirestore(getAdminApp()).collection('users').doc(decoded.uid).get();
  const allowed = Boolean(
    userSnap.exists &&
      (userSnap.get('hasAccess') || userSnap.get('isPlatformOwner') || userSnap.get('manualAccess')),
  );
  if (!allowed) throw Object.assign(new Error('no-access'), { status: 403 });
  return { uid: decoded.uid, email: decoded.email || '', allowed };
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function matchVoteId(matchId) {
  return slugify(matchId, 'unknown-match');
}

function voteDocId(match) {
  return matchVoteId(match.id || `${match.date}-${match.home?.name}-${match.away?.name}`);
}

function marketLine(match, key, fallback) {
  const displayKey = key === 'goals' ? 'goals' : key;
  const market =
    match.display_markets?.[displayKey]?.market ||
    (key === 'goals' ? match.predictions?.ou_goals : key === 'cards' ? match.predictions?.ou_cards : key === 'corners' ? match.predictions?.ou_corners : null);
  return market?.line ?? fallback;
}

function voteOptionsForMatch(match) {
  const goalsLine = marketLine(match, 'goals', 2.5);
  const cardsLine = marketLine(match, 'cards', 4.5);
  const cornersLine = marketLine(match, 'corners', 10.5);
  return {
    winner: {
      label: 'Winner',
      options: [
        { value: 'home', label: match.home?.name || 'Home' },
        { value: 'draw', label: 'Draw' },
        { value: 'away', label: match.away?.name || 'Away' },
      ],
    },
    btts: {
      label: 'BTTS',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    goals: {
      label: 'Goals',
      options: [
        { value: 'over', label: `Over ${goalsLine}` },
        { value: 'under', label: `Under ${goalsLine}` },
      ],
    },
    cards: {
      label: 'Cards',
      options: [
        { value: 'over', label: `Over ${cardsLine}` },
        { value: 'under', label: `Under ${cardsLine}` },
      ],
    },
    corners: {
      label: 'Corners',
      options: [
        { value: 'over', label: `Over ${cornersLine}` },
        { value: 'under', label: `Under ${cornersLine}` },
      ],
    },
  };
}

function adelaideLocalToUtc(dateStr, timeStr) {
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

function voteLockState(match) {
  if (String(match.status || '').toLowerCase() !== 'upcoming') {
    return { locked: true, reason: 'Voting is closed because this match is not upcoming.', cutoffAt: null };
  }
  const kickoff = adelaideLocalToUtc(match.date, match.time);
  if (!kickoff) return { locked: true, reason: 'Voting is closed because kickoff time is unavailable.', cutoffAt: null };
  const cutoff = new Date(kickoff.getTime() - VOTE_CUTOFF_MINUTES * 60000);
  if (Date.now() >= cutoff.getTime()) {
    return {
      locked: true,
      reason: `Voting closes ${VOTE_CUTOFF_MINUTES} minutes before kickoff.`,
      cutoffAt: cutoff.toISOString(),
    };
  }
  return {
    locked: false,
    reason: `Voting closes ${VOTE_CUTOFF_MINUTES} minutes before kickoff.`,
    cutoffAt: cutoff.toISOString(),
  };
}

async function loadMatch(db, matchId, date) {
  const wantedId = String(matchId || '');
  if (!wantedId) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    const dateSnap = await db.collection('dashboardData').doc(DASHBOARD_DOC).collection('dates').doc(date).get();
    if (dateSnap.exists) {
      for (const league of dateSnap.data()?.leagues || []) {
        const match = (league.matches || []).find((item) => String(item.id || '') === wantedId);
        if (match) return { ...match, league: match.league || league.name, leagueId: league.id };
      }
    }
  }

  const leaguesSnap = await db.collection('dashboardData').doc(DASHBOARD_DOC).collection('leagues').orderBy('index', 'asc').get();
  for (const leagueDoc of leaguesSnap.docs) {
    const league = leagueDoc.data() || {};
    const match = (league.matches || []).find((item) => String(item.id || '') === wantedId);
    if (match) return { ...match, league: match.league || league.name, leagueId: league.id || leagueDoc.id };
  }
  return null;
}

async function buildVoteSummary(voteRef, optionsByMarket) {
  const snap = await voteRef.collection('votes').get();
  const markets = {};
  Object.entries(optionsByMarket).forEach(([key, config]) => {
    markets[key] = {
      label: config.label,
      total: 0,
      options: Object.fromEntries(config.options.map((option) => [option.value, { label: option.label, count: 0 }])),
    };
  });

  snap.docs.forEach((doc) => {
    const votes = doc.data()?.votes || {};
    Object.entries(votes).forEach(([marketKey, value]) => {
      if (!markets[marketKey]?.options?.[value]) return;
      markets[marketKey].options[value].count += 1;
      markets[marketKey].total += 1;
    });
  });

  return {
    totalUsers: snap.size,
    markets,
  };
}

async function responsePayload(db, user, match) {
  const optionsByMarket = voteOptionsForMatch(match);
  const voteRef = db.collection(VOTE_COLLECTION).doc(voteDocId(match));
  const [userVoteSnap, summary] = await Promise.all([
    voteRef.collection('votes').doc(user.uid).get(),
    buildVoteSummary(voteRef, optionsByMarket),
  ]);
  const lock = voteLockState(match);
  return {
    matchId: String(match.id || ''),
    locked: lock.locked,
    lockReason: lock.reason,
    cutoffAt: lock.cutoffAt,
    options: optionsByMarket,
    myVotes: userVoteSnap.exists ? userVoteSnap.data()?.votes || {} : {},
    summary,
  };
}

export async function GET(request) {
  let user;
  try {
    user = await verifyAccess(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  const db = getFirestore(getAdminApp());
  const matchId = request.nextUrl.searchParams.get('matchId');
  const date = request.nextUrl.searchParams.get('date');
  const match = await loadMatch(db, matchId, date);
  if (!match) return jsonResponse({ error: 'match-not-found' }, 404);

  return jsonResponse(await responsePayload(db, user, match));
}

export async function POST(request) {
  let user;
  try {
    user = await verifyAccess(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  const body = await request.json().catch(() => ({}));
  const db = getFirestore(getAdminApp());
  const match = await loadMatch(db, body.matchId, body.date);
  if (!match) return jsonResponse({ error: 'match-not-found' }, 404);

  const lock = voteLockState(match);
  if (lock.locked) return jsonResponse({ error: 'voting-closed', detail: lock.reason, cutoffAt: lock.cutoffAt }, 409);

  const optionsByMarket = voteOptionsForMatch(match);
  const market = String(body.market || '').trim();
  const option = String(body.option || '').trim();
  if (!optionsByMarket[market]) return jsonResponse({ error: 'invalid-market' }, 400);
  if (!optionsByMarket[market].options.some((item) => item.value === option)) {
    return jsonResponse({ error: 'invalid-option' }, 400);
  }

  const voteRef = db.collection(VOTE_COLLECTION).doc(voteDocId(match));
  const userVoteRef = voteRef.collection('votes').doc(user.uid);
  const currentSnap = await userVoteRef.get();
  const currentVotes = currentSnap.exists ? currentSnap.data()?.votes || {} : {};
  const nextVotes = { ...currentVotes, [market]: option };
  await userVoteRef.set({
    uid: user.uid,
    email: user.email || null,
    matchId: String(match.id || ''),
    date: match.date || null,
    league: match.league || null,
    home: match.home?.name || null,
    away: match.away?.name || null,
    votes: nextVotes,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const summary = await buildVoteSummary(voteRef, optionsByMarket);
  await voteRef.set({
    matchId: String(match.id || ''),
    date: match.date || null,
    league: match.league || null,
    home: match.home?.name || null,
    away: match.away?.name || null,
    cutoffAt: lock.cutoffAt,
    cutoffMinutes: VOTE_CUTOFF_MINUTES,
    summary,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return jsonResponse(await responsePayload(db, user, match));
}
