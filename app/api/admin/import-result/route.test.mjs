import test from 'node:test';
import assert from 'node:assert/strict';

import { hydrateImportBaseMatch, normalizeImport } from './route.js';

test('normalizeImport reads final score from homeTeam/awayTeam score payloads', () => {
  const item = normalizeImport({
    id: 15186710,
    date: '2026-06-12',
    league: 'FIFA World Cup',
    home: 'Mexico',
    away: 'South Africa',
    homeTeam: {
      name: 'Mexico',
      score: 2,
    },
    awayTeam: {
      name: 'South Africa',
      score: 0,
    },
    statistics: {
      cornerKicks: { home: 3, away: 1 },
      fouls: { home: 12, away: 11 },
    },
    status: 'FT',
  });

  assert.equal(item.score.home, 2);
  assert.equal(item.score.away, 0);
  assert.equal(item.actuals.corners_total, 4);
  assert.equal(item.actuals.fouls_total, 23);
});

test('hydrateImportBaseMatch restores richer local prediction context for sparse firestore shells', () => {
  const item = {
    matchId: '15186710',
    date: '2026-06-12',
    league: 'FIFA World Cup',
    homeName: 'Mexico',
    awayName: 'South Africa',
  };

  const hydrated = hydrateImportBaseMatch(
    {
      id: 15186710,
      date: '2026-06-12',
      home: { name: 'Mexico' },
      away: { name: 'South Africa' },
      predictions: {},
      display_markets: {},
      display_summary: { compactMarket: null },
    },
    item,
  );

  assert.ok(hydrated.predictions?.winner);
  assert.ok(hydrated.predictions?.ou_goals);
  assert.ok(hydrated.sportsbet_odds?.home);
  assert.equal(hydrated.display_markets?.winner?.market?.pick, 'Mexico');
});
