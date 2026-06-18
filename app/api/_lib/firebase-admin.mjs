// Shared Firebase Admin SDK helpers — app initialisation, access verification,
// and match loading from Firestore. No pure-scoring logic here (see match-scoring.mjs).

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

// Bound an insertion-ordered Map to `max` entries (FIFO eviction of oldest).
// Keeps the in-memory caches from growing without limit on a long-lived instance.
export function capMap(map, max) {
  if (map.size <= max) return;
  for (const key of map.keys()) {
    if (map.size <= max) break;
    map.delete(key);
  }
}

// Cache the access decision per uid for a short window so we don't re-read the
// user doc on every request. The ID token is STILL verified on every call
// (verifyIdToken below) — only the Firestore profile/access lookup is cached, so
// an expired/revoked token is always rejected; at most a recently-changed access
// flag is stale for ACCESS_CACHE_TTL_MS.
const ACCESS_CACHE_TTL_MS = 60 * 1000;
const ACCESS_CACHE_MAX = 5000;
const accessCache = new Map();

export function getAdminApp() {
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

export async function verifyAccess(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('missing-token'), { status: 401 });

  const decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);

  // Token is verified above on every call; the profile/access read is cached.
  const cached = accessCache.get(decoded.uid);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.user;

  const userSnap = await getFirestore(getAdminApp()).collection('users').doc(decoded.uid).get();
  const profile = userSnap.exists ? userSnap.data() || {} : {};
  let user;
  if (decoded.email === OWNER_EMAIL) {
    user = {
      uid: decoded.uid,
      email: decoded.email || '',
      displayName: profile.displayName || decoded.name || '',
      nickname: profile.nickname || '',
      allowed: true,
      isPlatformOwner: true,
    };
  } else {
    const allowed = Boolean(
      userSnap.exists &&
        (userSnap.get('hasAccess') || userSnap.get('isPlatformOwner') || userSnap.get('manualAccess')),
    );
    // Don't cache denials — a user who just gained access should not wait out the TTL.
    if (!allowed) throw Object.assign(new Error('no-access'), { status: 403 });
    user = {
      uid: decoded.uid,
      email: decoded.email || profile.email || '',
      displayName: profile.displayName || decoded.name || '',
      nickname: profile.nickname || '',
      allowed,
      isPlatformOwner: Boolean(profile.isPlatformOwner),
    };
  }
  accessCache.set(decoded.uid, { user, at: Date.now() });
  capMap(accessCache, ACCESS_CACHE_MAX);
  return user;
}

export async function loadMatch(db, matchId, date) {
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
