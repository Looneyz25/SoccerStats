import assert from 'node:assert/strict';
import test from 'node:test';
import { captureQuickBetStars, quickBetStarLedgerKey } from './capture_quick_bet_stars.mjs';
import { buildQuickBetsPayload } from './upload_match_data_to_firestore.mjs';
import { quickBetSelectionSuccessLabel, quickBetStarredMarketStats } from '../app/dashboard/quick-bets/quick-bets-utils.mjs';

const now = '2026-09-04T09:00:00+09:30';
const coverage = Object.fromEntries(['winner', 'btts', 'goals:0.5', 'goals:1.5', 'goals:2.5', 'goals:3.5'].map((key) => [key, 'selection']));
const winner = (result) => ({ key: 'home', label: 'Home', odds: 1.2, ...(result ? { result } : {}) });
const event = (id, extra = {}) => ({
  event_id: String(id), event_url: `https://www.sportsbet.com.au/betting/soccer/a/b/home-away-${id}`,
  league: 'League', date: '2026-09-04', time: '20:00', home: 'Home', away: 'Away',
  root_stale: false, deep_stale: false, markets: { winner: [winner()], btts: [], goalsOver: [], goalsUnder: [] }, ...extra,
});
const result = (id, outcome = 'hit') => event(id, {
  date: '2026-09-03', time: '12:00', home: `Past ${id}`, status: 'result', markets: { winner: [winner(outcome)] },
});
const rows = (sidecar, clock = now, leagues = []) => [...buildQuickBetsPayload({ sidecar, leagues, now: new Date(clock) }).dates.values()].flat();
const snapshot = (sidecar, id, key = 'winner|home') => sidecar.star_snapshots[`event:${id}`].selections[key];

test('first qualifying stars retain their evidence through refresh and settled misses', () => {
  const original = { events: [event(101)], history: [result(100)] };
  const first = captureQuickBetStars({ sidecar: original, now });
  assert.equal(snapshot(first, 101).starred, true);
  assert.equal(snapshot(first, 101).evidence.league.hits, 1);
  assert.equal(original.star_snapshots, undefined);
  assert.deepEqual(snapshot(first, 100), { version: 1, state: 'unknown' });
  const later = '2026-09-04T10:00:00+09:30';
  const refreshed = captureQuickBetStars({ sidecar: { ...first, history: [...first.history, result(102, 'miss')] }, previous: first, now: later });
  assert.equal(snapshot(refreshed, 101).starred, true);
  assert.deepEqual(snapshot(refreshed, 101), snapshot(first, 101));

  for (const recorded of [first, refreshed]) {
    const terminal = { events: [], history: [...recorded.history, event(101, { status: 'result', markets: { winner: [winner('miss')] } })] };
    const settled = captureQuickBetStars({ sidecar: terminal, previous: recorded, now: '2026-09-05T02:00:00+09:30' });
    assert.deepEqual(snapshot(settled, 101), snapshot(recorded, 101));
    const match = rows(settled, '2026-09-05T02:00:00+09:30').find((row) => row.eventId === '101');
    const selection = { ...match.markets.winner[0], marketKey: 'winner' };
    assert.equal(selection.result, 'miss');
    assert.equal(Boolean(quickBetSelectionSuccessLabel(match, selection, new Map())), snapshot(recorded, 101).starred);
    const stats = quickBetStarredMarketStats([match], [{ key: 'winner', marketKeys: ['winner'] }], new Map());
    assert.deepEqual(stats.get('winner'), { hits: 0, settled: snapshot(recorded, 101).starred ? 1 : 0 });
  }
  const future = captureQuickBetStars({ sidecar: { events: [event(103)], history: [result(100), result(102, 'miss')] }, previous: first, now: later });
  assert.equal(snapshot(future, 103).starred, false);
});

test('stale and failed quote checks retain prior decisions and temporary withdrawal does not delete the ledger', () => {
  const first = captureQuickBetStars({ sidecar: { events: [event(201, { last_inspection_coverage: coverage })], history: [result(200)] }, now });
  for (const extra of [{ root_stale: true, deep_stale: true }, { deep_stale: true, market_coverage: { winner: 'fetch_failed' } }]) {
    const stale = captureQuickBetStars({ sidecar: { events: [event(201, { last_inspection_coverage: coverage, ...extra })], history: [result(200), result(202, 'miss')] }, previous: first, now });
    assert.deepEqual(snapshot(stale, 201), snapshot(first, 201));
  }
  const missing = captureQuickBetStars({ sidecar: { events: [event(201, { markets: {}, last_inspection_coverage: coverage })], history: [result(200)] }, previous: first, now });
  assert.deepEqual(snapshot(missing, 201), snapshot(first, 201));
  const returned = captureQuickBetStars({ sidecar: { events: [event(201)], history: [result(200), result(202, 'miss')] }, previous: missing, now });
  assert.deepEqual(snapshot(returned, 201), snapshot(first, 201));
});

test('all six markets capture independent exact-side decisions and preserve snapshots across reversed canonical identity', () => {
  const markets = {
    winner: [{ key: 'away', label: 'Home', odds: 1.2 }], btts: [{ key: 'yes', label: 'Yes', odds: 1.2 }],
    goalsOver: [0.5, 1.5, 2.5, 3.5].map((line) => ({ key: `over:${line}`, side: 'over', line, odds: 1.2 })),
  };
  const fixture = event(301, { home: 'Away', away: 'Home', markets, last_inspection_coverage: coverage,
    canonical: { league: 'League', date: '2026-09-04', time: '20:00', home: 'Home', away: 'Away', reversed: true } });
  const priorMarkets = structuredClone(markets);
  priorMarkets.winner[0].key = 'home';
  for (const entries of Object.values(priorMarkets)) for (const selection of entries) selection.result = 'hit';
  const captured = captureQuickBetStars({ sidecar: { events: [fixture], history: [result(300, 'hit'), { ...result(302, 'hit'), markets: priorMarkets }] }, now });
  const keys = Object.keys(captured.star_snapshots['event:301'].selections);
  assert.equal(keys.length, 6);
  assert.ok(keys.includes('winner|home'));
  assert.equal(snapshot(captured, 301).starred, true);
  assert.ok(keys.every((key) => snapshot(captured, 301, key).starred));
  const official = structuredClone(fixture);
  official.status = 'result';
  official.markets.winner[0].result = 'miss';
  const settled = captureQuickBetStars({ sidecar: { events: [], history: [official] }, previous: captured, now: '2026-09-05T03:00:00+09:30' });
  const match = rows(settled, '2026-09-05T03:00:00+09:30').find((row) => row.eventId === '301');
  assert.equal(match.markets.winner[0].key, 'home');
  assert.equal(match.markets.winner[0].result, 'miss');
  assert.deepEqual(match.markets.winner[0].starSnapshot, snapshot(captured, 301));
});

test('canonical-only selections are recorded and remain frozen when FT replaces the display time', () => {
  const leagues = [{ name: 'League', matches: [{
    date: '2026-09-04', time: '20:00', status: 'upcoming', home: { name: 'Core' }, away: { name: 'Only' },
    sportsbet_odds: { home: 1.2 },
  }] }];
  const first = captureQuickBetStars({ sidecar: { events: [], history: [result(400)] }, leagues, now });
  const target = rows(first, now, leagues).find((row) => row.home === 'Core');
  const key = quickBetStarLedgerKey(target);
  assert.equal(first.star_snapshots[key].selections['winner|home'].starred, true);
  const updatedLeagues = structuredClone(leagues);
  Object.assign(updatedLeagues[0].matches[0], { time: 'FT', status: 'FT', score: '0-1' });
  const settled = captureQuickBetStars({ sidecar: { events: [], history: [result(401, 'miss')] }, previous: first, leagues: updatedLeagues, now: '2026-09-05T02:00:00+09:30' });
  const terminal = rows(settled, '2026-09-05T02:00:00+09:30', updatedLeagues).find((row) => row.home === 'Core');
  assert.deepEqual(terminal.markets.winner[0].starSnapshot, first.star_snapshots[key].selections['winner|home']);
});

test('wrong-fixture and invalid historical snapshots fail closed instead of borrowing stars', () => {
  const prior = { star_snapshots: { 'event:501': { fixture: '2026-09-04||other|teams', selections: { 'winner|home': { version: 1, state: 'captured', starred: true } } } } };
  const settled = captureQuickBetStars({ sidecar: { events: [], history: [result(501)] }, previous: prior, now });
  assert.deepEqual(snapshot(settled, 501), { version: 1, state: 'unknown' });
  const match = rows(settled).find((row) => row.eventId === '501');
  assert.equal(quickBetSelectionSuccessLabel(match, { ...match.markets.winner[0], marketKey: 'winner' }, new Map([['Winner', { market: 'Winner', hits: 99, settled: 100 }]])), '');
});

test('a late event ID inherits only the exact fixture snapshot and retains recovery provenance', () => {
  const fixture = '2026-09-03||past 601|away';
  const captured = { version: 1, state: 'captured', starred: false, capturedAt: '2026-09-03T00:00:00Z', label: '', leagueLabel: '',
    recoveredFrom: { source: 'saved-pre-match-api-feed', sha256: 'source-hash' } };
  const previous = { star_snapshots: { [`fixture:${fixture}`]: { fixture, selections: { 'winner|home': captured } } } };
  const settled = captureQuickBetStars({ sidecar: { events: [], history: [result(601)] }, previous, now });
  assert.deepEqual(snapshot(settled, 601), captured);
  assert.deepEqual(rows(settled)[0].markets.winner[0].starSnapshot, captured);
});


test('late canonical reversal preserves true and false decisions in projections and the next ledger write', () => {
  for (const starred of [true, false]) {
    const markets = { winner: [winner(), { key: 'draw', label: 'Draw', odds: 1.2 }, { key: 'away', label: 'Away', odds: 1.2 }],
      btts: [{ key: 'yes', label: 'Yes', odds: 1.2 }], goalsOver: [{ key: 'over:1.5', side: 'over', line: 1.5, odds: 1.2 }] };
    const first = captureQuickBetStars({ sidecar: { events: [event(701, { markets })], history: [result(700, starred ? 'hit' : 'miss')] }, now });
    for (const decision of Object.values(first.star_snapshots['event:701'].selections)) {
      decision.recoveredFrom = { source: 'saved-pre-match-api-feed', sha256: 'preserved' };
    }
    const initial = structuredClone(first.star_snapshots['event:701'].selections);
    assert.equal(initial['winner|home'].starred, starred);
    const terminal = event(701, { status: 'result', markets,
      canonical: { date: '2026-09-04', time: '20:00', home: 'Away', away: 'Home', league: 'League', reversed: true } });
    for (const selections of Object.values(terminal.markets)) for (const selection of selections) selection.result = 'miss';
    const sidecar = { events: [], history: [terminal], star_snapshots: first.star_snapshots };
    const clock = '2026-09-05T02:00:00+09:30';
    const projected = rows(sidecar, clock)[0];
    const selected = projected.markets.winner.find((selection) => selection.key === 'away');
    assert.equal(selected.label, 'Home');
    assert.equal(selected.result, 'miss');
    assert.deepEqual(selected.starSnapshot, initial['winner|home']);
    const updated = captureQuickBetStars({ sidecar, previous: first, now: clock });
    const saved = updated.star_snapshots['event:701'];
    assert.equal(saved.fixture, '2026-09-04||away|home');
    for (const [key, decision] of Object.entries(initial)) {
      const mapped = key === 'winner|home' ? 'winner|away' : key === 'winner|away' ? 'winner|home' : key;
      assert.deepEqual(saved.selections[mapped], decision);
    }
    assert.deepEqual(rows(updated, clock)[0].markets.winner.find((selection) => selection.key === 'away').starSnapshot, initial['winner|home']);
    for (const fixture of ['2026-09-03||home|away', '2026-09-04||home|unrelated']) {
      const mismatched = structuredClone(sidecar);
      mismatched.star_snapshots['event:701'].fixture = fixture;
      assert.equal(rows(mismatched, clock)[0].markets.winner[0].starSnapshot, undefined);
      const rejected = captureQuickBetStars({ sidecar: mismatched, now: clock });
      assert.deepEqual(rejected.star_snapshots['event:701'].selections['winner|away'], { version: 1, state: 'unknown' });
    }
  }
});


test('an unstarred upcoming selection can qualify later and freezes at its first qualification', () => {
  const first = captureQuickBetStars({ sidecar: { events: [event(801)], history: [result(800, 'miss')] }, now });
  assert.equal(snapshot(first, 801).starred, false);
  const later = '2026-09-04T10:00:00+09:30';
  const history = [result(800, 'miss'), ...[802, 803, 804, 805].map((id) => result(id))];
  const qualified = captureQuickBetStars({ sidecar: { events: [event(801)], history }, previous: first, now: later });
  assert.equal(snapshot(qualified, 801).starred, true);
  assert.equal(snapshot(qualified, 801).capturedAt, new Date(later).toISOString());
  const refreshed = captureQuickBetStars({ sidecar: { events: [event(801)], history: [...history, result(806, 'miss')] }, previous: qualified, now: '2026-09-04T11:00:00+09:30' });
  assert.deepEqual(snapshot(refreshed, 801), snapshot(qualified, 801));
});
