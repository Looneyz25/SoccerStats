import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuickBetsPayload } from './upload_match_data_to_firestore.mjs';
import {
  marketSelections, normalizeQuickBetStarSnapshot, quickBetCurrentSelectionSuccessLabel,
  quickBetLeagueKey, quickBetLeagueSuccessStats, quickBetSuccessLabel, quickBetSuccessMarket,
} from '../app/dashboard/quick-bets/quick-bets-utils.mjs';

const FILTERS = [
  { key: 'winner', marketKeys: ['winner'] }, { key: 'btts', marketKeys: ['btts'] },
  ...[0.5, 1.5, 2.5, 3.5].map((line) => ({ key: `goals${line * 10}`, marketKeys: ['goalsOver', 'goalsUnder'], line })),
];
const UNKNOWN = { version: 1, state: 'unknown' };

export function quickBetStarFixtureKey(row) {
  const clean = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return [row.date, '', clean(row.home), clean(row.away)].join('|');
}

export function quickBetStarLedgerKey(row) {
  return row.eventId ? `event:${row.eventId}` : `fixture:${quickBetStarFixtureKey(row)}`;
}

export function captureQuickBetStarDecision(match, selection, leagueStats, capturedAt) {
  const market = quickBetSuccessMarket(selection);
  const stats = leagueStats?.get(market);
  const label = quickBetCurrentSelectionSuccessLabel(match, selection, leagueStats);
  const leagueLabel = quickBetSuccessLabel(stats);
  return {
    version: 1, state: 'captured', starred: Boolean(label), capturedAt,
    label, leagueLabel: leagueLabel ? `${match.league} historical Quick Bets — ${leagueLabel}` : '',
    evidence: {
      league: stats ? { name: match.league, market, hits: stats.hits, settled: stats.settled } : null,
      home: match.home, away: match.away,
      teamForm: { home: [...(match.teamForm?.home || [])], away: [...(match.teamForm?.away || [])] },
    },
  };
}

export function captureQuickBetStars({ sidecar, previous = null, leagues = [], now = new Date() }) {
  const clock = new Date(now);
  if (!Number.isFinite(clock.getTime()) || !sidecar || !Array.isArray(sidecar.events) || !Array.isArray(sidecar.history)) {
    throw new Error('Invalid Quick Bets star capture input');
  }
  const payload = structuredClone(sidecar);
  const ledger = { ...(previous?.star_snapshots || {}), ...(payload.star_snapshots || {}) };
  payload.star_snapshots = ledger;
  const projected = buildQuickBetsPayload({ leagues, sidecar: payload, now: clock });
  const matches = [...projected.dates.values()].flat();
  const success = quickBetLeagueSuccessStats(matches, FILTERS);
  const events = new Map(payload.events.map((row) => [String(row.event_id), row]));
  const kept = new Set();
  for (const match of matches) {
    const key = quickBetStarLedgerKey(match);
    const fixture = quickBetStarFixtureKey(match);
    const eventEntry = match.eventId ? ledger[key] : null;
    const reversedFixture = quickBetStarFixtureKey({ ...match, home: match.away, away: match.home });
    const reversed = eventEntry?.fixture !== fixture && eventEntry?.fixture === reversedFixture;
    const entry = ledger[key]?.fixture === fixture || reversed ? ledger[key] : ledger['fixture:' + fixture];
    const recorded = entry?.fixture === fixture || reversed ? entry.selections || {} : {};
    const prior = reversed ? Object.fromEntries(Object.entries(recorded).map(([selectionKey, decision]) => [
      selectionKey === 'winner|home' ? 'winner|away' : selectionKey === 'winner|away' ? 'winner|home' : selectionKey, decision,
    ])) : recorded;
    const selections = { ...prior };
    const event = events.get(match.eventId);
    for (const selection of FILTERS.flatMap((filter) => marketSelections(match, filter))) {
      const selectionKey = `${selection.marketKey}|${selection.key}`;
      const snapshot = normalizeQuickBetStarSnapshot(prior[selectionKey]);
      const deep = selection.marketKey !== 'winner' || Boolean(event?.last_inspection_coverage);
      const currentQuote = !event || (event.root_stale === false && (!deep || event.deep_stale === false));
      if (snapshot?.state === 'captured' && snapshot.starred) {
        selections[selectionKey] = snapshot;
      } else if (match.lifecycle === 'upcoming' && currentQuote) {
        selections[selectionKey] = captureQuickBetStarDecision(match, selection,
          success.get(quickBetLeagueKey(match.league)), clock.toISOString());
      } else {
        selections[selectionKey] = snapshot || UNKNOWN;
      }
    }
    ledger[key] = { fixture, selections };
    kept.add(key);
  }
  // Missing quotes retain their last decision until the existing 30-day sidecar retention expires.
  const cutoff = new Date(clock.getTime() - 31 * 86400000).toISOString().slice(0, 10);
  for (const [key, entry] of Object.entries(ledger)) {
    const date = String(entry?.fixture || '').slice(0, 10);
    if (!kept.has(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < cutoff)) delete ledger[key];
  }
  return payload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(JSON.stringify(captureQuickBetStars(JSON.parse(input))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
