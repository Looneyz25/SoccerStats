// Pure bet-slip leg construction + combined math. No React import so it is
// unit-testable with `node --test` and importable from the client bundle.

const LABEL_TO_KEY = {
  winner: 'winner',
  'draw no bet': 'draw_no_bet',
  btts: 'btts',
  goals: 'goals',
  cards: 'cards',
  corners: 'corners',
};

export function accaLegKey(matchId, label) {
  return `${matchId}::${label}`;
}

export function marketKeyForLabel(label) {
  return LABEL_TO_KEY[String(label || '').trim().toLowerCase()] || null;
}

export function selectionForRow(marketKey, market, match) {
  const pick = String(market?.pick || '').trim();
  const lower = pick.toLowerCase();
  if (marketKey === 'btts') return lower.startsWith('y') ? 'yes' : 'no';
  if (marketKey === 'goals' || marketKey === 'cards' || marketKey === 'corners') {
    return lower.startsWith('over') ? 'over' : 'under';
  }
  if (marketKey === 'winner' || marketKey === 'draw_no_bet') {
    if (lower === 'draw') return 'draw';
    const home = String(match?.home?.name || '').toLowerCase();
    const away = String(match?.away?.name || '').toLowerCase();
    const cleaned = lower.replace(/\s+dnb$/, '').trim();
    // Exact match first so one club name being a substring of the other
    // (e.g. "Congo" vs "Congo DR", "Madrid" in both) can't mis-resolve.
    if (home && cleaned === home) return 'home';
    if (away && cleaned === away) return 'away';
    if (home && cleaned.includes(home)) return 'home';
    if (away && cleaned.includes(away)) return 'away';
    return null;
  }
  return null;
}

export function legFromMarketRow(row, match) {
  const marketKey = marketKeyForLabel(row?.label);
  if (!marketKey) return null;
  const selection = selectionForRow(marketKey, row, match);
  if (!selection) return null;
  const realBook = Number(row?.book);
  const modelOdds = Number(row?.modelOdds);
  const hasBook = Number.isFinite(realBook) && realBook > 1;
  const book = hasBook ? realBook : Number.isFinite(modelOdds) && modelOdds > 1 ? modelOdds : null;
  if (book === null) return null;
  const lineNum = Number(row?.line);
  const prob = Number(row?.prob);
  return {
    matchId: String(match?.id || ''),
    date: match?.date ? String(match.date) : null,
    marketKey,
    selection,
    line: Number.isFinite(lineNum) ? lineNum : null,
    label: String(row.label),
    pick: String(row.pick || ''),
    matchLabel: `${match?.home?.name || 'Home'} v ${match?.away?.name || 'Away'}`,
    league: match?.league ? String(match.league) : null,
    book,
    priceEstimated: !hasBook,
    prob: Number.isFinite(prob) ? prob : null,
  };
}

export function combinedFromLegs(legs) {
  if (!legs.length) return null;
  // A leg without a model probability (e.g. a model-only estimated price) is
  // unknown, not impossible — use the neutral multiplier (1) so it doesn't
  // collapse the combined probability to 0. Mirrors the route's combinedProb.
  const odds = legs.reduce((p, l) => p * (Number(l.book) || 1), 1);
  const prob = legs.reduce((p, l) => {
    const legProb = Number(l.prob);
    return p * (Number.isFinite(legProb) && legProb > 0 ? legProb : 1);
  }, 1);
  return { odds, prob, ev: prob * odds - 1 };
}
