import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRoutineProgress,
  progressMaintenanceDecision,
  progressPendingPastExpectedFinish,
  renderRoutineProgressMarkdown,
} from './routine-progress.mjs';

const NOW = new Date('2026-06-11T06:30:00.000Z');

function match(overrides) {
  return {
    id: overrides.id,
    date: overrides.date,
    time: overrides.time || '10:00',
    status: overrides.status || 'upcoming',
    home: { name: overrides.home || 'Home' },
    away: { name: overrides.away || 'Away' },
  };
}

function progressFor(matches, previousProgress = null) {
  return buildRoutineProgress({
    now: NOW,
    previousProgress,
    log: { runId: 'run-1', mode: 'results-only', status: 'ok' },
    schedule: { result_check_buffer_minutes: 150, matches: [] },
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches }],
    },
  });
}

test('treats a forecast through today plus six days as healthy coverage', () => {
  const progress = progressFor([
    match({ id: 'm1', date: '2026-06-11', time: '23:00' }),
    match({ id: 'm2', date: '2026-06-17' }),
  ]);

  assert.equal(progress.requiredLatestDate, '2026-06-17');
  assert.equal(progress.latestCollectedDate, '2026-06-17');
  assert.equal(progress.hasSevenDayForecast, true);
  assert.equal(progress.actions.includes('No manual action required.'), true);
});

test('short forecast coverage recommends the light top-up path, not a full refresh', () => {
  const progress = progressFor([
    match({ id: 'm1', date: '2026-06-11' }),
    match({ id: 'm2', date: '2026-06-16' }),
  ]);

  assert.equal(progress.hasSevenDayForecast, false);
  assert.match(progress.actions.join('\n'), /get:data:topup/);
  assert.doesNotMatch(progress.actions.join('\n'), /Run npm\.cmd run get:data because/);
});

test('forecast coverage is gap-aware when the fixture slate lists intermediate days', () => {
  const progress = buildRoutineProgress({
    now: NOW,
    previousProgress: null,
    log: { runId: 'run-1', mode: 'results-only', status: 'ok' },
    schedule: { result_check_buffer_minutes: 150, matches: [] },
    // Store has only today and the far edge (06-17); the days between are missing.
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches: [
        match({ id: 'm1', date: '2026-06-11', time: '23:00' }),
        match({ id: 'm2', date: '2026-06-17' }),
      ] }],
    },
    // The ESPN slate knows fixtures also exist on 06-13 and 06-15.
    fixtureSlateDates: ['2026-06-11', '2026-06-13', '2026-06-15', '2026-06-17'],
  });

  assert.equal(progress.hasSevenDayForecast, false);
  assert.deepEqual(progress.missingForecastDates, ['2026-06-13', '2026-06-15']);

  const decision = progressMaintenanceDecision(progress);
  assert.equal(decision.action, 'top-up-horizon');
  assert.deepEqual(decision.targetDates, ['2026-06-13', '2026-06-15']);
});

test('a fixture slate covering the full horizon stays healthy', () => {
  const progress = buildRoutineProgress({
    now: NOW,
    previousProgress: null,
    log: { runId: 'run-1', mode: 'results-only', status: 'ok' },
    schedule: { result_check_buffer_minutes: 150, matches: [] },
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches: [
        match({ id: 'm1', date: '2026-06-13' }),
        match({ id: 'm2', date: '2026-06-17' }),
      ] }],
    },
    fixtureSlateDates: ['2026-06-13', '2026-06-17'],
  });

  assert.equal(progress.hasSevenDayForecast, true);
  assert.deepEqual(progress.missingForecastDates, []);
});

test('maintenance decision uses progress overdue pending before broader work', () => {
  const progress = progressFor([
    match({ id: 'm1', date: '2026-06-11', time: '01:00', home: 'Late' }),
    match({ id: 'm2', date: '2026-06-17', time: '23:00', home: 'Future' }),
  ]);

  const decision = progressMaintenanceDecision(progress);

  assert.equal(decision.action, 'results');
  assert.match(decision.reason, /pending match.*past expected finish/);
  assert.equal(decision.due.length, 1);
  assert.match(decision.due[0], /Late vs Away/);
});

test('intervention helper lists pending matches past expected finish', () => {
  const progress = progressFor([
    match({ id: 'late-1', date: '2026-06-11', time: '01:00', home: 'Late' }),
    match({ id: 'future-1', date: '2026-06-17', time: '23:00', home: 'Future' }),
  ]);

  const overdue = progressPendingPastExpectedFinish(progress);

  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].home, 'Late');
});

test('intervention helper ignores future pending matches', () => {
  const progress = progressFor([
    match({ id: 'future-1', date: '2026-06-12', time: '23:00', home: 'Tomorrow' }),
    match({ id: 'future-2', date: '2026-06-17', time: '23:00', home: 'Last' }),
  ]);

  assert.deepEqual(progressPendingPastExpectedFinish(progress), []);
});

test('maintenance decision uses top-up when progress horizon is short', () => {
  const progress = progressFor([
    match({ id: 'm1', date: '2026-06-11', time: '23:00' }),
    match({ id: 'm2', date: '2026-06-16', time: '23:00' }),
  ]);

  const decision = progressMaintenanceDecision(progress);

  assert.equal(decision.action, 'top-up-horizon');
  assert.match(decision.reason, /missing forecast horizon/);
});

test('maintenance decision skips when progress has no overdue pending and +6 coverage exists', () => {
  const progress = progressFor([
    match({ id: 'm1', date: '2026-06-11', time: '23:00' }),
    match({ id: 'm2', date: '2026-06-17', time: '23:00' }),
  ]);

  assert.equal(progressMaintenanceDecision(progress), null);
});

test('progress marks the Adelaide day completed when no due or remaining work exists', () => {
  const progress = buildRoutineProgress({
    now: NOW,
    previousProgress: null,
    log: { runId: 'run-complete', mode: 'results-only', status: 'ok' },
    schedule: { result_check_buffer_minutes: 150, matches: [], due_count: 0, remaining_count: 0 },
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches: [match({ id: 'm1', date: '2026-06-17', time: '23:00' })] }],
    },
  });

  assert.equal(progress.agent, 'codex 5.3');
  assert.equal(progress.progressDate, '2026-06-11');
  assert.equal(progress.progressState, 'completed');
  assert.equal(progress.completedForDate, '2026-06-11');

  const markdown = renderRoutineProgressMarkdown(progress);
  assert.match(markdown, /Agent: codex 5\.3/);
  assert.match(markdown, /In progress 2026-06-11: completed/);
});

test('progress stays active when the schedule still has same-day remaining work', () => {
  const progress = buildRoutineProgress({
    now: NOW,
    previousProgress: null,
    log: { runId: 'run-active', mode: 'results-only', status: 'running' },
    schedule: { result_check_buffer_minutes: 150, matches: [], due_count: 0, remaining_count: 2 },
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches: [match({ id: 'm1', date: '2026-06-17', time: '23:00' })] }],
    },
  });

  assert.equal(progress.progressState, 'active');
  assert.equal(progress.completedForDate, null);
});

test('maintenance decision ignores future pending matches inside healthy forecast window', () => {
  const progress = progressFor([
    match({ id: 'future-1', date: '2026-06-12', time: '23:00', home: 'Tomorrow' }),
    match({ id: 'future-2', date: '2026-06-17', time: '23:00', home: 'Last' }),
  ]);

  assert.equal(progress.pendingCount, 2);
  assert.equal(progress.overduePendingCount, 0);
  assert.equal(progress.hasSevenDayForecast, true);
  assert.equal(progressMaintenanceDecision(progress), null);
});

test('ledger keeps only pending or resulted statuses and carries prior resulted matches', () => {
  const progress = progressFor(
    [
      match({ id: 'pending-1', date: '2026-06-17', status: 'upcoming', home: 'Pending' }),
      match({ id: 'closed-1', date: '2026-06-11', status: 'cancelled', home: 'Closed' }),
    ],
    {
      matches: [
        {
          key: 'old-1',
          eventId: 'old-1',
          league: 'Old League',
          date: '2026-06-10',
          time: '10:00',
          home: 'Old',
          away: 'Match',
          status: 'resulted',
          expectedFinish: '2026-06-10 12:30 Adelaide',
          expectedFinishMinute: 29675250,
        },
      ],
    },
  );

  assert.deepEqual([...new Set(progress.matches.map((row) => row.status))].sort(), ['pending', 'resulted']);
  assert.equal(progress.matches.some((row) => row.key === 'old-1' && row.status === 'resulted'), true);

  const markdown = renderRoutineProgressMarkdown(progress);
  assert.match(markdown, /Latest \/ last day of data collected: 2026-06-17/);
  assert.doesNotMatch(markdown, /\| cancelled \|/);
  assert.doesNotMatch(markdown, /\| skipped \|/);
});

test('ledger does not carry stale prior pending matches', () => {
  const progress = progressFor(
    [match({ id: 'current-1', date: '2026-06-17', status: 'upcoming', home: 'Current' })],
    {
      matches: [
        {
          key: 'stale-pending',
          eventId: 'stale-pending',
          league: 'Old League',
          date: '2026-06-05',
          time: '10:00',
          home: 'Stale',
          away: 'Pending',
          status: 'pending',
          expectedFinish: '2026-06-05 12:30 Adelaide',
          expectedFinishMinute: 29668050,
        },
      ],
    },
  );

  assert.equal(progress.matches.some((row) => row.key === 'stale-pending'), false);
  assert.equal(progress.overduePendingCount, 0);
});

test('progress markdown exposes the current wrapper stage', () => {
  const progress = buildRoutineProgress({
    now: NOW,
    previousProgress: null,
    log: {
      runId: 'run-stage',
      mode: 'results-only',
      status: 'running',
      stage: {
        id: 'cache_badges',
        label: 'Starting: Cache badges to Firebase Storage',
        status: 'running',
      },
    },
    schedule: { result_check_buffer_minutes: 150, matches: [] },
    matchData: {
      captured_at: '2026-06-11',
      leagues: [{ name: 'Test League', matches: [match({ id: 'm1', date: '2026-06-17', time: '23:00' })] }],
    },
  });

  const markdown = renderRoutineProgressMarkdown(progress);

  assert.match(markdown, /Agent: codex 5\.3/);
  assert.match(markdown, /Run: run-stage \(results-only, running\)/);
  assert.match(markdown, /Stage: Starting: Cache badges to Firebase Storage \(running\)/);
  assert.match(markdown, /In progress 2026-06-11: completed/);
});
