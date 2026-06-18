import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAdminApp, verifyAccess, loadMatch, capMap } from '../_lib/firebase-admin.mjs';
import { marketLine, marketActualResult, adelaideLocalToUtc } from '../_lib/match-scoring.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VOTE_COLLECTION = 'matchVotes';
const VOTE_CUTOFF_MINUTES = 5;

// Vote reads are expensive (collection-group scan + per-match lookups) and
// change only when someone votes/follows, so cache GET payloads briefly and
// clear them on any write. Leaderboard is per-user (personalised flags).
const LEADERBOARD_CACHE_TTL_MS = 30 * 1000;
const MATCH_VOTE_CACHE_TTL_MS = 20 * 1000;
const CACHE_MAX = 2000; // bound the in-memory caches (#5)
const leaderboardCache = new Map();
const matchVoteCache = new Map();

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
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

async function buildVoteSummary(voteRef, optionsByMarket) {
  const snap = await voteRef.collection('votes').get();
  return buildVoteSummaryFromDocs(snap.docs, optionsByMarket);
}

function voterLabel(data, fallbackUid = '') {
  const nickname = String(data?.nickname || '').trim();
  if (nickname) return nickname;
  return fallbackUid ? `Member ${String(fallbackUid).slice(0, 4)}` : 'Member';
}

async function userDirectory(db, voteDocs, currentUser) {
  const uids = [...new Set(voteDocs.map((doc) => String(doc.id || doc.data()?.uid || '')).filter(Boolean))];
  const refs = uids.map((uid) => db.collection('users').doc(uid));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const directory = new Map();
  snaps.forEach((snap) => {
    const uid = snap.id;
    const data = snap.exists ? snap.data() || {} : {};
    directory.set(uid, {
      uid,
      label: voterLabel(data, uid),
      isMe: uid === currentUser.uid,
    });
  });
  voteDocs.forEach((doc) => {
    const data = doc.data() || {};
    const uid = String(doc.id || data.uid || '');
    if (!uid || directory.has(uid)) return;
    directory.set(uid, {
      uid,
      label: voterLabel(data, uid),
      isMe: uid === currentUser.uid,
    });
  });
  if (currentUser?.uid && !directory.has(currentUser.uid)) {
    directory.set(currentUser.uid, {
      uid: currentUser.uid,
      label: voterLabel(currentUser, currentUser.uid),
      isMe: true,
    });
  }
  return directory;
}

function buildVoteSummaryFromDocs(voteDocs, optionsByMarket, directory = new Map(), currentUid = '') {
  const markets = {};
  Object.entries(optionsByMarket).forEach(([key, config]) => {
    markets[key] = {
      label: config.label,
      total: 0,
      options: Object.fromEntries(config.options.map((option) => [option.value, { label: option.label, count: 0, voters: [] }])),
    };
  });

  voteDocs.forEach((doc) => {
    const data = doc.data() || {};
    const uid = String(doc.id || data.uid || '');
    const voter = directory.get(uid) || { uid, label: voterLabel(data, uid), isMe: uid === currentUid };
    const votes = data.votes || {};
    Object.entries(votes).forEach(([marketKey, value]) => {
      if (!markets[marketKey]?.options?.[value]) return;
      markets[marketKey].options[value].count += 1;
      markets[marketKey].total += 1;
      markets[marketKey].options[value].voters.push({
        label: voter.label,
        isMe: voter.isMe,
      });
    });
  });

  return {
    totalUsers: voteDocs.length,
    markets,
  };
}

function votePickMatchFields(match) {
  if (!match) return {};
  return {
    bookmaker_links: match.bookmaker_links || null,
    bookmaker_urls: match.bookmaker_urls || null,
    sportsbet_odds: match.sportsbet_odds || null,
    ladbrokes_odds: match.ladbrokes_odds || null,
    neds_odds: match.neds_odds || null,
  };
}

function voteParentId(doc) {
  return String(doc.ref.parent.parent?.id || '');
}

function labelFromVoteSummary(parentData, marketKey, value) {
  const market = parentData?.summary?.markets?.[marketKey];
  const option = market?.options?.[value];
  return {
    marketLabel: market?.label || marketKey.toUpperCase(),
    optionLabel: option?.label || String(value || '').replace(/^\w/, (letter) => letter.toUpperCase()),
  };
}

async function leaderboardPayload(db, user) {
  const [voteSnap, voteParentsSnap, followingSnap, followersSnap] = await Promise.all([
    db.collectionGroup('votes').get(),
    db.collection(VOTE_COLLECTION).get(),
    db.collection('users').doc(user.uid).collection('following').get(),
    db.collection('users').doc(user.uid).collection('followers').get(),
  ]);
  const voteParents = new Map(voteParentsSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const following = new Map(followingSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const followingUids = new Set(following.keys());
  const followerProfileSnaps = followersSnap.size
    ? await db.getAll(...followersSnap.docs.map((doc) => db.collection('users').doc(doc.id)))
    : [];
  const followerProfileByUid = new Map(
    followerProfileSnaps.map((snap) => [snap.id, snap.exists ? snap.data() || {} : {}]),
  );
  const myFollowers = followersSnap.docs
    .map((doc) => {
      const data = doc.data() || {};
      const uid = doc.id;
      const live = followerProfileByUid.get(uid) || {};
      // Show only the chosen nickname (current, else the snapshot), else an
      // anonymised handle. Never expose email or real name (PII).
      const niceName = String(live.nickname || data.nickname || '').trim();
      return {
        uid,
        label: voterLabel({ nickname: niceName }, uid),
        isFollowing: followingUids.has(uid),
        followedAt: data.followedAt?.toDate?.()?.toISOString?.() || data.followedAt || '',
      };
    })
    .sort((a, b) => String(b.followedAt || '').localeCompare(String(a.followedAt || '')) || a.label.localeCompare(b.label));
  const voteDocs = voteSnap.docs.filter((doc) => doc.ref.parent.parent?.parent?.id === VOTE_COLLECTION);
  const directory = await userDirectory(db, voteDocs, user);
  const matchLookup = new Map(await Promise.all(
    [...voteParents.entries()].map(async ([parentId, parentData]) => [
      parentId,
      await loadMatch(db, parentData.matchId || parentId, parentData.date),
    ]),
  ));
  const rows = new Map();
  const popularPickRows = new Map();
  const followingPickRows = [];
  const myPickRows = [];
  let totalMarketVotes = 0;
  let settledMarketVotes = 0;

  voteDocs.forEach((doc) => {
    const data = doc.data() || {};
    const uid = String(doc.id || data.uid || '');
    const voter = directory.get(uid) || { uid, label: voterLabel(data, uid), isMe: uid === user.uid };
    const row = rows.get(uid) || {
      uid,
      label: voter.label,
      isMe: voter.isMe,
      matchesVoted: 0,
      votes: 0,
      settled: 0,
      hits: 0,
      lastVoteAt: '',
    };
    row.matchesVoted += 1;
    const parentId = voteParentId(doc);
    const parentData = voteParents.get(parentId) || {};
    const liveMatch = matchLookup.get(parentId);
    const pickMatchFields = votePickMatchFields(liveMatch || parentData);
    const myPickMarkets = [];
    Object.entries(data.votes || {}).forEach(([marketKey, value]) => {
      row.votes += 1;
      totalMarketVotes += 1;
      const { marketLabel, optionLabel } = labelFromVoteSummary(parentData, marketKey, value);
      const matchId = String(data.matchId || parentData.matchId || parentId);
      const actualResult = marketActualResult(matchLookup.get(parentId), marketKey, value);
      if (actualResult !== null) {
        row.settled += 1;
        settledMarketVotes += 1;
        if (actualResult) row.hits += 1;
      }
      const popularKey = `${matchId}:${marketKey}:${value}`;
      const popularRow = popularPickRows.get(popularKey) || {
        matchId,
        date: data.date || parentData.date || null,
        time: parentData.time || null,
        league: data.league || parentData.league || null,
        home: data.home || parentData.home || 'Home',
        away: data.away || parentData.away || 'Away',
        ...pickMatchFields,
        market: marketKey,
        marketLabel,
        option: value,
        optionLabel,
        count: 0,
        voters: [],
        result: actualResult === null ? null : actualResult ? 'hit' : 'miss',
      };
      if (popularRow.result === null && actualResult !== null) {
        popularRow.result = actualResult ? 'hit' : 'miss';
      }
      popularRow.count += 1;
      popularRow.voters.push({
        label: voter.isMe ? 'You' : voter.label,
        isMe: voter.isMe,
      });
      popularPickRows.set(popularKey, popularRow);
      if (followingUids.has(uid)) {
        followingPickRows.push({
          matchId,
          date: data.date || parentData.date || null,
          time: parentData.time || null,
          league: data.league || parentData.league || null,
          home: data.home || parentData.home || 'Home',
          away: data.away || parentData.away || 'Away',
          ...pickMatchFields,
          market: marketKey,
          marketLabel,
          option: value,
          optionLabel,
          count: 1,
          voters: [{ label: voter.label, isMe: false }],
          result: actualResult === null ? null : actualResult ? 'hit' : 'miss',
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || '',
        });
      }
      if (uid === user.uid) {
        myPickMarkets.push({
          market: marketKey,
          marketLabel,
          option: value,
          optionLabel,
        });
      }
    });
    const updatedAt = data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || '';
    if (updatedAt && (!row.lastVoteAt || updatedAt > row.lastVoteAt)) row.lastVoteAt = updatedAt;
    rows.set(uid, row);
    if (uid === user.uid && myPickMarkets.length) {
      myPickRows.push({
        matchId: String(data.matchId || parentData.matchId || parentId),
        date: data.date || parentData.date || null,
        time: parentData.time || null,
        league: data.league || parentData.league || null,
        home: data.home || parentData.home || 'Home',
        away: data.away || parentData.away || 'Away',
        ...pickMatchFields,
        picks: myPickMarkets,
        updatedAt,
      });
    }
  });

  const sortedLeaders = [...rows.values()]
    .map((row) => ({
      uid: row.uid,
      label: row.label,
      isMe: row.isMe,
      isFollowing: followingUids.has(row.uid),
      matchesVoted: row.matchesVoted,
      votes: row.votes,
      settled: row.settled,
      hits: row.hits,
      hitRate: row.settled ? Math.round((row.hits / row.settled) * 100) : null,
      lastVoteAt: row.lastVoteAt,
    }))
    .sort((a, b) => (b.hits - a.hits) || (b.hitRate || 0) - (a.hitRate || 0) || b.votes - a.votes || a.label.localeCompare(b.label))
    .slice(0, 12);
  const followerCounts = await Promise.all(
    sortedLeaders.map(async (leader) => {
      const snap = await db.collection('users').doc(leader.uid).collection('followers').get();
      return [leader.uid, snap.size];
    }),
  );
  const followerCountByUid = new Map(followerCounts);
  const leaders = sortedLeaders.map((leader) => ({
    ...leader,
    followerCount: followerCountByUid.get(leader.uid) || 0,
  }));
  const popularPicks = [...popularPickRows.values()]
    .map((row) => ({
      ...row,
      voters: row.voters.slice(0, 6),
    }))
    .sort((a, b) => b.count - a.count || String(a.date || '').localeCompare(String(b.date || '')) || a.home.localeCompare(b.home))
    .slice(0, 5);
  const myPicks = myPickRows
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.date || '').localeCompare(String(b.date || '')))
    .slice(0, 5);
  const followingPicks = followingPickRows
    .sort((a, b) => Number(Boolean(a.result)) - Number(Boolean(b.result)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.date || '').localeCompare(String(b.date || '')))
    .slice(0, 10);

  return {
    totalVoters: rows.size,
    totalVotes: totalMarketVotes,
    settledVotes: settledMarketVotes,
    followingCount: following.size,
    followerCount: followersSnap.size,
    myFollowers,
    leaders,
    popularPicks,
    myPicks,
    followingPicks,
  };
}

async function setFollowState(db, user, targetUid, shouldFollow) {
  const cleanTargetUid = String(targetUid || '').trim();
  if (!cleanTargetUid) return jsonResponse({ error: 'missing-target' }, 400);
  if (cleanTargetUid === user.uid) return jsonResponse({ error: 'cannot-follow-self' }, 400);

  const targetSnap = await db.collection('users').doc(cleanTargetUid).get();
  if (!targetSnap.exists) return jsonResponse({ error: 'user-not-found' }, 404);
  const targetProfile = targetSnap.data() || {};
  const meRef = db.collection('users').doc(user.uid).collection('following').doc(cleanTargetUid);
  const targetRef = db.collection('users').doc(cleanTargetUid).collection('followers').doc(user.uid);

  if (!shouldFollow) {
    await Promise.all([meRef.delete(), targetRef.delete()]);
    return jsonResponse(await leaderboardPayload(db, user));
  }

  const now = FieldValue.serverTimestamp();
  await Promise.all([
    meRef.set({
      targetUid: cleanTargetUid,
      nickname: voterLabel(targetProfile, cleanTargetUid),
      followedAt: now,
    }, { merge: true }),
    targetRef.set({
      uid: user.uid,
      nickname: voterLabel(user, user.uid),
      followedAt: now,
    }, { merge: true }),
  ]);
  return jsonResponse(await leaderboardPayload(db, user));
}

async function responsePayload(db, user, match) {
  const optionsByMarket = voteOptionsForMatch(match);
  const voteRef = db.collection(VOTE_COLLECTION).doc(voteDocId(match));
  const [userVoteSnap, voteSnap] = await Promise.all([
    voteRef.collection('votes').doc(user.uid).get(),
    voteRef.collection('votes').get(),
  ]);
  const directory = await userDirectory(db, voteSnap.docs, user);
  const summary = buildVoteSummaryFromDocs(voteSnap.docs, optionsByMarket, directory, user.uid);
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
  if (request.nextUrl.searchParams.get('scope') === 'leaderboard') {
    const cached = leaderboardCache.get(user.uid);
    if (cached && Date.now() - cached.at < LEADERBOARD_CACHE_TTL_MS) {
      return jsonResponse(cached.payload);
    }
    const payload = await leaderboardPayload(db, user);
    leaderboardCache.set(user.uid, { payload, at: Date.now() });
    capMap(leaderboardCache, CACHE_MAX);
    return jsonResponse(payload);
  }

  const matchId = request.nextUrl.searchParams.get('matchId');
  const date = request.nextUrl.searchParams.get('date');
  const voteCacheKey = `${matchId || ''}:${date || ''}:${user.uid}`;
  const cachedVote = matchVoteCache.get(voteCacheKey);
  if (cachedVote && Date.now() - cachedVote.at < MATCH_VOTE_CACHE_TTL_MS) {
    return jsonResponse(cachedVote.payload);
  }
  const match = await loadMatch(db, matchId, date);
  if (!match) return jsonResponse({ error: 'match-not-found' }, 404);

  const votePayload = await responsePayload(db, user, match);
  matchVoteCache.set(voteCacheKey, { payload: votePayload, at: Date.now() });
  capMap(matchVoteCache, CACHE_MAX);
  return jsonResponse(votePayload);
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
  // Any write changes summaries/leaderboard for everyone — drop caches so the
  // next GET recomputes (the write itself returns freshly-computed data below).
  leaderboardCache.clear();
  matchVoteCache.clear();
  if (body.action === 'followUser') {
    return setFollowState(db, user, body.targetUid, true);
  }
  if (body.action === 'unfollowUser') {
    return setFollowState(db, user, body.targetUid, false);
  }

  if (!String(user.nickname || '').trim()) {
    return jsonResponse({ error: 'nickname-required', detail: 'Set a nickname in Settings before saving crowd votes.' }, 428);
  }

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
    nickname: user.nickname || null,
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
    ...votePickMatchFields(match),
    summary,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return jsonResponse(await responsePayload(db, user, match));
}
