#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'match_data.json');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const fixtures = [];
for (const lg of data.leagues || []) {
  const leagueName = lg.name || lg.league || lg.id || null;
  for (const f of lg.fixtures || lg.matches || []) {
    fixtures.push({ ...f, _league: leagueName });
  }
}

const isFT = (f) => f.status === 'FT';
const isUpcoming = (f) => f.status !== 'FT';

function get(obj, dottedPath) {
  const parts = dottedPath.split('.');
  let v = obj;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

function present(value) {
  if (value === undefined || value === null) return false;
  if (value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

const checks = [
  { card: 'Fixture meta', field: '_league', when: 'always', threshold: 1.0 },
  { card: 'Fixture meta', field: 'date', when: 'always', threshold: 1.0 },
  { card: 'Fixture meta', field: 'time', when: 'always', threshold: 1.0 },
  { card: 'Match detail venue', field: 'venue', when: 'always', threshold: 0.8 },
  { card: 'Match detail referee', field: 'referee.name', when: 'always', threshold: 0.0, advisory: true },
  { card: 'Team header (home)', field: 'home.name', when: 'always', threshold: 1.0 },
  { card: 'Team header (home rank)', field: 'home.rank', when: 'always', threshold: 0.95 },
  { card: 'Team header (home pts)', field: 'home.pts', when: 'always', threshold: 0.95 },
  { card: 'Team header (away)', field: 'away.name', when: 'always', threshold: 1.0 },
  { card: 'Team header (away rank)', field: 'away.rank', when: 'always', threshold: 0.95 },
  { card: 'Bookmaker odds (1x2)', field: 'odds', when: 'upcoming', threshold: 0.95 },
  { card: 'Bookmaker odds (sportsbet)', field: 'sportsbet_odds', when: 'upcoming', threshold: 0.9 },
  { card: 'Bookmaker direct link', field: 'bookmaker_links', when: 'upcoming', threshold: 0.0, advisory: true },
  { card: 'Winner pill', field: 'predictions.winner.pick', when: 'always', threshold: 1.0 },
  { card: 'BTTS pill', field: 'predictions.btts.pick', when: 'always', threshold: 1.0 },
  { card: 'Goals pill', field: 'predictions.ou_goals.pick', when: 'always', threshold: 1.0 },
  { card: 'Cards pill', field: 'predictions.ou_cards.pick', when: 'always', threshold: 1.0 },
  { card: 'Prediction factors (Elo etc.)', field: 'predictions.factors', when: 'always', threshold: 0.9 },
  { card: 'Team streaks (>=1)', field: 'team_streaks', when: 'always', threshold: 0.9 },
  { card: 'H2H streaks (>=1)', field: 'h2h_streaks', when: 'always', threshold: 0.95 },
  { card: 'Score (home goals)', field: 'home.goals', when: 'FT', threshold: 1.0 },
  { card: 'Score (away goals)', field: 'away.goals', when: 'FT', threshold: 1.0 },
  { card: 'Actuals corners', field: 'actuals.corners_total', when: 'FT', threshold: 1.0 },
  { card: 'Actuals fouls', field: 'actuals.fouls_total', when: 'FT', threshold: 1.0 },
  { card: 'Actuals shots (home)', field: 'actuals.home_sot', when: 'FT', threshold: 1.0 },
  { card: 'Actuals shots (away)', field: 'actuals.away_sot', when: 'FT', threshold: 1.0 },
  { card: 'Actuals HT winner', field: 'actuals.ht_winner', when: 'FT', threshold: 1.0 },
  { card: 'Actuals first scorer', field: 'actuals.first_scorer', when: 'FT', threshold: 0.95 },
  { card: 'Settled winner', field: 'predictions.winner.result', when: 'FT', threshold: 1.0 },
  { card: 'Settled BTTS', field: 'predictions.btts.result', when: 'FT', threshold: 1.0 },
  { card: 'Settled goals', field: 'predictions.ou_goals.result', when: 'FT', threshold: 1.0 },
  { card: 'Settled cards', field: 'predictions.ou_cards.result', when: 'FT', threshold: 0.95 },
];

function pool(when) {
  if (when === 'FT') return fixtures.filter(isFT);
  if (when === 'upcoming') return fixtures.filter(isUpcoming);
  return fixtures;
}

const rows = checks.map((c) => {
  const p = pool(c.when);
  const denom = p.length || 1;
  const hits = p.filter((f) => present(get(f, c.field))).length;
  const ratio = hits / denom;
  let status;
  if (c.advisory) status = 'INFO';
  else if (ratio >= c.threshold) status = 'PASS';
  else if (ratio >= c.threshold - 0.05) status = 'WARN';
  else status = 'FAIL';
  return { ...c, hits, denom, ratio, status };
});

const w1 = Math.max(...rows.map((r) => r.card.length));
const w2 = Math.max(...rows.map((r) => r.field.length));
const fmtPct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);

const order = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };
rows.sort((a, b) => order[a.status] - order[b.status] || a.card.localeCompare(b.card));

console.log(`Audit of match_data.json — ${fixtures.length} fixtures (FT=${fixtures.filter(isFT).length}, upcoming=${fixtures.filter(isUpcoming).length})\n`);
console.log(
  `${'Status'.padEnd(6)}  ${'Card'.padEnd(w1)}  ${'Field'.padEnd(w2)}  ${'When'.padEnd(9)}  ${'Coverage'.padStart(8)}  ${'Need'.padStart(6)}`
);
console.log('-'.repeat(6 + 2 + w1 + 2 + w2 + 2 + 9 + 2 + 8 + 2 + 6));
for (const r of rows) {
  console.log(
    `${r.status.padEnd(6)}  ${r.card.padEnd(w1)}  ${r.field.padEnd(w2)}  ${String(r.when).padEnd(9)}  ${fmtPct(r.ratio)} (${r.hits}/${r.denom})  ${fmtPct(r.threshold)}`
  );
}

const fails = rows.filter((r) => r.status === 'FAIL');
const warns = rows.filter((r) => r.status === 'WARN');

if (fails.length || warns.length) {
  console.log('\nWorst offenders (first 5 fixtures missing each failing field):');
  for (const r of [...fails, ...warns]) {
    const p = pool(r.when);
    const missing = p.filter((f) => !present(get(f, r.field))).slice(0, 5);
    console.log(`\n  ${r.status}  ${r.card} — ${r.field}`);
    for (const f of missing) {
      console.log(`    - ${f.id || '?'}  ${f.home?.name || '?'} v ${f.away?.name || '?'}  (${f.date || '?'} ${f._league || ''})`);
    }
  }
}

console.log(
  `\nSummary: ${rows.filter((r) => r.status === 'PASS').length} pass, ${warns.length} warn, ${fails.length} fail, ${rows.filter((r) => r.status === 'INFO').length} advisory.`
);

process.exit(fails.length ? 1 : 0);
