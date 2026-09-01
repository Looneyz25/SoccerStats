import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  marketSelections, quickBetMatchState, quickBetLeagueKey, quickBetSuccessMarket,
  quickBetLeagueSuccessStats, quickBetSuccessLabel, quickBetLeagueSuccessLabel,
  quickBetSelectionSuccessLabel, quickBetStarredMarketStats, quickBetStarredSelections,
  quickBetStarStatText, quickBetTeamSuccessLabels,
} from './quick-bets-utils.mjs';

const pageSource = readFileSync(new URL('./page.jsx', import.meta.url), 'utf8');
const filters = [
  { key: 'winner', marketKeys: ['winner'] }, { key: 'btts', marketKeys: ['btts'] },
  ...[0.5, 1.5, 2.5, 3.5].map((line) => ({ key: `goals${String(line * 10).padStart(2, '0')}`, marketKeys: ['goalsOver', 'goalsUnder'], line })),
];
const pick = (result = 'hit', extra = {}) => ({ label: 'Home', odds: 1.25, result, ...extra });
const row = (markets, extra = {}) => ({ league: 'Premier League', lifecycle: 'result', status: 'FT', markets, ...extra });
const statsFor = (matches, league = 'Premier League') => quickBetLeagueSuccessStats(matches, filters).get(quickBetLeagueKey(league));

test('success stars use exact 80 percent, not rounded rates, with no minimum sample', () => {
  const stats = statsFor(Array.from({ length: 5 }, (_, index) => row({ winner: [pick(index < 4 ? 'hit' : 'miss')] })));
  assert.equal(quickBetSuccessLabel(stats.get('Winner')), 'Winner: 80% hit rate (4/5 settled)');
  assert.equal(quickBetSuccessLabel({ market: 'Winner', hits: 159, settled: 200 }), '');
  assert.equal(quickBetSuccessLabel({ market: 'Winner', hits: 1, settled: 1 }), 'Winner: 100% hit rate (1/1 settled)');
  assert.equal(quickBetSuccessLabel({ hits: 0, settled: 0 }), '');
  assert.equal(quickBetSuccessLabel(undefined), '');
});

test('success history ignores live locks, pending and void rows, invalid odds and missing labels', () => {
  const valid = row({ winner: [pick()] });
  const ignored = [
    row({ winner: [pick()] }, { lifecycle: 'upcoming' }),
    row({ winner: [pick('miss', { liveLock: 'hit' })] }, { lifecycle: 'live' }),
    row({ winner: [pick(null, { liveLock: 'hit' })] }),
    ...['result_pending', 'postponed_or_cancelled', 'cancelled', 'postponed', 'void'].map((status) => row({ winner: [pick('miss')] }, { status })),
    ...['void', null, 'pending'].map((result) => row({ winner: [pick(result)] })),
    ...[1, 1.5, 2, NaN, Infinity, '1.25'].map((odds) => row({ winner: [pick('miss', { odds })] })),
    row({ winner: [pick('miss', { label: '' })] }), row({ winner: [pick('miss')] }, { league: '' }),
  ];
  assert.deepEqual(statsFor([valid, ...ignored]).get('Winner'), { market: 'Winner', filter: 'winner', hits: 1, settled: 1 });
  assert.equal(quickBetLeagueSuccessStats(ignored, filters).size, 0);
});

test('league aliases combine exact records without mixing leagues, draws, BTTS or goals sides', () => {
  const history = [row({ winner: [pick()] }), row({ winner: [pick('miss', { label: 'Away' })] }, { league: ' English   Premier League ' }),
    row({ winner: [pick('hit', { label: 'Draw' })], btts: [pick('hit', { label: 'Yes' }), pick('miss', { label: 'No' })],
      goalsOver: [pick('hit', { line: 1.5 }), pick('miss', { line: 2.5 })],
      goalsUnder: [pick('miss', { line: 1.5 }), pick('hit', { line: 2.5 })] }),
    row({ winner: [pick()] }, { league: 'Other League' })];
  const stats = statsFor(history);
  assert.equal(stats.get('Winner').settled, 2);
  assert.equal(quickBetSuccessLabel(stats.get('Winner')), '');
  for (const market of ['Draw', 'BTTS Yes', 'Over 1.5', 'Under 2.5']) assert.ok(quickBetSuccessLabel(stats.get(market)));
  for (const market of ['BTTS No', 'Under 1.5', 'Over 2.5']) assert.equal(quickBetSuccessLabel(stats.get(market)), '');
  const label = quickBetLeagueSuccessLabel('Premier League', stats, 'goals15');
  assert.match(label, /Over 1.5: 100% hit rate \(1\/1 settled\)/);
  assert.doesNotMatch(label, /BTTS|Draw|2.5/);
  assert.match(label, /not a prediction/);
  assert.equal(quickBetLeagueSuccessLabel('Unknown', undefined), '');
  assert.equal(quickBetSuccessMarket({ marketKey: 'btts', label: 'unknown' }), '');
});

test('history refresh recalculates stars and market selection grouping is unchanged', () => {
  const hit = row({ winner: [pick()] });
  assert.ok(quickBetSuccessLabel(statsFor([hit]).get('Winner')));
  assert.equal(quickBetSuccessLabel(statsFor([hit, row({ winner: [pick('miss')] })]).get('Winner')), '');
  const match = row({ goalsOver: [pick('hit', { line: 1.5 }), pick('miss', { line: 2.5 })], goalsUnder: [pick('miss', { line: 1.5 })] });
  assert.deepEqual(marketSelections(match, filters.find((filter) => filter.key === 'goals15')).map((selection) => selection.marketKey), ['goalsOver', 'goalsUnder']);
  assert.equal(marketSelections({}, filters[0]).length, 0);
});

test('starred market counters report hits against settled qualifying predictions', () => {
  const history = Array.from({ length: 5 }, (_, index) => row({
    winner: [pick(index < 4 ? 'hit' : 'miss')],
    btts: [pick(index < 4 ? 'hit' : 'miss', { label: 'Yes' }), pick(index === 0 ? 'hit' : 'miss', { label: 'No' })],
    goalsOver: [pick(index < 4 ? 'hit' : 'miss', { line: 1.5 }), pick(index === 0 ? 'hit' : 'miss', { line: 2.5 })],
    goalsUnder: [pick(index === 0 ? 'hit' : 'miss', { line: 1.5 }), pick(index < 4 ? 'hit' : 'miss', { line: 2.5 })],
  }));
  const success = quickBetLeagueSuccessStats(history, filters);
  const starred = quickBetStarredMarketStats(history, filters, success);
  assert.deepEqual(starred.get('winner'), { hits: 4, settled: 5 });
  assert.deepEqual(starred.get('btts'), { hits: 4, settled: 5 });
  assert.deepEqual(starred.get('goals15'), { hits: 4, settled: 5 });
  assert.deepEqual(starred.get('goals25'), { hits: 4, settled: 5 });
  assert.deepEqual(starred.get('goals05'), { hits: 0, settled: 0 });
  assert.equal(quickBetStarStatText(starred.get('winner')), '4 / 5');
  assert.equal(quickBetStarStatText(starred.get('goals05')), '');
});

test('starred-only selections reuse exact qualifying league and market records', () => {
  const history = Array.from({ length: 5 }, (_, index) => row({
    winner: [pick(index < 4 ? 'hit' : 'miss')],
    btts: [
      pick(index < 4 ? 'hit' : 'miss', { label: 'Yes' }),
      pick(index === 0 ? 'hit' : 'miss', { label: 'No' }),
    ],
  }));
  const success = quickBetLeagueSuccessStats(history, filters);
  const upcoming = row({
    winner: [pick(null)], btts: [pick(null, { label: 'Yes' }), pick(null, { label: 'No' })],
  }, { lifecycle: 'upcoming', status: 'upcoming' });
  assert.deepEqual(quickBetStarredSelections(upcoming, filters.slice(0, 2), success)
    .map((selection) => selection.label), ['Home', 'Yes']);
  assert.deepEqual(quickBetStarredSelections({ ...upcoming, league: 'Other League' }, filters, success), []);
});

test('team form stars apply exact five-game and market-side ownership rules', () => {
  const match = (home, away) => row({}, {
    league: '', lifecycle: 'upcoming', status: 'upcoming', home: 'Home Team', away: 'Away Team',
    teamForm: { home, away },
  });
  const selection = (marketKey, extra) => ({ marketKey, odds: 1.25, ...extra });
  const winning = ['2-0', '1-0', '0-1', '3-2', '2-1'];
  const losing = ['0-2', '0-1', '1-0', '2-3', '1-2'];
  const draws = ['1-1', '0-0', '2-2', '1-0', '3-3'];
  const bttsYes = ['1-1', '2-1', '0-0', '3-2', '1-2'];
  const bttsNo = ['1-0', '0-0', '2-0', '3-1', '0-2'];
  const over25 = ['2-1', '3-0', '1-1', '4-0', '2-2'];
  const under25 = ['1-0', '0-0', '2-0', '2-1', '0-1'];

  assert.deepEqual(quickBetTeamSuccessLabels(match(winning, losing), selection('winner', { key: 'home', label: 'Home Team' })),
    ['Home Team last 5 — Winner: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, winning), selection('winner', { key: 'away', label: 'Away Team' })),
    ['Away Team last 5 — Winner: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, winning), selection('winner', { key: 'home', label: 'Home Team' })), []);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, draws), selection('winner', { key: 'draw', label: 'Draw' })),
    ['Away Team last 5 — Draw: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, bttsYes), selection('btts', { key: 'yes', label: 'Yes' })),
    ['Away Team last 5 — BTTS Yes: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(bttsNo, bttsYes), selection('btts', { key: 'no', label: 'No' })),
    ['Home Team last 5 — BTTS No: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, over25), selection('goalsOver', { key: 'over:2.5', line: 2.5 })),
    ['Away Team last 5 — Over 2.5: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(under25, over25), selection('goalsUnder', { key: 'under:2.5', line: 2.5 })),
    ['Home Team last 5 — Under 2.5: 4/5 hits']);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, over25), selection('goalsUnder', { key: 'under:2.5', line: 2.5 })), []);
  assert.deepEqual(quickBetTeamSuccessLabels(match(losing, over25), selection('goalsOver', { key: 'over:3.5', line: 3.5 })), []);
  assert.deepEqual(quickBetTeamSuccessLabels(match(winning.slice(0, 4), losing), selection('winner', { key: 'home', label: 'Home Team' })), []);
  assert.deepEqual(quickBetTeamSuccessLabels(match(['2-0', '1-0', '0-1', '0-2', '2-1'], losing), selection('winner', { key: 'home', label: 'Home Team' })), []);

  const starred = row({ winner: [pick('hit', { key: 'home', label: 'Home Team' })] }, {
    league: '', home: 'Home Team', away: 'Away Team', teamForm: { home: winning, away: losing },
  });
  const starStats = quickBetStarredMarketStats([starred], filters, new Map());
  assert.deepEqual(starStats.get('winner'), { hits: 1, settled: 1 });
  assert.match(quickBetSelectionSuccessLabel(starred, marketSelections(starred, filters[0])[0], undefined), /Home Team last 5/);
});

test('desktop, filtered leagues, mobile cards and linked/static odds share the star treatment', () => {
  assert.match(pageSource, /useMemo\(\(\) => quickBetLeagueSuccessStats\(matches, MARKET_COLUMNS\), \[matches\]\)/);
  assert.equal((pageSource.match(/<OddsBadge[^>]*leagueStats=\{leagueStats\}/g) || []).length, 2);
  assert.match(pageSource, /quickBetSelectionSuccessLabel\(match, selection, leagueStats\)/);
  assert.match(pageSource, /<MatchCard[\s\S]*?leagueStats=\{successByLeague\.get/);
  assert.match(pageSource, /<PriceCell[^>]*successByLeague=\{successByLeague\}[^>]*starredOnly=\{starredOnly\}/);
  assert.match(pageSource, /aria-label="Show starred markets only"/);
  assert.match(pageSource, /aria-pressed=\{starredOnly\}/);
  assert.match(pageSource, /<StarIcon \/>[\s\S]*?<span>Starred<\/span>/);
  assert.doesNotMatch(pageSource, /\bStar\s*}\s*from 'lucide-react'/);
  assert.ok((pageSource.match(/displayedSelections\(/g) || []).length >= 4);
  assert.match(pageSource, /quickBetStarredMarketStats\(matches, MARKET_COLUMNS, successByLeague\)/);
  assert.equal((pageSource.match(/<HeaderStat stats=\{stat\} \/>/g) || []).length, 2);
  assert.equal((pageSource.match(/className=\{`qb-stat-card/g) || []).length, 2);
  assert.equal((pageSource.match(/\{' · '\}/g) || []).length, 2);
  assert.equal((pageSource.match(/<StarCounter stats=\{starStat\}/g) || []).length, 2);
  assert.equal((pageSource.match(/aria-label=\{marketFilterAriaLabel\(filter, stat, starStat\)\}/g) || []).length, 2);
  assert.equal((pageSource.match(/<SuccessStar label=\{leagueSuccessLabel\}/g) || []).length, 3);
  assert.equal((pageSource.match(/<SuccessStar label=\{historyLabel\}/g) || []).length, 2);
  assert.match(pageSource, /role="img" title=\{label\} aria-label=\{label\}/);
  assert.match(pageSource, /aria-hidden="true" focusable="false"/);
  assert.match(pageSource, /href=\{href\}[\s\S]*?rel="noopener noreferrer"/);
  assert.match(readFileSync(new URL('../../globals.css', import.meta.url), 'utf8'), /--quick-bet-success: #f3bc63;/);
});

test('quickBetMatchState separates pending results from explicit voids', () => {
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'result_pending', score: null }), 'Result pending');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'FT', score: null }), 'Result pending');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'result', score: null }), 'Settled');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'finished', score: null }), 'Settled');
  assert.equal(quickBetMatchState({ lifecycle: 'result', status: 'FT', score: '2-0' }), '2-0 · FT');
  for (const status of ['postponed_or_cancelled', 'cancelled', 'postponed', 'void']) {
    assert.equal(quickBetMatchState({ lifecycle: 'result', status, score: '1-0' }), 'Void');
  }
});
