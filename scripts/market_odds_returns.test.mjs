import assert from 'node:assert/strict';
import test from 'node:test';
import { marketReturnTotals, pricedMarketOdds } from './market_odds_returns.mjs';

test('winners bank profit (odds - 1) and losers forfeit one stake', () => {
  const totals = marketReturnTotals([
    { result: 'hit', odds: 2.4 },
    { result: 'miss', odds: 201 },
    { result: 'miss', odds: 3.25 },
  ]);

  assert.deepEqual(totals, { hit: 1.4, loss: 2, priced: 3 });
});

test('estimated odds are not treated as priced bookmaker returns', () => {
  assert.equal(pricedMarketOdds({ odds: 192.43, odds_estimated: true }), null);

  const totals = marketReturnTotals([
    { result: 'miss', odds: 192.43, odds_estimated: true },
    { result: 'hit', odds: 1.08, odds_estimated: true },
  ]);

  assert.deepEqual(totals, { hit: 0, loss: 0, priced: 0 });
});
