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
    const status = String(match?.status || '').toLowerCase();
    if (match?.lifecycle !== 'result' || !league || status === 'result_pending' || VOID_STATUSES.has(status)) continue;
    for (const filter of filters) {
      for (const selection of marketSelections(match, filter)) {
        if (!['hit', 'miss'].includes(selection.result)
            || typeof selection.odds !== 'number' || !Number.isFinite(selection.odds)
            || selection.odds <= 1 || selection.odds >= 1.5) continue;
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

export function quickBetLeagueSuccessLabel(league, stats, filterKey = 'all') {
  const labels = [...(stats?.values() || [])]
    .filter((item) => filterKey === 'all' || item.filter === filterKey)
    .map(quickBetSuccessLabel).filter(Boolean);
  return labels.length
    ? `${league} historical Quick Bets: ${labels.join('; ')}. Recorded settled results, not a prediction.` : '';
}

export function quickBetMatchState(match) {
  if (match.lifecycle === 'live') return `${match.score || 'LIVE'}${match.minute ? ` · ${match.minute}` : ''}`;
  if (match.lifecycle !== 'result') return match.time || 'TBD';
  if (VOID_STATUSES.has(String(match.status || '').toLowerCase())) return 'Void';
  return match.score ? `${match.score} · FT` : 'Result pending';
}
