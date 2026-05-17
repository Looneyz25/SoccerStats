const WINNER_CONFIDENCE_THRESHOLD = 0.40;
const PREDICTION_TRACKING_START_DATE = '2026-04-22';

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function fmtPct(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(0)}%` : '-';
}

function fmtPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : '-';
}

function impliedProbability(odds) {
  const value = Number(odds);
  return Number.isFinite(value) && value > 0 ? 1 / value : null;
}

function decimalFromProbability(probability) {
  const value = Number(probability);
  return Number.isFinite(value) && value > 0 ? 1 / value : null;
}

function hasThreeWayOdds(odds) {
  return ['home', 'draw', 'away'].every((key) => {
    const value = Number(odds?.[key]);
    return Number.isFinite(value) && value > 1.01;
  });
}

function displayThreeWayOdds(match) {
  const originalOdds = match?.odds || {};
  const bookmakerOdds = match?.sportsbet_odds || {};
  if (match?.status === 'FT' && hasThreeWayOdds(originalOdds)) return originalOdds;
  if (hasThreeWayOdds(bookmakerOdds)) return bookmakerOdds;
  return originalOdds;
}

function bookmakerNoVigProbability(odds, side) {
  const home = impliedProbability(odds?.home);
  const draw = impliedProbability(odds?.draw);
  const away = impliedProbability(odds?.away);
  if (![home, draw, away].every((p) => Number.isFinite(p) && p > 0)) return null;
  const total = home + draw + away;
  if (!(total > 0)) return null;
  const map = { home: home / total, draw: draw / total, away: away / total };
  return side ? map[side] ?? null : map;
}

function factorial(n) {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

function poissonOverTotalProbability(lambda, line, max = 40) {
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line)) return null;
  const cutoff = Math.floor(line);
  let pUnderOrEqual = 0;
  for (let k = 0; k <= Math.min(cutoff, max); k += 1) {
    pUnderOrEqual += Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }
  return Math.max(0, Math.min(1, 1 - pUnderOrEqual));
}

function poissonMarketProbabilities(lh, la, rho = 0, line = 2.5) {
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  const pmf = (k, l) => Math.exp(-l) * Math.pow(l, k) / [1, 1, 2, 6, 24, 120, 720][k];
  const grid = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => pmf(i, lh) * pmf(j, la)));
  grid[0][0] *= 1 - lh * la * rho;
  grid[1][0] *= 1 + la * rho;
  grid[0][1] *= 1 + lh * rho;
  grid[1][1] *= 1 - rho;
  const total = grid.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0);
  if (total <= 0) return null;

  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let overGoals = 0;
  for (let i = 0; i < 7; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      const p = grid[i][j] / total;
      if (i > j) home += p;
      else if (j > i) away += p;
      else draw += p;
      if (i > 0 && j > 0) bttsYes += p;
      if (i + j > line) overGoals += p;
    }
  }
  return { home, draw, away, bttsYes, overGoals };
}

function teamNameForSide(side, match) {
  if (side === 'home') return match.home?.short || match.home?.name || 'Home';
  if (side === 'away') return match.away?.short || match.away?.name || 'Away';
  if (side === 'draw') return 'Draw';
  return 'Both';
}

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
}

function matchSortKey(match) {
  return `${match?.date || ''} ${match?.time || ''}`;
}

function sameTeamId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function teamGoalsInMatch(match, teamId) {
  if (sameTeamId(match.home?.team_id, teamId)) return { scored: match.home?.goals, conceded: match.away?.goals, side: 'home' };
  if (sameTeamId(match.away?.team_id, teamId)) return { scored: match.away?.goals, conceded: match.home?.goals, side: 'away' };
  return null;
}

function resultForTeam(scored, conceded) {
  if (scored > conceded) return 'W';
  if (scored < conceded) return 'L';
  return 'D';
}

function recentTeamForm(allMatches, teamId, currentMatchId, n = 5, options = {}) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      const goals = teamGoalsInMatch(m, teamId);
      if (!goals || typeof goals.scored !== 'number' || typeof goals.conceded !== 'number') return false;
      if (options.side && goals.side !== options.side) return false;
      if (options.venue && m.venue !== options.venue) return false;
      return true;
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, n);
  if (!played.length) return null;

  const summary = { count: played.length, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 };
  for (const m of played) {
    const goals = teamGoalsInMatch(m, teamId);
    summary.scored += goals.scored;
    summary.conceded += goals.conceded;
    const result = resultForTeam(goals.scored, goals.conceded);
    if (result === 'W') summary.wins += 1;
    else if (result === 'D') summary.draws += 1;
    else summary.losses += 1;
  }
  return {
    ...summary,
    avgScored: summary.scored / summary.count,
    avgConceded: summary.conceded / summary.count,
    goalDiff: summary.scored - summary.conceded,
    pointsPerMatch: (summary.wins * 3 + summary.draws) / summary.count,
  };
}

function recentTeamCards(allMatches, teamId, currentMatchId, n = 5) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      if (!sameTeamId(m.home?.team_id, teamId) && !sameTeamId(m.away?.team_id, teamId)) return false;
      return typeof m.predictions?.ou_cards?.actual === 'number';
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, n);
  if (!played.length) return null;
  const total = played.reduce((sum, m) => sum + m.predictions.ou_cards.actual, 0);
  return { count: played.length, avg: total / played.length };
}

function recentTeamCorners(allMatches, teamId, currentMatchId, n = 5) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      if (!sameTeamId(m.home?.team_id, teamId) && !sameTeamId(m.away?.team_id, teamId)) return false;
      return typeof m.actuals?.corners_total === 'number';
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, n);
  if (!played.length) return null;
  const total = played.reduce((sum, m) => sum + m.actuals.corners_total, 0);
  return { count: played.length, avg: total / played.length };
}

function marketProbabilityFromTotalAverage(market, averageTotal) {
  if (!market) return null;
  const line = Number(market.line);
  const pOver = poissonOverTotalProbability(averageTotal, line);
  if (!Number.isFinite(pOver)) return null;
  if (market.pick === 'Over') return pOver;
  if (market.pick === 'Under') return 1 - pOver;
  return null;
}

function oppositeTotalPick(pick) {
  if (pick === 'Over') return 'Under';
  if (pick === 'Under') return 'Over';
  return pick;
}

function marketResultFromActual(market, actual) {
  if (!market || actual === null || actual === undefined || Number.isNaN(Number(actual))) return undefined;
  const line = Number(market.line);
  if (!Number.isFinite(line)) return undefined;
  if (market.pick === 'Over') return Number(actual) > line ? 'hit' : 'miss';
  if (market.pick === 'Under') return Number(actual) < line ? 'hit' : 'miss';
  return undefined;
}

function modelProbabilityForMarket(market) {
  for (const key of ['model_probability', 'probability']) {
    const value = Number(market?.[key]);
    if (Number.isFinite(value) && value > 0 && value < 1) return value;
  }
  return NaN;
}

function cornerBookmakerOdds(match, line, pick) {
  const lineKey = String(line ?? 10.5);
  const lineOdds = match.corner_odds?.[lineKey] || match.corner_odds?.[Number(line).toFixed(1)];
  const value = lineOdds?.[pick];
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function exactCardBookmakerOdds(match, line, pick) {
  const prediction = match.predictions?.ou_cards;
  if (Number(prediction?.line) === Number(line) && prediction?.pick === pick) {
    const predictionOdds = Number(prediction.odds);
    if (Number.isFinite(predictionOdds) && predictionOdds > 1.01) return predictionOdds;
  }
  return undefined;
}

function estimatedOppositeOdds(knownOdds) {
  const knownProb = impliedProbability(knownOdds);
  if (!Number.isFinite(knownProb) || knownProb <= 0 || knownProb >= 1) return undefined;
  const oppositeOdds = decimalFromProbability(1 - knownProb);
  return Number.isFinite(oppositeOdds) && oppositeOdds > 1.01 ? Number(oppositeOdds.toFixed(2)) : undefined;
}

function cardBookmakerOddsInfo(match, line, pick) {
  const exactOdds = exactCardBookmakerOdds(match, line, pick);
  if (Number.isFinite(exactOdds)) return { odds: exactOdds, estimated: false };
  const oppositeOdds = exactCardBookmakerOdds(match, line, oppositeTotalPick(pick));
  const estimatedOdds = estimatedOppositeOdds(oppositeOdds);
  if (Number.isFinite(estimatedOdds)) return { odds: estimatedOdds, estimated: true };
  return { odds: undefined, estimated: false };
}

function winnerActualType(match) {
  const homeGoals = Number(match.home?.goals);
  const awayGoals = Number(match.away?.goals);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

function winnerResultFromActual(match, type) {
  const actual = winnerActualType(match);
  if (!actual || !type) return undefined;
  return actual === type ? 'hit' : 'miss';
}

function strongestBookmakerSide(odds) {
  const rows = ['home', 'draw', 'away']
    .map((type) => ({ type, odds: Number(odds?.[type]), probability: impliedProbability(Number(odds?.[type])) }))
    .filter((row) => Number.isFinite(row.odds) && row.odds > 1.01 && Number.isFinite(row.probability));
  if (!rows.length) return null;
  return rows.sort((a, b) => b.probability - a.probability)[0];
}

function sideHasNoWinsStreak(match, side, minimum = 5) {
  return (match.team_streaks || []).some((streak) => {
    const value = Number(String(streak.value || '').match(/\d+/)?.[0]);
    return streak.team === side && String(streak.label || '').toLowerCase() === 'no wins' && Number.isFinite(value) && value >= minimum;
  });
}

function winnerProbabilityBreakdown(match) {
  const f = match.predictions?.factors || {};
  const probs = poissonMarketProbabilities(Number(f.lambda_home), Number(f.lambda_away), Number(f.dixon_coles_rho) || 0);
  if (!probs) return null;
  const odds = displayThreeWayOdds(match);
  return [
    { key: 'home', label: match.home?.short || match.home?.name || 'Home', model: round(probs.home), bookmaker: round(impliedProbability(odds.home)) },
    { key: 'draw', label: 'Draw', model: round(probs.draw), bookmaker: round(impliedProbability(odds.draw)) },
    { key: 'away', label: match.away?.short || match.away?.name || 'Away', model: round(probs.away), bookmaker: round(impliedProbability(odds.away)) },
  ];
}

function withWinnerConfidenceGate(match, market) {
  if (!market?.type || match.status === 'FT') return market;
  const noVig = bookmakerNoVigProbability(displayThreeWayOdds(match), market.type);
  if (!Number.isFinite(noVig) || noVig >= WINNER_CONFIDENCE_THRESHOLD) return market;
  return { ...market, lowConfidence: true, lowConfidenceProb: round(noVig) };
}

function winnerMarketWithGuidance(match, allMatches = []) {
  const market = match.predictions?.winner;
  if (!market?.type) return market || null;
  if (match.status === 'FT') return market;
  const rows = winnerProbabilityBreakdown(match);
  const selected = rows?.find((row) => row.key === market.type);
  const selectedModel = selected?.model;
  const strongestModel = rows?.reduce((best, row) => (!best || row.model > best.model ? row : best), null);
  const modelLead = Number.isFinite(selectedModel) && Number.isFinite(strongestModel?.model)
    ? selectedModel - rows.filter((row) => row.key !== market.type).reduce((best, row) => Math.max(best, row.model || 0), 0)
    : 0;
  const odds = displayThreeWayOdds(match);
  const bookmakerSide = strongestBookmakerSide(odds);
  if (!bookmakerSide || bookmakerSide.type === market.type || bookmakerSide.type === 'draw') return withWinnerConfidenceGate(match, market);

  const pickedOdds = Number(odds?.[market.type]);
  const pickedBookProbability = impliedProbability(pickedOdds);
  const bookProbabilityGap = Number.isFinite(bookmakerSide.probability) && Number.isFinite(pickedBookProbability)
    ? bookmakerSide.probability - pickedBookProbability
    : 0;
  const oddsRatio = Number.isFinite(pickedOdds) && Number.isFinite(bookmakerSide.odds) ? pickedOdds / bookmakerSide.odds : 0;
  const pickedForm = recentTeamForm(allMatches, market.type === 'home' ? match.home?.team_id : match.away?.team_id, match.id, 8);
  const bookmakerForm = recentTeamForm(allMatches, bookmakerSide.type === 'home' ? match.home?.team_id : match.away?.team_id, match.id, 8);
  const pickedNoWins = sideHasNoWinsStreak(match, market.type);
  const bookmakerFormEdge = Number.isFinite(bookmakerForm?.pointsPerMatch) && Number.isFinite(pickedForm?.pointsPerMatch)
    ? bookmakerForm.pointsPerMatch - pickedForm.pointsPerMatch
    : 0;
  const noExactH2h = Number(match.predictions?.factors?.h2h_n || 0) === 0;
  const strongMarketDisagreement = bookProbabilityGap >= 0.18 || oddsRatio >= 2;
  const majorMarketDisagreement = bookProbabilityGap >= 0.25 || oddsRatio >= 3;
  const modelIsNotClear = !Number.isFinite(selectedModel) || selectedModel < 0.5 || modelLead <= 0.1;
  const modelCanOverrideBookmaker = Number.isFinite(selectedModel) && selectedModel >= 0.6 && modelLead >= 0.18;
  const contextSupportsBookmaker = pickedNoWins || bookmakerFormEdge >= 0.35 || noExactH2h;

  if (modelCanOverrideBookmaker || !(majorMarketDisagreement || (strongMarketDisagreement && modelIsNotClear && contextSupportsBookmaker))) {
    return withWinnerConfidenceGate(match, market);
  }

  const guided = {
    ...market,
    pick: teamNameForSide(bookmakerSide.type, match),
    type: bookmakerSide.type,
    odds: bookmakerSide.odds,
    probability: rows?.find((row) => row.key === bookmakerSide.type)?.model ?? market.probability,
    result: winnerResultFromActual(match, bookmakerSide.type) || market.result,
    guidance: {
      type: 'bookmaker_guard',
      originalPick: market.pick,
      originalType: market.type,
      reason: majorMarketDisagreement
        ? 'Direct bookmaker market strongly overrode a model lean.'
        : 'Bookmaker and context overrode a low-conviction model lean.',
    },
  };
  return withWinnerConfidenceGate(match, guided);
}

function displayBttsMarket(market, match = null) {
  if (!market) return null;
  if (match?.status === 'FT') return market;
  const f = match?.predictions?.factors || {};
  const probs = poissonMarketProbabilities(Number(f.lambda_home), Number(f.lambda_away), Number(f.dixon_coles_rho) || 0);
  const pYes = probs?.bttsYes;
  const nextPick = Number.isFinite(pYes) ? (pYes > 0.56 ? 'Yes' : 'No') : market.pick === 'Pass' ? 'No' : market.pick;
  if (nextPick === market.pick && market.pick !== 'Pass') return market;
  const probability = Number.isFinite(pYes) ? (nextPick === 'Yes' ? pYes : 1 - pYes) : Number(market.probability);
  const actual = market.actual_btts;
  const result = typeof actual === 'boolean' ? ((nextPick === 'Yes') === actual ? 'hit' : 'miss') : market.result === 'pass' ? undefined : market.result;
  return { ...market, pick: nextPick, probability: round(probability), result };
}

function cardsMarketWithModelProbability(match, allMatches) {
  const market = match.predictions?.ou_cards;
  if (!market) return null;
  if (match.status === 'FT') return market;
  const available = [
    recentTeamCards(allMatches, match.home?.team_id, match.id),
    recentTeamCards(allMatches, match.away?.team_id, match.id),
  ].filter(Boolean);
  if (!available.length) return market;
  const average = available.reduce((sum, item) => sum + item.avg, 0) / available.length;
  const line = Number(market.line ?? 4.5);
  const modelProbability = marketProbabilityFromTotalAverage(market, average);
  if (Number.isFinite(modelProbability) && modelProbability < 0.5) {
    const guidedPick = oppositeTotalPick(market.pick);
    const oddsInfo = cardBookmakerOddsInfo(match, line, guidedPick);
    const guidedMarket = {
      ...market,
      pick: guidedPick,
      line,
      odds: oddsInfo.odds,
      odds_estimated: oddsInfo.estimated,
      model_probability: round(1 - modelProbability),
      model_average_total: round(average),
      trendConflict: { pick: market.pick, line, model_probability: round(modelProbability) },
    };
    return { ...guidedMarket, result: marketResultFromActual(guidedMarket, market.actual) };
  }
  return { ...market, model_probability: round(modelProbability), model_average_total: round(average) };
}

function cornerMarketFromStreaks(match, allMatches = []) {
  if (match.predictions?.ou_corners) {
    const prediction = match.predictions.ou_corners;
    return {
      ...prediction,
      actual: prediction.actual ?? match.actuals?.corners_total,
      result: prediction.result || marketResultFromActual(prediction, match.actuals?.corners_total),
    };
  }
  const available = [
    recentTeamCorners(allMatches, match.home?.team_id, match.id),
    recentTeamCorners(allMatches, match.away?.team_id, match.id),
  ].filter(Boolean);
  if (!available.length) return null;
  const average = available.reduce((sum, item) => sum + item.avg, 0) / available.length;
  const line = 10.5;
  const pick = average >= line ? 'Over' : 'Under';
  const market = {
    pick,
    line,
    odds: cornerBookmakerOdds(match, line, pick),
    actual: match.actuals?.corners_total,
    model_probability: round(marketProbabilityFromTotalAverage({ pick, line }, average)),
    model_average_total: round(average),
    sourceLabel: 'Recent corner average',
    sourceValue: `${average.toFixed(1)} avg`,
    team: 'both',
  };
  return { ...market, result: marketResultFromActual(market, market.actual) };
}

function comparisonFromPrices({ title, modelProb, marketOdds, fallbackLabel = null, marketOddsEstimated = false }) {
  const bookmakerLabel = marketOddsEstimated ? 'Book est.' : 'Bookmaker';
  if (!Number.isFinite(modelProb)) {
    const marketPrice = fmtPrice(marketOdds);
    return {
      title,
      badge: { label: fallbackLabel || 'Trend pick', tone: 'neutral' },
      bookmaker: { label: bookmakerLabel, odds: marketPrice, probability: Number.isFinite(impliedProbability(marketOdds)) ? fmtPct(impliedProbability(marketOdds)) : '-' },
      model: { odds: fallbackLabel || 'Trend pick', probability: '-' },
      edgePoints: 0,
      modelEdge: 0,
      note: 'This pick comes from recent trends, so treat the bookmaker odds as a guide only.',
    };
  }

  const modelPrice = fmtPrice(1 / modelProb);
  const marketPrice = fmtPrice(marketOdds);
  const marketProb = impliedProbability(marketOdds);
  if (modelPrice === '-') return null;

  if (marketPrice === '-' || !Number.isFinite(marketProb)) {
    const isModelSuggestion = modelProb >= 0.56;
    return {
      title,
      badge: { label: isModelSuggestion ? 'Model suggestion' : 'Model odds', tone: isModelSuggestion ? 'positive' : 'neutral' },
      bookmaker: { label: bookmakerLabel, odds: '-', probability: '-' },
      model: { odds: modelPrice, probability: fmtPct(modelProb) },
      edgePoints: 0,
      modelEdge: 0,
      note: isModelSuggestion
        ? 'Our model likes this from recent totals, but bookmaker odds are not available.'
        : 'Our model has a price from recent totals, but bookmaker odds are not available.',
    };
  }

  const diff = modelProb - marketProb;
  const points = Math.abs(diff * 100).toFixed(0);
  const isClose = Math.abs(diff) < 0.02;
  const label = isClose ? 'Close to market' : diff > 0 ? `Model +${points}%` : `Bookmaker +${points}%`;
  const tone = isClose ? 'neutral' : diff > 0 ? 'positive' : 'warning';
  return {
    title,
    badge: { label, tone },
    bookmaker: { label: bookmakerLabel, odds: marketPrice, probability: fmtPct(marketProb) },
    model: { odds: modelPrice, probability: fmtPct(modelProb) },
    edgePoints: round(Math.abs(diff * 100), 1),
    modelEdge: round(diff),
    note: isClose
      ? marketOddsEstimated
        ? 'No clear edge; this uses an estimated opposite-side price, so check the bookmaker first.'
        : 'No clear edge; bookmaker odds are about where we would expect.'
      : diff > 0
        ? marketOddsEstimated
          ? 'Our model rates this better than the estimated odds suggest, but check the bookmaker first.'
          : 'Our model predicts this has a better chance of hitting than the bookmaker odds suggest.'
        : marketOddsEstimated
          ? 'The estimated odds look too low for the risk, so check the bookmaker first.'
          : 'No clear edge; the bookmaker odds look too low for the risk.',
  };
}

function modelVsBookmakerComparison(match, marketKey, market) {
  if (!market) return null;
  const f = match.predictions?.factors || {};
  const probs = poissonMarketProbabilities(Number(f.lambda_home), Number(f.lambda_away), Number(f.dixon_coles_rho) || 0, Number(market.line ?? 2.5));

  if (marketKey === 'winner') {
    if (!market.type || market.type === 'draw' || !probs) return null;
    return comparisonFromPrices({ title: 'Winner', modelProb: probs[market.type], marketOdds: Number(displayThreeWayOdds(match)[market.type] ?? market.odds) });
  }
  if (marketKey === 'btts' && probs) {
    const modelProb = market.pick === 'No' ? 1 - probs.bttsYes : probs.bttsYes;
    return comparisonFromPrices({ title: 'BTTS', modelProb, marketOdds: Number(market.odds) });
  }
  if (marketKey === 'ou_goals' && probs) {
    const modelProb = market.pick === 'Under' ? 1 - probs.overGoals : probs.overGoals;
    return comparisonFromPrices({ title: `${market.pick || 'Goals'} ${market.line ?? 2.5} Goals`, modelProb, marketOdds: Number(market.odds) });
  }
  if (marketKey === 'ou_cards') {
    return comparisonFromPrices({
      title: `${market.pick || 'Cards'} ${market.line ?? 4.5} Cards`,
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      marketOddsEstimated: Boolean(market.odds_estimated),
      fallbackLabel: 'Trend pick',
    });
  }
  if (marketKey === 'ou_corners') {
    return comparisonFromPrices({
      title: `${market.pick || 'Corners'} ${market.line ?? 10.5} Corners`,
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      fallbackLabel: 'Trend pick',
    });
  }
  return null;
}

function marketEntry(match, allMatches, key, title, market) {
  const comparison = modelVsBookmakerComparison(match, key, market);
  const modelProbability =
    key === 'winner'
      ? winnerProbabilityBreakdown(match)?.find((row) => row.key === market?.type)?.model ?? null
      : modelProbabilityForMarket(market);
  return {
    market: market || null,
    modelProbability: Number.isFinite(modelProbability) ? round(modelProbability) : null,
    fairOdds: Number.isFinite(modelProbability) ? round(decimalFromProbability(modelProbability), 2) : null,
    bookmakerImpliedProbability: round(impliedProbability(Number(market?.odds))),
    comparison,
    label: title,
    display: market ? formatMarketDetail(market) : null,
  };
}

function suggestedMarketPick(candidates, isFinished = false) {
  const available = candidates.filter((item) => item?.market);
  if (!available.length) return null;
  return available
    .map((item, index) => ({
      ...item,
      index,
      modelEdge: Number(item.comparison?.modelEdge || 0),
      modelProbability: Number(item.modelProbability ?? modelProbabilityForMarket(item.market)),
    }))
    .sort((a, b) => {
      if (isFinished) {
        const resultRank = (item) => item.market?.result === 'hit' ? 2 : item.market?.result === 'miss' ? 0 : 1;
        const resultDiff = resultRank(b) - resultRank(a);
        if (resultDiff) return resultDiff;
      }
      const edgeDiff = b.modelEdge - a.modelEdge;
      if (edgeDiff) return edgeDiff;
      const probDiff = (Number.isFinite(b.modelProbability) ? b.modelProbability : 0) - (Number.isFinite(a.modelProbability) ? a.modelProbability : 0);
      if (probDiff) return probDiff;
      return a.index - b.index;
    })[0];
}

function dataQualityForMatch(match) {
  const f = match.predictions?.factors || {};
  const odds = displayThreeWayOdds(match);
  const signals = [];
  const cautions = [];
  if (odds.home && odds.draw && odds.away) signals.push('1X2 odds');
  else cautions.push('missing 1X2 odds');
  if (match.sportsbet_odds?.event_url) signals.push('direct Sportsbet');
  else cautions.push('bookmaker link fallback');
  if (Number.isFinite(Number(f.lambda_home)) && Number.isFinite(Number(f.lambda_away))) signals.push('model xG');
  else cautions.push('model xG missing');
  if ((match.team_streaks || []).length >= 2) signals.push('team streaks');
  else cautions.push('thin team streaks');
  const score = signals.length - Math.min(cautions.length, 2);
  const label = score >= 4 ? 'Data strong' : score >= 2 ? 'Data usable' : 'Data weak';
  const tone = score >= 4 ? 'positive' : score >= 2 ? 'neutral' : 'warning';
  return { label, tone, score, signals, cautions };
}

function confidenceForMatch(match, displayMarkets) {
  const edges = Object.entries(displayMarkets)
    .filter(([, entry]) => entry?.comparison?.badge?.tone === 'positive' && Number(entry.comparison.modelEdge) > 0)
    .sort((a, b) => Number(b[1].comparison.modelEdge) - Number(a[1].comparison.modelEdge));
  const bestEdge = Number(edges[0]?.[1]?.comparison?.modelEdge || 0);
  const quality = dataQualityForMatch(match);
  if (!edges.length) return { label: 'Avoid picking a winner', tone: 'warning', reason: 'Our model does not see better odds than the bookmaker', edge: 0, quality };
  if (bestEdge >= 0.05 && quality.score >= 3) return { label: 'Strong edge', tone: 'positive', reason: `${edges[0][1].label} ${edges[0][1].comparison.badge.label}`, edge: bestEdge, quality };
  if (bestEdge >= 0.02 && quality.score >= 2) return { label: 'Watchlist', tone: 'neutral', reason: `${edges[0][1].label} ${edges[0][1].comparison.badge.label}`, edge: bestEdge, quality };
  return { label: 'Data weak', tone: 'warning', reason: quality.cautions[0] || 'Thin supporting data', edge: bestEdge, quality };
}

function headlineMarkets(match, displayMarkets) {
  if (match.status !== 'FT' || String(match.date || '') < PREDICTION_TRACKING_START_DATE) return [];
  return ['winner', 'btts', 'goals', 'cards', 'corners']
    .map((key) => displayMarkets[key]?.market)
    .filter((market) => market?.result === 'hit' || market?.result === 'miss');
}

function summarizeHeadline(markets) {
  const hits = markets.filter((market) => market.result === 'hit').length;
  const oddsTotals = markets.reduce((totals, market) => {
    const odds = Number(market?.odds);
    if (!Number.isFinite(odds)) return totals;
    if (market.result === 'hit') totals.hit += odds;
    if (market.result === 'miss') totals.loss += odds;
    return totals;
  }, { hit: 0, loss: 0 });
  return {
    settled: markets.length,
    hits,
    misses: markets.length - hits,
    hitRate: markets.length ? Math.round((hits / markets.length) * 100) : 0,
    oddsHit: round(oddsTotals.hit, 1) || 0,
    oddsLoss: round(oddsTotals.loss, 1) || 0,
  };
}

function precomputeMatch(match, allMatches) {
  const winner = winnerMarketWithGuidance(match, allMatches);
  const btts = displayBttsMarket(match.predictions?.btts, match);
  const goals = match.predictions?.ou_goals || null;
  const cards = cardsMarketWithModelProbability(match, allMatches);
  const corners = cornerMarketFromStreaks(match, allMatches);
  const displayMarkets = {
    winner: marketEntry(match, allMatches, 'winner', 'Winner', winner),
    btts: marketEntry(match, allMatches, 'btts', 'BTTS', btts),
    goals: marketEntry(match, allMatches, 'ou_goals', 'Goals', goals),
    cards: marketEntry(match, allMatches, 'ou_cards', 'Cards', cards),
    corners: marketEntry(match, allMatches, 'ou_corners', 'Corners', corners),
  };
  const compactMarket = suggestedMarketPick([
    displayMarkets.btts,
    displayMarkets.goals,
    displayMarkets.cards,
    displayMarkets.corners,
  ], match.status === 'FT');
  const odds = displayThreeWayOdds(match);
  const headline = headlineMarkets(match, displayMarkets);
  return {
    ...match,
    display_markets: displayMarkets,
    display_summary: {
      format: 'display_precompute_v1',
      oddsStrip: {
        home: Number.isFinite(Number(odds.home)) ? Number(odds.home) : null,
        draw: Number.isFinite(Number(odds.draw)) ? Number(odds.draw) : null,
        away: Number.isFinite(Number(odds.away)) ? Number(odds.away) : null,
      },
      winnerBreakdown: winnerProbabilityBreakdown(match),
      confidence: confidenceForMatch(match, displayMarkets),
      compactMarket,
      headlineMarkets: headline,
      headlineSummary: summarizeHeadline(headline),
      detailRows: Object.entries(displayMarkets)
        .filter(([, entry]) => entry?.market)
        .map(([key, entry]) => ({ key, label: entry.label, ...entry })),
    },
  };
}

export function precomputeDisplayData(data) {
  const allMatches = (data.leagues || []).flatMap((league) =>
    (league.matches || []).map((match) => ({ ...match, league: league.name, leagueId: league.id })),
  );
  return {
    ...data,
    leagues: (data.leagues || []).map((league) => ({
      ...league,
      matches: (league.matches || []).map((match) => precomputeMatch({ ...match, league: league.name, leagueId: league.id }, allMatches)),
    })),
  };
}
