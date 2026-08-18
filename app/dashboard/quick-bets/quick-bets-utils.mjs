const VOID_STATUSES = new Set(['postponed_or_cancelled', 'cancelled', 'postponed', 'void']);

export function quickBetMatchState(match) {
  if (match.lifecycle === 'live') return `${match.score || 'LIVE'}${match.minute ? ` · ${match.minute}` : ''}`;
  if (match.lifecycle !== 'result') return match.time || 'TBD';
  if (VOID_STATUSES.has(String(match.status || '').toLowerCase())) return 'Void';
  return match.score ? `${match.score} · FT` : 'Result pending';
}
