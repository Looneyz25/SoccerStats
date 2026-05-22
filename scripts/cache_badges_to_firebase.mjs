import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const STORAGE_BUCKET = 'sports-predictions-f91fd.firebasestorage.app';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');
const DATA_FILES = ['match_data.json', `predictions_${new Date().toISOString().slice(0, 10)}.json`];
const FIREBASE_STORAGE_HOST = 'firebasestorage.googleapis.com';

const LEAGUE_BADGE_SOURCES = {
  'Premier League': 'https://media.api-sports.io/football/leagues/39.png',
  Championship: 'https://media.api-sports.io/football/leagues/40.png',
  'Championship, Promotion Playoffs': 'https://media.api-sports.io/football/leagues/40.png',
  'League One': 'https://media.api-sports.io/football/leagues/41.png',
  'League Two': 'https://media.api-sports.io/football/leagues/42.png',
  LaLiga: 'https://media.api-sports.io/football/leagues/140.png',
  'Serie A': 'https://media.api-sports.io/football/leagues/135.png',
  Bundesliga: 'https://media.api-sports.io/football/leagues/78.png',
  'Ligue 1': 'https://media.api-sports.io/football/leagues/61.png',
  Eredivisie: 'https://media.api-sports.io/football/leagues/88.png',
  'Primeira Liga': 'https://media.api-sports.io/football/leagues/94.png',
  'UEFA Champions League': 'https://media.api-sports.io/football/leagues/2.png',
  'UEFA Europa League': 'https://media.api-sports.io/football/leagues/3.png',
  'UEFA Conference League': 'https://media.api-sports.io/football/leagues/848.png',
  MLS: 'https://media.api-sports.io/football/leagues/253.png',
  'A-League Men': 'https://media.api-sports.io/football/leagues/188.png',
  'Scottish Premiership': 'https://media.api-sports.io/football/leagues/179.png',
  'J1 League': 'https://media.api-sports.io/football/leagues/98.png',
  'Brasileirão Betano': 'https://media.api-sports.io/football/leagues/71.png',
  'CONMEBOL Libertadores': 'https://media.api-sports.io/football/leagues/13.png',
  'FIFA World Cup': 'https://media.api-sports.io/football/leagues/1.png',
  Allsvenskan: 'https://media.api-sports.io/football/leagues/113.png',
  Eliteserien: 'https://media.api-sports.io/football/leagues/103.png',
};

const TEAM_BADGE_SOURCES = {
  arsenal: 'https://media.api-sports.io/football/teams/42.png',
  'aston villa': 'https://media.api-sports.io/football/teams/66.png',
  bournemouth: 'https://media.api-sports.io/football/teams/35.png',
  'afc bournemouth': 'https://media.api-sports.io/football/teams/35.png',
  brentford: 'https://media.api-sports.io/football/teams/55.png',
  brighton: 'https://media.api-sports.io/football/teams/51.png',
  'brighton & hove albion': 'https://media.api-sports.io/football/teams/51.png',
  burnley: 'https://media.api-sports.io/football/teams/44.png',
  chelsea: 'https://media.api-sports.io/football/teams/49.png',
  'crystal palace': 'https://media.api-sports.io/football/teams/52.png',
  everton: 'https://media.api-sports.io/football/teams/45.png',
  fulham: 'https://media.api-sports.io/football/teams/36.png',
  leeds: 'https://media.api-sports.io/football/teams/63.png',
  'leeds united': 'https://media.api-sports.io/football/teams/63.png',
  liverpool: 'https://media.api-sports.io/football/teams/40.png',
  'liverpool fc': 'https://media.api-sports.io/football/teams/40.png',
  'manchester city': 'https://media.api-sports.io/football/teams/50.png',
  'man city': 'https://media.api-sports.io/football/teams/50.png',
  'manchester united': 'https://media.api-sports.io/football/teams/33.png',
  'man united': 'https://media.api-sports.io/football/teams/33.png',
  newcastle: 'https://media.api-sports.io/football/teams/34.png',
  'newcastle united': 'https://media.api-sports.io/football/teams/34.png',
  'nottingham forest': 'https://media.api-sports.io/football/teams/65.png',
  sunderland: 'https://media.api-sports.io/football/teams/746.png',
  tottenham: 'https://media.api-sports.io/football/teams/47.png',
  'tottenham hotspur': 'https://media.api-sports.io/football/teams/47.png',
  'west ham': 'https://media.api-sports.io/football/teams/48.png',
  'west ham united': 'https://media.api-sports.io/football/teams/48.png',
  wolves: 'https://media.api-sports.io/football/teams/39.png',
  wolverhampton: 'https://media.api-sports.io/football/teams/39.png',
  'wolverhampton wanderers': 'https://media.api-sports.io/football/teams/39.png',
  hull: 'https://media.api-sports.io/football/teams/64.png',
  'hull city': 'https://media.api-sports.io/football/teams/64.png',
  middlesbrough: 'https://media.api-sports.io/football/teams/70.png',
  'middlesbrough fc': 'https://media.api-sports.io/football/teams/70.png',
  southampton: 'https://media.api-sports.io/football/teams/41.png',
  'southampton fc': 'https://media.api-sports.io/football/teams/41.png',
};

function credentialOptions() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET, credential: applicationDefault() };
  }
  const raw = JSON.parse(readFileSync(DEFAULT_SERVICE_ACCOUNT_PATH, 'utf8'));
  return { projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET, credential: cert(raw) };
}

function cleanKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isFirebaseUrl(value) {
  return String(value || '').includes(FIREBASE_STORAGE_HOST);
}

function isProviderUrl(value) {
  const text = String(value || '');
  return /^https?:\/\//i.test(text) && !isFirebaseUrl(text);
}

function sourceForEntity(kind, entity) {
  const explicit = entity?.badge_source_url || entity?.logo_url || entity?.logo || entity?.badge || entity?.crest;
  if (isProviderUrl(explicit)) return explicit;
  const name = sourceKey(entity?.name || entity?.league || entity?.short);
  if (kind === 'leagues') return LEAGUE_BADGE_SOURCES[entity?.name] || LEAGUE_BADGE_SOURCES[entity?.league] || '';
  if (kind === 'teams') return TEAM_BADGE_SOURCES[name] || '';
  return '';
}

function extensionFor(contentType, sourceUrl) {
  if (/svg/i.test(contentType)) return 'svg';
  if (/webp/i.test(contentType)) return 'webp';
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/png/i.test(contentType)) return 'png';
  const ext = path.extname(new URL(sourceUrl).pathname).replace('.', '').toLowerCase();
  return ext || 'png';
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function fetchProviderImage(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 LVRstats badge cache',
      accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) throw new Error(`not image: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('empty image');
  return { buffer, contentType };
}

async function cacheImage(bucket, kind, identity, sourceUrl, sourceName) {
  const { buffer, contentType } = await fetchProviderImage(sourceUrl);
  const ext = extensionFor(contentType, sourceUrl);
  const storagePath = `badges/${kind}/${identity}.${ext}`;
  const token = randomUUID();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=2592000',
      metadata: {
        firebaseStorageDownloadTokens: token,
        sourceUrl,
        sourceName: sourceName || '',
      },
    },
  });
  return {
    logo: firebaseDownloadUrl(bucket.name, storagePath, token),
    badge_storage_path: storagePath,
    badge_source: sourceName || 'provider',
    badge_source_url: sourceUrl,
  };
}

async function cacheEntity(bucket, kind, entity, identityParts, sourceName) {
  if (!entity || typeof entity !== 'object') return { cached: 0, skipped: 0, failed: 0 };
  if (entity.badge_storage_path && isFirebaseUrl(entity.logo)) return { cached: 0, skipped: 1, failed: 0 };
  const sourceUrl = sourceForEntity(kind, entity);
  if (!isProviderUrl(sourceUrl)) return { cached: 0, skipped: 1, failed: 0 };

  const identity = cleanKey(identityParts.filter(Boolean).join('-'));
  if (!identity) return { cached: 0, skipped: 1, failed: 0 };
  try {
    Object.assign(entity, await cacheImage(bucket, kind, identity, sourceUrl, entity.badge_source || sourceName));
    return { cached: 1, skipped: 0, failed: 0 };
  } catch (error) {
    entity.logo = '';
    entity.badge_cache_error = error.message;
    return { cached: 0, skipped: 0, failed: 1 };
  }
}

function addCounts(total, next) {
  total.cached += next.cached;
  total.skipped += next.skipped;
  total.failed += next.failed;
}

async function processFile(bucket, fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!existsSync(filePath)) return null;
  let data;
  try {
    data = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }

  const counts = { cached: 0, skipped: 0, failed: 0 };
  for (const league of data.leagues || []) {
    addCounts(counts, await cacheEntity(bucket, 'leagues', league, [league.name || league.id], 'league'));
    for (const match of league.matches || []) {
      addCounts(counts, await cacheEntity(bucket, 'teams', match.home, [match.home?.name || match.home?.team_id], match.home?.badge_source || match.source));
      addCounts(counts, await cacheEntity(bucket, 'teams', match.away, [match.away?.name || match.away?.team_id], match.away?.badge_source || match.source));
    }
  }

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return { fileName, ...counts };
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Firebase badge cache needs credentials at ${DEFAULT_SERVICE_ACCOUNT_PATH}`);
  }
  if (!getApps().length) initializeApp(credentialOptions());
  const bucket = getStorage().bucket(STORAGE_BUCKET);
  const results = [];
  for (const fileName of DATA_FILES) {
    const result = await processFile(bucket, fileName);
    if (result) results.push(result);
  }
  results.forEach((result) => {
    console.log(`${result.fileName}: cached=${result.cached} skipped=${result.skipped} failed=${result.failed}`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
