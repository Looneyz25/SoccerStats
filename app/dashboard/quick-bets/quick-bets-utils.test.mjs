import assert from 'node:assert/strict';
import test from 'node:test';
import { quickBetMatchState } from './quick-bets-utils.mjs';

test('quickBetMatchState separates pending results from explicit voids', () => {
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'result_pending', score: null }), 'Result pending');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'FT', score: null }), 'Result pending');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'FT', score: '2-0' }), '2-0 · FT');
  for (const status of ['postponed_or_cancelled', 'cancelled', 'postponed', 'void']) {
    assert.equal(quickBetMatchState({ lifecycle: 'result', status, score: '1-0' }), 'Void');
  }
});
