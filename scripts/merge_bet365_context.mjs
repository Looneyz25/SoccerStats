import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = path.join(ROOT, 'match_data.json');
const INPUT_CANDIDATES = [
  path.join(ROOT, 'docs', 'agent-system', 'inputs', 'bet365_context.json'),
  path.join(ROOT, 'docs', 'agent-system', 'inputs', 'statshub_context.json'),
  path.join(ROOT, 'docs', 'agent-system', 'outputs', 'bet365_context_latest.json'),
  path.join(ROOT, 'docs', 'agent-system', 'outputs', 'statshub_context_latest.json'),
];

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/utd/g, 'united')
    .replace(/fc/g, '');
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.events)) return payload.events;
  return [];
}

function eventIdCandidates(item) {
  return [
    item.event_id,
    item.id,
    item.match_id,
    item.sportsbet_event_id ? `sportsbet:${item.sportsbet_event_id}` : null,
    item.sofascore_id ? `sofascore:${item.sofascore_id}` : null,
  ]
    .filter(Boolean)
    .map(String);
}

function matchItem(match, item) {
  const eventIds = new Set(eventIdCandidates(item));
  if (eventIds.has(String(match.id || ''))) return true;
  const sportsbetId = match.sportsbet_odds?.event_id || match.bookmaker_event_id;
  if (sportsbetId && eventIds.has(`sportsbet:${sportsbetId}`)) return true;
  if (sportsbetId && eventIds.has(String(sportsbetId))) return true;

  const itemDate = item.date || item.kickoff_date || item.start_date;
  if (itemDate && match.date && String(itemDate).slice(0, 10) !== String(match.date)) return false;
  const itemLeague = normalize(item.league || item.tournament || item.competition);
  if (itemLeague && normalize(match.league_name || match.league || '') && itemLeague !== normalize(match.league_name || match.league || '')) {
    return false;
  }

  const home = item.home || item.home_team || item.homeName;
  const away = item.away || item.away_team || item.awayName;
  return normalize(home) === normalize(match.home?.name) && normalize(away) === normalize(match.away?.name);
}

function contextFromItem(item) {
  const context = item.bet365_context || item.statshub_context || item.context || null;
  if (context && typeof context === 'object' && !Array.isArray(context)) return context;
  const reserved = new Set([
    'event_id',
    'id',
    'match_id',
    'sportsbet_event_id',
    'sofascore_id',
    'date',
    'kickoff_date',
    'start_date',
    'league',
    'tournament',
    'competition',
    'home',
    'home_team',
    'homeName',
    'away',
    'away_team',
    'awayName',
  ]);
  const loose = {};
  for (const [key, value] of Object.entries(item)) {
    if (!reserved.has(key) && value !== null && value !== undefined) loose[key] = value;
  }
  return Object.keys(loose).length ? loose : null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const inputPath = INPUT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!inputPath) {
    console.log('No bet365/StatsHub context cache found; nothing to merge.');
    return;
  }

  const store = await readJson(STORE_PATH);
  const payload = await readJson(inputPath);
  const items = asArray(payload);
  let applied = 0;
  let skippedFinished = 0;
  let unmatched = 0;

  for (const item of items) {
    const context = contextFromItem(item);
    if (!context) {
      unmatched += 1;
      continue;
    }
    let matched = false;
    for (const league of store.leagues || []) {
      for (const match of league.matches || []) {
        match.league_name = match.league_name || league.name;
        if (!matchItem(match, item)) continue;
        matched = true;
        if (match.status === 'FT' || match.prediction_locked) {
          skippedFinished += 1;
          continue;
        }
        match.bet365_context = {
          ...(match.bet365_context || {}),
          ...context,
          source: context.source || 'bet365/statshub-cache',
          merged_at: new Date().toISOString(),
        };
        applied += 1;
      }
    }
    if (!matched) unmatched += 1;
  }

  if (applied) {
    for (const league of store.leagues || []) {
      for (const match of league.matches || []) delete match.league_name;
    }
    await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }

  console.log(`DONE. input=${path.relative(ROOT, inputPath)} items=${items.length} applied=${applied} skipped_finished=${skippedFinished} unmatched=${unmatched}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
