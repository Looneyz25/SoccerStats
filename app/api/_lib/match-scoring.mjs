// Pure prediction/market scoring helpers. No firebase-admin import so this
// module is unit-testable with `node --test` and safe to reason about in
// isolation. Shared by the crowd-vote route and the bet-slip route.

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marketLine(match, key, fallback) {
  const displayKey = key === 'goals' ? 'goals' : key;
  const market =
    match.display_markets?.[displayKey]?.market ||
    (key === 'goals'
      ? match.predictions?.ou_goals
      : key === 'cards'
        ? match.predictions?.ou_cards
        : key === 'corners'
          ? match.predictions?.ou_corners
          : null);
  return market?.line ?? fallback;
}

// Boolean|null scorer for the five crowd-vote markets. Contract unchanged from
// the original match-votes implementation (callers there rely on boolean|null).
export function marketActualResult(match, marketKey, value) {
  if (!match) return null;
  const homeGoals = parseNumber(match?.home?.goals);
  const awayGoals = parseNumber(match?.away?.goals);
  if (marketKey === 'winner') {
    if (homeGoals === null || awayGoals === null) return null;
    const actual = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
    return value === actual;
  }
  if (marketKey === 'btts') {
    if (homeGoals === null || awayGoals === null) return null;
    const actual = homeGoals > 0 && awayGoals > 0 ? 'yes' : 'no';
    return value === actual;
  }
  if (marketKey === 'goals') {
    if (homeGoals === null || awayGoals === null) return null;
    const line = Number(marketLine(match, 'goals', 2.5));
    if (!Number.isFinite(line)) return null;
    const total = homeGoals + awayGoals;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  if (marketKey === 'cards') {
    const total = parseNumber(match?.actuals?.cards_total);
    const line = Number(marketLine(match, 'cards', 4.5));
    if (total === null || !Number.isFinite(line)) return null;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  if (marketKey === 'corners') {
    const total = parseNumber(match?.actuals?.corners_total);
    const line = Number(marketLine(match, 'corners', 10.5));
    if (total === null || !Number.isFinite(line)) return null;
    return value === 'over' ? total > line : value === 'under' ? total < line : null;
  }
  return null;
}

// Bet-slip leg scorer: returns 'hit' | 'miss' | 'void' | null (null = pending).
// Scores over/under against the LINE CAPTURED ON THE LEG (leg.line), not the
// current match line, so a later line move can't rewrite a settled bet. Draw No
// Bet voids on a draw; an exact integer total pushes (voids) over/under.
export function scoreLeg(match, leg) {
  if (!match || !leg) return null;
  const h = parseNumber(match?.home?.goals);
  const a = parseNumber(match?.away?.goals);
  const { marketKey, selection, line } = leg;

  if (marketKey === 'winner') {
    if (h === null || a === null) return null;
    const actual = h > a ? 'home' : a > h ? 'away' : 'draw';
    return selection === actual ? 'hit' : 'miss';
  }
  if (marketKey === 'draw_no_bet') {
    if (h === null || a === null) return null;
    if (h === a) return 'void';
    return selection === (h > a ? 'home' : 'away') ? 'hit' : 'miss';
  }
  if (marketKey === 'btts') {
    if (h === null || a === null) return null;
    const actual = h > 0 && a > 0 ? 'yes' : 'no';
    return selection === actual ? 'hit' : 'miss';
  }

  const ln = Number(line);
  if (!Number.isFinite(ln)) return null;
  let total = null;
  if (marketKey === 'goals') {
    if (h === null || a === null) return null;
    total = h + a;
  } else if (marketKey === 'cards') {
    total = parseNumber(match?.actuals?.cards_total);
  } else if (marketKey === 'corners') {
    total = parseNumber(match?.actuals?.corners_total);
  }
  if (total === null) return null;
  if (total === ln) return 'void';
  const over = total > ln;
  return (selection === 'over' ? over : !over) ? 'hit' : 'miss';
}

// Overall slip status from per-leg results.
// A single miss settles the slip as lost even if other legs are still pending.
export function computeSlipStatus(legs) {
  const results = (legs || []).map((l) => l?.result ?? null);
  if (results.some((r) => r === 'miss')) return 'lost';
  if (results.some((r) => r == null)) return 'pending';
  const nonVoid = results.filter((r) => r !== 'void');
  if (nonVoid.length === 0) return 'void';
  return 'won';
}

// Adelaide-local kickoff → UTC Date (DST-aware). Used by the crowd-vote lock.
export function adelaideLocalToUtc(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) || !/^\d{2}:\d{2}$/.test(String(timeStr || ''))) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcGuess));
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const renderedAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  const offset = renderedAsUtc - utcGuess;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset);
}
