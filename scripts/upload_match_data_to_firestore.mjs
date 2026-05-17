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

  for (const ref of existingLeagues) {
    writer.delete(ref);
  }

  for (const ref of existingDates) {
    writer.delete(ref);
  }

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
    dateDocCount: dateBuckets.size,
    byteLength: Buffer.byteLength(raw),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const fastLeagues = leagues.map(slimLeague);
  writer.set(fastRef, firestoreSafe({
    format: 'single_doc_v1',
    capturedAt: parsed.captured_at || null,
    source: parsed.source || null,
    availableDates,
    leagueCount: fastLeagues.length,
    matchCount: fastLeagues.reduce((sum, league) => sum + league.matches.length, 0),
    byteLength: Buffer.byteLength(JSON.stringify({ leagues: fastLeagues })),
    leagues: fastLeagues,
    updatedAt: FieldValue.serverTimestamp(),
  }));

  await writer.close();
  console.log(`Uploaded ${dataPath} to Firestore dashboardData/${DOC_ID} as ${leagues.length} league docs and ${dateBuckets.size} date docs.`);
  console.log(`Uploaded fast dashboard doc dashboardData/${FAST_DOC_ID}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
