import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyPublishedResults } from './upload_match_data_to_firestore.mjs';

const fixture = () => ({ id: 'espn:123', date: '2026-09-11', status: 'FT', prediction_locked: true,
  home: { goals: 2 }, away: { goals: 1 }, predictions: { winner: { pick: 'Home', result: 'hit' }, btts: { result: 'hit' },
    ou_goals: { result: 'hit' }, ou_cards: { result: 'miss' }, ou_corners: { result: 'pass' } } });

test('verified publication requires every expected result, score and lock', () => {
  const expected = fixture();
  assert.doesNotThrow(() => verifyPublishedResults([expected], [fixture()], 'date'));
  assert.throws(() => verifyPublishedResults([expected], [], 'date'), /missing or differs/);
  for (const alter of [m => m.status = 'upcoming', m => m.home.goals = 3, m => delete m.prediction_locked]) {
    const remote = fixture(); alter(remote);
    assert.throws(() => verifyPublishedResults([expected], [remote], 'league'), /missing or differs/);
  }
});

test('verification rejects unsettled visible stat and Double Chance markets', () => {
  const expected = fixture(); const remote = fixture(); delete remote.predictions.ou_cards.result;
  assert.throws(() => verifyPublishedResults([expected], [remote], 'date'), /verification failed/);
  const dc = fixture(); dc.display_markets = { double_chance: { market: { pick: 'Home or Draw' } } };
  assert.throws(() => verifyPublishedResults([expected], [dc], 'date'), /verification failed/);
});

test('terminal void fixtures verify without invented final scores', () => {
  const cancelled = { id: 'espn:void', status: 'postponed_or_cancelled', prediction_locked: true };
  assert.doesNotThrow(() => verifyPublishedResults([cancelled], [cancelled], 'date'));
});

test('expected markets cannot disappear or change selection or result', () => {
  for (const key of ['winner', 'btts', 'ou_goals', 'ou_cards', 'ou_corners']) {
    const expected = fixture(); const remote = fixture(); delete remote.predictions[key];
    assert.throws(() => verifyPublishedResults([expected], [remote], 'date'), /expected market/);
  }
  for (const key of ['double_chance', 'draw_no_bet', 'suggested']) {
    const expected = fixture(); const remote = fixture();
    const market = { pick: 'Home or Draw', line: 1.5, probability: 0.7, result: 'hit' };
    if (key === 'suggested') expected.display_summary = { compactMarket: { market } };
    else expected.display_markets = { [key]: { market } };
    assert.throws(() => verifyPublishedResults([expected], [remote], 'date'), /expected market/);
  }
  for (const [field, value] of [['result', 'miss'], ['pick', 'Away'], ['probability', 0.1], ['model_probability', 0.2], ['line', 3.5]]) {
    const expected = fixture(); const remote = fixture(); remote.predictions.winner[field] = value;
    assert.throws(() => verifyPublishedResults([expected], [remote], 'date'), /expected market/);
  }
});

test('actual compact league and fast projections retain verifiable result contracts', () => {
  const source = readFileSync(new URL('./upload_match_data_to_firestore.mjs', import.meta.url), 'utf8');
  const fields = source.match(/const MATCH_KEEP_FIELDS = \[[\s\S]*?\n\];/)[0];
  const extract = name => source.match(new RegExp(`function ${name}\\(match\\) \\{[\\s\\S]*?\\n\\}`))[0];
  const { slimMatch, slimLeagueDocMatch } = new Function(`${fields}\n${extract('slimMatch')}\n${extract('slimLeagueDocMatch')}\nreturn {slimMatch,slimLeagueDocMatch};`)();
  const expected = fixture();
  expected.display_summary = { compactMarket: { market: { pick: 'Yes', result: 'hit', probability: 0.75 } } };
  for (const project of [slimMatch, slimLeagueDocMatch]) {
    const payload = project(expected);
    assert.equal(payload.prediction_locked, true);
    assert.doesNotThrow(() => verifyPublishedResults([payload], [structuredClone(payload)], 'projection'));
    const missing = structuredClone(payload); delete missing.prediction_locked;
    assert.throws(() => verifyPublishedResults([payload], [missing], 'projection'), /prediction lock/);
    const missingSuggested = structuredClone(payload); delete missingSuggested.display_summary;
    assert.throws(() => verifyPublishedResults([payload], [missingSuggested], 'projection'), /expected market/);
  }
  assert.equal(slimLeagueDocMatch(expected).predictions, undefined);
  assert.doesNotThrow(() => verifyPublishedResults([expected], [structuredClone(expected)], 'full date payload'));
  const noSnapshot = { id: 'old', date: '2026-09-09', status: 'FT', home: { goals: 1 }, away: { goals: 0 }, predictions: {} };
  for (const project of [value => value, slimMatch, slimLeagueDocMatch]) {
    const payload = project(noSnapshot);
    assert.doesNotThrow(() => verifyPublishedResults([payload], [structuredClone(payload)], 'no snapshot'));
    assert.equal(payload.prediction_locked, undefined);
  }
});

test('suppressed No pick totals do not block publication but retain exact prediction parity', () => {
  const expected = fixture();
  for (const key of ['ou_cards', 'ou_corners']) {
    expected.predictions[key] = { pick: null, insufficient_evidence: true, line: 4.5, probability: null, suppressed_pick: 'Under' };
  }
  const original = structuredClone(expected);
  assert.doesNotThrow(() => verifyPublishedResults([expected], [structuredClone(expected)], 'No pick'));
  assert.deepEqual(expected, original);
  const missing = structuredClone(expected); delete missing.predictions.ou_cards;
  assert.throws(() => verifyPublishedResults([expected], [missing], 'No pick'), /expected market/);
  const changed = structuredClone(expected); changed.predictions.ou_cards.insufficient_evidence = false;
  assert.throws(() => verifyPublishedResults([expected], [changed], 'No pick'), /expected market/);
});

test('meaningful unsettled markets still block even when flagged insufficient evidence', () => {
  for (const market of [
    { pick: 'Under', insufficient_evidence: true, line: 4.5 },
    { pick: null, type: 'home', insufficient_evidence: true },
    { pick: null, insufficient_evidence: false },
    { pick: 'Over', line: 4.5 },
  ]) {
    const expected = fixture(); expected.predictions.ou_cards = market;
    assert.throws(() => verifyPublishedResults([expected], [structuredClone(expected)], 'unsettled'), /verification failed.*cards/);
  }
});
