export function pricedMarketOdds(market) {
  if (market?.odds_estimated) return null;
  const odds = Number(market?.odds);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

export function marketReturnTotals(markets) {
  // Flat 1-unit stake P&L. A winner banks (odds - 1) profit (the stake is
  // returned, not winnings); a loser forfeits its 1-unit stake. Keeping both
  // sides on a profit basis makes `hit - loss` the true net return.
  return (markets || []).reduce((totals, market) => {
    const odds = pricedMarketOdds(market);
    if (!odds) return totals;
    if (market.result === 'hit') totals.hit += odds - 1;
    if (market.result === 'miss') totals.loss += 1;
    totals.priced += 1;
    return totals;
  }, { hit: 0, loss: 0, priced: 0 });
}
