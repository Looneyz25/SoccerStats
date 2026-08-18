import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuickBetsPayload } from './upload_match_data_to_firestore.mjs';

const EVENT_URL = 'https://www.sportsbet.com.au/betting/soccer/a/b/home-away-101';

test('quick bets Firestore payload mirrors AIOS by merging canonical match data with sidecar rows', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const leagues = [{
    name: 'League',
    matches: [{
      date: '2026-08-19',
      time: '18:00',
      status: 'upcoming',
      home: { name: 'Home' },
      away: { name: 'Away' },
      sportsbet_odds: { event_id: 101, home: 1.22, event_url: EVENT_URL },
      sportsbet_markets: {
        'Full time': { 1: 1.22 },
        'Match goals 1.5': { Over: 1.18 },
      },
    }, {
      date: '2026-08-19',
      time: '19:00',
      status: 'upcoming',
      home: { name: 'Canonical Only' },
      away: { name: 'Away' },
      sportsbet_markets: {
        'Both teams to score': { Yes: 1.4 },
      },
    }],
  }];
  const sidecar = {
    status: 'partial',
    captured_at: '2026-08-18T14:24:03+09:30',
    events: [{
      event_id: '101',
      league: 'Sidecar League',
      date: '2026-08-19',
      time: '18:00',
      home: 'Home',
      away: 'Away',
      event_url: EVENT_URL,
      root_stale: false,
      deep_stale: true,
      markets: {
        winner: [{ key: 'home', label: 'Home', odds: 1.2 }],
        btts: [{ key: 'yes', label: 'Yes', odds: 1.3 }],
        goalsOver: [{ key: 'over:1.5', side: 'over', line: 1.5, label: 'Over 1.5', odds: 1.17 }],
        goalsUnder: [],
      },
    }, {
      event_id: '102',
      league: 'Sidecar Only',
      date: '2026-08-19',
      time: '20:00',
      home: 'Sidecar Only',
      away: 'Away',
      event_url: 'https://www.sportsbet.com.au/betting/soccer/a/b/sidecar-away-102',
      root_stale: false,
      deep_stale: false,
      markets: {
        winner: [],
        btts: [],
        goalsOver: [{ key: 'over:1.5', side: 'over', line: 1.5, label: 'Over 1.5', odds: 1.16 }],
        goalsUnder: [],
      },
    }],
  };

  const payload = buildQuickBetsPayload({ leagues, sidecar, now });
  const rows = payload.dates.get('2026-08-19');

  assert.equal(payload.meta.totalMatches, 3);
  assert.equal(payload.meta.counts.upcoming, 3);
  assert.equal(payload.meta.refreshStatus, 'partial');
  assert.deepEqual(rows.map((row) => row.home), ['Home', 'Canonical Only', 'Sidecar Only']);

  const merged = rows.find((row) => row.home === 'Home');
  assert.equal(merged.league, 'League');
  assert.equal(merged.eventId, '101');
  assert.deepEqual(merged.markets.winner.map((selection) => selection.key), ['home']);
  assert.deepEqual(merged.markets.btts, []);
  assert.deepEqual(merged.markets.goalsOver.map((selection) => [selection.line, selection.odds]), [[1.5, 1.18]]);

  const canonicalOnly = rows.find((row) => row.home === 'Canonical Only');
  assert.deepEqual(canonicalOnly.markets.btts.map((selection) => selection.key), ['yes']);

  const sidecarOnly = rows.find((row) => row.home === 'Sidecar Only');
  assert.deepEqual(sidecarOnly.markets.goalsOver.map((selection) => [selection.line, selection.odds]), [[1.5, 1.16]]);
});
