import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './firebase';

const DASHBOARD_DOC = 'match_data';
const FAST_DASHBOARD_DOC = 'match_data_fast';

export function readMatchDataCache(date = '') {
  return null;
}

const inflightMatchDataPromises = new Map();

export function loadMatchDataFromFirestore(date = '') {
  const key = date || 'all';
  if (!inflightMatchDataPromises.has(key)) {
    inflightMatchDataPromises.set(key, fetchMatchData(date).finally(() => {
      inflightMatchDataPromises.delete(key);
    }));
  }
  return inflightMatchDataPromises.get(key);
}

async function fetchMatchData(date = '') {
  try {
    const apiResult = await fetchMatchDataFromApi(date);
    if (apiResult) return apiResult;
  } catch {
    // fall through to direct Firestore SDK read
  }
  return fetchMatchDataFromFirestoreSdk(date);
}

async function fetchMatchDataFromApi(date = '') {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const url = date ? `/api/match-data?date=${encodeURIComponent(date)}` : '/api/match-data';
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.leagues)) return null;
  return payload;
}

async function fetchMatchDataFromFirestoreSdk(date = '') {
  const db = getFirebaseDb();
  let metaSummary = null;

  async function loadMetaSummary() {
    if (metaSummary) return metaSummary;
    const metaRef = doc(db, 'dashboardData', DASHBOARD_DOC);
    const metaSnap = await getDoc(metaRef);
    metaSummary = metaSnap.exists() ? metaSnap.data()?.allTimeSummary || null : null;
    return metaSummary;
  }

  if (date) {
    const dateRef = doc(db, 'dashboardData', DASHBOARD_DOC, 'dates', date);
    const dateSnap = await getDoc(dateRef);
    if (dateSnap.exists()) {
      const data = dateSnap.data();
      if (data.format === 'date_doc_v1' && Array.isArray(data.leagues)) {
        const result = {
          captured_at: data.capturedAt || null,
          source: data.source || null,
          date: data.date || date,
          availableDates: Array.isArray(data.availableDates) ? data.availableDates : [],
          allTimeSummary: data.allTimeSummary || await loadMetaSummary(),
          leagues: data.leagues,
        };
        return result;
      }
    }
  }

  const fastRef = doc(db, 'dashboardData', FAST_DASHBOARD_DOC);
  const fastSnap = await getDoc(fastRef);

  if (fastSnap.exists()) {
    const fast = fastSnap.data();
    if (fast.format === 'single_doc_v1' && Array.isArray(fast.leagues)) {
      const result = {
        captured_at: fast.capturedAt || null,
        source: fast.source || null,
        availableDates: Array.isArray(fast.availableDates) ? fast.availableDates : [],
        allTimeSummary: fast.allTimeSummary || null,
        leagues: fast.leagues,
      };
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
      availableDates: Array.isArray(meta.availableDates) ? meta.availableDates : [],
      allTimeSummary: meta.allTimeSummary || null,
      leagues,
    };
    return result;
  }

  const chunksRef = collection(db, 'dashboardData', DASHBOARD_DOC, 'chunks');
  const chunksSnap = await getDocs(query(chunksRef, orderBy('index', 'asc')));
  const chunks = chunksSnap.docs.map((chunkDoc) => chunkDoc.data()?.text || '');

  if (!chunks.length || chunks.length !== meta.chunkCount) {
    throw new Error('Firestore match data chunks are incomplete');
  }

  const parsed = JSON.parse(chunks.join(''));
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
