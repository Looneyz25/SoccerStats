import assert from 'node:assert/strict';
import test from 'node:test';
import { precomputeDisplayData } from './precompute_display_markets.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

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

test('table shows signed model probability differences against exact bookmaker prices', async () => {
  const { transform } = createRequire(import.meta.url)('next/dist/build/swc');
  const source = fs.readFileSync(new URL('../app/dashboard/page.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('function MatchesTable(');
  const end = source.indexOf('\nfunction ', start + 10);
  assert.ok(start >= 0 && end > start, 'MatchesTable source must be present');
  const { code } = await transform(source.slice(start, end), { jsc: { target: 'es2020', parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } });
  const row = { key: 'ou_cards', market: { pick: 'Under', line: 4.5 }, comparison: {} };
  const context = vm.createContext({ React, Number, Math,
    MARKET_CONFIG: [{ key: 'ou_cards', label: 'Cards' }],
    LeagueBadge: () => null, TeamBadge: () => null, Info: () => null,
    marketValueClass: () => "text-ink", resultIcon: () => null,
    MatchTableHint: ({ children, text }) => React.createElement('span', { title: typeof text === 'string' ? text : '' }, children),
    leagueCountryLabel: () => 'Europe', marketRowsForMatch: () => [row],
    formatDateDMY: x => x, hasScoreline: () => false, matchDisplayTime: () => '02:15', teamLogo: () => '',
    withLiveResult: (_m, _k, value) => value, formatMarketDetail: m => `${m.pick} ${m.line}`, formatOdds: n => n.toFixed(2),
  });
  vm.runInContext(code, context);
  const fixture = { id: 'sample', status: 'upcoming', date: '2026-09-11', home: { name: 'Fenerbahce' }, away: { name: 'AS Roma' } };
  const render = () => renderToStaticMarkup(React.createElement(context.MatchesTable, {
    groups: [{ league: 'UEFA Champions League', matches: [fixture] }], allMatches: [], onSelectMatch: () => {},
  }));
  for (const probability of [.775, .4]) {
    row.comparison = { modelProbability: probability, bookmakerOdds: 2.08, bookmaker: { odds: '2.08' }, model: { odds: '1.10' }, badge: { tone: 'positive' } };
    const html = render();
    const visible = html.replace(/<[^>]*>/g, '');
    assert.match(visible, probability > .5 ? /\+29\.4%/ : /-8\.1%/);
    assert.match(visible, new RegExp(`Model ${(probability * 100).toFixed(1)}%`));
    assert.doesNotMatch(visible, /vs bookie|pp gap|% edge|61\.2%|16\.8%/);
    assert.doesNotMatch(html, /text-emerald-500/);
    assert.match(html, /model probability minus 1 \/ odds/);
    assert.match(html, probability > .5 ? /Model-estimated return \+61\.2%/ : /Model-estimated return -16\.8%/);
    assert.match(html, probability > .5 ? /Model gap \+29\.4 percentage points/ : /Model gap -8\.1 percentage points/);
    assert.match(visible, /Under 4\.5/);
    assert.match(visible, /2\.08/);
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
  row.comparison = { modelProbability: .4081, bookmakerOdds: 3.9 };
  assert.match(render().replace(/<[^>]*>/g, ''), /\+15\.2%/);
  row.comparison = { modelProbability: 1 / 2.08 - .00001, bookmakerOdds: 2.08 };
  assert.match(render().replace(/<[^>]*>/g, ''), /\+0\.0%/);
  row.comparison = { modelProbability: .55, bookmakerOdds: 2.08, bookmaker: { odds: '2.08' } };
  assert.match(render(), /text-emerald-500/);
  row.market.odds_estimated = true;
  assert.match(render(), /Est\. \+6\.9%/);
  assert.match(render(), /Based on estimated odds/);
  assert.match(render(), /Estimated odds/);
  assert.match(render().replace(/<[^>]*>/g, ''), /Est\. 2\.08/);
  row.comparison = { bookmaker: { odds: '2.08' } };
  assert.match(render(), /Model unavailable/);
  row.comparison = { modelProbability: .775 };
  const noOdds = render();
  assert.match(noOdds, /Model 77\.5%/);
  assert.match(noOdds, /No bookmaker odds/);
  assert.doesNotMatch(noOdds, /NaN|Infinity/);
  row.market.odds_estimated = false;
  const qualifies = () => /data-strategy-candidate="true"/.test(render());
  for (const [probability, odds, expected] of [[.68, 1.6, true], [.65, 1.8, true], [.6499, 1.8, false], [.8, 1.5, false], [.775, 1.49, false], [.65, 1 / .6, false], [.64999, 1 / .6, false], [.65001, 1 / .6, true], [null, 1.8, false], [.8, undefined, false], [1, 2, false]]) {
    row.comparison = { modelProbability: probability, bookmakerOdds: odds, bookmaker: { odds: Number.isFinite(odds) ? odds.toFixed(2) : undefined } };
    assert.equal(qualifies(), expected, `strategy ${probability} at ${odds}`);
  }
  row.comparison = { modelProbability: .68, bookmakerOdds: 1.6, bookmaker: { odds: '1.60' } };
  assert.match(render(), /bg-blue-50/);
  assert.match(render(), /Model probabilities still require validation/);
  for (const flag of ['odds_estimated', 'insufficient_evidence', 'confidence_hidden']) {
    row.market[flag] = true;
    assert.equal(qualifies(), false, flag);
    delete row.market[flag];
  }
  row.comparison.bookmaker.label = 'Book est.';
  assert.equal(qualifies(), false);
  delete row.comparison.bookmaker.label;
  for (const status of ['live', 'FT', 'postponed_or_cancelled']) {
    fixture.status = status;
    assert.equal(qualifies(), false, status);
  }
  fixture.status = 'upcoming';
  row.market.result = 'hit';
  assert.equal(qualifies(), false);
  delete row.market.result;
  context.marketRowsForMatch = () => [];
  const missingMarket = render();
  assert.match(missingMarket, /No pick/);
  assert.doesNotMatch(missingMarket, /Model 77\.5%|Model-estimated return|NaN|Infinity/);
});

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

for (const path of ['../app/dashboard/page.jsx', './precompute_display_markets.mjs']) {
  test(`${path}: comparisons retain calibrated probabilities and unrounded prices`, () => {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const names = ['modelProbabilityForMarket', 'comparisonFromPrices', 'modelVsBookmakerComparison', 'winnerProbabilityBreakdown', 'displayBttsMarket', 'cardsMarketWithModelProbability', 'winnerMarketWithGuidance', 'strongestBookmakerSide'];
    if (path.endsWith('.jsx')) names.push('flattenMatches', 'marketForConfig', 'comparisonForMarket', 'withCornerBookmakerOdds', 'hasDirectCornerContext', 'capGenericCornerMarket', 'suggestedPickForMatch');
    else names.push('winnerLikeMarketWithFinalOnlyResult');
    const functions = names.map((name) => {
      const start = source.indexOf(`function ${name}(`);
      const end = source.indexOf('\nfunction ', start + 10);
      return source.slice(start, end);
    }).join('\n');
    const context = vm.createContext({
      Number, Math,
      fmtPrice: (n) => Number.isFinite(Number(n)) && Number(n) > 1 ? Number(n).toFixed(2) : null,
      fmtPct: (n) => `${Math.round(n * 100)}%`,
      impliedProbability: (n) => Number(n) > 1 ? 1 / Number(n) : null,
      round: (n, places = 4) => Number.isFinite(n) ? Number(n.toFixed(places)) : null,
      displayThreeWayOdds: (m) => m.odds,
      winnerGuidanceOdds: (m) => m.odds,
      withWinnerRiskCaution: (c) => c,
      oppositeTotalPick: (p) => p === 'Under' ? 'Over' : 'Under',
      cardBookmakerOddsInfo: () => ({ odds: 1.8, estimated: false }),
      marketResultFromActual: () => undefined,
      withWinnerConfidenceGate: (_match, market) => market,
      recentTeamForm: () => null,
      sideHasNoWinsStreak: () => false,
      teamNameForSide: (side, match) => match[side]?.name,
      winnerResultFromActual: () => undefined,
      BOOKMAKER_WINNER_GUARD_THRESHOLD: .65,
      CORNER_MODEL_PROBABILITY_CAP: .72,
      NO_ODDS_CORNER_PROBABILITY_CAP: .55,
      arrayValue: (value) => Array.isArray(value) ? value : [],
      textValue: (value, fallback) => value || fallback,
      leagueLogo: () => null,
    });
    vm.runInContext(functions, context);
    const match = { status: 'upcoming', odds: { home: 3.9, draw: 3.2, away: 1.8 }, predictions: {
      factors: { lambda_home: 1.85, lambda_away: 1.507 },
      winner: { type: 'home', probability: .4081, probabilities: { home: .4081, draw: .259, away: .333 } },
      btts: { pick: 'No', probability: .61, odds: 1.673 },
      ou_cards: { pick: 'Under', probability: .775, line: 4.5, odds: 2.08 },
    } };
    assert.equal(context.modelVsBookmakerComparison(match, 'winner', match.predictions.winner).modelProbability, .4081);
    const btts = context.modelVsBookmakerComparison(match, 'btts', match.predictions.btts);
    assert.equal(btts.modelProbability, .61);
    assert.equal(btts.bookmakerOdds, 1.673);
    assert.equal(context.displayBttsMarket(match.predictions.btts, match), match.predictions.btts);
    assert.equal(context.cardsMarketWithModelProbability(match, []), match.predictions.ou_cards);
    assert.equal(context.winnerProbabilityBreakdown(match)[0].model, .4081);
    const cards = context.modelVsBookmakerComparison(match, 'ou_cards', match.predictions.ou_cards);
    assert.equal(cards.modelProbability, .775);
    assert.equal(cards.badge.tone, 'warning');
    assert.match(cards.badge.label, /pp$/);
    assert.ok(Math.abs((cards.modelProbability * cards.bookmakerOdds - 1) * 100 - 61.2) < 1e-9);
    assert.equal(context.modelVsBookmakerComparison(match, 'btts', { pick: 'Yes', odds: 1.7 }).modelProbability, undefined);
    assert.equal(context.winnerProbabilityBreakdown({ predictions: { factors: { lambda_home: 2, lambda_away: 1 } } }), null);
    const frozen = { ...match, prediction_locked: true, predictions: { ou_cards: { pick: 'Under', probability: .4, line: 4.5 } } };
    assert.equal(context.cardsMarketWithModelProbability(frozen, []), frozen.predictions.ou_cards);
    const weakCards = { ...match, predictions: { ou_cards: { pick: 'Over', probability: .4, model_probability: .4, odds: 2.4, line: 4.5 } } };
    const originalCards = JSON.stringify(weakCards);
    const inverseCards = context.cardsMarketWithModelProbability(weakCards, []);
    assert.equal(inverseCards.pick, 'Under');
    assert.equal(inverseCards.probability, .6);
    assert.equal(inverseCards.model_probability, .6);
    assert.equal(inverseCards.odds, 1.8);
    assert.equal(JSON.stringify(weakCards), originalCards);
    assert.equal(context.cardsMarketWithModelProbability({ ...weakCards, status: 'FT' }, []), weakCards.predictions.ou_cards);

    const heavyAway = { ...match, home: { name: 'Home' }, away: { name: 'Away' }, odds: { home: 5, draw: 4, away: 1.2 }, predictions: {
      winner: { type: 'home', pick: 'Home', probability: .45, model_probability: .45, probabilities: { home: .45, draw: .2, away: .35 } },
    } };
    const originalWinner = JSON.stringify(heavyAway);
    const guided = context.winnerMarketWithGuidance(heavyAway);
    assert.equal(guided.type, 'away');
    assert.equal(guided.probability, .35);
    assert.equal(guided.model_probability, .35);
    assert.equal(JSON.stringify(heavyAway), originalWinner);
    const lockedWinner = context.winnerMarketWithGuidance({ ...heavyAway, prediction_locked: true });
    assert.equal(JSON.stringify(lockedWinner), JSON.stringify(heavyAway.predictions.winner));
    assert.equal(context.winnerMarketWithGuidance({ ...heavyAway, status: 'FT' }), heavyAway.predictions.winner);
    const missingVector = { ...heavyAway, predictions: { winner: { type: 'home', probability: .45 } } };
    assert.equal(JSON.stringify(context.winnerMarketWithGuidance(missingVector)), JSON.stringify(missingVector.predictions.winner));

    if (path.endsWith('.jsx')) {
      const savedMarket = { pick: 'Yes', probability: .91, odds: 1.67, result: 'hit' };
      const savedSuggestion = { label: 'BTTS', market: savedMarket };
      const cached = { ...match, display_markets: { btts: { market: savedMarket } }, display_summary: { format: 'display_precompute_v1', compactMarket: savedSuggestion } };
      const flatten = (row) => context.flattenMatches({ leagues: [{ name: 'Test', matches: [row] }] })[0];
      const upcoming = flatten(cached);
      assert.equal(upcoming.display_markets, undefined);
      assert.equal(upcoming.display_summary, undefined);
      assert.equal(context.marketForConfig({ key: 'btts' }, upcoming), match.predictions.btts);
      assert.equal(context.comparisonForMarket(upcoming, 'btts', match.predictions.btts, { modelProbability: .91 }).modelProbability, .61);
      const current = flatten({ ...cached, display_summary: { format: 'display_precompute_v2' } });
      assert.equal(current.display_markets, cached.display_markets);
      for (const state of [{ status: 'FT' }, { prediction_locked: true }]) {
        const historical = flatten({ ...cached, ...state });
        assert.equal(historical.display_markets, cached.display_markets);
        assert.equal(context.marketForConfig({ key: 'btts' }, historical), savedMarket);
        assert.equal(context.suggestedPickForMatch(historical, []), savedSuggestion);
        const corner = { pick: 'Under', line: 10.5, probability: .65, odds: 1.493, result: 'miss' };
        const cornerBefore = JSON.stringify(corner);
        const legacyComparison = { model: { odds: '1.54' }, bookmaker: { odds: '1.49' } };
        const comparison = context.comparisonForMarket(historical, 'ou_corners', corner, legacyComparison);
        assert.equal(comparison.modelProbability, .65);
        assert.equal(comparison.bookmakerOdds, 1.493);
        assert.equal(JSON.stringify(corner), cornerBefore);
        assert.equal(context.comparisonForMarket(historical, 'ou_corners', { ...corner, confidence_hidden: true }, legacyComparison).modelProbability, undefined);
      }
    }
  });
}

test('recomputed display leaves finished prediction snapshots unchanged', () => {
  const match = baseFinishedMatch();
  match.prediction_locked = true;
  const before = JSON.stringify(match.predictions);
  const computed = precomputeDisplayData({ leagues: [{ name: 'Test', matches: [match] }] }).leagues[0].matches[0];
  assert.equal(JSON.stringify(computed.predictions), before);
  assert.equal(computed.display_markets.btts.comparison.modelProbability, .58);
  assert.equal(computed.display_markets.goals.comparison.modelProbability, .61);
});

test('precompute preserves a saved historical suggested pick', () => {
  const match = baseFinishedMatch();
  const compactMarket = { label: 'Goals', market: { ...match.predictions.ou_goals } };
  match.display_summary = { format: 'display_precompute_v1', compactMarket };
  const computed = precomputeDisplayData({ leagues: [{ name: 'Test', matches: [match] }] }).leagues[0].matches[0];
  assert.deepEqual(computed.display_summary.compactMarket, compactMarket);
});
