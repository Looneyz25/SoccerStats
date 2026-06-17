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
  const userSnap = await getFirestore(getAdminApp()).collection('users').doc(decoded.uid).get();
  const profile = userSnap.exists ? userSnap.data() || {} : {};
  if (decoded.email === OWNER_EMAIL) {
    return {
      uid: decoded.uid,
      email: decoded.email || '',
      displayName: profile.displayName || decoded.name || '',
      nickname: profile.nickname || '',
      allowed: true,
      isPlatformOwner: true,
    };
  }
  const allowed = Boolean(
    userSnap.exists &&
      (userSnap.get('hasAccess') || userSnap.get('isPlatformOwner') || userSnap.get('manualAccess')),
  );
  if (!allowed) throw Object.assign(new Error('no-access'), { status: 403 });
  return {
    uid: decoded.uid,
    email: decoded.email || profile.email || '',
    displayName: profile.displayName || decoded.name || '',
    nickname: profile.nickname || '',
    allowed,
    isPlatformOwner: Boolean(profile.isPlatformOwner),
  };
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
