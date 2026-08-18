import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { initializeFirestore, getFirestore, FieldValue } from 'firebase-admin/firestore';
import { precomputeDisplayData } from './precompute_display_markets.mjs';
import { marketReturnTotals, pricedMarketOdds } from './market_odds_returns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const DOC_ID = 'match_data';
const FAST_DOC_ID = 'match_data_fast';
const QUICK_BETS_DOC_ID = 'quick_bets';
const MANUAL_IMPORTS_COLLECTION = 'manualResultImports';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');
const QUICK_BETS_PATH = path.join(ROOT, 'sportsbet_quick_bets.json');
const SPORTSBET_SOURCE_URL = 'https://www.sportsbet.com.au/betting/soccer';
const FIRESTORE_UPLOAD_BATCH_SIZE = Number(process.env.FIRESTORE_UPLOAD_BATCH_SIZE || 5);
const DRAW_NO_BET_TRACKING_START_DATE = '2026-05-25';
const SETTLED_MARKET_RESULTS = new Set(['hit', 'miss', 'pass', 'void']);
const QUICK_BET_MARKETS = ['winner', 'btts', 'goalsOver', 'goalsUnder'];
const QUICK_BET_GOAL_LINES = [0.5, 1.5, 2.5, 3.5];
const QUICK_BET_MAX_ODDS_EXCLUSIVE = 1.5;

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

function sportsbetEventDetails(value, expectedId = null) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const id = /-(\d+)\/?$/.exec(url.pathname)?.[1] || null;
    const safeHost = host === 'sportsbet.com.au' || host.endsWith('.sportsbet.com.au');
    if (url.protocol !== 'https:' || !safeHost || !id || (expectedId != null && String(expectedId) !== id)) return null;
    return { url: url.href, eventId: id };
  } catch {
    return null;
  }
}

function quickBetFixtureKey(match) {
  const clean = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return [match.date, match.time || '', clean(match.home), clean(match.away)].join('|');
}

function goalLineText(line) {
  return Number(line).toString();
}

function quickBetSelection(market, item, home, away) {
  if (!item || typeof item !== 'object') return null;
  const odds = Number(item.odds);
  if (!Number.isFinite(odds) || odds <= 1 || odds >= QUICK_BET_MAX_ODDS_EXCLUSIVE) return null;
  const key = String(item.key || '').toLowerCase();

  if (market === 'winner') {
    if (!['home', 'draw', 'away'].includes(key)) return null;
    return {
      key,
      label: key === 'home' ? home : key === 'away' ? away : 'Draw',
      odds,
    };
  }
  if (market === 'btts') {
    if (!['yes', 'no'].includes(key)) return null;
    return {
      key,
      label: key === 'yes' ? 'Yes' : 'No',
      odds,
    };
  }

  const side = market === 'goalsOver' ? 'over' : 'under';
  const line = Number(item.line);
  if (!Number.isFinite(line) || line < 0) return null;
  if (side === 'under' && line === 4.5) return null;
  if (String(item.side || '').toLowerCase() !== side) return null;
  const stableKey = `${side}:${goalLineText(line)}`;
  if (key !== stableKey) return null;
  return {
    key: stableKey,
    side,
    line,
    label: `${side === 'over' ? 'Over' : 'Under'} ${goalLineText(line)}`,
    odds,
  };
}

function mergeQuickBetMarkets(left = {}, right = {}) {
  const merged = {};
  for (const market of QUICK_BET_MARKETS) {
    const selections = new Map();
    for (const item of [...(left[market] || []), ...(right[market] || [])]) {
      if (item?.key && !selections.has(item.key)) selections.set(item.key, item);
    }
    merged[market] = [...selections.values()];
  }
  return merged;
}

function coreQuickBetCandidate(match, league) {
  const home = match?.home?.short || match?.home?.name || '?';
  const away = match?.away?.short || match?.away?.name || '?';
  const book = match?.sportsbet_odds || {};
  const captured = match?.sportsbet_markets || {};
  const fullTime = captured['Full time'] || {};
  const bothTeams = captured['Both teams to score'] || {};
  const winnerOdds = (primary, fallback) => (Number.isFinite(primary) ? primary : fallback);
  const selection = (market, item) => quickBetSelection(market, item, home, away);
  const goals = (market, side) => Object.entries(captured)
    .map(([name, prices]) => ({ line: /^Match goals (\d+(?:\.\d+)?)$/.exec(name), prices }))
    .filter(({ line, prices }) => line && prices && typeof prices === 'object')
    .sort((a, b) => Number(a.line[1]) - Number(b.line[1]))
    .map(({ line, prices }) => {
      const numericLine = Number(line[1]);
      return selection(market, {
        key: `${side}:${goalLineText(numericLine)}`,
        side,
        line: numericLine,
        odds: prices[side === 'over' ? 'Over' : 'Under'],
      });
    })
    .filter(Boolean);
  const rawEventId = book.event_id == null ? null : String(book.event_id);
  const event = sportsbetEventDetails(book.event_url, rawEventId)
    || sportsbetEventDetails(match?.bookmaker_links?.sportsbet, rawEventId);
  const settlementScore = match?.settlement_score || {};
  const homeScore = settlementScore.home != null && Number.isFinite(Number(settlementScore.home))
    ? Number(settlementScore.home)
    : match?.home?.goals != null && Number.isFinite(Number(match.home.goals)) ? Number(match.home.goals) : null;
  const awayScore = settlementScore.away != null && Number.isFinite(Number(settlementScore.away))
    ? Number(settlementScore.away)
    : match?.away?.goals != null && Number.isFinite(Number(match.away.goals)) ? Number(match.away.goals) : null;

  return {
    league: league || '',
    date: match?.date || '',
    time: match?.time || '',
    home,
    away,
    status: match?.status || '',
    eventId: event?.eventId || null,
    eventUrl: event?.url || null,
    homeScore,
    awayScore,
    minute: typeof match?.live_minute === 'string' ? match.live_minute : null,
    source: 'canonical',
    markets: {
      winner: [
        selection('winner', { key: 'home', odds: winnerOdds(book.home, fullTime['1']) }),
        selection('winner', { key: 'draw', odds: winnerOdds(book.draw, fullTime.X) }),
        selection('winner', { key: 'away', odds: winnerOdds(book.away, fullTime['2']) }),
      ].filter(Boolean),
      btts: [
        selection('btts', { key: 'yes', odds: bothTeams.Yes }),
        selection('btts', { key: 'no', odds: bothTeams.No }),
      ].filter(Boolean),
      goalsOver: goals('goalsOver', 'over'),
      goalsUnder: goals('goalsUnder', 'under'),
    },
  };
}

function sidecarQuickBetCandidate(row, source = 'event') {
  if (!row || typeof row !== 'object' || typeof row.home !== 'string' || typeof row.away !== 'string') return null;
  const home = row.home;
  const away = row.away;
  const rawEventId = row.eventId == null && row.event_id == null ? null : String(row.eventId ?? row.event_id);
  const event = sportsbetEventDetails(row.eventUrl, rawEventId) || sportsbetEventDetails(row.event_url, rawEventId);
  const frozen = source === 'history';
  const rootFresh = frozen || row.root_stale === false;
  const deepFresh = frozen || (rootFresh && row.deep_stale === false);
  const rawMarkets = row.markets && typeof row.markets === 'object' ? row.markets : {};
  const markets = {};
  for (const market of QUICK_BET_MARKETS) {
    const fresh = market === 'winner' ? rootFresh : deepFresh;
    markets[market] = fresh && Array.isArray(rawMarkets[market])
      ? rawMarkets[market].map((item) => quickBetSelection(market, item, home, away)).filter(Boolean)
      : [];
  }

  return {
    league: typeof row.league === 'string' ? row.league : '',
    date: typeof row.date === 'string' ? row.date : '',
    time: typeof row.time === 'string' ? row.time : '',
    home,
    away,
    status: frozen ? String(row.status || 'started') : 'upcoming',
    eventId: event?.eventId || null,
    eventUrl: event?.url || null,
    homeScore: row.home_score != null && Number.isFinite(Number(row.home_score)) ? Number(row.home_score) : null,
    awayScore: row.away_score != null && Number.isFinite(Number(row.away_score)) ? Number(row.away_score) : null,
    minute: typeof row.live_minute === 'string' ? row.live_minute : null,
    source,
    markets,
  };
}

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function quickBetDate(row) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.date || '');
  if (!date) return null;
  const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
  const valid = parsed.getUTCFullYear() === Number(date[1])
    && parsed.getUTCMonth() === Number(date[2]) - 1
    && parsed.getUTCDate() === Number(date[3]);
  return valid ? row.date : null;
}

function quickBetKickoff(row) {
  const date = quickBetDate(row);
  const time = /^(\d{1,2}):(\d{2})$/.exec(row.time || '');
  if (!date || !time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const [year, month, day] = date.split('-').map(Number);
  const kickoff = new Date(year, month - 1, day, hour, minute);
  return localDate(kickoff) === date && kickoff.getHours() === hour && kickoff.getMinutes() === minute ? kickoff : null;
}

function quickBetLifecycleName(row, now = new Date()) {
  const status = String(row.status || '').toLowerCase();
  if (['ft', 'finished', 'result', 'postponed_or_cancelled', 'cancelled', 'postponed', 'void'].includes(status)) return 'result';
  const date = quickBetDate(row);
  if (!date) return null;
  const today = localDate(now);
  if (date < today) return null;
  if (date > today) return 'upcoming';
  if (status === 'live') return 'live';
  const kickoff = quickBetKickoff(row);
  return kickoff && kickoff <= now ? 'live' : 'upcoming';
}

function gradeQuickBetMarkets(markets, lifecycle, status, homeScore, awayScore) {
  const terminalVoid = ['postponed_or_cancelled', 'cancelled', 'postponed', 'void'].includes(String(status || '').toLowerCase());
  const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);
  const total = hasScore ? homeScore + awayScore : null;
  const grade = (market, selection) => {
    if (selection.result || selection.liveLock) return selection;
    let result = null;
    let liveLock = null;
    if (terminalVoid) result = 'void';
    else if (hasScore && lifecycle === 'result') {
      if (market === 'winner') {
        const actual = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';
        result = selection.key === actual ? 'hit' : 'miss';
      } else if (market === 'btts') {
        const actual = homeScore > 0 && awayScore > 0 ? 'yes' : 'no';
        result = selection.key === actual ? 'hit' : 'miss';
      } else if (market === 'goalsOver') result = total > selection.line ? 'hit' : 'miss';
      else if (market === 'goalsUnder') result = total < selection.line ? 'hit' : 'miss';
    } else if (hasScore && lifecycle === 'live') {
      if (market === 'btts' && homeScore > 0 && awayScore > 0) liveLock = selection.key === 'yes' ? 'hit' : 'miss';
      if (market === 'goalsOver' && total > selection.line) liveLock = 'hit';
      if (market === 'goalsUnder' && total > selection.line) liveLock = 'miss';
    }
    return { ...selection, result, liveLock };
  };
  return Object.fromEntries(QUICK_BET_MARKETS.map((market) => [
    market,
    (markets[market] || []).map((selection) => grade(market, selection)),
  ]));
}

function quickBetSelectionCount(matches) {
  return (Array.isArray(matches) ? matches : []).reduce((total, match) => (
    total + QUICK_BET_MARKETS.reduce((count, market) => count + (match.markets?.[market]?.length || 0), 0)
  ), 0);
}

function quickBetCounts(matches) {
  return {
    upcoming: matches.filter((row) => row.lifecycle === 'upcoming').length,
    live: matches.filter((row) => row.lifecycle === 'live').length,
    results: matches.filter((row) => row.lifecycle === 'result').length,
  };
}

function mergeQuickBetCandidate(left, right) {
  const history = left.source === 'history' ? left : right.source === 'history' ? right : null;
  const canonical = left.source === 'canonical' ? left : right.source === 'canonical' ? right : null;
  const identity = history || left;
  const canonicalStatus = String(canonical?.status || '').toLowerCase();
  const canonicalScore = Number.isFinite(canonical?.homeScore) && Number.isFinite(canonical?.awayScore);
  const canonicalAuthoritative = canonical && (canonicalStatus === 'live'
    || ['postponed_or_cancelled', 'cancelled', 'postponed', 'void'].includes(canonicalStatus)
    || (['ft', 'finished', 'result'].includes(canonicalStatus) && canonicalScore));
  const statusOwner = canonicalAuthoritative ? canonical : history || right;
  return {
    ...identity,
    eventId: history?.eventId || left.eventId || right.eventId || null,
    eventUrl: history?.eventUrl || left.eventUrl || right.eventUrl || null,
    markets: history
      ? mergeQuickBetMarkets(history.markets, canonical ? canonical.markets : (history === left ? right.markets : left.markets))
      : mergeQuickBetMarkets(left.markets, right.markets),
    status: statusOwner.status,
    homeScore: statusOwner.homeScore,
    awayScore: statusOwner.awayScore,
    minute: statusOwner.minute,
    source: history ? 'history' : canonical ? 'canonical' : left.source,
  };
}

export function buildQuickBetsPayload({ leagues = [], sidecar = null, now = new Date(), sourceCapturedAt = null } = {}) {
  const candidates = [];
  for (const league of Array.isArray(leagues) ? leagues : []) {
    for (const match of Array.isArray(league?.matches) ? league.matches : []) {
      candidates.push(coreQuickBetCandidate(match, league.name));
    }
  }
  for (const row of (sidecar && (sidecar.events || sidecar.matches)) || []) {
    const candidate = sidecarQuickBetCandidate(row, 'event');
    if (candidate) candidates.push(candidate);
  }
  for (const row of (sidecar?.history || [])) {
    const candidate = sidecarQuickBetCandidate(row, 'history');
    if (candidate) candidates.push(candidate);
  }

  const merged = [];
  const byEventId = new Map();
  const byFixture = new Map();
  for (const candidateRow of candidates) {
    if (!candidateRow.date || !candidateRow.home || !candidateRow.away) continue;
    const normalized = {};
    for (const market of QUICK_BET_MARKETS) {
      normalized[market] = (candidateRow.markets[market] || [])
        .map((item) => quickBetSelection(market, item, candidateRow.home, candidateRow.away))
        .filter(Boolean);
    }
    if (!QUICK_BET_MARKETS.some((market) => normalized[market].length)) continue;
    const row = { ...candidateRow, markets: normalized };
    const fixtureKey = quickBetFixtureKey(row);
    const eventId = row.eventId == null ? null : String(row.eventId);
    const existingIndex = (eventId && byEventId.get(eventId)) ?? byFixture.get(fixtureKey);
    if (existingIndex != null) {
      merged[existingIndex] = mergeQuickBetCandidate(merged[existingIndex], row);
      const combined = merged[existingIndex];
      if (combined.eventId) byEventId.set(String(combined.eventId), existingIndex);
      if (eventId) byEventId.set(eventId, existingIndex);
      byFixture.set(fixtureKey, existingIndex);
      byFixture.set(quickBetFixtureKey(combined), existingIndex);
      continue;
    }
    const index = merged.push(row) - 1;
    if (eventId) byEventId.set(eventId, index);
    byFixture.set(fixtureKey, index);
  }

  const today = localDate(now);
  const throughDate = addDays(today, 6);
  const rows = merged.flatMap((row) => {
    const lifecycle = quickBetLifecycleName(row, now);
    if (!lifecycle) return [];
    const score = Number.isFinite(row.homeScore) && Number.isFinite(row.awayScore) ? `${row.homeScore}-${row.awayScore}` : null;
    return [firestoreSafe({
      league: row.league || '',
      date: row.date,
      time: row.time || '',
      home: row.home,
      away: row.away,
      eventId: row.eventId == null ? null : String(row.eventId),
      eventUrl: row.eventUrl || null,
      lifecycle,
      status: String(lifecycle === 'upcoming' ? 'upcoming'
        : lifecycle === 'live' && String(row.status || '').toLowerCase() === 'upcoming' ? 'started'
          : row.status || 'started'),
      score,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      minute: row.minute || null,
      markets: gradeQuickBetMarkets(row.markets, lifecycle, row.status, row.homeScore, row.awayScore),
    })];
  })
    .filter((row) => {
      if (row.lifecycle !== 'upcoming') return true;
      if (row.date < today || row.date > throughDate) return false;
      if (!row.time) return row.date !== today;
      return !!quickBetKickoff(row);
    })
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.time || '99:99').localeCompare(String(b.time || '99:99')) ||
      String(a.league || '').localeCompare(String(b.league || '')) ||
      String(a.home || '').localeCompare(String(b.home || '')) ||
      String(a.away || '').localeCompare(String(b.away || '')),
    );

  const dates = new Map();
  for (const row of rows) {
    if (!dates.has(row.date)) dates.set(row.date, []);
    dates.get(row.date).push(row);
  }

  return {
    meta: firestoreSafe({
      format: 'quick_bets_v1',
      source: 'Sportsbet',
      sourceUrl: sidecar?.source_url || sidecar?.sourceUrl || SPORTSBET_SOURCE_URL,
      capturedAt: sidecar?.captured_at || sidecar?.capturedAt || sourceCapturedAt || null,
      attemptedAt: sidecar?.attempted_at || sidecar?.attemptedAt || null,
      refreshStatus: ['complete', 'partial', 'stale'].includes(sidecar?.status) ? sidecar.status : 'core-only',
      maxOddsExclusive: QUICK_BET_MAX_ODDS_EXCLUSIVE,
      counts: quickBetCounts(rows),
      totalMatches: rows.length,
      totalSelections: quickBetSelectionCount(rows),
      availableDates: [...dates.keys()].sort(),
      dateDocCount: dates.size,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    dates,
  };
}

async function loadQuickBetsPayload(leagues, sourceCapturedAt = null, now = new Date()) {
  const sidecar = existsSync(QUICK_BETS_PATH)
    ? JSON.parse(await readFile(QUICK_BETS_PATH, 'utf8'))
    : null;
  return buildQuickBetsPayload({ leagues, sidecar, now, sourceCapturedAt });
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

function findManualImportTarget(leagues, item) {
  const leagueNeedle = cleanKey(item.league);
  let best = null;
  leagues.forEach((league, leagueIndex) => {
    const leagueMatches = !leagueNeedle || cleanKey(league.name) === leagueNeedle || cleanKey(league.id) === leagueNeedle;
    (Array.isArray(league.matches) ? league.matches : []).forEach((match, matchIndex) => {
      const score = matchScore(match, item) + (leagueMatches ? 2 : 0);
      if (score >= 8 && (!best || score > best.score)) {
        best = { leagueIndex, matchIndex, score };
      }
    });
  });
  return best;
}

function settleWinnerMarket(match, winner, actualWinner) {
  const next = { ...winner };
  next.result = next.type === actualWinner ? 'hit' : 'miss';
  delete next.picked;
  return next;
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

function settleTotalOrPassMarket(market, actual) {
  if (!market || actual === null || actual === undefined) return market;
  const settled = settleTotalMarket(market, actual);
  if (marketResult(settled)) return settled;
  const value = Number(actual);
  return Number.isFinite(value) && !market.pick ? { ...market, actual: value, result: 'pass' } : market;
}

function isTerminalVoidStatus(item) {
  return ['postponed_or_cancelled', 'postponed', 'cancelled', 'canceled', 'abandoned'].includes(
    String(item.status || item.state || '').toLowerCase(),
  );
}

function voidPredictions(predictions = {}) {
  return Object.fromEntries(Object.entries(predictions).map(([key, value]) => {
    if (!value || typeof value !== 'object' || ['hit', 'miss'].includes(value.result)) return [key, value];
    return [key, { ...value, result: 'void' }];
  }));
}

function applyManualTerminalStatus(match, item) {
  const importedAt = item.importedAt || item.updatedAt || new Date().toISOString();
  const statusText = item.statusText || item.status_text || item.state || item.status || 'Postponed';
  const displayTime = String(statusText).toLowerCase().includes('postpon') ? 'Postponed' : 'Cancelled';
  return {
    ...match,
    status: 'postponed_or_cancelled',
    time: displayTime,
    predictions: voidPredictions(match.predictions || {}),
    settled_at: String(item.date || match.date || importedAt).slice(0, 10),
    prediction_locked: true,
    prediction_locked_at: match.prediction_locked_at || importedAt,
    void_reason: item.voidReason || 'Fixture postponed/cancelled by manual source before result settlement.',
    manual_result_import: {
      source: item.source || 'manual_terminal_status',
      statusText,
      importedAt,
      importedBy: item.importedBy || null,
      importedByEmail: item.importedByEmail || null,
      reappliedByRoutine: true,
    },
  };
}

function applyManualResult(match, item) {
  if (isTerminalVoidStatus(item)) return applyManualTerminalStatus(match, item);
  const homeGoals = Number(item.score?.home);
  const awayGoals = Number(item.score?.away);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return match;
  const actuals = item.actuals || {};
  const actualWinner = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
  const predictions = { ...(match.predictions || {}) };

  if (predictions.winner) {
    predictions.winner = settleWinnerMarket(match, predictions.winner, actualWinner);
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

  const importedAt = item.importedAt || item.updatedAt || new Date().toISOString();
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

async function loadManualResultImports(db) {
  const snap = await db.collection('dashboardData').doc(DOC_ID).collection(MANUAL_IMPORTS_COLLECTION).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((item) => item.date && (item.score || isTerminalVoidStatus(item)) && item.homeName && item.awayName);
}

function applyManualResultImports(leagues, imports) {
  if (!imports.length) return { leagues, applied: 0, missed: [] };
  const nextLeagues = leagues.map((league) => ({
    ...league,
    matches: Array.isArray(league.matches) ? league.matches.map((match) => ({ ...match })) : [],
  }));
  let applied = 0;
  const missed = [];
  for (const item of imports) {
    const target = findManualImportTarget(nextLeagues, item);
    if (!target) {
      missed.push(`${item.date} ${item.league || ''} ${item.homeName} vs ${item.awayName}`.trim());
      continue;
    }
    const league = nextLeagues[target.leagueIndex];
    league.matches[target.matchIndex] = applyManualResult(league.matches[target.matchIndex], item);
    applied += 1;
  }
  return { leagues: nextLeagues, applied, missed };
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

// The whitelist of match fields that reach Firestore. Anything not listed here is
// silently dropped by slimMatch — so a new match field (e.g. espn_stats) must be added
// here or it never ships. reportDroppedMatchFields() warns loudly when that happens.
const MATCH_KEEP_FIELDS = [
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
  'settled_source',
  'after_extra_time_score',
  'settlement_score',
  'void_reason',
  'manual_result_source_url',
  'manual_result_import',
  'venue',
  'referee',
  'espn_stats',
  'ladbrokes_odds',
];

// Fields present on source matches that are intentionally not uploaded (pipeline-internal
// bookkeeping). Listed so the coverage check doesn't cry wolf about them.
const MATCH_DROP_OK = new Set([
  'leagueId', 'leagueLogo', 'league', 'source', 'source_status', 'source_health',
  'phase_status', 'phase_notes', 'stat_backfill', 'flashscore_score', 'livescore_score',
  'settled_at', 'settled_by_due_time', 'prediction_locked', 'prediction_locked_at',
  'team_streaks', 'h2h_streaks', 'h2h_duel', 'h2h_history', 'odds_backfill_only',
  'live_minute', 'live_updated_at', 'utc_timestamp', 'sportsbet_markets',
  'bookmaker_odds_source', 'bookmaker_meta', 'merged_source_ids', 'espn_event_id',
]);

function slimMatch(match) {
  return Object.fromEntries(
    MATCH_KEEP_FIELDS
      .filter((key) => match[key] !== undefined && match[key] !== null)
      .map((key) => [key, match[key]]),
  );
}

// Warn when a match carries a field that is neither uploaded nor explicitly OK to drop —
// the silent-loss class that hid espn_stats from Firestore. Returns the unexpected keys.
function reportDroppedMatchFields(leagues) {
  const keep = new Set(MATCH_KEEP_FIELDS);
  const unexpected = new Map();
  for (const league of Array.isArray(leagues) ? leagues : []) {
    for (const match of Array.isArray(league?.matches) ? league.matches : []) {
      for (const key of Object.keys(match || {})) {
        if (keep.has(key) || MATCH_DROP_OK.has(key)) continue;
        unexpected.set(key, (unexpected.get(key) || 0) + 1);
      }
    }
  }
  if (unexpected.size) {
    console.warn('⚠ Upload whitelist: dropping unrecognised match field(s) — add to MATCH_KEEP_FIELDS or MATCH_DROP_OK:');
    for (const [key, count] of [...unexpected.entries()].sort((a, b) => b[1] - a[1])) {
      console.warn(`  - ${key} (${count} matches)`);
    }
  }
  return [...unexpected.keys()];
}

function repairVisibleMarketSettlements(leagues) {
  let repaired = 0;
  for (const league of Array.isArray(leagues) ? leagues : []) {
    for (const match of Array.isArray(league?.matches) ? league.matches : []) {
      if (!isFinishedStatus(match)) continue;
      const display = match.display_markets || {};
      const predictions = match.predictions || {};
      const actuals = match.actuals || {};
      const repairs = [
        ['cards', 'ou_cards', actuals.cards_total],
        ['corners', 'ou_corners', actuals.corners_total],
      ];

      for (const [key, predictionKey, actual] of repairs) {
        const predictionMarket = predictions[predictionKey];
        if (predictionMarket && !marketResult(predictionMarket)) {
          const settledPrediction = settleTotalOrPassMarket(predictionMarket, actual);
          if (marketResult(settledPrediction)) {
            match.predictions = {
              ...match.predictions,
              [predictionKey]: settledPrediction,
            };
            repaired += 1;
          }
        }

        const market = display[key]?.market;
        if (!market || marketResult(market)) continue;
        const settled = settleTotalOrPassMarket(market, actual);
        if (!marketResult(settled)) continue;
        match.display_markets = {
          ...match.display_markets,
          [key]: {
            ...display[key],
            market: settled,
          },
        };
        repaired += 1;
      }
    }
  }
  if (repaired) console.log(`Visible display market settlements repaired for upload: ${repaired}`);
  return repaired;
}

function slimLeagueDocMatch(match) {
  const keep = [
    'id',
    'date',
    'time',
    'status',
    'home',
    'away',
    'display_summary',
    'settled_source',
    'after_extra_time_score',
    'settlement_score',
    'void_reason',
    'prediction_locked',
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
  const oddsTotals = marketReturnTotals(markets);
  const finished = matches.filter((match) => match.status === 'FT').length;
  const upcoming = matches.filter((match) => match.status === 'upcoming').length;
  return {
    total: matches.length,
    finished,
    upcoming,
    settledMarkets: markets.length,
    marketHits: hits,
    marketMisses: markets.length - hits,
    accuracy: markets.length ? Math.round((hits / markets.length) * 100) : 0,
    oddsTotals: {
      hit: Math.round(oddsTotals.hit * 10) / 10,
      loss: Math.round(oddsTotals.loss * 10) / 10,
      priced: oddsTotals.priced,
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
    { key: 'draw_no_bet', label: 'Draw No Bet', getMarket: (match) => String(match.date || '') >= DRAW_NO_BET_TRACKING_START_DATE ? match.display_markets?.draw_no_bet?.market : null },
    { key: 'btts', label: 'BTTS', getMarket: (match) => match.display_markets?.btts?.market || match.predictions?.btts },
    { key: 'goals', label: 'Goals', getMarket: (match) => match.display_markets?.goals?.market || match.predictions?.ou_goals },
    { key: 'cards', label: 'Cards', getMarket: (match) => match.display_markets?.cards?.market || match.predictions?.ou_cards },
    { key: 'corners', label: 'Corners', getMarket: (match) => match.predictions?.ou_corners },
  ];

  return configs.map((config) => {
    const settled = matches
      .map((match) => config.getMarket(match))
      .filter((market) => market?.result === 'hit' || market?.result === 'miss');
    const hits = settled.filter((market) => market.result === 'hit');
    const misses = settled.filter((market) => market.result === 'miss');
    const oddsTotals = marketReturnTotals(settled);
    return {
      key: config.key,
      label: config.label,
      total: settled.length,
      hits: hits.length,
      misses: misses.length,
      hitRate: settled.length ? Math.round((hits.length / settled.length) * 100) : 0,
      oddsHit: Math.round(oddsTotals.hit * 10) / 10,
      oddsMiss: Math.round(oddsTotals.loss * 10) / 10,
      oddsPriced: settled.filter((market) => pricedMarketOdds(market)).length,
      net: Math.round((oddsTotals.hit - oddsTotals.loss) * 10) / 10,
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

function fastDocPayload({ parsed, allTimeSummary, availableDates, fastLeagues, fastCutoff, fastDays, fastByteLength }) {
  return firestoreSafe({
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
  });
}

function selectFastPayload(leagues, parsed, allTimeSummary, availableDates) {
  const today = adelaideTodayIso();
  for (const days of FAST_DOC_WINDOW_DAYS) {
    const cutoff = isoMinusDays(today, days);
    const fastLeagues = buildFastLeagues(leagues, cutoff);
    const fastByteLength = Buffer.byteLength(JSON.stringify({ leagues: fastLeagues }));
    const payload = fastDocPayload({ parsed, allTimeSummary, availableDates, fastLeagues, fastCutoff: cutoff, fastDays: days, fastByteLength });
    const byteLength = Buffer.byteLength(JSON.stringify(payload));
    if (byteLength <= FIRESTORE_DOC_SAFE_BYTES) {
      return { payload, cutoff, byteLength, days, matchCount: payload.matchCount, overflow: false };
    }
    console.warn(`Fast doc payload ${(byteLength / 1024).toFixed(1)} KB at ${days}d window, retrying with smaller window`);
  }

  const fastLeagues = buildFastLeagues(leagues, today);
  const fastByteLength = Buffer.byteLength(JSON.stringify({ leagues: fastLeagues }));
  const todayPayload = fastDocPayload({ parsed, allTimeSummary, availableDates, fastLeagues, fastCutoff: today, fastDays: 0, fastByteLength });
  const todayByteLength = Buffer.byteLength(JSON.stringify(todayPayload));
  if (todayByteLength <= FIRESTORE_DOC_SAFE_BYTES) {
    return { payload: todayPayload, cutoff: today, byteLength: todayByteLength, days: 0, matchCount: todayPayload.matchCount, overflow: false };
  }

  console.warn(`Fast doc payload ${(todayByteLength / 1024).toFixed(1)} KB at 0d window; writing metadata-only fallback`);
  const overflowPayload = firestoreSafe({
    format: 'fast_doc_unavailable_v1',
    capturedAt: parsed.captured_at || null,
    source: parsed.source || null,
    availableDates,
    allTimeSummary,
    leagueCount: 0,
    matchCount: 0,
    byteLength: todayByteLength,
    fastWindowDays: 0,
    fastWindowStart: today,
    overflow: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    payload: overflowPayload,
    cutoff: today,
    byteLength: Buffer.byteLength(JSON.stringify(overflowPayload)),
    days: 0,
    matchCount: 0,
    overflow: true,
  };
}

function flattenedMatchesFromDateDoc(dateDoc) {
  return (Array.isArray(dateDoc?.leagues) ? dateDoc.leagues : [])
    .flatMap((league) =>
      (Array.isArray(league.matches) ? league.matches : []).map((match) => ({
        ...match,
        leagueName: league.name || league.id || null,
      })),
    );
}

function isFinishedStatus(match) {
  return String(match?.status || '').toLowerCase() === 'ft';
}

function marketResult(market) {
  const result = String(market?.result || '').toLowerCase();
  return SETTLED_MARKET_RESULTS.has(result) ? result : '';
}

function marketLabelForIssue(match, key) {
  const home = match?.home?.short || match?.home?.name || 'Home';
  const away = match?.away?.short || match?.away?.name || 'Away';
  return `${match?.date || '?'} ${match?.time || '?'} ${match?.leagueName || match?.league || '?'} ${home} vs ${away} [${match?.id || 'no-id'}] ${key}`;
}

function requiredMarketChecks(match) {
  const display = match?.display_markets || {};
  const predictions = match?.predictions || {};
  const checks = [
    ['winner', display.winner?.market || predictions.winner],
    ['btts', display.btts?.market || predictions.btts],
    ['goals', display.goals?.market || predictions.ou_goals],
    ['cards', display.cards?.market || predictions.ou_cards],
    ['corners', display.corners?.market || predictions.ou_corners],
  ];

  if (display.double_chance?.market) checks.push(['double_chance', display.double_chance.market]);
  if (display.draw_no_bet?.market && String(match?.date || '') >= DRAW_NO_BET_TRACKING_START_DATE) {
    checks.push(['draw_no_bet', display.draw_no_bet.market]);
  }
  if (match?.display_summary?.compactMarket?.market) {
    checks.push(['suggested', match.display_summary.compactMarket.market]);
  }
  return checks;
}

function unsettledMarketsForMatch(match) {
  return requiredMarketChecks(match)
    .filter(([, market]) => market && !marketResult(market))
    .map(([key]) => marketLabelForIssue(match, key));
}

async function verifyFirestoreDayMarketsSettled(db, date, uploadedDates) {
  const dateRef = db.collection('dashboardData').doc(DOC_ID).collection('dates').doc(slugify(date, 'unknown'));
  const dateSnap = await dateRef.get();
  if (!dateSnap.exists) {
    // No bucket was uploaded for this date because the slate has no fixtures
    // today (common on quiet days) — nothing to verify, so skip cleanly. A
    // missing doc is only a failure when we did upload a bucket for the date.
    if (uploadedDates && !uploadedDates.has(date)) {
      console.log(`Firestore day-market verification ${date}: no fixtures scheduled, skipping.`);
      return;
    }
    throw new Error(`Firestore day-market verification failed: date doc ${date} is missing.`);
  }

  const dateData = dateSnap.data() || {};
  const dayMatches = flattenedMatchesFromDateDoc(dateData).filter((match) => String(match.date || '') === date);
  const finishedMatches = dayMatches.filter(isFinishedStatus);
  const unsettled = finishedMatches.flatMap(unsettledMarketsForMatch);

  console.log(`Firestore day-market verification ${date}: matches=${dayMatches.length} FT=${finishedMatches.length} unsettled=${unsettled.length}`);
  if (unsettled.length) {
    const sample = unsettled.slice(0, 12).join('; ');
    throw new Error(`Firestore day-market verification failed: ${unsettled.length} unsettled market(s) for ${date}. ${sample}`);
  }

  const fastSnap = await db.collection('dashboardData').doc(FAST_DOC_ID).get();
  if (fastSnap.exists) {
    const fastMatches = flattenedMatchesFromDateDoc(fastSnap.data()).filter((match) => String(match.date || '') === date);
    const fastUnsettled = fastMatches.filter(isFinishedStatus).flatMap(unsettledMarketsForMatch);
    if (fastUnsettled.length) {
      const sample = fastUnsettled.slice(0, 12).join('; ');
      throw new Error(`Firestore fast-doc market verification failed: ${fastUnsettled.length} unsettled market(s) for ${date}. ${sample}`);
    }
    console.log(`Firestore fast-doc market verification ${date}: matches=${fastMatches.length} unsettled=${fastUnsettled.length}`);
  }
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

async function commitBatchWithRetry(batch, index) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await batch.commit();
      console.log(`Committed Firestore upload batch ${index}`);
      return;
    } catch (error) {
      const message = error?.message || String(error);
      console.warn(`Firestore upload batch ${index} attempt ${attempt} failed: ${message}`);
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function commitUploadOperations(db, operations) {
  const batchSize = Number.isFinite(FIRESTORE_UPLOAD_BATCH_SIZE) && FIRESTORE_UPLOAD_BATCH_SIZE > 0
    ? Math.min(Math.floor(FIRESTORE_UPLOAD_BATCH_SIZE), 400)
    : 5;
  let batchIndex = 0;
  for (let index = 0; index < operations.length; index += batchSize) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + batchSize)) {
      if (operation.type === 'delete') batch.delete(operation.ref);
      if (operation.type === 'set') batch.set(operation.ref, operation.payload);
    }
    batchIndex += 1;
    await commitBatchWithRetry(batch, batchIndex);
  }
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

  if (!getApps().length) {
    initializeApp(credentialOptions());
  }

  let db;
  try {
    db = initializeFirestore(getApps()[0], { preferRest: true });
  } catch {
    db = getFirestore();
  }
  const dataPath = path.join(ROOT, 'match_data.json');
  const raw = await readFile(dataPath, 'utf8');
  const sourceData = JSON.parse(raw);
  const manualImports = await loadManualResultImports(db);
  const sourceLeagues = Array.isArray(sourceData.leagues) ? sourceData.leagues : [];
  const manualResult = applyManualResultImports(sourceLeagues, manualImports);
  if (manualImports.length) {
    console.log(`Manual result imports reapplied: ${manualResult.applied}/${manualImports.length}`);
    if (manualResult.missed.length) console.warn(`Manual result imports missed: ${manualResult.missed.join('; ')}`);
  }
  const parsed = precomputeDisplayData({ ...sourceData, leagues: manualResult.leagues });
  const leagues = Array.isArray(parsed.leagues) ? parsed.leagues : [];
  repairVisibleMarketSettlements(leagues);
  reportDroppedMatchFields(leagues);
  const allTimeSummary = summarizeAllTime(leagues);
  const metaRef = db.collection('dashboardData').doc(DOC_ID);
  const fastRef = db.collection('dashboardData').doc(FAST_DOC_ID);
  const quickBetsRef = db.collection('dashboardData').doc(QUICK_BETS_DOC_ID);
  const chunksRef = metaRef.collection('chunks');
  const leaguesRef = metaRef.collection('leagues');
  const datesRef = metaRef.collection('dates');
  const quickBetsDatesRef = quickBetsRef.collection('dates');
  const existingChunks = await chunksRef.listDocuments();
  const existingLeagues = await leaguesRef.listDocuments();
  const existingDates = await datesRef.listDocuments();
  const quickBetsPayload = await loadQuickBetsPayload(leagues, parsed.captured_at || sourceData.captured_at || null);
  const existingQuickBetDates = await quickBetsDatesRef.listDocuments();
  const operations = [];

  for (const ref of existingChunks) {
    operations.push({ type: 'delete', ref });
  }

  const targetLeagueIds = new Set(leagues.map((league, index) => slugify(league.id || league.name, String(index).padStart(2, '0'))));
  leagues.forEach((league, index) => {
    const id = slugify(league.id || league.name, String(index).padStart(2, '0'));
    operations.push({ type: 'set', ref: leaguesRef.doc(id), payload: firestoreSafe({
      index,
      id: league.id ?? id,
      name: league.name || id,
      season: league.season || null,
      round: league.round ?? null,
      logo: league.logo || null,
      matchCount: Array.isArray(league.matches) ? league.matches.length : 0,
      matches: Array.isArray(league.matches) ? league.matches.map(slimLeagueDocMatch) : [],
      updatedAt: FieldValue.serverTimestamp(),
    }) });
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
    if (!targetLeagueIds.has(ref.id)) operations.push({ type: 'delete', ref });
  }

  for (const ref of existingDates) {
    if (!targetDateIds.has(ref.id)) operations.push({ type: 'delete', ref });
  }

  const availableDates = [...dateBuckets.keys()].filter((date) => date !== 'unknown').sort();
  for (const [date, leaguesByDate] of dateBuckets.entries()) {
    const dateLeagues = [...leaguesByDate.values()];
    operations.push({ type: 'set', ref: datesRef.doc(slugify(date, 'unknown')), payload: firestoreSafe({
      format: 'date_doc_v1',
      date,
      capturedAt: parsed.captured_at || null,
      source: parsed.source || null,
      availableDates,
      leagueCount: dateLeagues.length,
      matchCount: dateLeagues.reduce((sum, league) => sum + league.matches.length, 0),
      leagues: dateLeagues,
      updatedAt: FieldValue.serverTimestamp(),
    }) });
  }

  operations.push({ type: 'set', ref: metaRef, payload: {
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
  } });

  const { payload: fastPayload, cutoff: fastCutoff, byteLength: fastByteLength, days: fastDays, overflow: fastOverflow } = selectFastPayload(leagues, parsed, allTimeSummary, availableDates);
  operations.push({ type: 'set', ref: fastRef, payload: fastPayload });

  const quickBetDates = [...quickBetsPayload.dates.keys()].sort();
  const targetQuickBetDateIds = new Set(quickBetDates.map((date) => slugify(date, 'unknown')));
  for (const ref of existingQuickBetDates) {
    if (!targetQuickBetDateIds.has(ref.id)) operations.push({ type: 'delete', ref });
  }

  operations.push({ type: 'set', ref: quickBetsRef, payload: quickBetsPayload.meta });
  for (const date of quickBetDates) {
    const matches = quickBetsPayload.dates.get(date) || [];
    operations.push({
      type: 'set',
      ref: quickBetsDatesRef.doc(slugify(date, 'unknown')),
      payload: firestoreSafe({
        format: 'quick_bets_date_v1',
        date,
        capturedAt: quickBetsPayload.meta.capturedAt || null,
        source: quickBetsPayload.meta.source || 'Sportsbet',
        sourceUrl: quickBetsPayload.meta.sourceUrl || null,
        refreshStatus: quickBetsPayload.meta.refreshStatus || 'core-only',
        maxOddsExclusive: quickBetsPayload.meta.maxOddsExclusive || QUICK_BET_MAX_ODDS_EXCLUSIVE,
        matchCount: matches.length,
        totalSelections: quickBetSelectionCount(matches),
        matches,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    });
  }

  await commitUploadOperations(db, operations);
  await verifyFirestoreDayMarketsSettled(db, adelaideTodayIso(), new Set(dateBuckets.keys()));
  console.log(`Uploaded ${dataPath} to Firestore dashboardData/${DOC_ID} as ${leagues.length} league docs and ${dateBuckets.size} date docs.`);
  if (fastOverflow) {
    console.log(`Uploaded fast dashboard doc dashboardData/${FAST_DOC_ID} as metadata-only fallback (${(fastByteLength / 1024).toFixed(1)} KB); app will use date/league docs.`);
  } else {
    console.log(`Uploaded fast dashboard doc dashboardData/${FAST_DOC_ID} (${fastDays}-day window from ${fastCutoff}, ${(fastByteLength / 1024).toFixed(1)} KB).`);
  }
  console.log(`Uploaded quick bets to Firestore dashboardData/${QUICK_BETS_DOC_ID} as ${quickBetsPayload.dates.size} date docs (${quickBetsPayload.meta.totalMatches} matches, ${quickBetsPayload.meta.totalSelections} selections).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
