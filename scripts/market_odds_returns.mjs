export function pricedMarketOdds(market) {
  if (market?.odds_estimated) return null;
  const odds = Number(market?.odds);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

export function marketReturnTotals(markets) {
  return (markets || []).reduce((totals, market) => {
    const odds = pricedMarketOdds(market);
    if (!odds) return totals;
    if (market.result === 'hit') totals.hit += odds;
    if (market.result === 'miss') totals.loss += 1;
    totals.priced += 1;
    return totals;
  }, { hit: 0, loss: 0, priced: 0 });
}
