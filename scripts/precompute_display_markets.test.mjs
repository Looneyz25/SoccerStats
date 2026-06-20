import assert from 'node:assert/strict';
import test from 'node:test';
import { precomputeDisplayData } from './precompute_display_markets.mjs';

function baseFinishedMatch() {
  return {
    id: 'match-1',
    date: '2026-06-11',
    time: '05:15',
    status: 'FT',
    home: { name: 'Portugal', short: 'Portugal', goals: 2, team_id: 'home-1' },
    away: { name: 'Nigeria', short: 'Nigeria', goals: 1, team_id: 'away-1' },
    odds: { home: 1.25, draw: 5.5, away: 11 },
    sportsbet_odds: { home: 1.25, draw: 5.5, away: 11 },
    sportsbet_markets: {
      'Full time': { '1': 1.25, X: 5.5, '2': 11 },
      'Both teams to score': { Yes: 2, No: 1.72 },
      'Match goals 2.5': { Over: 1.59, Under: 2.27 },
    },
    predictions: {
      factors: { lambda_home: 1.8, lambda_away: 0.8, dixon_coles_rho: 0 },
      winner: { pick: 'Portugal', type: 'home', probability: 0.62, result: 'hit' },
      btts: { pick: 'Yes', probability: 0.58, result: 'hit' },
      ou_goals: { pick: 'Over', line: 2.5, probability: 0.61, result: 'hit', actual: 3 },
    },
  };
}

test('precompute attaches stored bookmaker odds to finished display markets', () => {
  const data = precomputeDisplayData({
    leagues: [{ id: 'intl', name: 'International Friendly Games', matches: [baseFinishedMatch()] }],
  });

  const match = data.leagues[0].matches[0];

  assert.equal(match.display_markets.winner.market.odds, 1.25);
  assert.equal(match.display_markets.btts.market.odds, 2);
  assert.equal(match.display_markets.goals.market.odds, 1.59);
  assert.equal(match.display_summary.headlineSummary.oddsHit, 1.8);
  assert.equal(match.display_summary.headlineSummary.oddsPriced, 3);
});
