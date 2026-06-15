const CLOSED_STATUSES = new Set([
  'ft',
  'postponed_or_cancelled',
  'postponed',
  'cancelled',
  'canceled',
  'abandoned',
  'suspended',
]);
const ROUTINE_AGENT = 'codex 5.3';

function addIsoDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function isoDateInAdelaide(now = new Date()) {
  const parts = adelaideParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function adelaideParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function adelaideMinuteValue(now = new Date()) {
  const parts = adelaideParts(now);
  return localMinuteValue(`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`);
}

function localMinuteValue(date, time) {
  if (!date || !/^\d{2}:\d{2}$/.test(String(time || ''))) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function formatMinuteValue(value) {
  if (!Number.isFinite(value)) return 'unknown';
  const date = new Date(value * 60000);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} Adelaide`;
}

function dueMinuteForMatch(match, bufferMinutes) {
  const start = localMinuteValue(match.date, match.time);
  return start === null ? null : start + bufferMinutes;
}

function closedStatus(status) {
  return CLOSED_STATUSES.has(String(status || '').toLowerCase());
}

const SETTLED_MARKET_RESULTS = new Set(['hit', 'miss', 'pass', 'void']);

function marketUnsettled(market) {
  return Boolean(market) && !SETTLED_MARKET_RESULTS.has(String(market.result || '').toLowerCase());
}

// An FT match still owes a settlement if a stat market (cards/corners) has no result yet.
// These settle from match.actuals, which can lag the final score, so the routine must keep
// re-running the results backfill until they land — never voided.
function hasUnsettledStatMarket(match) {
  const predictions = match?.predictions || {};
  return marketUnsettled(predictions.ou_cards) || marketUnsettled(predictions.ou_corners);
}

const STAT_BACKFILL_WINDOW_DAYS = Math.max(1, Number(process.env.SOCCER_STAT_BACKFILL_WINDOW_DAYS) || 3);
const STAT_BACKFILL_FORCE_MAX_ATTEMPTS = Math.max(1, Number(process.env.SOCCER_STAT_BACKFILL_FORCE_MAX_ATTEMPTS) || 12);

function matchKey(match) {
  if (match.event_id !== undefined && match.event_id !== null) return String(match.event_id);
  if (match.id !== undefined && match.id !== null) return String(match.id);
  return [match.date || '', match.time || '', match.league || '', match.home || '', match.away || ''].join('|');
}

function normalizeStoreMatch(league, match, bufferMinutes) {
  const home = match.home?.name || match.home_name || match.home || '';
  const away = match.away?.name || match.away_name || match.away || '';
  const normalized = {
    key: matchKey({ ...match, league: league.name, home, away }),
    eventId: match.id ?? null,
    league: league.name || '',
    date: match.date || '',
    time: match.time || '',
    home,
    away,
    status: closedStatus(match.status) ? 'resulted' : 'pending',
    sourceStatus: match.status || '',
    statSettlementPending: closedStatus(match.status) && hasUnsettledStatMarket(match),
    statBackfillAttempts: Number(match.stat_backfill?.attempts || 0),
  };
  const dueMinute = dueMinuteForMatch(normalized, bufferMinutes);
  normalized.expectedFinish = formatMinuteValue(dueMinute);
  normalized.expectedFinishMinute = dueMinute;
  return normalized;
}

function normalizeScheduleMatch(row, bufferMinutes) {
  const normalized = {
    key: matchKey(row),
    eventId: row.event_id ?? null,
    league: row.league || '',
    date: row.date || '',
    time: row.time || '',
    home: row.home || '',
    away: row.away || '',
    status: closedStatus(row.status) ? 'resulted' : 'pending',
    sourceStatus: row.status || '',
  };
  const parsedDue = row.due_at || row.check_after;
  normalized.expectedFinish = parsedDue
    ? `${String(parsedDue).slice(0, 10)} ${String(parsedDue).slice(11, 16)} Adelaide`
    : formatMinuteValue(dueMinuteForMatch(normalized, bufferMinutes));
  normalized.expectedFinishMinute = dueMinuteForMatch(normalized, bufferMinutes);
  return normalized;
}

function flattenMatches(matchData, bufferMinutes) {
  const leagues = Array.isArray(matchData?.leagues) ? matchData.leagues : [];
  return leagues.flatMap((league) =>
    (Array.isArray(league.matches) ? league.matches : []).map((match) => normalizeStoreMatch(league, match, bufferMinutes)),
  );
}

function sortedUniqueDates(matches) {
  return [...new Set(matches.map((match) => match.date).filter(Boolean))].sort();
}

function tableEscape(value) {
  return String(value ?? '').replace(/\|/g, '/');
}

function describeProgressMatch(match) {
  return `${match.date || '?'} ${match.time || '?'} ${match.league || '?'} ${match.home || '?'} vs ${match.away || '?'} (${match.expectedFinish || 'expected finish unknown'})`;
}

export function buildRoutineProgress({ matchData, schedule, log, previousProgress = null, now = new Date() }) {
  const bufferMinutes = Number(schedule?.result_check_buffer_minutes || 150);
  const today = isoDateInAdelaide(now);
  const requiredLatestDate = addIsoDays(today, 6);
  const storeMatches = flattenMatches(matchData, bufferMinutes);
  const dates = sortedUniqueDates(storeMatches);
  const latestCollectedDate = dates.at(-1) || null;
  const hasSevenDayForecast = Boolean(latestCollectedDate && latestCollectedDate >= requiredLatestDate);
  const nowMinute = adelaideMinuteValue(now);

  const byKey = new Map();
  for (const previous of previousProgress?.matches || []) {
    if (previous?.key && previous.status === 'resulted') byKey.set(previous.key, { ...previous });
  }
  for (const row of schedule?.matches || []) {
    const normalized = normalizeScheduleMatch(row, bufferMinutes);
    byKey.set(normalized.key, { ...byKey.get(normalized.key), ...normalized });
  }
  for (const match of storeMatches) {
    if (match.status === 'pending' || byKey.has(match.key)) {
      byKey.set(match.key, { ...byKey.get(match.key), ...match });
    }
  }

  const matches = [...byKey.values()]
    .filter((match) => match.status === 'pending' || match.status === 'resulted')
    .sort((a, b) =>
      (a.expectedFinishMinute ?? Number.MAX_SAFE_INTEGER) - (b.expectedFinishMinute ?? Number.MAX_SAFE_INTEGER)
      || String(a.league).localeCompare(String(b.league))
      || String(a.home).localeCompare(String(b.home)),
    );

  const pending = matches.filter((match) => match.status === 'pending');
  const overduePending = pending.filter((match) =>
    Number.isFinite(match.expectedFinishMinute) && match.expectedFinishMinute < nowMinute,
  );
  // Recently finished matches whose cards/corners markets are not yet settled. These keep the
  // routine in results mode every run so the stat backfill retries until they settle (never
  // voided). Scoped to the backfill's own lookback so any settleable straggler settles
  // deterministically within the hour, but a match attempted past the cap stops forcing runs
  // (it is almost certainly an unobtainable provider gap) — it is still swept opportunistically
  // by any other results run, and is never voided.
  const statBackfillWindowStart = addIsoDays(today, -STAT_BACKFILL_WINDOW_DAYS);
  const statBackfillPending = storeMatches.filter((match) =>
    match.statSettlementPending
    && match.date
    && match.date >= statBackfillWindowStart
    && match.statBackfillAttempts < STAT_BACKFILL_FORCE_MAX_ATTEMPTS,
  );
  const strictDueCount = Number(schedule?.due_count ?? 0);
  const strictRemainingCount = Number(schedule?.remaining_count ?? 0);
  const progressState = strictDueCount === 0 && strictRemainingCount === 0 && overduePending.length === 0
    ? 'completed'
    : 'active';
  const completedForDate = progressState === 'completed' ? today : null;
  const actions = [];
  if (!hasSevenDayForecast) actions.push('Run npm.cmd run get:data:topup to fill the missing forecast horizon; do not run a full refresh unless the agent check finds broken base data.');
  if (overduePending.length) actions.push('Manual result check required for pending matches past expected finish.');
  if (!actions.length) actions.push('No manual action required.');

  return {
    generatedAt: now.toISOString(),
    agent: ROUTINE_AGENT,
    mode: log?.mode || null,
    runId: log?.runId || null,
    runStatus: log?.status || null,
    stage: log?.stage || null,
    progressDate: today,
    progressState,
    completedForDate,
    capturedAt: matchData?.captured_at || null,
    latestCollectedDate,
    requiredLatestDate,
    hasSevenDayForecast,
    totalMatches: storeMatches.length,
    pendingCount: pending.length,
    resultedCount: matches.length - pending.length,
    overduePendingCount: overduePending.length,
    statBackfillPendingCount: statBackfillPending.length,
    statBackfillPending: statBackfillPending.slice(0, 8).map(describeProgressMatch),
    actions,
    agentReviewGate: log?.agentReviewGate || previousProgress?.agentReviewGate || null,
    matches,
  };
}

export function progressPendingPastExpectedFinish(progress) {
  if (!progress) return null;
  const generatedAt = progress.generatedAt ? new Date(progress.generatedAt) : new Date();
  const nowMinute = adelaideMinuteValue(Number.isNaN(generatedAt.valueOf()) ? new Date() : generatedAt);
  return (progress.matches || []).filter((match) =>
    match.status === 'pending'
    && Number.isFinite(match.expectedFinishMinute)
    && match.expectedFinishMinute < nowMinute,
  );
}

export function progressMaintenanceDecision(progress) {
  if (!progress) return null;
  const overduePending = progressPendingPastExpectedFinish(progress);
  if (overduePending.length) {
    return {
      action: 'results',
      reason: `${overduePending.length} progress pending match${overduePending.length === 1 ? '' : 'es'} past expected finish`,
      due: overduePending.slice(0, 8).map(describeProgressMatch),
    };
  }
  if (Number(progress.statBackfillPendingCount || 0) > 0) {
    return {
      action: 'results',
      reason: `${progress.statBackfillPendingCount} finished match${progress.statBackfillPendingCount === 1 ? '' : 'es'} awaiting cards/corners settlement`,
      due: progress.statBackfillPending || [],
    };
  }
  if (progress.hasSevenDayForecast === false) {
    return {
      action: 'top-up-horizon',
      reason: `routine progress is missing forecast horizon through ${progress.requiredLatestDate || '+6 days'}`,
      targetDate: progress.requiredLatestDate || null,
    };
  }
  return null;
}

export function renderRoutineProgressMarkdown(progress) {
  const lines = [
    '# Soccer Stats Routine Progress',
    '',
    `Generated: ${progress.generatedAt}`,
    `Agent: ${progress.agent || ROUTINE_AGENT}`,
    `Run: ${progress.runId || 'n/a'} (${progress.mode || 'n/a'}, ${progress.runStatus || 'n/a'})`,
    `Stage: ${progress.stage?.label || progress.stage?.id || 'n/a'} (${progress.stage?.status || 'n/a'})`,
    `In progress ${progress.progressDate || 'n/a'}: ${progress.progressState || 'n/a'}`,
    `Data captured: ${progress.capturedAt || 'n/a'}`,
    `Latest / last day of data collected: ${progress.latestCollectedDate || 'n/a'}`,
    `7-day forecast required through: ${progress.requiredLatestDate}`,
    `7-day forecast present: ${progress.hasSevenDayForecast ? 'yes' : 'no'}`,
    `Published match rows checked: ${progress.totalMatches}`,
    `Tracked pending: ${progress.pendingCount}`,
    `Tracked resulted: ${progress.resultedCount}`,
    `Pending past expected finish: ${progress.overduePendingCount}`,
    '',
    '## Agent Action',
    '',
    ...progress.actions.map((action) => `- ${action}`),
    '',
  ];

  if (progress.agentReviewGate) {
    lines.push('## Agent Review Gate', '');
    lines.push(`- current_step: ${progress.agentReviewGate.current_step || 'n/a'}`);
    lines.push(`- status: ${progress.agentReviewGate.status || 'n/a'}`);
    lines.push(`- evidence_checked: ${Array.isArray(progress.agentReviewGate.evidence_checked) ? progress.agentReviewGate.evidence_checked.join('; ') : 'n/a'}`);
    lines.push(`- decision: ${progress.agentReviewGate.decision || 'n/a'}`);
    lines.push(`- action_taken: ${progress.agentReviewGate.action_taken || 'n/a'}`);
    lines.push(`- result: ${progress.agentReviewGate.result || 'n/a'}`);
    lines.push(`- blockers: ${Array.isArray(progress.agentReviewGate.blockers) && progress.agentReviewGate.blockers.length ? progress.agentReviewGate.blockers.join('; ') : 'none'}`);
    lines.push(`- next_step: ${progress.agentReviewGate.next_step || 'n/a'}`);
    lines.push(`- agent_intervention_required: ${progress.agentReviewGate.agent_intervention_required ? 'yes' : 'no'}`);
    lines.push('');
  }

  lines.push('## Matches', '');
  lines.push('| Status | Expected finish | Date | Kickoff | League | Match |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  if (progress.matches.length) {
    for (const match of progress.matches) {
      lines.push(
        `| ${tableEscape(match.status)} | ${tableEscape(match.expectedFinish)} | ${tableEscape(match.date)} | ${tableEscape(match.time)} | ${tableEscape(match.league)} | ${tableEscape(match.home)} vs ${tableEscape(match.away)} |`,
      );
    }
  } else {
    lines.push('| pending | unknown | n/a | n/a | n/a | No tracked matches |');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}
