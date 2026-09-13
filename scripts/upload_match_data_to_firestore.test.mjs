import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildQuickBetsPayload } from './upload_match_data_to_firestore.mjs';

const EVENT_URL = 'https://www.sportsbet.com.au/betting/soccer/a/b/home-away-101';

test('date and league match projections retain only Double chance bookmaker markets', () => {
  const source = readFileSync(new URL('./upload_match_data_to_firestore.mjs', import.meta.url), 'utf8');
  const fields = source.match(/const MATCH_KEEP_FIELDS = \[[\s\S]*?\n\];/)[0];
  const extract = (name) => source.match(new RegExp(`function ${name}\\(match\\) \\{[\\s\\S]*?\\n\\}`))[0];
  const { slimMatch, slimLeagueDocMatch } = new Function(`${fields}\n${extract('slimMatch')}\n${extract('slimLeagueDocMatch')}\nreturn { slimMatch, slimLeagueDocMatch };`)();
  const match = { id: 'fixture', status: 'FT', prediction_locked: true,
    sportsbet_markets: { 'Double chance': { '1X': 1.72, 'X2': 1.28, '12': 1.25 },
      'Draw No Bet': { '1': 1.8, '2': 2.1 }, 'Full time': { '1': 2.5, 'X': 3.2, '2': 2.8 } } };
  const before = structuredClone(match);
  for (const project of [slimMatch, slimLeagueDocMatch]) {
    const result = project(match);
    assert.deepEqual(result.sportsbet_markets, { 'Double chance': match.sportsbet_markets['Double chance'] });
    assert.equal(result.id, match.id);
    assert.equal(result.status, match.status);
    assert.equal(project({ sportsbet_markets: { 'Draw No Bet': { '1': 1.8 } } }).sportsbet_markets, undefined);
    assert.equal(project({}).sportsbet_markets, undefined);
  }
  assert.equal(slimLeagueDocMatch(match).prediction_locked, true);
  assert.deepEqual(match, before);
});

test('quick bets Firestore payload mirrors AIOS by merging canonical match data with sidecar rows', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const leagues = [{
    name: 'League',
    matches: [{
      date: '2026-08-19',
      time: '18:00',
      status: 'upcoming',
      home: { name: 'Home' },
      away: { name: 'Away' },
      sportsbet_odds: { event_id: 101, home: 1.22, event_url: EVENT_URL },
      sportsbet_markets: {
        'Full time': { 1: 1.22 },
        'Match goals 1.5': { Over: 1.18 },
      },
    }, {
      date: '2026-08-19',
      time: '19:00',
      status: 'upcoming',
      home: { name: 'Canonical Only' },
      away: { name: 'Away' },
      sportsbet_markets: {
        'Both teams to score': { Yes: 1.4 },
      },
    }],
  }];
  const sidecar = {
    status: 'partial',
    captured_at: '2026-08-18T14:24:03+09:30',
    events: [{
      event_id: '101',
      league: 'Sidecar League',
      date: '2026-08-19',
      time: '18:00',
      home: 'Home',
      away: 'Away',
      event_url: EVENT_URL,
      root_stale: false,
      deep_stale: true,
      markets: {
        winner: [{ key: 'home', label: 'Home', odds: 1.2 }],
        btts: [{ key: 'yes', label: 'Yes', odds: 1.3 }],
        goalsOver: [{ key: 'over:1.5', side: 'over', line: 1.5, label: 'Over 1.5', odds: 1.17 }],
        goalsUnder: [],
      },
    }, {
      event_id: '102',
      league: 'Sidecar Only',
      date: '2026-08-19',
      time: '20:00',
      home: 'Sidecar Only',
      away: 'Away',
      event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/sidecar-away-102',
      root_stale: false,
      deep_stale: false,
      markets: {
        winner: [],
        btts: [],
        goalsOver: [{ key: 'over:1.5', side: 'over', line: 1.5, label: 'Over 1.5', odds: 1.16 }],
        goalsUnder: [],
      },
    }],
  };

  const payload = buildQuickBetsPayload({ leagues, sidecar, now });
  const rows = payload.dates.get('2026-08-19');

  assert.equal(payload.meta.totalMatches, 3);
  assert.equal(payload.meta.counts.upcoming, 3);
  assert.equal(payload.meta.refreshStatus, 'partial');
  assert.deepEqual(rows.map((row) => row.home), ['Home', 'Canonical Only', 'Sidecar Only']);

  const merged = rows.find((row) => row.home === 'Home');
  assert.equal(merged.league, 'League');
  assert.equal(merged.eventId, '101');
  assert.deepEqual(merged.markets.winner.map((selection) => selection.key), ['home']);
  assert.deepEqual(merged.markets.btts, []);
  assert.deepEqual(merged.markets.goalsOver.map((selection) => [selection.line, selection.odds]), [[1.5, 1.18]]);

  const canonicalOnly = rows.find((row) => row.home === 'Canonical Only');
  assert.deepEqual(canonicalOnly.markets.btts.map((selection) => selection.key), ['yes']);

  const sidecarOnly = rows.find((row) => row.home === 'Sidecar Only');
  assert.deepEqual(sidecarOnly.markets.goalsOver.map((selection) => [selection.line, selection.odds]), [[1.5, 1.16]]);
});

test('quick bets mirror uses canonical identities and excludes future or unprovable same-day results', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const result = (date, time, short, goals, opponent) => ({
    date, time, status: 'FT', home: { name: 'Form United', short, goals }, away: { name: opponent, goals: 0 },
  });
  const historical = [
    result('2026-08-12', '15:00', 'FU One', 1, 'Past 1'),
    result('2026-08-13', '15:00', 'FU Two', 2, 'Past 2'),
    result('2026-08-14', '15:00', 'FU Three', 3, 'Past 3'),
    result('2026-08-15', '15:00', 'FU Four', 0, 'Past 4'),
    result('2026-08-16', '15:00', 'FU Five', 1, 'Past 5'),
    result('2026-08-17', '15:00', 'FU Six', 2, 'Past 6'),
    result('2026-08-18', 'FT', 'Unprovable Today', 8, 'Same Day'),
    result('2026-08-18', '13:00', 'Future Today', 7, 'Later Today'),
    result('2026-08-20', '15:00', 'Bogus Future', 9, 'Future Opponent'),
    result('2026-08-22', '15:00', 'After Target', 10, 'Later Opponent'),
  ];
  const upcoming = {
    date: '2026-08-21', time: '15:00', status: 'upcoming',
    home: { name: 'Form United', short: 'Current Short' }, away: { name: 'Upcoming Opponent' },
    sportsbet_odds: { event_id: 555, event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/form-target-555', home: 1.2 },
  };
  const sidecar = { history: [{
    event_id: '555', league: 'Provider League', date: '2026-08-21', time: '15:00',
    home: 'Provider Form', away: 'Provider Opponent', status: 'started',
    event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/form-target-555',
    markets: { winner: [{ key: 'home', label: 'Provider Form', odds: 1.19 }], btts: [], goalsOver: [], goalsUnder: [] },
  }], events: [{
    event_id: '999', league: 'Sidecar Only', date: '2026-08-22', time: '15:00',
    home: 'Form United', away: 'Unmatched', root_stale: false, deep_stale: false,
    event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/sidecar-only-999',
    markets: { winner: [{ key: 'home', label: 'Form United', odds: 1.2 }], btts: [], goalsOver: [], goalsUnder: [] },
  }] };

  const payload = buildQuickBetsPayload({ leagues: [{ name: 'League', matches: [...historical, upcoming] }], sidecar, now });
  const rows = [...payload.dates.values()].flat();
  const row = rows.find((item) => item.eventId === '555');
  const sidecarOnly = rows.find((item) => item.eventId === '999');

  assert.equal(row.home, 'Provider Form');
  assert.deepEqual(row.teamForm.home, ['2-0', '1-0', '0-0', '3-0', '2-0']);
  assert.deepEqual(row.teamForm.away, []);
  assert.equal(JSON.stringify(row.teamForm).includes('9-0'), false);
  assert.equal(JSON.stringify(row.teamForm).includes('8-0'), false);
  assert.equal(JSON.stringify(row.teamForm).includes('7-0'), false);
  assert.equal(JSON.stringify(row.teamForm).includes('10-0'), false);
  assert.deepEqual(sidecarOnly.teamForm, { home: [], away: [] });
  assert.equal(Object.keys(row).some((key) => key.startsWith('_')), false);

  const backtestTarget = {
    date: '2026-08-16', time: '10:00', status: 'FT',
    home: { name: 'Form United', goals: 1 }, away: { name: 'Backtest Target', goals: 0 }, sportsbet_odds: { home: 1.2 },
  };
  const backtest = [...buildQuickBetsPayload({
    leagues: [{ name: 'League', matches: [...historical, backtestTarget] }], now,
  }).dates.values()].flat().find((item) => item.away === 'Backtest Target');
  assert.deepEqual(backtest.teamForm.home, ['0-0', '3-0', '2-0', '1-0']);
});

test('quick bets mirror is duplicate-safe and input-order invariant at an ambiguous last-five boundary', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const settled = (date, opponent, goals, time = 'FT') => ({
    date, time, status: 'FT', home: { name: 'Boundary Team', goals }, away: { name: opponent, goals: 0 },
  });
  const target = {
    date: '2026-08-19', time: '15:00', status: 'upcoming',
    home: { name: 'Boundary Team' }, away: { name: 'Target' }, sportsbet_odds: { home: 1.2 },
  };
  const form = (rows) => buildQuickBetsPayload({ leagues: [{ name: 'League', matches: [...rows, target] }], now })
    .dates.get('2026-08-19').find((row) => row.home === 'Boundary Team').teamForm.home;
  const clean = [
    settled('2026-08-17', 'A', 5, '15:00'), settled('2026-08-16', 'B', 4, '15:00'),
    settled('2026-08-15', 'C', 3, '15:00'), settled('2026-08-14', 'D', 2, '15:00'),
    settled('2026-08-13', 'E', 1, '15:00'), settled('2026-08-12', 'F', 0, '15:00'),
  ];
  assert.deepEqual(form([clean[0], clean[0], ...clean.slice(1)]), ['5-0', '4-0', '3-0', '2-0', '1-0']);

  const conflict = { ...clean[0], home: { ...clean[0].home, goals: 9 } };
  assert.deepEqual(form([clean[0], conflict, ...clean.slice(1)]), []);
  assert.deepEqual(form([...clean.slice(1).reverse(), conflict, clean[0]]), []);

  const ambiguous = [
    ...clean.slice(0, 4),
    settled('2026-08-13', 'Cup A', 1), settled('2026-08-13', 'Cup B', 2),
    settled('2026-08-12', 'Older', 3),
  ];
  assert.deepEqual(form(ambiguous), []);
  assert.deepEqual(form([...ambiguous].reverse()), []);
});

test('quick bets mirror does not publish future-dated FT rows as results', () => {
  const now = new Date(2026, 7, 19, 12, 0, 0);
  const sidecar = {
    status: 'partial',
    history: [{
      event_id: '201',
      league: 'Future League',
      date: '2026-08-23',
      time: 'FT',
      home: 'Future Home',
      away: 'Future Away',
      status: 'FT',
      home_score: 0,
      away_score: 0,
      event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/future-away-201',
      markets: {
        winner: [{ key: 'home', label: 'Future Home', odds: 1.45 }],
        btts: [],
        goalsOver: [],
        goalsUnder: [],
      },
    }],
  };

  const payload = buildQuickBetsPayload({ leagues: [], sidecar, now });

  assert.equal(payload.meta.counts.results, 0);
  assert.equal(payload.meta.totalMatches, 0);
  assert.equal(payload.dates.has('2026-08-23'), false);
});

test('quick bets mirror moves tracked stale rows to Results pending and preserves terminal semantics', () => {
  const now = new Date(2026, 7, 19, 4, 30, 0);
  const base = {
    event_id: '103', league: 'Friendly', date: '2026-08-18', time: '01:30',
    home: 'Stuck Live', away: 'Silent Feed', status: 'started', root_stale: false, deep_stale: false,
    markets: { winner: [{ key: 'home', label: 'Stuck Live', odds: 1.2 }], btts: [], goalsOver: [], goalsUnder: [] },
  };
  const build = (row, leagues = []) => buildQuickBetsPayload({ leagues, sidecar: { history: [row] }, now }).dates.get(row.date)[0];

  const pending = build(base);
  assert.equal(pending.lifecycle, 'result');
  assert.equal(pending.status, 'result_pending');
  assert.equal(pending.score, null);
  assert.equal(pending.markets.winner[0].result, null);

  const settled = build({ ...base, status: 'FT', home_score: 2, away_score: 0 });
  assert.equal(settled.status, 'FT');
  assert.equal(settled.score, '2-0');
  assert.equal(settled.markets.winner[0].result, 'hit');

  for (const status of ['postponed_or_cancelled', 'cancelled', 'postponed', 'void']) {
    const terminal = build({ ...base, status, home_score: 1, away_score: 0 });
    assert.equal(terminal.lifecycle, 'result');
    assert.equal(terminal.status, status);
    assert.equal(terminal.markets.winner[0].result, 'void');
  }
});

test('quick bets mirror preserves sidecar recovery through a canonical event merge', () => {
  const now = new Date(2026, 7, 19, 4, 30, 0);
  const eventUrl = 'https://www.sportsbet.com.au/betting/soccer/a/b/tracked-away-301';
  const sidecar = { events: [{
    event_id: '301', league: 'Sidecar', date: '2026-08-19', time: '01:30', home: 'Tracked Home', away: 'Tracked Away',
    event_url: eventUrl, root_stale: false, deep_stale: false,
    markets: { winner: [{ key: 'home', label: 'Tracked Home', odds: 1.2 }], btts: [], goalsOver: [], goalsUnder: [] },
  }] };
  const leagues = [{ name: 'Canonical', matches: [{
    date: '2026-08-19', time: '01:30', status: 'upcoming', home: { name: 'Tracked Home' }, away: { name: 'Tracked Away' },
    sportsbet_odds: { event_id: '301', event_url: eventUrl, home: 1.2 },
  }] }];
  const row = buildQuickBetsPayload({ leagues, sidecar, now }).dates.get('2026-08-19')[0];
  assert.equal(row.lifecycle, 'result');
  assert.equal(row.status, 'result_pending');
});

test('quick bets mirror preserves allow-listed Sportsbet scoreless result-market settlement', () => {
  const now = new Date(2026, 7, 19, 12, 0, 0);
  const sidecar = { history: [{
    event_id: '901', league: 'Results', date: '2026-08-19', time: '02:00',
    home: 'Home', away: 'Away', status: 'result',
    event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/home-away-901',
    markets: { winner: [], btts: [{ key: 'yes', label: 'Yes', odds: 1.2, result: 'won' }], goalsOver: [
      { key: 'over:1.5', side: 'over', line: 1.5, label: 'Over 1.5', odds: 1.2, result: 'hit' },
      { key: 'over:2.5', side: 'over', line: 2.5, label: 'Over 2.5', odds: 1.3, result: 'miss' },
    ], goalsUnder: [] },
  }] };

  const row = buildQuickBetsPayload({ leagues: [], sidecar, now }).dates.get('2026-08-19')[0];

  assert.equal(row.status, 'result');
  assert.equal(row.score, null);
  assert.deepEqual(row.markets.goalsOver.map((item) => item.result), ['hit', 'miss']);
  assert.equal(row.markets.btts[0].result, null);
});

test('quick bets mirror keeps scoreless terminal history over matching stale canonical live state', () => {
  const now = new Date(2026, 7, 19, 12, 0, 0);
  const eventUrl = 'https://www.sportsbet.com.au/betting/soccer/a/b/home-away-902';
  const sidecar = { history: [{
    event_id: '902', event_url: eventUrl, league: 'Results', date: '2026-08-19', time: '02:00',
    home: 'Home', away: 'Away', status: 'result',
    markets: { winner: [{ key: 'home', label: 'Home', odds: 1.2, result: 'hit' }], btts: [], goalsOver: [], goalsUnder: [] },
  }] };
  const leagues = [{ name: 'Results', matches: [{
    date: '2026-08-19', time: '02:00', status: 'live', live_minute: "87'",
    home: { name: 'Home' }, away: { name: 'Away' },
    sportsbet_odds: { event_id: '902', event_url: eventUrl, home: 1.2 },
  }] }];

  const row = buildQuickBetsPayload({ leagues, sidecar, now }).dates.get('2026-08-19')[0];

  assert.equal(row.lifecycle, 'result');
  assert.equal(row.status, 'result');
  assert.equal(row.score, null);
  assert.equal(row.minute, null);
  assert.equal(row.markets.winner[0].result, 'hit');

  const cancelledLeagues = [{ ...leagues[0], matches: [{ ...leagues[0].matches[0], status: 'cancelled', live_minute: null }] }];
  const cancelled = buildQuickBetsPayload({ leagues: cancelledLeagues, sidecar, now }).dates.get('2026-08-19')[0];
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.markets.winner[0].result, 'void');
});

test('forecast inspections carry coverage, reorient reversed identities, and replace old eligible prices', () => {
  const now = new Date('2026-09-03T02:30:00Z');
  const core = { date: '2026-09-09', time: '20:00', status: 'upcoming', home: { id: 1, name: 'Alpha' }, away: { id: 2, name: 'Beta' },
    sportsbet_odds: { event_id: 777, event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/beta-alpha-777', home: 1.2 },
    sportsbet_markets: { 'Both teams to score': { Yes: 1.3 }, 'Match goals 1.5': { Over: 1.1 } } };
  const coverage = { fromDate: '2026-09-03', throughDate: '2026-09-09', totalFixtures: 1, checkedFixtures: 1, pendingFixtures: 0 };
  const event = { event_id: '777', event_url: core.sportsbet_odds.event_url, date: core.date, time: core.time,
    home: 'Beta', away: 'Alpha', league: 'Book League', root_stale: false, deep_stale: false,
    canonical: { date: core.date, time: core.time, home: 'Alpha', away: 'Beta', home_id: 1, away_id: 2, league: 'League', reversed: true },
    market_coverage: { winner: 'no_selection', btts: 'not_offered', 'goals:0.5': 'not_offered', 'goals:1.5': 'no_price', 'goals:2.5': 'not_offered', 'goals:3.5': 'selection' },
    markets: { winner: [], btts: [], goalsOver: [], goalsUnder: [{ key: 'under:3.5', side: 'under', line: 3.5, label: 'Under 3.5', odds: 1.4 }] } };
  const sidecar = { status: 'complete', coverage, events: [event], history: [] };
  const payload = buildQuickBetsPayload({ leagues: [{ name: 'League', matches: [core] }], sidecar, now });
  const rows = [...payload.dates.values()].flat();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].home, 'Alpha');
  assert.equal(rows[0].away, 'Beta');
  assert.deepEqual(rows[0].markets.winner, []);
  assert.deepEqual(rows[0].markets.btts, []);
  assert.deepEqual(rows[0].markets.goalsOver, []);
  assert.equal(rows[0].marketCoverage.winner, 'no_selection');
  assert.deepEqual(payload.meta.coverage, coverage);
  event.markets.winner = [{ key: 'away', label: 'Alpha', odds: 1.25 }];
  const reversedPayload = buildQuickBetsPayload({ leagues: [{ name: 'League', matches: [core] }], sidecar, now });
  const reversedRows = [...reversedPayload.dates.values()].flat();
  assert.equal(reversedRows[0].markets.winner[0].key, 'home');
  assert.equal(reversedRows[0].markets.winner[0].label, 'Alpha');
  event.markets = { winner: [], btts: [], goalsOver: [], goalsUnder: [] };
  const emptyPayload = buildQuickBetsPayload({ leagues: [{ name: 'League', matches: [core] }], sidecar, now });
  assert.equal(emptyPayload.meta.totalMatches, 0);
});


test('successful inspection withdrawals remain authoritative through stale, missing, and retained history states', () => {
  const coverage = Object.fromEntries(['winner', 'btts', 'goals:0.5', 'goals:1.5', 'goals:2.5', 'goals:3.5'].map((key) => [key, 'no_selection']));
  const core = { date: '2026-09-03', time: '20:00', status: 'upcoming',
    home: { id: 1, name: 'Alpha' }, away: { id: 2, name: 'Beta' },
    sportsbet_odds: { event_id: 777, event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/alpha-beta-777', home: 1.2 },
    sportsbet_markets: { 'Both teams to score': { Yes: 1.3 }, 'Match goals 1.5': { Over: 1.1 } } };
  const captured = { event_id: '777', event_url: core.sportsbet_odds.event_url, date: core.date, time: core.time,
    home: 'Alpha', away: 'Beta', league: 'League', root_stale: false, deep_stale: false,
    canonical: { date: core.date, time: core.time, home: 'Alpha', away: 'Beta', home_id: 1, away_id: 2, league: 'League' },
    last_inspection_coverage: coverage, market_coverage: coverage,
    markets: { winner: [], btts: [], goalsOver: [], goalsUnder: [] } };
  const leagues = [{ name: 'League', matches: [core] }];
  const read = (sidecar, now) => [...buildQuickBetsPayload({ leagues, sidecar, now }).dates.values()].flat();
  for (const state of ['fresh', 'fetch_failed', 'stale', 'omitted']) {
    const event = { ...captured, deep_stale: state !== 'fresh', root_stale: state === 'omitted',
      market_coverage: state === 'fresh' ? coverage : Object.fromEntries(Object.keys(coverage).map((key) => [key, state === 'fetch_failed' ? 'fetch_failed' : 'stale'])) };
    assert.deepEqual(read({ events: [event], history: [] }, new Date(2026, 8, 3, 12)), [], state);
  }
  core.status = 'FT'; core.home.goals = 2; core.away.goals = 0;
  const frozen = { ...captured, status: 'started', inspection_only: true, deep_stale: true };
  for (const now of [new Date(2026, 8, 3, 23), new Date(2026, 9, 6)]) {
    assert.deepEqual(read({ events: [], history: [frozen] }, now), [], 'marketless retained history must not create a result or star');
  }
  const realHistory = { ...captured, status: 'FT', home_score: 2, away_score: 0,
    markets: { winner: [{ key: 'home', label: 'Alpha', odds: 1.25 }], btts: [], goalsOver: [], goalsUnder: [] } };
  const rows = read({ events: [captured], history: [realHistory] }, new Date(2026, 8, 3, 23));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].markets.winner[0].odds, 1.25, 'frozen history remains immutable');
  assert.deepEqual(rows[0].markets.btts, [], 'inspected history cannot be supplemented by stale core odds');
});
