const VOID_STATUSES = new Set(['postponed_or_cancelled', 'cancelled', 'postponed', 'void']);

const QUICK_BET_LEAGUE_ALIASES = new Map([
  ['premier league', 'english premier league'], ['championship', 'english championship'],
  ['league one', 'english league 1'], ['league two', 'english league 2'],
  ['laliga', 'spanish la liga'], ['serie a', 'italian serie a'],
  ['bundesliga', 'german bundesliga'], ['ligue 1', 'french ligue 1'],
  ['eredivisie', 'dutch eredivisie'], ['primeira liga', 'portuguese primeira liga'],
  ['allsvenskan', 'swedish allsvenskan'], ['eliteserien', 'norwegian eliteserien'],
  ['mls', 'us major league soccer'], ['j1 league', 'japanese j league'],
  ['conmebol libertadores', 'conmebol copa libertadores'],
]);

function isQuickBetSettledResult(match) {
  const status = String(match?.status || '').toLowerCase();
  return match?.lifecycle === 'result' && status !== 'result_pending' && !VOID_STATUSES.has(status);
}

function isQuickBetLeagueResult(match) {
  return isQuickBetSettledResult(match) && !!quickBetLeagueKey(match?.league);
}

function isSettledQuickBetSelection(selection) {
  return ['hit', 'miss'].includes(selection.result)
    && typeof selection.odds === 'number' && Number.isFinite(selection.odds)
    && selection.odds > 1 && selection.odds < 1.5;
}

export function marketSelections(match, filter) {
  return filter.marketKeys.flatMap((marketKey) => {
    const selections = Array.isArray(match?.markets?.[marketKey]) ? match.markets[marketKey] : [];
    if (filter.line == null) return selections.map((selection) => ({ ...selection, marketKey }));
    return selections
      .filter((selection) => Number(selection.line) === filter.line)
      .map((selection) => ({ ...selection, marketKey }));
  });
}

export function quickBetLeagueKey(league) {
  const key = typeof league === 'string' ? league.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return QUICK_BET_LEAGUE_ALIASES.get(key) || key;
}

export function quickBetSuccessMarket(selection) {
  if (selection.marketKey === 'goalsOver' || selection.marketKey === 'goalsUnder') {
    if (typeof selection.line !== 'number' || ![0.5, 1.5, 2.5, 3.5].includes(selection.line)) return '';
    return `${selection.marketKey === 'goalsOver' ? 'Over' : 'Under'} ${selection.line}`;
  }
  const label = typeof selection.label === 'string' ? selection.label.trim().toLowerCase() : '';
  if (!label) return '';
  if (selection.marketKey === 'winner') return label === 'draw' ? 'Draw' : 'Winner';
  if (selection.marketKey === 'btts') return label === 'yes' ? 'BTTS Yes' : label === 'no' ? 'BTTS No' : '';
  return '';
}

export function quickBetLeagueSuccessStats(matches, filters) {
  const leagues = new Map();
  for (const match of matches) {
    const league = quickBetLeagueKey(match?.league);
    if (!isQuickBetLeagueResult(match)) continue;
    for (const filter of filters) {
      for (const selection of marketSelections(match, filter)) {
        if (!isSettledQuickBetSelection(selection)) continue;
        const market = quickBetSuccessMarket(selection);
        if (!market) continue;
        if (!leagues.has(league)) leagues.set(league, new Map());
        const markets = leagues.get(league);
        const stats = markets.get(market) || { market, filter: filter.key, hits: 0, settled: 0 };
        stats.settled += 1;
        if (selection.result === 'hit') stats.hits += 1;
        markets.set(market, stats);
      }
    }
  }
  return leagues;
}

export function quickBetSuccessLabel(stats) {
  if (!stats || !stats.settled || stats.hits * 5 < stats.settled * 4) return '';
  return `${stats.market}: ${Math.round(stats.hits / stats.settled * 100)}% hit rate (${stats.hits}/${stats.settled} settled)`;
}

function quickBetTeamFormScores(match, side) {
  const scores = Array.isArray(match?.teamForm?.[side]) ? match.teamForm[side] : [];
  if (scores.length !== 5) return [];
  const parsed = scores.map((score) => /^(\d+)-(\d+)$/.exec(String(score || '')))
    .map((parts) => parts ? { for: Number(parts[1]), against: Number(parts[2]) } : null);
  return parsed.every(Boolean) ? parsed : [];
}

function quickBetTeamFormHit(score, selection) {
  const label = String(selection.label || '').trim().toLowerCase();
  if (selection.marketKey === 'winner') return label === 'draw' ? score.for === score.against : score.for > score.against;
  if (selection.marketKey === 'btts') {
    const bothScored = score.for > 0 && score.against > 0;
    return label === 'yes' ? bothScored : label === 'no' ? !bothScored : false;
  }
  const total = score.for + score.against;
  if (selection.marketKey === 'goalsOver') return total > selection.line;
  if (selection.marketKey === 'goalsUnder') return total < selection.line;
  return false;
}

export function quickBetTeamSuccessLabels(match, selection) {
  const market = quickBetSuccessMarket(selection);
  if (!market) return [];
  let sides = ['home', 'away'];
  if (selection.marketKey === 'winner') {
    const key = String(selection.key || '').toLowerCase();
    const label = String(selection.label || '').trim().toLowerCase();
    if (key === 'home' || label === String(match?.home || '').trim().toLowerCase()) sides = ['home'];
    else if (key === 'away' || label === String(match?.away || '').trim().toLowerCase()) sides = ['away'];
    else if (key !== 'draw' && label !== 'draw') return [];
  }
  return sides.flatMap((side) => {
    const scores = quickBetTeamFormScores(match, side);
    if (scores.length !== 5) return [];
    const hits = scores.filter((score) => quickBetTeamFormHit(score, selection)).length;
    if (hits < 4) return [];
    const team = String(match?.[side] || '').trim();
    return team ? [`${team} last 5 — ${market}: ${hits}/5 hits`] : [];
  });
}

export function quickBetCurrentSelectionSuccessLabel(match, selection, leagueStats) {
  const labels = [];
  const league = quickBetSuccessLabel(leagueStats?.get(quickBetSuccessMarket(selection)));
  if (league) labels.push(`${match.league} historical Quick Bets — ${league}`);
  labels.push(...quickBetTeamSuccessLabels(match, selection));
  return labels.length ? `${labels.join('; ')}. Not a prediction.` : '';
}

export function normalizeQuickBetStarSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.version !== 1 || value.state !== 'captured' || typeof value.starred !== 'boolean'
      || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))
      || typeof value.label !== 'string' || (value.starred && !value.label.trim())
      || typeof value.leagueLabel !== 'string') return { version: 1, state: 'unknown' };
  return { version: 1, state: 'captured', starred: value.starred, capturedAt: value.capturedAt,
    label: value.starred ? value.label : '', leagueLabel: value.starred ? value.leagueLabel : '',
    ...(value.evidence && typeof value.evidence === 'object' ? { evidence: value.evidence } : {}),
    ...(value.recoveredFrom && typeof value.recoveredFrom === 'object' ? { recoveredFrom: value.recoveredFrom } : {}) };
}

export function quickBetStarDecisionLabel(selection) {
  const snapshot = normalizeQuickBetStarSnapshot(selection?.starSnapshot);
  if (snapshot?.state !== 'captured') return 'Star at prediction not recorded';
  return snapshot.starred ? `${snapshot.label} Star captured ${snapshot.capturedAt}.`
    : `Not starred at prediction. Captured ${snapshot.capturedAt}.`;
}

export function quickBetSelectionSuccessLabel(match, selection, leagueStats) {
  const snapshot = normalizeQuickBetStarSnapshot(selection?.starSnapshot);
  return snapshot?.state === 'captured' && snapshot.starred ? quickBetStarDecisionLabel(selection) : '';
}

export function quickBetRecordedLeagueSuccessLabel(match, filters) {
  const matches = Array.isArray(match) ? match : [match];
  const labels = matches.flatMap((row) => filters.flatMap((filter) => marketSelections(row, filter))).flatMap((selection) => {
    const snapshot = normalizeQuickBetStarSnapshot(selection.starSnapshot);
    return snapshot?.state === 'captured' && snapshot.starred && snapshot.leagueLabel
      ? [`${snapshot.leagueLabel} Star captured ${snapshot.capturedAt}.`] : [];
  });
  return [...new Set(labels)].join('; ');
}

export function quickBetStarredSelections(match, filters, successByLeague) {
  const leagueStats = successByLeague.get(quickBetLeagueKey(match?.league));
  return filters.flatMap((filter) => marketSelections(match, filter)
    .filter((selection) => quickBetSelectionSuccessLabel(match, selection, leagueStats)));
}

export function quickBetLeagueSuccessLabel(league, stats, filterKey = 'all') {
  const labels = [...(stats?.values() || [])]
    .filter((item) => filterKey === 'all' || item.filter === filterKey)
    .map(quickBetSuccessLabel).filter(Boolean);
  return labels.length
    ? `${league} historical Quick Bets: ${labels.join('; ')}. Recorded settled results, not a prediction.` : '';
}

export function quickBetStarredMarketStats(matches, filters, successByLeague) {
  const stats = new Map(filters.map((filter) => [filter.key, { hits: 0, settled: 0 }]));
  for (const match of matches) {
    if (!isQuickBetSettledResult(match)) continue;
    const leagueStats = successByLeague.get(quickBetLeagueKey(match.league));
    for (const filter of filters) {
      for (const selection of marketSelections(match, filter)) {
        if (!isSettledQuickBetSelection(selection)) continue;
        if (!quickBetSelectionSuccessLabel(match, selection, leagueStats)) continue;
        const item = stats.get(filter.key);
        item.settled += 1;
        if (selection.result === 'hit') item.hits += 1;
      }
    }
  }
  return stats;
}

export function quickBetDailyStats(matches, filters, successByLeague) {
  const byDate = new Map();
  for (const match of matches) {
    if (!byDate.has(match.date)) byDate.set(match.date, []);
    byDate.get(match.date).push(match);
  }
  return new Map([...byDate].map(([date, dayMatches]) => {
    const markets = quickBetStarredMarketStats(dayMatches, filters, successByLeague);
    const total = { hits: 0, settled: 0 };
    for (const match of dayMatches) {
      if (!isQuickBetSettledResult(match)) continue;
      const selections = filters.flatMap((filter) => marketSelections(match, filter));
      for (const selection of selections) {
        if (!isSettledQuickBetSelection(selection)) continue;
        total.settled += 1;
        if (selection.result === 'hit') total.hits += 1;
      }
    }
    return [date, { markets, total }];
  }));
}

export function quickBetStarStatText(stats) {
  return stats?.settled ? `${stats.hits} / ${stats.settled}` : '';
}

export function quickBetMatchState(match) {
  if (match.lifecycle === 'live') return `${match.score || 'LIVE'}${match.minute ? ` · ${match.minute}` : ''}`;
  if (match.lifecycle !== 'result') return match.time || 'TBD';
  const status = String(match.status || '').toLowerCase();
  if (VOID_STATUSES.has(status)) return 'Void';
  if (match.score) return `${match.score} · FT`;
  return ['result', 'finished'].includes(status) ? 'Settled' : 'Result pending';
}
