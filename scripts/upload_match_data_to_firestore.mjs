import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { precomputeDisplayData } from './precompute_display_markets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const DOC_ID = 'match_data';
const FAST_DOC_ID = 'match_data_fast';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function applyLocalEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadLocalCredentials() {
  applyLocalEnvFile(path.join(ROOT, '.env.local'));
  applyLocalEnvFile(path.join(ROOT, '.env'));

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_SERVICE_ACCOUNT_PATH;
  }
}

function slimMatch(match) {
  const keep = [
    'id',
    'date',
    'time',
    'status',
    'home',
    'away',
    'predictions',
    'odds',
    'sportsbet_odds',
    'bookmaker_links',
    'actuals',
    'corner_odds',
    'display_markets',
    'display_summary',
    'venue',
    'referee',
  ];
  return Object.fromEntries(
    keep
      .filter((key) => match[key] !== undefined && match[key] !== null)
      .map((key) => [key, match[key]]),
  );
}

function slimLeague(league, index) {
  const id = slugify(league.id || league.name, String(index).padStart(2, '0'));
  return {
    id: league.id ?? id,
    name: league.name || id,
    season: league.season || null,
    round: league.round ?? null,
    logo: league.logo || null,
    matches: Array.isArray(league.matches) ? league.matches.map(slimMatch) : [],
  };
}

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
    review: summarizeReviewMarkets(matches),
  };
}

function weekStartMonday(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayIndex = date.getUTCDay();
  const mondayOffset = (dayIndex + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
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

function adelaideTodayIso() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function isoMinusDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day - days));
  return d.toISOString().slice(0, 10);
}

function buildFastLeagues(leagues, cutoffIso) {
  return leagues
    .map((league, index) => {
      const id = slugify(league.id || league.name, String(index).padStart(2, '0'));
      const matches = (Array.isArray(league.matches) ? league.matches : [])
        .filter((match) => match.status !== 'FT' || String(match.date || '') >= cutoffIso)
        .map(slimMatch);
      return {
        id: league.id ?? id,
        name: league.name || id,
        season: league.season || null,
        round: league.round ?? null,
        logo: league.logo || null,
        matches,
      };
    })
    .filter((league) => league.matches.length > 0);
}

const FIRESTORE_DOC_SAFE_BYTES = 900_000;
const FAST_DOC_WINDOW_DAYS = [14, 7, 3, 1];

function selectFastLeagues(leagues) {
  const today = adelaideTodayIso();
  for (const days of FAST_DOC_WINDOW_DAYS) {
    const cutoff = isoMinusDays(today, days);
    const fastLeagues = buildFastLeagues(leagues, cutoff);
    const byteLength = Buffer.byteLength(JSON.stringify({ leagues: fastLeagues }));
    if (byteLength <= FIRESTORE_DOC_SAFE_BYTES) {
      return { fastLeagues, cutoff, byteLength, days };
    }
    console.warn(`Fast doc payload ${(byteLength / 1024).toFixed(1)} KB at ${days}d window, retrying with smaller window`);
  }
  // Fall back to upcoming-only if every finished window is too big.
  const fastLeagues = buildFastLeagues(leagues, today).map((league) => ({
    ...league,
    matches: league.matches.filter((match) => match.status !== 'FT'),
  })).filter((league) => league.matches.length > 0);
  const byteLength = Buffer.byteLength(JSON.stringify({ leagues: fastLeagues }));
  return { fastLeagues, cutoff: today, byteLength, days: 0 };
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

function credentialOptions() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    return {
      projectId: PROJECT_ID,
      credential: cert(JSON.parse(serviceAccountJson)),
    };
  }

  return {
    projectId: PROJECT_ID,
    credential: applicationDefault(),
  };
}

async function main() {
  loadLocalCredentials();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Firestore upload needs credentials.');
    console.error('Use one of these local admin credential options:');
    console.error(`1. Save the service account JSON at ${DEFAULT_SERVICE_ACCOUNT_PATH}`);
    console.error('2. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path in .env.local');
    console.error('3. Set FIREBASE_SERVICE_ACCOUNT_JSON to the service account JSON string in .env.local');
    process.exit(1);
  }

  const dataPath = path.join(ROOT, 'match_data.json');
  const raw = await readFile(dataPath, 'utf8');
  const parsed = precomputeDisplayData(JSON.parse(raw));
  const leagues = Array.isArray(parsed.leagues) ? parsed.leagues : [];
  const allTimeSummary = summarizeAllTime(leagues);

  if (!getApps().length) {
    initializeApp(credentialOptions());
  }

  const db = getFirestore();
  const metaRef = db.collection('dashboardData').doc(DOC_ID);
  const fastRef = db.collection('dashboardData').doc(FAST_DOC_ID);
  const chunksRef = metaRef.collection('chunks');
  const leaguesRef = metaRef.collection('leagues');
  const datesRef = metaRef.collection('dates');
  const existingChunks = await chunksRef.listDocuments();
  const existingLeagues = await leaguesRef.listDocuments();
  const existingDates = await datesRef.listDocuments();
  const writer = db.bulkWriter({
    throttling: {
      initialOpsPerSecond: 10,
      maxOpsPerSecond: 25,
    },
  });
  writer.onWriteError((error) => {
    const retryableCodes = new Set([4, 10, 13, 14]);
    if (retryableCodes.has(error.code) && error.failedAttempts < 5) {
      console.warn(`Retrying Firestore ${error.operationType} ${error.documentRef.path} after ${error.message}`);
      return true;
    }
    console.error(`Firestore ${error.operationType} failed for ${error.documentRef.path}: ${error.message}`);
    return false;
  });

  for (const ref of existingChunks) {
    writer.delete(ref);
  }

  const targetLeagueIds = new Set(leagues.map((league, index) => slugify(league.id || league.name, String(index).padStart(2, '0'))));
  leagues.forEach((league, index) => {
    const id = slugify(league.id || league.name, String(index).padStart(2, '0'));
    writer.set(leaguesRef.doc(id), firestoreSafe({
      index,
      id: league.id ?? id,
      name: league.name || id,
      season: league.season || null,
      round: league.round ?? null,
      logo: league.logo || null,
      matchCount: Array.isArray(league.matches) ? league.matches.length : 0,
      matches: Array.isArray(league.matches) ? league.matches : [],
      updatedAt: FieldValue.serverTimestamp(),
    }));
  });

  const dateBuckets = new Map();
  leagues.forEach((league, index) => {
    const leagueId = league.id ?? slugify(league.name, String(index).padStart(2, '0'));
    (Array.isArray(league.matches) ? league.matches : []).forEach((match) => {
      const date = match.date || 'unknown';
      if (!dateBuckets.has(date)) dateBuckets.set(date, new Map());
      const leaguesByDate = dateBuckets.get(date);
      if (!leaguesByDate.has(leagueId)) {
        leaguesByDate.set(leagueId, {
          id: leagueId,
          name: league.name || leagueId,
          season: league.season || null,
          round: league.round ?? null,
          logo: league.logo || null,
          matches: [],
        });
      }
      leaguesByDate.get(leagueId).matches.push(match);
    });
  });

  const targetDateIds = new Set([...dateBuckets.keys()].map((date) => slugify(date, 'unknown')));
  for (const ref of existingLeagues) {
    if (!targetLeagueIds.has(ref.id)) writer.delete(ref);
  }

  for (const ref of existingDates) {
    if (!targetDateIds.has(ref.id)) writer.delete(ref);
  }

  const availableDates = [...dateBuckets.keys()].filter((date) => date !== 'unknown').sort();
  for (const [date, leaguesByDate] of dateBuckets.entries()) {
    const dateLeagues = [...leaguesByDate.values()];
    writer.set(datesRef.doc(slugify(date, 'unknown')), firestoreSafe({
      format: 'date_doc_v1',
      date,
      capturedAt: parsed.captured_at || null,
      source: parsed.source || null,
      availableDates,
      leagueCount: dateLeagues.length,
      matchCount: dateLeagues.reduce((sum, league) => sum + league.matches.length, 0),
      leagues: dateLeagues,
      updatedAt: FieldValue.serverTimestamp(),
    }));
  }

  writer.set(metaRef, {
    format: 'league_docs_v1',
    capturedAt: parsed.captured_at || null,
    source: parsed.source || null,
    leagueCount: leagues.length,
    matchCount: leagues.reduce((sum, league) => sum + (Array.isArray(league.matches) ? league.matches.length : 0), 0),
    availableDates,
    allTimeSummary,
    dateDocCount: dateBuckets.size,
    byteLength: Buffer.byteLength(raw),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const { fastLeagues, cutoff: fastCutoff, byteLength: fastByteLength, days: fastDays } = selectFastLeagues(leagues);
  writer.set(fastRef, firestoreSafe({
    format: 'single_doc_v1',
    capturedAt: parsed.captured_at || null,
    source: parsed.source || null,
    availableDates,
    allTimeSummary,
    leagueCount: fastLeagues.length,
    matchCount: fastLeagues.reduce((sum, league) => sum + league.matches.length, 0),
    byteLength: fastByteLength,
    fastWindowDays: fastDays,
    fastWindowStart: fastCutoff,
    leagues: fastLeagues,
    updatedAt: FieldValue.serverTimestamp(),
  }));

  await writer.close();
  console.log(`Uploaded ${dataPath} to Firestore dashboardData/${DOC_ID} as ${leagues.length} league docs and ${dateBuckets.size} date docs.`);
  console.log(`Uploaded fast dashboard doc dashboardData/${FAST_DOC_ID} (${fastDays}-day window from ${fastCutoff}, ${(fastByteLength / 1024).toFixed(1)} KB).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
