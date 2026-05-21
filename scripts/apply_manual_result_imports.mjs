import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const DOC_ID = 'match_data';
const MANUAL_IMPORTS_COLLECTION = 'manualResultImports';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');

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

function credentialOptions() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return serviceAccountJson
    ? { projectId: PROJECT_ID, credential: cert(JSON.parse(serviceAccountJson)) }
    : { projectId: PROJECT_ID, credential: applicationDefault() };
}

function cleanKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function matchScore(match, item) {
  if (item.matchId && String(match.id || '') === String(item.matchId)) return 20;
  if (item.date && String(match.date || '') !== String(item.date)) return 0;
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

function findTarget(leagues, item) {
  const leagueNeedle = cleanKey(item.league);
  let best = null;
  leagues.forEach((league, leagueIndex) => {
    const leagueMatches = !leagueNeedle || cleanKey(league.name) === leagueNeedle || cleanKey(league.id) === leagueNeedle;
    (Array.isArray(league.matches) ? league.matches : []).forEach((match, matchIndex) => {
      const score = matchScore(match, item) + (leagueMatches ? 2 : 0);
      if (score >= 8 && (!best || score > best.score)) best = { leagueIndex, matchIndex, score };
    });
  });
  return best;
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

function applyResult(match, item) {
  const homeGoals = Number(item.score?.home);
  const awayGoals = Number(item.score?.away);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return match;
  const actuals = item.actuals || {};
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
  predictions.ou_cards = settleTotalMarket(predictions.ou_cards, actuals.cards_total);
  predictions.ou_corners = settleTotalMarket(predictions.ou_corners, actuals.corners_total);

  const importedAt = item.importedAt || new Date().toISOString();
  return {
    ...match,
    status: 'FT',
    time: 'FT',
    home: { ...(match.home || {}), goals: homeGoals },
    away: { ...(match.away || {}), goals: awayGoals },
    actuals: { ...(match.actuals || {}), ...actuals },
    predictions,
    settled_at: String(item.date || match.date || importedAt).slice(0, 10),
    prediction_locked: true,
    prediction_locked_at: match.prediction_locked_at || importedAt,
    manual_result_import: {
      source: item.source || 'sofascore_mobile_screenshot_json',
      importedAt,
      importedBy: item.importedBy || null,
      importedByEmail: item.importedByEmail || null,
      reappliedByRoutine: true,
    },
  };
}

async function loadManualImports(db) {
  const snap = await db.collection('dashboardData').doc(DOC_ID).collection(MANUAL_IMPORTS_COLLECTION).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((item) => item.date && item.score && item.homeName && item.awayName);
}

async function main() {
  loadLocalCredentials();
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Manual result imports skipped: Firestore credentials missing.');
    return;
  }
  if (!getApps().length) initializeApp(credentialOptions());
  const db = getFirestore();
  const imports = await loadManualImports(db);
  if (!imports.length) {
    console.log('Manual result imports reapplied: 0/0');
    return;
  }

  const dataPath = path.join(ROOT, 'match_data.json');
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const leagues = Array.isArray(data.leagues) ? data.leagues : [];
  let applied = 0;
  const missed = [];

  for (const item of imports) {
    const target = findTarget(leagues, item);
    if (!target) {
      missed.push(`${item.date} ${item.league || ''} ${item.homeName} vs ${item.awayName}`.trim());
      continue;
    }
    const league = leagues[target.leagueIndex];
    league.matches[target.matchIndex] = applyResult(league.matches[target.matchIndex], item);
    applied += 1;
  }

  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Manual result imports reapplied to match_data.json: ${applied}/${imports.length}`);
  if (missed.length) console.warn(`Manual result imports missed: ${missed.join('; ')}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
