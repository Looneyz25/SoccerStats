import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accaLegKey, marketKeyForLabel, selectionForRow, legFromMarketRow } from './bet-slip-utils.mjs';

const match = { id: 'm1', date: '2026-06-18', league: 'FIFA World Cup', home: { name: 'Portugal' }, away: { name: 'Congo DR' } };

test('accaLegKey is matchId::label', () => {
  assert.equal(accaLegKey('m1', 'BTTS'), 'm1::BTTS');
});

test('marketKeyForLabel maps display labels to scoring keys', () => {
  assert.equal(marketKeyForLabel('Winner'), 'winner');
  assert.equal(marketKeyForLabel('Draw No Bet'), 'draw_no_bet');
  assert.equal(marketKeyForLabel('BTTS'), 'btts');
  assert.equal(marketKeyForLabel('Goals'), 'goals');
  assert.equal(marketKeyForLabel('Cards'), 'cards');
  assert.equal(marketKeyForLabel('Corners'), 'corners');
});

test('selectionForRow derives home/draw/away/yes/no/over/under', () => {
  assert.equal(selectionForRow('winner', { pick: 'Portugal' }, match), 'home');
  assert.equal(selectionForRow('winner', { pick: 'Congo DR' }, match), 'away');
  assert.equal(selectionForRow('winner', { pick: 'Draw' }, match), 'draw');
  assert.equal(selectionForRow('draw_no_bet', { pick: 'Portugal DNB' }, match), 'home');
  assert.equal(selectionForRow('btts', { pick: 'Yes' }, match), 'yes');
  assert.equal(selectionForRow('goals', { pick: 'Over 2.5' }, match), 'over');
  assert.equal(selectionForRow('corners', { pick: 'Under 10.5' }, match), 'under');
});

test('legFromMarketRow builds the structured leg (real book price)', () => {
  const row = { label: 'Goals', pick: 'Over 2.5', book: 1.83, prob: 0.62, line: 2.5 };
  const leg = legFromMarketRow(row, match);
  assert.deepEqual(leg, {
    matchId: 'm1', date: '2026-06-18', marketKey: 'goals', selection: 'over',
    line: 2.5, label: 'Goals', pick: 'Over 2.5', matchLabel: 'Portugal v Congo DR',
    league: 'FIFA World Cup', book: 1.83, priceEstimated: false, prob: 0.62,
  });
});

test('legFromMarketRow flags estimated price when only model odds exist', () => {
  const row = { label: 'Corners', pick: 'Over 10.5', modelOdds: 1.95, prob: 0.51, line: 10.5 };
  const leg = legFromMarketRow(row, match);
  assert.equal(leg.book, 1.95);
  assert.equal(leg.priceEstimated, true);
});

test('legFromMarketRow returns null for an unscorable row', () => {
  assert.equal(legFromMarketRow({ label: 'Mystery', pick: 'x' }, match), null);
});
