import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumber,
  marketLine,
  marketActualResult,
  scoreLeg,
  computeSlipStatus,
  isFinishedMatch,
  settleLegResult,
} from './match-scoring.mjs';

const matchHomeWin = { home: { goals: 2 }, away: { goals: 0 }, actuals: { cards_total: 5, corners_total: 11 } };
const matchDraw = { home: { goals: 1 }, away: { goals: 1 }, actuals: { cards_total: 3, corners_total: 8 } };
const matchAwayWin = { home: { goals: 0 }, away: { goals: 3 }, actuals: { cards_total: 6, corners_total: 12 } };
const matchUpcoming = { home: {}, away: {}, actuals: {} };

test('parseNumber handles numbers, numeric strings, blanks', () => {
  assert.equal(parseNumber(3), 3);
  assert.equal(parseNumber('2.5'), 2.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('x'), null);
  assert.equal(parseNumber(NaN), null);
});

test('marketLine reads display_markets, falls back to predictions then default', () => {
  assert.equal(marketLine({ display_markets: { goals: { market: { line: 3.5 } } } }, 'goals', 2.5), 3.5);
  assert.equal(marketLine({ predictions: { ou_cards: { line: 5.5 } } }, 'cards', 4.5), 5.5);
  assert.equal(marketLine({}, 'corners', 10.5), 10.5);
});

test('marketActualResult scores the five standard markets (boolean|null)', () => {
  assert.equal(marketActualResult(matchHomeWin, 'winner', 'home'), true);
  assert.equal(marketActualResult(matchHomeWin, 'winner', 'away'), false);
  assert.equal(marketActualResult(matchDraw, 'winner', 'draw'), true);
  assert.equal(marketActualResult(matchHomeWin, 'btts', 'no'), true);
  assert.equal(marketActualResult(matchDraw, 'btts', 'yes'), true);
  assert.equal(marketActualResult(matchUpcoming, 'winner', 'home'), null);
});

test('scoreLeg: winner / btts / draw_no_bet', () => {
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'winner', selection: 'home' }), 'hit');
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'winner', selection: 'home' }), 'miss');
  assert.equal(scoreLeg(matchDraw, { marketKey: 'btts', selection: 'yes' }), 'hit');
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'draw_no_bet', selection: 'home' }), 'hit');
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'draw_no_bet', selection: 'home' }), 'miss');
  assert.equal(scoreLeg(matchDraw, { marketKey: 'draw_no_bet', selection: 'home' }), 'void');
  assert.equal(scoreLeg(matchUpcoming, { marketKey: 'draw_no_bet', selection: 'home' }), null);
});

test('scoreLeg: over/under uses the leg-captured line (incl. integer push)', () => {
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'over', line: 1.5 }), 'hit'); // total 2
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'under', line: 1.5 }), 'miss');
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'goals', selection: 'over', line: 2 }), 'void'); // total 2 == line 2
  assert.equal(scoreLeg(matchHomeWin, { marketKey: 'cards', selection: 'under', line: 5.5 }), 'hit'); // 5 cards
  assert.equal(scoreLeg(matchAwayWin, { marketKey: 'corners', selection: 'over', line: 10.5 }), 'hit'); // 12 corners
  assert.equal(scoreLeg(matchUpcoming, { marketKey: 'corners', selection: 'over', line: 10.5 }), null);
});

test('isFinishedMatch is true only at FT', () => {
  assert.equal(isFinishedMatch({ status: 'FT' }), true);
  assert.equal(isFinishedMatch({ status: 'live' }), false);
  assert.equal(isFinishedMatch({ status: 'upcoming' }), false);
  assert.equal(isFinishedMatch(null), false);
  assert.equal(isFinishedMatch({}), false);
});

test('settleLegResult: live only locks Over-goals-met and BTTS-yes-met as hit', () => {
  // 2-1 live: 3 goals total, both scored
  const live21 = { status: 'live', home: { goals: 2 }, away: { goals: 1 }, actuals: {} };
  const live10 = { status: 'live', home: { goals: 1 }, away: { goals: 0 }, actuals: {} };
  // Over goals locks once total is past the line
  assert.equal(settleLegResult(live21, { marketKey: 'goals', selection: 'over', line: 2.5 }), 'hit');
  assert.equal(settleLegResult(live10, { marketKey: 'goals', selection: 'over', line: 2.5 }), null);
  // Under never settles live
  assert.equal(settleLegResult(live10, { marketKey: 'goals', selection: 'under', line: 2.5 }), null);
  // BTTS yes locks once both scored; not before
  assert.equal(settleLegResult(live21, { marketKey: 'btts', selection: 'yes' }), 'hit');
  assert.equal(settleLegResult(live10, { marketKey: 'btts', selection: 'yes' }), null);
  assert.equal(settleLegResult(live21, { marketKey: 'btts', selection: 'no' }), null);
  // Winner / DNB never settle live even with a lead
  assert.equal(settleLegResult(live21, { marketKey: 'winner', selection: 'home' }), null);
  assert.equal(settleLegResult(live21, { marketKey: 'draw_no_bet', selection: 'home' }), null);
  // Corners / cards never settle live (still accumulating)
  assert.equal(settleLegResult(live21, { marketKey: 'corners', selection: 'over', line: 1.5 }), null);
  assert.equal(settleLegResult(live21, { marketKey: 'cards', selection: 'over', line: 0.5 }), null);
});

test('settleLegResult: FT delegates to full scoreLeg; upcoming is pending', () => {
  const ft = { status: 'FT', home: { goals: 1 }, away: { goals: 3 }, actuals: { cards_total: 2, corners_total: 7 } };
  assert.equal(settleLegResult(ft, { marketKey: 'btts', selection: 'yes' }), 'hit');
  assert.equal(settleLegResult(ft, { marketKey: 'winner', selection: 'home' }), 'miss');
  assert.equal(settleLegResult(ft, { marketKey: 'goals', selection: 'under', line: 2.5 }), 'miss'); // 4 goals
  assert.equal(settleLegResult({ status: 'upcoming', home: {}, away: {} }, { marketKey: 'goals', selection: 'over', line: 2.5 }), null);
});

test('computeSlipStatus', () => {
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: null }]), 'pending');
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'miss' }]), 'lost');
  assert.equal(computeSlipStatus([{ result: null }, { result: 'miss' }]), 'lost'); // a miss settles the slip
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'hit' }]), 'won');
  assert.equal(computeSlipStatus([{ result: 'hit' }, { result: 'void' }]), 'won');
  assert.equal(computeSlipStatus([{ result: 'void' }, { result: 'void' }]), 'void');
});
