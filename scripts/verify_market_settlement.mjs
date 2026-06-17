import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { precomputeDisplayData } from './precompute_display_markets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'agent-system', 'outputs');
const DATA_PATH = path.join(ROOT, 'match_data.json');
const PREDICTION_TRACKING_START_DATE = '2026-04-22';
const DRAW_NO_BET_TRACKING_START_DATE = '2026-05-25';
const SETTLED_RESULTS = new Set(['hit', 'miss', 'pass', 'void']);

function adelaideTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isFt(match) {
  return String(match?.status || '').toLowerCase() === 'ft';
}

function settledResult(market) {
  const result = String(market?.result || '').toLowerCase();
  return SETTLED_RESULTS.has(result) ? result : '';
}

function actualWinner(match) {
  const home = Number(match?.home?.goals);
  const away = Number(match?.away?.goals);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

function settleTotalMarket(market, actual) {
  if (!market || actual === null || actual === undefined) return false;
  const value = Number(actual);
  const line = Number(market.line);
  if (!Number.isFinite(value) || !Number.isFinite(line)) return false;
  if (market.pick === 'Over') market.result = value > line ? 'hit' : 'miss';
  else if (market.pick === 'Under') market.result = value < line ? 'hit' : 'miss';
  else return false;
  market.actual = value;
  return true;
}

function repairPredictionMarkets(match) {
  const predictions = match.predictions || {};
  const winner = actualWinner(match);
  let repaired = 0;

  if (predictions.winner && winner && !settledResult(predictions.winner)) {
    predictions.winner.result = predictions.winner.type === winner ? 'hit' : 'miss';
    delete predictions.winner.picked;
    repaired += 1;
  }

  if (predictions.btts && winner && !settledResult(predictions.btts)) {
    const actualBtts = Number(match.home?.goals) > 0 && Number(match.away?.goals) > 0;
    predictions.btts.actual_btts = actualBtts;
    predictions.btts.result = (String(predictions.btts.pick || '').toLowerCase() === 'yes') === actualBtts ? 'hit' : 'miss';
    repaired += 1;
  }

  const goalTotal = Number(match.home?.goals) + Number(match.away?.goals);
  if (predictions.ou_goals && Number.isFinite(goalTotal) && !settledResult(predictions.ou_goals)) {
    repaired += settleTotalMarket(predictions.ou_goals, goalTotal) ? 1 : 0;
  }
  if (predictions.ou_cards && !settledResult(predictions.ou_cards)) {
    repaired += settleTotalMarket(predictions.ou_cards, match.actuals?.cards_total) ? 1 : 0;
  }
  if (predictions.ou_corners && !settledResult(predictions.ou_corners)) {
    repaired += settleTotalMarket(predictions.ou_corners, match.actuals?.corners_total) ? 1 : 0;
  }

  if (repaired) {
    match.predictions = predictions;
    match.prediction_locked = true;
    match.market_settlement_repaired_at = new Date().toISOString();
  }
  return repaired;
}

function requiredMarkets(match) {
  const display = match.display_markets || {};
  const predictions = match.predictions || {};
  const rows = [
    ['winner', display.winner?.market || predictions.winner, 'score-derived'],
    ['btts', display.btts?.market || predictions.btts, 'score-derived'],
    ['goals', display.goals?.market || predictions.ou_goals, 'score-derived'],
    ['cards', display.cards?.market || predictions.ou_cards, match.actuals?.cards_total === undefined ? 'missing cards_total actual' : 'actuals-derived'],
    ['corners', display.corners?.market || predictions.ou_corners, match.actuals?.corners_total === undefined ? 'missing corners_total actual' : 'actuals-derived'],
  ];
  if (display.double_chance?.market) rows.push(['double_chance', display.double_chance.market, 'score-derived display market']);
  if (display.draw_no_bet?.market && String(match.date || '') >= DRAW_NO_BET_TRACKING_START_DATE) {
    rows.push(['draw_no_bet', display.draw_no_bet.market, 'score-derived display market']);
  }
  if (match.display_summary?.compactMarket?.market) rows.push(['suggested', match.display_summary.compactMarket.market, 'selected display market']);
  return rows;
}

function matchLabel(match) {
  const home = match.home?.short || match.home?.name || 'Home';
  const away = match.away?.short || match.away?.name || 'Away';
  return `${match.date || '?'} ${match.time || '?'} ${match.league || match.leagueName || '?'} ${home} vs ${away} [${match.id || 'no-id'}]`;
}

function unresolvedRows(match) {
  return requiredMarkets(match)
    .filter(([, market]) => market && !settledResult(market))
    .map(([market, , reason]) => ({
      matchId: String(match.id || ''),
      date: match.date || null,
      league: match.league || match.leagueName || null,
      home: match.home?.name || match.home?.short || null,
      away: match.away?.name || match.away?.short || null,
      market,
      reason,
      action_required: reason.startsWith('missing ') ? 'fetch provider actuals or add manual result import' : 'repair display/precomputed market settlement',
      label: `${matchLabel(match)} ${market}`,
    }));
}

function renderMarkdown(report) {
  const lines = [
    '# Market Settlement Verification',
    '',
    `Agent: codex 5.3`,
    `Date checked: ${report.date}`,
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `FT matches checked: ${report.ftMatchesChecked}`,
    `Markets repaired: ${report.marketsRepaired}`,
    `Unresolved markets: ${report.unresolvedMarkets.length}`,
    '',
    '## Decision',
    '',
    report.unresolvedMarkets.length
      ? 'Stop before Firestore upload; required FT markets are still unsettled.'
      : 'Proceed; all required FT markets for the day are settled.',
  ];

  if (report.repairedRows.length) {
    lines.push('', '## Repaired', '');
    report.repairedRows.forEach((row) => lines.push(`- ${row}`));
  }

  if (report.unresolvedMarkets.length) {
    lines.push('', '## Unresolved', '');
    report.unresolvedMarkets.forEach((row) => lines.push(`- ${row.label}: ${row.reason}; ${row.action_required}`));
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const targetDate = process.env.SOCCER_MARKET_SETTLEMENT_DATE || adelaideTodayIso();
  const raw = await readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  let repaired = 0;
  const repairedRows = [];

  for (const league of Array.isArray(data.leagues) ? data.leagues : []) {
    for (const match of Array.isArray(league.matches) ? league.matches : []) {
      if (String(match.date || '') !== targetDate || !isFt(match) || String(match.date || '') < PREDICTION_TRACKING_START_DATE) continue;
      match.league = match.league || league.name || league.id || null;
      const count = repairPredictionMarkets(match);
      if (count) {
        repaired += count;
        repairedRows.push(`${matchLabel(match)} repaired=${count}`);
      }
    }
  }

  if (repaired) await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const displayData = precomputeDisplayData(data);
  const dayMatches = (Array.isArray(displayData.leagues) ? displayData.leagues : [])
    .flatMap((league) => (Array.isArray(league.matches) ? league.matches : []).map((match) => ({ ...match, leagueName: league.name || league.id || null })))
    .filter((match) => String(match.date || '') === targetDate && isFt(match) && String(match.date || '') >= PREDICTION_TRACKING_START_DATE);

  const unresolvedMarkets = dayMatches.flatMap(unresolvedRows);
  const report = {
    format: 'market_settlement_verification_v1',
    agent: 'codex 5.3',
    generatedAt: new Date().toISOString(),
    date: targetDate,
    status: unresolvedMarkets.length ? 'failed' : 'ok',
    ftMatchesChecked: dayMatches.length,
    marketsRepaired: repaired,
    repairedRows,
    unresolvedMarkets,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'market_settlement_verification_latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(OUT_DIR, 'market_settlement_verification_latest.md'), renderMarkdown(report), 'utf8');

  console.log(`Market settlement verification ${targetDate}: FT=${report.ftMatchesChecked} repaired=${repaired} unresolved=${unresolvedMarkets.length}`);
  if (unresolvedMarkets.length) {
    unresolvedMarkets.slice(0, 12).forEach((row) => console.error(`${row.label}: ${row.reason}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
