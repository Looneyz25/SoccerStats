import assert from 'node:assert/strict';
import { test } from 'node:test';

import { precomputeDisplayData } from '../scripts/precompute_display_markets.mjs';

function precomputeSingleMatch(overrides = {}) {
  const match = {
    id: 'live-dnb-regression',
    date: '2026-07-04',
    time: '03:30',
    status: 'live',
    home: { name: 'Australia', short: 'Australia', team_id: 'home', goals: 0 },
    away: { name: 'Egypt', short: 'Egypt', team_id: 'away', goals: 1 },
    odds: { home: 2.4, draw: 3.2, away: 3.1 },
    sportsbet_markets: {
      'Draw No Bet': { 1: 1.98, 2: 2.05 },
    },
    predictions: {
      factors: {
        lambda_home: 1.8,
        lambda_away: 1.0,
        dixon_coles_rho: 0,
      },
      winner: {
        pick: 'Australia',
        type: 'home',
        probability: 0.52,
      },
      btts: {
        pick: 'Yes',
        probability: 0.58,
      },
      ou_goals: {
        pick: 'Over',
        line: 2.5,
        probability: 0.54,
      },
    },
    ...overrides,
  };

  const data = {
    leagues: [
      {
        id: 'world-cup',
        name: 'FIFA World Cup',
        matches: [match],
      },
    ],
  };

  return precomputeDisplayData(data).leagues[0].matches[0];
}

test('live matches do not precompute Draw No Bet as settled from the live score', () => {
  const match = precomputeSingleMatch();

  assert.equal(match.display_markets.draw_no_bet.market.result, undefined);
});

test('finished matches still precompute Draw No Bet settlement from the final score', () => {
  const match = precomputeSingleMatch({ status: 'FT' });

  assert.equal(match.display_markets.draw_no_bet.market.result, 'miss');
});
