import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './firebase';

const DASHBOARD_DOC = 'match_data';
const FAST_DASHBOARD_DOC = 'match_data_fast';
const MATCH_DATA_CACHE_KEY = 'matchDataCache_v1';

export function readMatchDataCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MATCH_DATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Array.isArray(parsed.data.leagues)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeMatchDataCache(data) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      MATCH_DATA_CACHE_KEY,
      JSON.stringify({ data, cachedAt: Date.now() }),
    );
  } catch {
    try {
      window.localStorage.removeItem(MATCH_DATA_CACHE_KEY);
    } catch {}
  }
}

let inflightMatchDataPromise = null;

export function loadMatchDataFromFirestore() {
  if (!inflightMatchDataPromise) {
    inflightMatchDataPromise = fetchMatchData().finally(() => {
      inflightMatchDataPromise = null;
    });
  }
  return inflightMatchDataPromise;
}

async function fetchMatchData() {
  try {
    const apiResult = await fetchMatchDataFromApi();
    if (apiResult) return apiResult;
  } catch {
    // fall through to direct Firestore SDK read
  }
  return fetchMatchDataFromFirestoreSdk();
}

async function fetchMatchDataFromApi() {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const response = await fetch('/api/match-data', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.leagues)) return null;
  writeMatchDataCache(payload);
  return payload;
}

async function fetchMatchDataFromFirestoreSdk() {
  const db = getFirebaseDb();
  const fastRef = doc(db, 'dashboardData', FAST_DASHBOARD_DOC);
  const fastSnap = await getDoc(fastRef);

  if (fastSnap.exists()) {
    const fast = fastSnap.data();
    if (fast.format === 'single_doc_v1' && Array.isArray(fast.leagues)) {
      const result = {
        captured_at: fast.capturedAt || null,
        source: fast.source || null,
        leagues: fast.leagues,
      };
      writeMatchDataCache(result);
      return result;
    }
  }

  const metaRef = doc(db, 'dashboardData', DASHBOARD_DOC);
  const metaSnap = await getDoc(metaRef);

  if (!metaSnap.exists()) {
    throw new Error('Firestore match data metadata not found');
  }

  const meta = metaSnap.data();

  if (meta.format === 'league_docs_v1') {
    const leaguesRef = collection(db, 'dashboardData', DASHBOARD_DOC, 'leagues');
    const leaguesSnap = await getDocs(query(leaguesRef, orderBy('index', 'asc')));
    const leagues = leaguesSnap.docs.map((leagueDoc) => {
      const league = leagueDoc.data();
      return {
        id: league.id,
        name: league.name,
        season: league.season || null,
        round: league.round ?? null,
        logo: league.logo || null,
        matches: Array.isArray(league.matches) ? league.matches : [],
      };
    });

    if (!leagues.length || leagues.length !== meta.leagueCount) {
      throw new Error('Firestore league match data is incomplete');
    }

    const result = {
      captured_at: meta.capturedAt || null,
      source: meta.source || null,
      leagues,
    };
    writeMatchDataCache(result);
    return result;
  }

  const chunksRef = collection(db, 'dashboardData', DASHBOARD_DOC, 'chunks');
  const chunksSnap = await getDocs(query(chunksRef, orderBy('index', 'asc')));
  const chunks = chunksSnap.docs.map((chunkDoc) => chunkDoc.data()?.text || '');

  if (!chunks.length || chunks.length !== meta.chunkCount) {
    throw new Error('Firestore match data chunks are incomplete');
  }

  const parsed = JSON.parse(chunks.join(''));
  if (parsed && Array.isArray(parsed.leagues)) writeMatchDataCache(parsed);
  return parsed;
}

export async function getUserProfile(uid) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;

  const data = snap.data();
  if (data.email === 'l.vorabouth@gmail.com') {
    data.isPlatformOwner = true;
    data.hasAccess = true;
    data.accessSource = 'owner';
  }
  return data;
}

export async function createUserProfile(user) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', user.uid);
  const isPlatformOwner = user.email === 'l.vorabouth@gmail.com';
  const newProfile = {
    email: user.email,
    displayName: user.displayName || '',
    nickname: '',
    favoriteTeams: [],
    isPlatformOwner: isPlatformOwner,
    manualAccess: false,
    inheritStripeStatus: true,
    subscriptionHasAccess: false,
    hasAccess: isPlatformOwner,
    accessSource: isPlatformOwner ? 'owner' : 'none',
    createdAt: new Date().toISOString()
  };
  await setDoc(userRef, newProfile);
  return newProfile;
}

export async function updateUserProfile(uid, profile) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', uid);
  const displayName = String(profile?.displayName || '').trim().slice(0, 80);
  const nickname = String(profile?.nickname || '').trim().slice(0, 40);
  const favoriteTeams = Array.isArray(profile?.favoriteTeams)
    ? [...new Set(profile.favoriteTeams.map((team) => String(team || '').trim()).filter(Boolean))].slice(0, 20)
    : [];

  await setDoc(userRef, {
    displayName,
    nickname,
    favoriteTeams,
    profileUpdatedAt: new Date().toISOString()
  }, { merge: true });

  return { displayName, nickname, favoriteTeams };
}

export async function updateUserFavoriteTeams(uid, favoriteTeams) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', uid);
  const cleanFavoriteTeams = Array.isArray(favoriteTeams)
    ? [...new Set(favoriteTeams.map((team) => String(team || '').trim()).filter(Boolean))].slice(0, 20)
    : [];

  await setDoc(userRef, {
    favoriteTeams: cleanFavoriteTeams,
    profileUpdatedAt: new Date().toISOString()
  }, { merge: true });

  return { favoriteTeams: cleanFavoriteTeams };
}

export async function getAllUsers() {
  const db = getFirebaseDb();
  const usersRef = collection(db, 'users');
  const snap = await getDocs(query(usersRef, orderBy('createdAt', 'desc')));
  return snap.docs.map(doc => {
    const data = doc.data();
    if (data.email === 'l.vorabouth@gmail.com') {
      data.isPlatformOwner = true;
      data.hasAccess = true;
      data.accessSource = 'owner';
    } else if (data.hasAccess && data.manualAccess == null && data.subscriptionHasAccess == null) {
      data.manualAccess = true;
      data.accessSource = data.accessSource || 'legacy_manual';
    }
    return { uid: doc.id, ...data };
  });
}

export async function updateUserManualAccess(uid, manualAccess) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', uid);
  const current = await getDoc(userRef);
  const data = current.exists() ? current.data() : {};
  const inheritStripeStatus = data.inheritStripeStatus !== false;
  const inheritsActiveStripe = inheritStripeStatus && data.subscriptionHasAccess;
  await updateDoc(userRef, {
    manualAccess,
    hasAccess: Boolean(manualAccess || inheritsActiveStripe || data.isPlatformOwner),
    accessSource: manualAccess ? 'manual' : inheritsActiveStripe ? 'stripe' : 'none',
    manualAccessUpdatedAt: new Date().toISOString()
  });
}

export async function updateUserStripeInheritance(uid, inheritStripeStatus) {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', uid);
  const current = await getDoc(userRef);
  const data = current.exists() ? current.data() : {};
  const inheritsActiveStripe = inheritStripeStatus && data.subscriptionHasAccess;
  const hasAccess = Boolean(data.manualAccess || inheritsActiveStripe || data.isPlatformOwner);

  await updateDoc(userRef, {
    inheritStripeStatus,
    hasAccess,
    accessSource: data.manualAccess ? 'manual' : inheritsActiveStripe ? 'stripe' : 'none',
    stripeInheritanceUpdatedAt: new Date().toISOString()
  });
}
