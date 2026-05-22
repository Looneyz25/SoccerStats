import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const STORAGE_BUCKET = process.env.FIREBASE_BADGE_BUCKET || 'lvrstats-badges-sports-predictions-f91fd';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');
const DATA_FILES = ['match_data.json', `predictions_${new Date().toISOString().slice(0, 10)}.json`];
const FIREBASE_STORAGE_HOST = 'firebasestorage.googleapis.com';
const GOOGLE_STORAGE_HOST = 'storage.googleapis.com';
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || process.env.THESPORTSDB_API_KEY || '123';
const THESPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}`;

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
  'as roma': 'https://media.api-sports.io/football/teams/497.png',
  atalanta: 'https://media.api-sports.io/football/teams/499.png',
  arsenal: 'https://media.api-sports.io/football/teams/42.png',
  'aston villa': 'https://media.api-sports.io/football/teams/66.png',
  bologna: 'https://media.api-sports.io/football/teams/500.png',
  bournemouth: 'https://media.api-sports.io/football/teams/35.png',
  'afc bournemouth': 'https://media.api-sports.io/football/teams/35.png',
  brentford: 'https://media.api-sports.io/football/teams/55.png',
  brighton: 'https://media.api-sports.io/football/teams/51.png',
  'brighton & hove albion': 'https://media.api-sports.io/football/teams/51.png',
  burnley: 'https://media.api-sports.io/football/teams/44.png',
  cagliari: 'https://media.api-sports.io/football/teams/490.png',
  chelsea: 'https://media.api-sports.io/football/teams/49.png',
  como: 'https://media.api-sports.io/football/teams/895.png',
  cremonese: 'https://media.api-sports.io/football/teams/520.png',
  'crystal palace': 'https://media.api-sports.io/football/teams/52.png',
  everton: 'https://media.api-sports.io/football/teams/45.png',
  fiorentina: 'https://media.api-sports.io/football/teams/502.png',
  fulham: 'https://media.api-sports.io/football/teams/36.png',
  genoa: 'https://media.api-sports.io/football/teams/495.png',
  'hellas verona': 'https://media.api-sports.io/football/teams/504.png',
  'halmstad': 'https://r2.thesportsdb.com/images/media/team/badge/26hnaj1639778271.png/medium',
  halmstads: 'https://r2.thesportsdb.com/images/media/team/badge/26hnaj1639778271.png/medium',
  inter: 'https://media.api-sports.io/football/teams/505.png',
  'inter milan': 'https://media.api-sports.io/football/teams/505.png',
  'jef united chiba': 'https://r2.thesportsdb.com/images/media/team/badge/no15iq1590070851.png/medium',
  juventus: 'https://media.api-sports.io/football/teams/496.png',
  kalmar: 'https://r2.thesportsdb.com/images/media/team/badge/3tnu4i1688449562.png/medium',
  'kalmar ff': 'https://r2.thesportsdb.com/images/media/team/badge/3tnu4i1688449562.png/medium',
  lazio: 'https://media.api-sports.io/football/teams/487.png',
  leeds: 'https://media.api-sports.io/football/teams/63.png',
  'leeds united': 'https://media.api-sports.io/football/teams/63.png',
  lecce: 'https://media.api-sports.io/football/teams/867.png',
  liverpool: 'https://media.api-sports.io/football/teams/40.png',
  'liverpool fc': 'https://media.api-sports.io/football/teams/40.png',
  milan: 'https://media.api-sports.io/football/teams/489.png',
  'ac milan': 'https://media.api-sports.io/football/teams/489.png',
  'manchester city': 'https://media.api-sports.io/football/teams/50.png',
  'man city': 'https://media.api-sports.io/football/teams/50.png',
  'manchester united': 'https://media.api-sports.io/football/teams/33.png',
  'man united': 'https://media.api-sports.io/football/teams/33.png',
  napoli: 'https://media.api-sports.io/football/teams/492.png',
  newcastle: 'https://media.api-sports.io/football/teams/34.png',
  'newcastle united': 'https://media.api-sports.io/football/teams/34.png',
  'nottingham forest': 'https://media.api-sports.io/football/teams/65.png',
  'nagoya grampus': 'https://r2.thesportsdb.com/images/media/team/badge/a1ucr01706244426.png/medium',
  orgryte: 'https://r2.thesportsdb.com/images/media/team/badge/ssprqx1473540098.png/medium',
  parma: 'https://media.api-sports.io/football/teams/523.png',
  pisa: 'https://media.api-sports.io/football/teams/517.png',
  sassuolo: 'https://media.api-sports.io/football/teams/488.png',
  'sanfrecce hiroshima': 'https://r2.thesportsdb.com/images/media/team/badge/gsgkxj1590068965.png/medium',
  'ssc napoli': 'https://media.api-sports.io/football/teams/492.png',
  sunderland: 'https://media.api-sports.io/football/teams/746.png',
  torino: 'https://media.api-sports.io/football/teams/503.png',
  tottenham: 'https://media.api-sports.io/football/teams/47.png',
  'tottenham hotspur': 'https://media.api-sports.io/football/teams/47.png',
  udinese: 'https://media.api-sports.io/football/teams/494.png',
  'v-varen nagasaki': 'https://r2.thesportsdb.com/images/media/team/badge/m2heet1734627248.png/medium',
  'v varen nagasaki': 'https://r2.thesportsdb.com/images/media/team/badge/m2heet1734627248.png/medium',
  'vissel kobe': 'https://r2.thesportsdb.com/images/media/team/badge/2axjch1578239819.png/medium',
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

const THESPORTSDB_LEAGUES = {
  'A-League Men': 'Australian A-League',
  Allsvenskan: 'Swedish Allsvenskan',
  Bundesliga: 'German Bundesliga',
  Championship: 'English League Championship',
  'Championship, Promotion Playoffs': 'English League Championship',
  Eliteserien: 'Norwegian Eliteserien',
  Eredivisie: 'Dutch Eredivisie',
  'J1 League': 'Japanese J1 League',
  LaLiga: 'Spanish La Liga',
  'League One': 'English League One',
  'League Two': 'English League Two',
  'Ligue 1': 'French Ligue 1',
  MLS: 'American Major League Soccer',
  'Premier League': 'English Premier League',
  'Primeira Liga': 'Portuguese Primeira Liga',
  'Scottish Premiership': 'Scottish Premier League',
  'Serie A': 'Italian Serie A',
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

function sourceKeysForTeamName(value) {
  const text = sourceKey(value);
  if (!text) return [];
  const keys = new Set([text]);
  keys.add(text.replace(/\bfc\b/g, '').replace(/\s+/g, ' ').trim());
  keys.add(text.replace(/\bafc\b/g, '').replace(/\s+/g, ' ').trim());
  keys.add(text.replace(/\bunited\b/g, 'utd').replace(/\s+/g, ' ').trim());
  keys.add(text.replace(/\butd\b/g, 'united').replace(/\s+/g, ' ').trim());
  keys.add(text.replace(/\bsc\b/g, '').replace(/\s+/g, ' ').trim());
  return [...keys].filter(Boolean);
}

function registryDocId(kind, entity, identityParts) {
  const name = entity?.name || entity?.league || entity?.short || identityParts.find(Boolean);
  return cleanKey([kind, name].filter(Boolean).join('-'));
}

function isFirebaseUrl(value) {
  const text = String(value || '');
  return text.includes(FIREBASE_STORAGE_HOST) || text.includes(`${GOOGLE_STORAGE_HOST}/${STORAGE_BUCKET}/`);
}

function isProviderUrl(value) {
  const text = String(value || '');
  return /^https?:\/\//i.test(text) && !isFirebaseUrl(text);
}

function rosterSourceForTeam(teamSources, leagueName, teamName) {
  const leagueMap = teamSources.byLeague.get(leagueName) || new Map();
  for (const key of sourceKeysForTeamName(teamName)) {
    if (leagueMap.has(key)) return leagueMap.get(key);
    if (teamSources.byName.has(key)) return teamSources.byName.get(key);
  }
  return '';
}

function sourceForEntity(kind, entity, teamSources, leagueName = '') {
  const explicit = entity?.badge_source_url || entity?.logo_url || entity?.logo || entity?.badge || entity?.crest;
  const name = sourceKey(entity?.name || entity?.league || entity?.short);
  if (kind === 'leagues') return LEAGUE_BADGE_SOURCES[entity?.name] || LEAGUE_BADGE_SOURCES[entity?.league] || (isProviderUrl(explicit) ? explicit : '');
  if (kind === 'teams') return TEAM_BADGE_SOURCES[name] || rosterSourceForTeam(teamSources, leagueName, entity?.name || entity?.short) || (isProviderUrl(explicit) ? explicit : '');
  return '';
}

async function fetchTheSportsDbLeagueTeams(leagueName) {
  const url = `${THESPORTSDB_BASE}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 LVRstats badge cache',
      accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`TheSportsDB ${leagueName} HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.teams) ? payload.teams : [];
}

async function loadTeamSources(leagues) {
  const byLeague = new Map();
  const byName = new Map();
  const leagueNames = [...new Set((leagues || []).map((league) => league?.name).filter(Boolean))];
  for (const localLeagueName of leagueNames) {
    const sportsDbLeague = THESPORTSDB_LEAGUES[localLeagueName];
    if (!sportsDbLeague) continue;
    try {
      const teams = await fetchTheSportsDbLeagueTeams(sportsDbLeague);
      const leagueMap = new Map();
      for (const team of teams) {
        const sourceUrl = team.strBadge || team.strTeamBadge || team.strLogo;
        if (!team.strTeam || !isProviderUrl(sourceUrl)) continue;
        for (const key of sourceKeysForTeamName(team.strTeam)) {
          leagueMap.set(key, sourceUrl);
          byName.set(key, sourceUrl);
        }
        for (const alias of String(team.strTeamAlternate || '').split(',')) {
          for (const key of sourceKeysForTeamName(alias)) {
            leagueMap.set(key, sourceUrl);
            byName.set(key, sourceUrl);
          }
        }
      }
      if (leagueMap.size) byLeague.set(localLeagueName, leagueMap);
    } catch (error) {
      console.warn(`TheSportsDB badge roster skipped for ${localLeagueName}: ${error.message}`);
    }
  }
  return { byLeague, byName };
}

function extensionFor(contentType, sourceUrl) {
  if (/svg/i.test(contentType)) return 'svg';
  if (/webp/i.test(contentType)) return 'webp';
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/png/i.test(contentType)) return 'png';
  const ext = path.extname(new URL(sourceUrl).pathname).replace('.', '').toLowerCase();
  return ext || 'png';
}

function managedStorageUrl(bucketName, storagePath) {
  return `https://storage.googleapis.com/${bucketName}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
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
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: {
        cacheId: randomUUID(),
        sourceUrl,
        sourceName: sourceName || '',
      },
    },
  });
  await file.makePublic();
  return {
    logo: managedStorageUrl(bucket.name, storagePath),
    badge_storage_path: storagePath,
    badge_source: sourceName || 'provider',
    badge_source_url: sourceUrl,
  };
}

async function applyRegistryBadge(db, registryCache, kind, entity, identityParts) {
  const docId = registryDocId(kind, entity, identityParts);
  if (!docId) return false;
  if (registryCache.has(docId)) {
    const data = registryCache.get(docId);
    if (!data) return false;
    entity.logo = data.logo;
    entity.badge_storage_path = data.storagePath || data.badge_storage_path || entity.badge_storage_path;
    entity.badge_source = data.source || data.badge_source || entity.badge_source || 'registry';
    entity.badge_source_url = data.sourceUrl || data.badge_source_url || entity.badge_source_url;
    delete entity.badge_cache_error;
    return true;
  }
  const snapshot = await db.collection('badgeRegistry').doc(docId).get();
  if (!snapshot.exists) {
    registryCache.set(docId, null);
    return false;
  }
  const data = snapshot.data() || {};
  const logo = data.logo || data.badge_download_url || data.badgeDownloadUrl;
  if (!isFirebaseUrl(logo)) {
    registryCache.set(docId, null);
    return false;
  }
  entity.logo = logo;
  entity.badge_storage_path = data.storagePath || data.badge_storage_path || entity.badge_storage_path;
  entity.badge_source = data.source || data.badge_source || entity.badge_source || 'registry';
  entity.badge_source_url = data.sourceUrl || data.badge_source_url || entity.badge_source_url;
  delete entity.badge_cache_error;
  registryCache.set(docId, {
    ...data,
    logo,
  });
  return true;
}

async function writeRegistryBadge(db, registryCache, kind, entity, identityParts) {
  const docId = registryDocId(kind, entity, identityParts);
  if (!docId || !isFirebaseUrl(entity?.logo)) return;
  const data = {
    kind,
    name: entity.name || entity.league || entity.short || identityParts.find(Boolean) || docId,
    logo: entity.logo,
    storagePath: entity.badge_storage_path || '',
    source: entity.badge_source || 'provider',
    sourceUrl: entity.badge_source_url || '',
    verified: true,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('badgeRegistry').doc(docId).set(data, { merge: true });
  registryCache.set(docId, data);
}

async function useCachedImage(bucket, entity) {
  const storagePath = entity?.badge_storage_path;
  if (!storagePath) return false;
  const file = bucket.file(storagePath);
  try {
    await file.makePublic();
    entity.logo = managedStorageUrl(bucket.name, storagePath);
    delete entity.badge_cache_error;
    return true;
  } catch {
    return false;
  }
}

async function cacheEntity(bucket, db, registryCache, teamSources, kind, entity, identityParts, sourceName, leagueName = '') {
  if (!entity || typeof entity !== 'object') return { cached: 0, skipped: 0, failed: 0 };
  if (entity.badge_storage_path && await useCachedImage(bucket, entity)) {
    await writeRegistryBadge(db, registryCache, kind, entity, identityParts);
    return { cached: 0, skipped: 1, failed: 0 };
  }
  if (await applyRegistryBadge(db, registryCache, kind, entity, identityParts)) return { cached: 0, skipped: 1, failed: 0 };
  const sourceUrl = sourceForEntity(kind, entity, teamSources, leagueName);
  if (!isProviderUrl(sourceUrl)) return { cached: 0, skipped: 1, failed: 0 };

  const identity = cleanKey(identityParts.filter(Boolean).join('-'));
  if (!identity) return { cached: 0, skipped: 1, failed: 0 };
  try {
    Object.assign(entity, await cacheImage(bucket, kind, identity, sourceUrl, entity.badge_source || sourceName));
    await writeRegistryBadge(db, registryCache, kind, entity, identityParts);
    delete entity.badge_cache_error;
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

async function processFile(bucket, db, registryCache, fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!existsSync(filePath)) return null;
  let data;
  try {
    data = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }

  const counts = { cached: 0, skipped: 0, failed: 0 };
  const teamSources = await loadTeamSources(data.leagues || []);
  for (const league of data.leagues || []) {
    addCounts(counts, await cacheEntity(bucket, db, registryCache, teamSources, 'leagues', league, [league.name || league.id], 'league', league.name));
    for (const match of league.matches || []) {
      addCounts(counts, await cacheEntity(bucket, db, registryCache, teamSources, 'teams', match.home, [match.home?.name || match.home?.team_id], match.home?.badge_source || 'thesportsdb', league.name));
      addCounts(counts, await cacheEntity(bucket, db, registryCache, teamSources, 'teams', match.away, [match.away?.name || match.away?.team_id], match.away?.badge_source || 'thesportsdb', league.name));
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
  const db = getFirestore();
  const registryCache = new Map();
  const results = [];
  for (const fileName of DATA_FILES) {
    const result = await processFile(bucket, db, registryCache, fileName);
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
