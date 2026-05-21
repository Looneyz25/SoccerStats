import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { precomputeDisplayData } from '../../../../scripts/precompute_display_markets.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ID = 'sports-predictions-f91fd';
const META_DOC_ID = 'match_data';
const FAST_DOC_ID = 'match_data_fast';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');
const OWNER_EMAIL = 'l.vorabouth@gmail.com';

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

async function verifyOwner(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('missing-token'), { status: 401 });

  const decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
  if (decoded.email === OWNER_EMAIL) return { uid: decoded.uid, email: decoded.email };

  const snap = await getFirestore(getAdminApp()).collection('users').doc(decoded.uid).get();
  if (!snap.exists || !snap.get('isPlatformOwner')) {
    throw Object.assign(new Error('platform-owner-required'), { status: 403 });
  }
  return { uid: decoded.uid, email: decoded.email || '' };
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function cleanKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dotMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return text;
}

function sidePair(value, homeKeys = ['home'], awayKeys = ['away']) {
  if (Array.isArray(value) && value.length >= 2) {
    const homeNumber = parseNumber(value[0]);
    const awayNumber = parseNumber(value[1]);
    return homeNumber === null || awayNumber === null ? null : { home: homeNumber, away: awayNumber };
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (match) return { home: Number(match[1]), away: Number(match[2]) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => [cleanKey(key), item]));
  const home = firstValue(...homeKeys.map((key) => normalized[cleanKey(key)]));
  const away = firstValue(...awayKeys.map((key) => normalized[cleanKey(key)]));
  const homeNumber = parseNumber(home);
  const awayNumber = parseNumber(away);
  return homeNumber === null || awayNumber === null ? null : { home: homeNumber, away: awayNumber };
}

function statPair(stats, ...keys) {
  for (const key of keys) {
    const value = stats[key] ?? stats[cleanKey(key)];
    const pair = sidePair(value);
    if (pair) return pair;
  }
  return null;
}

function parseScore(input) {
  const direct = sidePair(input?.score || input?.result || input?.fullTime || input?.ft || input, ['home', 'homeScore'], ['away', 'awayScore']);
  if (direct) return direct;

  const home = parseNumber(firstValue(input?.homeScore, input?.home?.score, input?.home?.goals, input?.scoreHome, input?.match?.homeScore));
  const away = parseNumber(firstValue(input?.awayScore, input?.away?.score, input?.away?.goals, input?.scoreAway, input?.match?.awayScore));
  if (home !== null && away !== null) return { home, away };

  const scoreText = firstValue(input?.score, input?.result, input?.fullTime, input?.ft);
  if (typeof scoreText === 'string') {
    const match = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (match) return { home: Number(match[1]), away: Number(match[2]) };
  }
  return null;
}

function normalizeFirstToScore(value, homeName, awayName) {
  const key = cleanKey(value);
  if (!key || key === 'none' || key === 'nogoal' || key === 'nogoa') return null;
  if (key === 'home' || key === 'h') return 'home';
  if (key === 'away' || key === 'a') return 'away';
  if (cleanKey(homeName) && key.includes(cleanKey(homeName))) return 'home';
  if (cleanKey(awayName) && key.includes(cleanKey(awayName))) return 'away';
  return null;
}

function normalizeImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Each import item must be a JSON object.');
  }

  const teams = raw.teams || raw.match || {};
  const homeName = String(firstValue(raw.home?.name, raw.homeTeam?.name, teams.home?.name, raw.match?.homeTeam, raw.home, raw.homeTeam, teams.home) || '').trim();
  const awayName = String(firstValue(raw.away?.name, raw.awayTeam?.name, teams.away?.name, raw.match?.awayTeam, raw.away, raw.awayTeam, teams.away) || '').trim();
  const score = parseScore(raw);
  const statsRaw = raw.stats || raw.statistics || raw.matchStats || raw.matchOverview || raw.overview || {};
  const stats = Object.fromEntries(Object.entries(statsRaw).map(([key, value]) => [cleanKey(key), value]));

  const corners = statPair(stats, 'corners', 'cornerKicks', 'corner kicks');
  const fouls = statPair(stats, 'fouls');
  const shotsOnTarget = statPair(stats, 'shotsOnTarget', 'shots on target', 'shotsOnGoal');
  const yellowCards = statPair(stats, 'yellowCards', 'yellow cards');
  const redCards = statPair(stats, 'redCards', 'red cards');
  const cards = statPair(stats, 'cards', 'totalCards', 'total cards');

  const actuals = { source: 'SofaScore manual import' };
  if (corners) Object.assign(actuals, { home_corners: corners.home, away_corners: corners.away, corners_total: corners.home + corners.away });
  if (fouls) Object.assign(actuals, { home_fouls: fouls.home, away_fouls: fouls.away, fouls_total: fouls.home + fouls.away });
  if (shotsOnTarget) Object.assign(actuals, { home_sot: shotsOnTarget.home, away_sot: shotsOnTarget.away });
  if (cards) {
    Object.assign(actuals, { home_cards: cards.home, away_cards: cards.away, cards_total: cards.home + cards.away });
  } else if (yellowCards || redCards) {
    const yellowHome = yellowCards?.home || 0;
    const yellowAway = yellowCards?.away || 0;
    const redHome = redCards?.home || 0;
    const redAway = redCards?.away || 0;
    Object.assign(actuals, {
      home_cards: yellowHome + redHome,
      away_cards: yellowAway + redAway,
      cards_total: yellowHome + yellowAway + redHome + redAway,
    });
  }

  const firstToScore = normalizeFirstToScore(
    firstValue(raw.firstToScore, raw.first_to_score, stats.firsttoscore, stats.firstgoal, stats.firstscorer),
    homeName,
    awayName,
  );
  if (firstToScore) actuals.first_to_score = firstToScore;

  const date = normalizeDate(firstValue(raw.date, raw.matchDate, raw.kickoffDate, raw.match?.date));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use date as YYYY-MM-DD.');
  if (!homeName || !awayName) throw new Error('Import needs home and away team names.');
  if (!score) throw new Error('Import needs a final score.');

  return {
    raw,
    matchId: String(firstValue(raw.id, raw.matchId, raw.eventId, raw.sofascoreId, raw.sofascore_id) || '').trim(),
    date,
    league: String(firstValue(raw.league, raw.competition, raw.tournament) || '').trim(),
    homeName,
    awayName,
    score,
    status: String(firstValue(raw.status, raw.time) || 'FT').trim().toUpperCase(),
    actuals,
  };
}

function importItemsFromPayload(payload) {
  const data = payload?.data ?? payload?.matches ?? payload?.results ?? payload;
  const items = Array.isArray(data) ? data : [data];
  return items.map(normalizeImport);
}

function matchScore(match, item) {
  if (item.matchId && String(match.id || '') === item.matchId) return 20;
  if (item.date && String(match.date || '') !== item.date) return 0;
  const home = cleanKey(match.home?.name || match.home?.short);
  const away = cleanKey(match.away?.name || match.away?.short);
  const wantedHome = cleanKey(item.homeName);
  const wantedAway = cleanKey(item.awayName);
  if (!home || !away || !wantedHome || !wantedAway) return 0;
  let score = 0;
  if (home === wantedHome) score += 5;
  else if (home.includes(wantedHome) || wantedHome.includes(home)) score += 3;
  if (away === wantedAway) score += 5;
  else if (away.includes(wantedAway) || wantedAway.includes(away)) score += 3;
  return score;
}

function settleTotalMarket(market, actual) {
  if (!market || actual === null || actual === undefined) return market;
  const line = Number(market.line);
  if (!Number.isFinite(line)) return market;
  const next = { ...market, actual };
  if (market.pick === 'Over') next.result = actual > line ? 'hit' : 'miss';
  if (market.pick === 'Under') next.result = actual < line ? 'hit' : 'miss';
  return next;
}

function applyResultToMatch(match, item, actor) {
  const homeGoals = item.score.home;
  const awayGoals = item.score.away;
  const actualWinner = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
  const predictions = { ...(match.predictions || {}) };

  if (predictions.winner) {
    predictions.winner = {
      ...predictions.winner,
      result: predictions.winner.type === actualWinner ? 'hit' : 'miss',
    };
  }
  if (predictions.btts) {
    const actualBtts = homeGoals > 0 && awayGoals > 0;
    predictions.btts = {
      ...predictions.btts,
      actual_btts: actualBtts,
      result: (String(predictions.btts.pick || '').toLowerCase() === 'yes') === actualBtts ? 'hit' : 'miss',
    };
  }
  predictions.ou_goals = settleTotalMarket(predictions.ou_goals, homeGoals + awayGoals);
  predictions.ou_cards = settleTotalMarket(predictions.ou_cards, item.actuals.cards_total);
  predictions.ou_corners = settleTotalMarket(predictions.ou_corners, item.actuals.corners_total);

  const importedAt = new Date().toISOString();
  return {
    ...match,
    status: 'FT',
    time: 'FT',
    home: { ...(match.home || {}), goals: homeGoals },
    away: { ...(match.away || {}), goals: awayGoals },
    actuals: { ...(match.actuals || {}), ...item.actuals },
    predictions,
    settled_at: importedAt.slice(0, 10),
    prediction_locked: true,
    prediction_locked_at: match.prediction_locked_at || importedAt,
    manual_result_import: {
      source: 'sofascore_mobile_screenshot_json',
      importedAt,
      importedBy: actor.uid,
      importedByEmail: actor.email || null,
    },
  };
}

function firestoreSafe(value) {
  if (Array.isArray(value)) return value.map(firestoreSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, firestoreSafe(item)]),
    );
  }
  return value;
}

function summarizeReviewRows(matches) {
  const configs = [
    { key: 'suggested', label: 'Suggested pick', getMarket: (match) => match.display_summary?.compactMarket?.market },
    { key: 'winner', label: 'Winner', getMarket: (match) => match.display_markets?.winner?.market || match.predictions?.winner },
    { key: 'btts', label: 'BTTS', getMarket: (match) => match.display_markets?.btts?.market || match.predictions?.btts },
    { key: 'goals', label: 'Goals', getMarket: (match) => match.display_markets?.goals?.market || match.predictions?.ou_goals },
    { key: 'cards', label: 'Cards', getMarket: (match) => match.display_markets?.cards?.market || match.predictions?.ou_cards },
    { key: 'corners', label: 'Corners', getMarket: (match) => match.display_markets?.corners?.market || match.predictions?.ou_corners },
  ];

  return configs.map((config) => {
    const settled = matches
      .map((match) => config.getMarket(match))
      .filter((market) => market?.result === 'hit' || market?.result === 'miss');
    const hits = settled.filter((market) => market.result === 'hit');
    const misses = settled.filter((market) => market.result === 'miss');
    const oddsHit = hits.reduce((sum, market) => sum + (Number(market.odds) || 0), 0);
    const oddsMiss = misses.reduce((sum, market) => sum + (Number(market.odds) || 0), 0);
    return {
      key: config.key,
      label: config.label,
      total: settled.length,
      hits: hits.length,
      misses: misses.length,
      hitRate: settled.length ? Math.round((hits.length / settled.length) * 100) : 0,
      oddsHit: Math.round(oddsHit * 10) / 10,
      oddsMiss: Math.round(oddsMiss * 10) / 10,
      net: Math.round((oddsHit - oddsMiss) * 10) / 10,
    };
  }).filter((row) => row.total > 0);
}

function weekStartMonday(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function summarizeReviewMarkets(matches) {
  const tracked = matches.filter((match) => match.status === 'FT' && String(match.date || '') >= '2026-04-22');
  const byDate = {};
  const byWeek = {};
  for (const match of tracked) {
    const date = String(match.date || '');
    if (!date) continue;
    (byDate[date] ||= []).push(match);
    const week = weekStartMonday(date);
    if (week) (byWeek[week] ||= []).push(match);
  }
  return {
    format: 'review_summary_v1',
    all: summarizeReviewRows(tracked),
    byDate: Object.fromEntries(Object.entries(byDate).map(([date, rows]) => [date, summarizeReviewRows(rows)])),
    byWeek: Object.fromEntries(Object.entries(byWeek).map(([week, rows]) => [week, summarizeReviewRows(rows)])),
  };
}

function summarizeAllTime(leagues) {
  const matches = leagues.flatMap((league) => Array.isArray(league.matches) ? league.matches : []);
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
    review: summarizeReviewMarkets(matches),
  };
}

function adelaideTodayIso() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isoMinusDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day - days));
  return d.toISOString().slice(0, 10);
}

function buildFastLeagues(leagues, cutoffIso) {
  return leagues
    .map((league) => ({
      ...league,
      matches: (Array.isArray(league.matches) ? league.matches : []).filter((match) => match.status !== 'FT' || String(match.date || '') >= cutoffIso),
    }))
    .filter((league) => league.matches.length > 0);
}

function selectFastLeagues(leagues) {
  const today = adelaideTodayIso();
  for (const days of [14, 7, 3, 1]) {
    const cutoff = isoMinusDays(today, days);
    const fastLeagues = buildFastLeagues(leagues, cutoff);
    const byteLength = Buffer.byteLength(JSON.stringify({ leagues: fastLeagues }));
    if (byteLength <= 900_000) return { fastLeagues, cutoff, byteLength, days };
  }
  const fastLeagues = buildFastLeagues(leagues, today)
    .map((league) => ({ ...league, matches: league.matches.filter((match) => match.status !== 'FT') }))
    .filter((league) => league.matches.length > 0);
  return { fastLeagues, cutoff: today, byteLength: Buffer.byteLength(JSON.stringify({ leagues: fastLeagues })), days: 0 };
}

async function loadLeagueDocs(db) {
  const snap = await db.collection('dashboardData').doc(META_DOC_ID).collection('leagues').orderBy('index', 'asc').get();
  return snap.docs.map((doc, index) => {
    const data = doc.data() || {};
    return {
      docId: doc.id,
      index: data.index ?? index,
      id: data.id ?? doc.id,
      name: data.name || doc.id,
      season: data.season ?? null,
      round: data.round ?? null,
      logo: data.logo || null,
      matches: Array.isArray(data.matches) ? data.matches : [],
    };
  });
}

function findImportTarget(leagues, item) {
  const leagueNeedle = cleanKey(item.league);
  let best = null;
  leagues.forEach((league, leagueIndex) => {
    const leagueMatches = !leagueNeedle || cleanKey(league.name) === leagueNeedle || cleanKey(league.id) === leagueNeedle;
    league.matches.forEach((match, matchIndex) => {
      const score = matchScore(match, item) + (leagueMatches ? 2 : 0);
      if (score >= 8 && (!best || score > best.score)) {
        best = { leagueIndex, matchIndex, score, leagueName: league.name, match };
      }
    });
  });
  return best;
}

function buildDateBuckets(leagues) {
  const dateBuckets = new Map();
  leagues.forEach((league) => {
    (Array.isArray(league.matches) ? league.matches : []).forEach((match) => {
      const date = match.date || 'unknown';
      if (!dateBuckets.has(date)) dateBuckets.set(date, new Map());
      const byLeague = dateBuckets.get(date);
      const leagueId = league.id ?? league.docId;
      if (!byLeague.has(leagueId)) {
        byLeague.set(leagueId, {
          id: leagueId,
          name: league.name || leagueId,
          season: league.season || null,
          round: league.round ?? null,
          logo: league.logo || null,
          matches: [],
        });
      }
      byLeague.get(leagueId).matches.push(match);
    });
  });
  return dateBuckets;
}

export async function POST(request) {
  const startedAt = Date.now();
  let owner;
  try {
    owner = await verifyOwner(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  let imports;
  try {
    imports = importItemsFromPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: 'invalid-import-json', detail: err.message }, 400);
  }

  const db = getFirestore(getAdminApp());
  const leagueDocs = await loadLeagueDocs(db);
  const updated = [];
  const misses = [];
  const affectedLeagueIndexes = new Set();
  const affectedDates = new Set();

  for (const item of imports) {
    const target = findImportTarget(leagueDocs, item);
    if (!target) {
      misses.push({ date: item.date, league: item.league || null, home: item.homeName, away: item.awayName });
      continue;
    }
    const league = leagueDocs[target.leagueIndex];
    const nextMatch = applyResultToMatch(league.matches[target.matchIndex], item, owner);
    league.matches[target.matchIndex] = nextMatch;
    affectedLeagueIndexes.add(target.leagueIndex);
    affectedDates.add(nextMatch.date || item.date);
    updated.push({
      date: item.date,
      league: league.name,
      home: nextMatch.home?.name || item.homeName,
      away: nextMatch.away?.name || item.awayName,
      score: `${item.score.home}-${item.score.away}`,
    });
  }

  if (!updated.length) {
    return jsonResponse({ error: 'no-matching-firestore-match', missed: misses }, 404);
  }

  const baseData = {
    leagues: leagueDocs.map(({ docId, index, ...league }) => league),
  };
  const precomputed = precomputeDisplayData(baseData);
  const precomputedById = new Map(precomputed.leagues.map((league) => [String(league.id ?? league.name), league]));
  const nextLeagueDocs = leagueDocs.map((league) => ({
    ...league,
    ...(precomputedById.get(String(league.id ?? league.name)) || {}),
  }));

  const dateBuckets = buildDateBuckets(nextLeagueDocs);
  const availableDates = [...dateBuckets.keys()].filter((date) => date !== 'unknown').sort();
  const allTimeSummary = summarizeAllTime(nextLeagueDocs);
  const { fastLeagues, cutoff: fastCutoff, byteLength: fastByteLength, days: fastDays } = selectFastLeagues(nextLeagueDocs);
  const metaRef = db.collection('dashboardData').doc(META_DOC_ID);
  const writer = db.bulkWriter({
    throttling: {
      initialOpsPerSecond: 10,
      maxOpsPerSecond: 25,
    },
  });
  writer.onWriteError((error) => {
    const retryableCodes = new Set([4, 10, 13, 14]);
    if (retryableCodes.has(error.code) && error.failedAttempts < 5) return true;
    return false;
  });

  const changedLeagueDocs = nextLeagueDocs.filter((league, index) => affectedLeagueIndexes.has(index));
  for (const league of changedLeagueDocs) {
    writer.set(metaRef.collection('leagues').doc(league.docId), firestoreSafe({
      index: league.index,
      id: league.id ?? league.docId,
      name: league.name || league.docId,
      season: league.season || null,
      round: league.round ?? null,
      logo: league.logo || null,
      matchCount: Array.isArray(league.matches) ? league.matches.length : 0,
      matches: Array.isArray(league.matches) ? league.matches : [],
      updatedAt: FieldValue.serverTimestamp(),
    }), { merge: true });
  }

  for (const [date, leaguesByDate] of dateBuckets.entries()) {
    if (!affectedDates.has(date)) continue;
    const dateLeagues = [...leaguesByDate.values()];
    writer.set(metaRef.collection('dates').doc(slugify(date, 'unknown')), firestoreSafe({
      format: 'date_doc_v1',
      date,
      availableDates,
      leagueCount: dateLeagues.length,
      matchCount: dateLeagues.reduce((sum, league) => sum + league.matches.length, 0),
      leagues: dateLeagues,
      updatedAt: FieldValue.serverTimestamp(),
    }), { merge: true });
  }

  writer.set(metaRef, {
    format: 'league_docs_v1',
    leagueCount: nextLeagueDocs.length,
    matchCount: nextLeagueDocs.reduce((sum, league) => sum + (Array.isArray(league.matches) ? league.matches.length : 0), 0),
    availableDates,
    allTimeSummary,
    dateDocCount: dateBuckets.size,
    manualImportUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  writer.set(db.collection('dashboardData').doc(FAST_DOC_ID), firestoreSafe({
    format: 'single_doc_v1',
    availableDates,
    allTimeSummary,
    leagueCount: fastLeagues.length,
    matchCount: fastLeagues.reduce((sum, league) => sum + league.matches.length, 0),
    byteLength: fastByteLength,
    fastWindowDays: fastDays,
    fastWindowStart: fastCutoff,
    leagues: fastLeagues,
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true });

  await writer.close();

  return jsonResponse({
    ok: true,
    updated,
    missed: misses,
    durationMs: Date.now() - startedAt,
    writes: {
      leagues: changedLeagueDocs.length,
      dates: [...affectedDates].filter((date) => dateBuckets.has(date)).length,
      fast: 1,
      meta: 1,
    },
    format: {
      date: 'YYYY-MM-DD',
      league: 'League name as shown in dashboard',
      home: 'Home team',
      away: 'Away team',
      score: { home: 2, away: 1 },
      stats: {
        corners: { home: 4, away: 5 },
        fouls: { home: 12, away: 10 },
        shotsOnTarget: { home: 5, away: 3 },
        yellowCards: { home: 2, away: 1 },
        redCards: { home: 0, away: 0 },
        firstToScore: 'home',
      },
    },
  });
}
