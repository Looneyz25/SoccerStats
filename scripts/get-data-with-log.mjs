import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildRoutineProgress,
  progressMaintenanceDecision,
  progressPendingPastExpectedFinish,
  renderRoutineProgressMarkdown,
} from './routine-progress.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'agent-system', 'outputs');
const PENDING_UPLOAD_PATH = path.join(OUT_DIR, 'result_pending_upload_latest.json');
const PROGRESS_JSON_PATH = path.join(OUT_DIR, 'routine_progress_latest.json');
const PROGRESS_MD_PATH = path.join(OUT_DIR, 'routine_progress_latest.md');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const argv = process.argv.slice(2);
const strictResultsOnly = argv.includes('--results-only-strict');
const resultsOnly = argv.includes('--results-only') || process.env.SOCCER_DATA_MODE === 'results';
const topUpOnly = argv.includes('--top-up-only') || process.env.SOCCER_DATA_MODE === 'topup';
const sourceArg = argv.find((arg) => arg.startsWith('--source='));
const sourceMode = sourceArg ? sourceArg.slice('--source='.length).trim().toLowerCase() : '';
const validSourceModes = new Set(['sportsbet', 'bet365']);
if (resultsOnly && topUpOnly) {
  console.error('Choose one mode: --results-only or --top-up-only');
  process.exit(1);
}
if (sourceMode && !validSourceModes.has(sourceMode)) {
  console.error(`Unknown source mode: ${sourceMode}. Expected one of: ${Array.from(validSourceModes).join(', ')}`);
  process.exit(1);
}
if (sourceMode && (resultsOnly || topUpOnly)) {
  console.error('Choose either --source=<source>, --results-only, or --top-up-only');
  process.exit(1);
}
const runMode = sourceMode ? `source-${sourceMode}` : resultsOnly ? 'results-only' : topUpOnly ? 'top-up-only' : 'full-refresh';
const DEFAULT_ENV = {
  SOCCER_FIXTURE_DAYS: resultsOnly ? '1' : '7',
  SOCCER_ODDS_BUDGET: resultsOnly ? '80' : topUpOnly ? '320' : '720',
  SOCCER_SPORTSBET_DEEP_BUDGET: resultsOnly ? '120' : topUpOnly ? '240' : '420',
  SOCCER_RESULT_BUFFER_MINUTES: process.env.SOCCER_RESULT_BUFFER_MINUTES || '180',
  SOCCER_RESULT_LOOKBACK_DAYS: process.env.SOCCER_RESULT_LOOKBACK_DAYS || '3',
};

const FULL_REFRESH_STEPS = [
  {
    id: 'collect_dashboard_data',
    label: 'Collect dashboard data',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_routine.py'],
  },
  {
    id: 'run_phase_pipeline',
    label: 'Run phase pipeline',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_phases_routine.py'],
  },
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const RESULTS_ONLY_STEPS = [
  {
    id: 'apply_manual_result_imports',
    label: 'Apply manual result imports',
    command: 'node',
    args: ['scripts/apply_manual_result_imports.mjs'],
  },
  {
    id: 'settle_due_results',
    label: 'Settle due results',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_routine.py', '--results-only'],
  },
  {
    id: 'run_result_review',
    label: 'Run result review',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_result_review_agent.py'],
  },
  {
    id: 'run_model_calibration',
    label: 'Run model calibration',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_model_calibration_agent.py'],
  },
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const SEED_NEXT_DAY_STEP = {
  id: 'seed_next_day',
  label: 'Seed day+1 slate',
  command: 'node',
  args: ['scripts/run-python.js', 'scripts/soccer_routine.py', '--seed-next-day'],
  env: {
    SOCCER_FIXTURE_DAYS: '2',
    SOCCER_ODDS_BUDGET: '240',
    SOCCER_SPORTSBET_DEEP_BUDGET: '180',
  },
};

const TOP_UP_HORIZON_STEP = {
  id: 'top_up_horizon',
  label: 'Top up 7-day prediction horizon',
  command: 'node',
  args: ['scripts/run-python.js', 'scripts/soccer_routine.py', '--seed-next-day'],
  env: {
    SOCCER_FIXTURE_DAYS: '7',
    SOCCER_ODDS_BUDGET: '320',
    SOCCER_SPORTSBET_DEEP_BUDGET: '240',
  },
};

const TOP_UP_ONLY_STEPS = [
  TOP_UP_HORIZON_STEP,
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const UPLOAD_RETRY_STEPS = [
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const SPORTSBET_SOURCE_STEPS = [
  {
    id: 'refresh_sportsbet_odds',
    label: 'Refresh Sportsbet odds and markets',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_fetch_sportsbet.py'],
    env: {
      SOCCER_SPORTSBET_DEEP_BUDGET: process.env.SOCCER_SPORTSBET_DEEP_BUDGET || '360',
    },
  },
  {
    id: 'refresh_bookmaker_links',
    label: 'Refresh direct bookmaker links',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_fetch_bookmaker_links.py'],
  },
  {
    id: 'refresh_prediction_odds',
    label: 'Refresh visible prediction odds',
    command: 'node',
    args: ['scripts/run-python.js', 'scripts/soccer_fetch_pred_odds.py'],
    env: {
      SOCCER_ODDS_BUDGET: process.env.SOCCER_ODDS_BUDGET || '360',
    },
  },
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const BET365_SOURCE_STEPS = [
  {
    id: 'merge_bet365_context',
    label: 'Merge bet365 context cache',
    command: 'node',
    args: ['scripts/merge_bet365_context.mjs'],
  },
  {
    id: 'verify_market_settlement',
    label: 'Verify and repair settled markets',
    command: 'node',
    args: ['scripts/verify_market_settlement.mjs'],
  },
  {
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
  {
    id: 'cache_badges',
    label: 'Cache badges to Firebase Storage',
    command: 'node',
    args: ['scripts/cache_badges_to_firebase.mjs'],
    timeoutMs: 240000,
  },
];

const DATA_MUTATION_STEP_IDS = new Set([
  'settle_due_results',
  'seed_next_day',
  'top_up_horizon',
  'run_result_review',
  'run_model_calibration',
  'verify_market_settlement',
  'refresh_sportsbet_odds',
  'refresh_bookmaker_links',
  'refresh_prediction_odds',
  'merge_bet365_context',
]);
const RESULT_UPLOAD_GATE_STEP_IDS = new Set(['cache_badges', 'upload_firestore']);

const BET365_CONTEXT_INPUTS = [
  path.join(ROOT, 'docs', 'agent-system', 'inputs', 'bet365_context.json'),
  path.join(ROOT, 'docs', 'agent-system', 'inputs', 'statshub_context.json'),
  path.join(ROOT, 'docs', 'agent-system', 'outputs', 'bet365_context_latest.json'),
  path.join(ROOT, 'docs', 'agent-system', 'outputs', 'statshub_context_latest.json'),
];

function nowIso() {
  return new Date().toISOString();
}

function runIdFromDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function tail(value, length = 4000) {
  if (!value) return '';
  return value.length > length ? value.slice(-length) : value;
}

function appendTranscript(lines, text) {
  if (!text) return;
  text.split(/\r?\n/).forEach((line) => {
    lines.push(line);
  });
}

function runStep(step, transcript) {
  return new Promise((resolve) => {
    const startedAt = nowIso();
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    transcript.push('');
    transcript.push(`## ${step.label}`);
    transcript.push(`$ ${step.command} ${step.args.join(' ')}`);
    transcript.push(`started_at=${startedAt}`);
    console.log('');
    console.log(`[${step.label}] starting...`);

    const child = spawn(step.command, step.args, {
      cwd: ROOT,
      shell: false,
      env: { ...DEFAULT_ENV, ...process.env, ...(step.env || {}) },
    });

    // Hard cap per step so a slow/hung worker (e.g. the badge cache making thousands of
    // Storage round-trips) can't hold the no-touch loop and trip the overlap guard.
    let timer = null;
    if (step.timeoutMs) {
      timer = setTimeout(() => {
        const msg = `[${step.label}] timed out after ${step.timeoutMs}ms — killing`;
        console.error(msg);
        appendTranscript(transcript, `${msg}\n`);
        try { child.kill('SIGKILL'); } catch {}
      }, step.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
      appendTranscript(transcript, text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
      appendTranscript(transcript, text);
    });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      stderr += `${error.message}\n`;
      transcript.push(error.message);
      resolve({
        ...step,
        status: 'failed',
        exitCode: null,
        startedAt,
        completedAt: nowIso(),
        durationMs: Date.now() - startTime,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const completedAt = nowIso();
      const status = code === 0 ? 'ok' : 'failed';
      transcript.push(`completed_at=${completedAt}`);
      transcript.push(`exit_code=${code}`);
      console.log(`[${step.label}] ${status} exit=${code}`);
      resolve({
        ...step,
        status,
        exitCode: code,
        startedAt,
        completedAt,
        durationMs: Date.now() - startTime,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    });
  });
}

async function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readTextSafe(filePath) {
  if (!existsSync(filePath)) return '';
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function todayInAdelaide() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addIsoDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateRangeAfter(startDate, endDate) {
  if (!endDate) return [];
  if (!startDate || startDate >= endDate) return [endDate];
  const dates = [];
  for (let cursor = addIsoDays(startDate, 1); cursor <= endDate; cursor = addIsoDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function topUpStepForDates(targetDates) {
  const dates = targetDates.filter(Boolean);
  return {
    ...TOP_UP_HORIZON_STEP,
    env: {
      ...TOP_UP_HORIZON_STEP.env,
      SOCCER_FIXTURE_DATES: dates.join(','),
      SOCCER_FIXTURE_DAYS: String(Math.max(1, dates.length)),
      SOCCER_TOP_UP_TARGETED: '1',
    },
  };
}

function scopedPostTopUpStep(step, targetDates) {
  const dates = targetDates.filter(Boolean);
  if (step.id !== 'cache_badges' || !dates.length) return step;
  return {
    ...step,
    env: {
      ...(step.env || {}),
      BADGE_TARGET_DATES: dates.join(','),
      SOCCER_FIXTURE_DATES: dates.join(','),
    },
  };
}

function seedTargetDate(schedule) {
  const tomorrowRows = (schedule?.matches || [])
    .filter((row) => row.scope === 'tomorrow' && row.date)
    .map((row) => row.date)
    .sort();
  return tomorrowRows[0] || addIsoDays(todayInAdelaide(), 1);
}

async function seedDecision() {
  const schedule = await readJsonSafe(path.join(OUT_DIR, 'result_check_schedule_latest.json'));
  if (!schedule || Number(schedule.remaining_count ?? 0) !== 0 || Number(schedule.due_count ?? 0) !== 0) {
    return { shouldSeed: false, reason: 'result schedule still has active matches' };
  }
  const targetDate = seedTargetDate(schedule);
  const markerPath = path.join(OUT_DIR, 'result_next_day_seed_latest.json');
  const marker = await readJsonSafe(markerPath);
  if (marker?.targetDate === targetDate) {
    return { shouldSeed: false, reason: `day+1 already seeded for ${targetDate}`, targetDate };
  }
  return { shouldSeed: true, reason: `active slate complete; seed ${targetDate}`, targetDate, markerPath };
}

async function horizonTopUpDecision() {
  const targetDate = todayInAdelaide();
  const markerPath = path.join(OUT_DIR, 'result_horizon_top_up_latest.json');
  const marker = await readJsonSafe(markerPath);
  if (marker?.targetDate === targetDate) {
    return { shouldTopUp: false, reason: `7-day horizon already topped up for ${targetDate}`, targetDate };
  }
  return { shouldTopUp: true, reason: `no due results; top up 7-day prediction horizon for ${targetDate}`, targetDate, markerPath };
}

async function markSeeded(targetDate, step) {
  const markerPath = path.join(OUT_DIR, 'result_next_day_seed_latest.json');
  await writeFile(markerPath, `${JSON.stringify({
    targetDate,
    seededAt: nowIso(),
    stepStatus: step.status,
    stepExitCode: step.exitCode,
  }, null, 2)}\n`, 'utf8');
}

async function markHorizonTopUp(targetDate, step) {
  const markerPath = path.join(OUT_DIR, 'result_horizon_top_up_latest.json');
  await writeFile(markerPath, `${JSON.stringify({
    targetDate,
    toppedUpAt: nowIso(),
    stepStatus: step.status,
    stepExitCode: step.exitCode,
  }, null, 2)}\n`, 'utf8');
}

async function markPendingUpload(log, reason) {
  await writeFile(PENDING_UPLOAD_PATH, `${JSON.stringify({
    reason,
    runId: log.runId,
    mode: log.mode,
    decision: log.decision?.action || null,
    targetDate: log.decision?.targetDate || null,
    targetDates: log.decision?.targetDates || [],
    markedAt: nowIso(),
    steps: log.steps.map((step) => ({
      id: step.id,
      status: step.status,
      exitCode: step.exitCode,
    })),
  }, null, 2)}\n`, 'utf8');
}

async function clearPendingUpload() {
  if (!existsSync(PENDING_UPLOAD_PATH)) return;
  await rm(PENDING_UPLOAD_PATH, { force: true });
}

async function pendingUploadDecision() {
  const pending = await readJsonSafe(PENDING_UPLOAD_PATH);
  if (!pending) return { shouldRetryUpload: false };
  const horizonTopUp = await readJsonSafe(path.join(OUT_DIR, 'result_horizon_top_up_latest.json'));
  const targetDates = Array.isArray(pending.targetDates) && pending.targetDates.length
    ? pending.targetDates
    : pending.targetDate
      ? [pending.targetDate]
      : pending.decision === 'top-up-horizon' && horizonTopUp?.targetDate
        ? [horizonTopUp.targetDate]
        : [];
  return {
    shouldRetryUpload: true,
    reason: `previous local data run needs Firestore upload retry (${pending.reason || 'upload did not complete'})`,
    pending,
    targetDates,
  };
}

async function writeRoutineProgress(log) {
  const matchData = await readJsonSafe(path.join(ROOT, 'match_data.json'));
  const schedule = await readJsonSafe(path.join(OUT_DIR, 'result_check_schedule_latest.json'));
  const previousProgress = await readJsonSafe(PROGRESS_JSON_PATH);
  const progress = buildRoutineProgress({ matchData, schedule, log, previousProgress });
  await writeFile(PROGRESS_JSON_PATH, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  await writeFile(PROGRESS_MD_PATH, renderRoutineProgressMarkdown(progress), 'utf8');
  return progress;
}

async function checkpointRoutineProgress(log, stage) {
  log.stage = {
    id: stage.id || null,
    label: stage.label || stage.id || 'Routine checkpoint',
    status: stage.status || log.status || 'running',
    updatedAt: nowIso(),
    stepStatus: stage.stepStatus || null,
    stepExitCode: stage.stepExitCode ?? null,
  };
  return writeRoutineProgress(log);
}

async function readRoutineProgressSnapshot(log = null) {
  const matchData = await readJsonSafe(path.join(ROOT, 'match_data.json'));
  const schedule = await readJsonSafe(path.join(OUT_DIR, 'result_check_schedule_latest.json'));
  const previousProgress = await readJsonSafe(PROGRESS_JSON_PATH);
  return buildRoutineProgress({ matchData, schedule, log, previousProgress });
}

function parseDueAt(row) {
  const value = row?.due_at || row?.check_after;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function rowClosedForResultCheck(row) {
  return new Set([
    'ft',
    'postponed_or_cancelled',
    'postponed',
    'cancelled',
    'canceled',
    'abandoned',
    'suspended',
  ]).has(String(row?.status || '').toLowerCase());
}

function rowIsDue(row, nowMs = Date.now()) {
  if (!row || rowClosedForResultCheck(row)) return false;
  if (row.due_for_check === true) return true;
  if (row.scope === 'overdue') return true;
  if (row.date && row.date < todayInAdelaide()) return true;
  const dueAt = parseDueAt(row);
  return dueAt !== null && nowMs > dueAt;
}

function dueRows(schedule, nowMs = Date.now()) {
  return (schedule?.matches || []).filter((row) => rowIsDue(row, nowMs));
}

function nextDueRows(schedule, limit = 5, nowMs = Date.now()) {
  return (schedule?.matches || [])
    .map((row) => ({ row, dueAt: parseDueAt(row) }))
    .filter((entry) => entry.dueAt !== null && entry.dueAt > nowMs)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit)
    .map((entry) => entry.row);
}

function describeMatch(row) {
  const teams = `${row.home || '?'} vs ${row.away || '?'}`;
  return `${row.date || '?'} ${row.time || '?'} ${row.league || '?'} ${teams} (${row.result_queue || 'DUE @ unknown'})`;
}

function unresolvedDueResultsStep(due) {
  const details = due.map(describeMatch);
  return {
    id: 'block_unresolved_due_results',
    label: 'Block upload on unresolved due results',
    command: 'internal',
    args: [],
    status: 'failed',
    exitCode: 1,
    durationMs: 0,
    stdout: details.join('\n'),
    stderr: `${due.length} due result${due.length === 1 ? '' : 's'} still unresolved after settlement`,
  };
}

function agentInterventionRequiredStep(overduePending) {
  const details = overduePending.map((match) =>
    `${match.date || '?'} ${match.time || '?'} ${match.league || '?'} ${match.home || '?'} vs ${match.away || '?'} (${match.expectedFinish || 'expected finish unknown'})`,
  );
  return {
    id: 'agent_intervention_required',
    label: 'Agent intervention required for pending results',
    command: 'internal',
    args: [],
    status: 'failed',
    exitCode: 1,
    durationMs: 0,
    stdout: details.join('\n'),
    stderr: `${overduePending.length} pending match${overduePending.length === 1 ? '' : 'es'} still past expected finish after get:data results check`,
  };
}

function horizonTopUpIncompleteStep(progress) {
  return {
    id: 'horizon_top_up_incomplete',
    label: 'Forecast horizon still incomplete',
    command: 'internal',
    args: [],
    status: 'failed',
    exitCode: 1,
    durationMs: 0,
    stdout: `latest=${progress.latestCollectedDate || 'n/a'} required=${progress.requiredLatestDate || 'n/a'}`,
    stderr: `forecast horizon still short after top-up: latest ${progress.latestCollectedDate || 'n/a'}, required ${progress.requiredLatestDate || 'n/a'}`,
  };
}

async function postResultsInterventionStep() {
  const progress = await readRoutineProgressSnapshot();
  const overduePending = progressPendingPastExpectedFinish(progress);
  if (!overduePending.length) return null;
  return agentInterventionRequiredStep(overduePending);
}

async function planResultsRun({ forceResultsOnly = false } = {}) {
  const progress = await readRoutineProgressSnapshot();
  const progressDecision = progressMaintenanceDecision(progress);
  if (progressDecision?.action === 'results') {
    return {
      action: 'results',
      reason: progressDecision.reason,
      due: progressDecision.due || [],
      requiredSteps: RESULTS_ONLY_STEPS,
    };
  }

  const schedulePath = path.join(OUT_DIR, 'result_check_schedule_latest.json');
  const schedule = await readJsonSafe(schedulePath);
  if (!schedule) {
    return {
      action: 'results',
      reason: 'no result schedule exists yet; run the results checker to build one',
      requiredSteps: RESULTS_ONLY_STEPS,
    };
  }

  const due = dueRows(schedule);
  if (due.length) {
    return {
      action: 'results',
      reason: `${due.length} match${due.length === 1 ? '' : 'es'} due for result check`,
      due: due.slice(0, 8).map(describeMatch),
      requiredSteps: RESULTS_ONLY_STEPS,
    };
  }

  if (!forceResultsOnly && progressDecision?.action === 'top-up-horizon') {
    const targetDates = dateRangeAfter(progress.latestCollectedDate, progressDecision.targetDate);
    return {
      action: 'top-up-horizon',
      reason: progressDecision.reason,
      targetDate: progressDecision.targetDate || null,
      targetDates,
      requiredSteps: [
        topUpStepForDates(targetDates),
        ...TOP_UP_ONLY_STEPS.slice(1).map((step) => scopedPostTopUpStep(step, targetDates)),
      ],
    };
  }

  // Check pending upload BEFORE the completed-today gate: the --live pass writes this
  // flag when it updates live scores, and those changes need a Firestore upload even
  // when today's full settlement run already completed.
  const pendingUpload = await pendingUploadDecision();
  if (pendingUpload.shouldRetryUpload) {
    return {
      action: 'retry-upload',
      reason: pendingUpload.reason,
      targetDates: pendingUpload.targetDates,
      requiredSteps: UPLOAD_RETRY_STEPS.map((step) => scopedPostTopUpStep(step, pendingUpload.targetDates)),
    };
  }

  const routineCompletedToday = progress?.completedForDate
    && progress.completedForDate === todayInAdelaide()
    && progress.progressState === 'completed'
    && Number(schedule.remaining_count ?? 0) === 0
    && Number(schedule.due_count ?? 0) === 0;
  if (routineCompletedToday) {
    return {
      action: 'skip',
      reason: `routine progress marks in progress ${progress.completedForDate} completed`,
      nextDue: nextDueRows(schedule).map(describeMatch),
      requiredSteps: [],
    };
  }

  if (!progressDecision) {
    const nextDue = nextDueRows(schedule).map(describeMatch);
    return {
      action: 'skip',
      reason: 'routine progress has no pending matches past expected finish and +6 forecast is collected',
      nextDue,
      requiredSteps: [],
    };
  }

  const nextDue = nextDueRows(schedule).map(describeMatch);
  return {
    action: 'skip',
    reason: 'routine progress did not require data collection',
    nextDue,
    requiredSteps: [],
  };
}

function bet365ContextInputPath() {
  return BET365_CONTEXT_INPUTS.find((candidate) => existsSync(candidate)) || null;
}

function planSourceRun(source) {
  if (source === 'sportsbet') {
    return {
      action: 'source-sportsbet',
      reason: 'manual Sportsbet-only odds/market enrichment requested',
      requiredSteps: SPORTSBET_SOURCE_STEPS,
    };
  }
  if (source === 'bet365') {
    const inputPath = bet365ContextInputPath();
    if (!inputPath) {
      return {
        action: 'source-bet365-skip',
        reason: 'no bet365/StatsHub context cache found to merge',
        requiredSteps: [],
      };
    }
    return {
      action: 'source-bet365',
      reason: `manual bet365/StatsHub cache merge requested from ${path.relative(ROOT, inputPath)}`,
      requiredSteps: BET365_SOURCE_STEPS,
    };
  }
  throw new Error(`Unsupported source mode: ${source}`);
}

function countMatches(matchData) {
  const leagues = Array.isArray(matchData?.leagues) ? matchData.leagues : [];
  return leagues.reduce((sum, league) => sum + (Array.isArray(league.matches) ? league.matches.length : 0), 0);
}

function statusCounts(matchData) {
  const counts = {};
  const leagues = Array.isArray(matchData?.leagues) ? matchData.leagues : [];
  leagues.forEach((league) => {
    (league.matches || []).forEach((match) => {
      const status = match.status || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
    });
  });
  return counts;
}

function dateWindow(matchData) {
  const dates = [];
  const leagues = Array.isArray(matchData?.leagues) ? matchData.leagues : [];
  leagues.forEach((league) => {
    (league.matches || []).forEach((match) => {
      if (match.date) dates.push(match.date);
    });
  });
  dates.sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: null, end: null };
}

async function collectArtifacts() {
  const matchData = await readJsonSafe(path.join(ROOT, 'match_data.json'));
  const phaseRunLog = await readJsonSafe(path.join(OUT_DIR, 'Phase7_Run_Log.json'));
  const resultSchedule = await readJsonSafe(path.join(OUT_DIR, 'result_check_schedule_latest.json'));
  const phaseSummary = await readTextSafe(path.join(OUT_DIR, 'Phase7_Daily_Summary.md'));
  const marketSettlement = await readJsonSafe(path.join(OUT_DIR, 'market_settlement_verification_latest.json'));
  const leagues = Array.isArray(matchData?.leagues) ? matchData.leagues : [];
  const uploadMeta = matchData
    ? {
        firestoreFormat: 'league_docs_v1',
        capturedAt: matchData.captured_at || null,
        source: matchData.source || null,
        leagueCount: leagues.length,
        matchCount: countMatches(matchData),
        largestLeagueDocBytes: leagues.reduce((max, league) => Math.max(max, Buffer.byteLength(JSON.stringify(league))), 0),
        statusCounts: statusCounts(matchData),
        dateWindow: dateWindow(matchData),
      }
    : null;

  return {
    matchData: uploadMeta,
    resultSchedule,
    phaseRunLog,
    resultSchedulePath: path.join('docs', 'agent-system', 'outputs', 'result_check_schedule_latest.md'),
    phaseSummaryPath: path.join('docs', 'agent-system', 'outputs', 'Phase7_Daily_Summary.md'),
    phaseRunLogPath: path.join('docs', 'agent-system', 'outputs', 'Phase7_Run_Log.json'),
    marketSettlement,
    marketSettlementPath: path.join('docs', 'agent-system', 'outputs', 'market_settlement_verification_latest.md'),
  };
}

function marketSettlementAgentReviewGate(marketSettlement) {
  if (!marketSettlement) return null;
  const unresolved = Array.isArray(marketSettlement.unresolvedMarkets) ? marketSettlement.unresolvedMarkets : [];
  return {
    current_step: 'market_settlement_verification',
    status: marketSettlement.status || 'unknown',
    evidence_checked: [
      'match_data.json',
      'docs/agent-system/outputs/market_settlement_verification_latest.json',
      'docs/agent-system/outputs/market_settlement_verification_latest.md',
    ],
    decision: unresolved.length
      ? 'stop before Firestore upload; required FT markets are not fully settled'
      : 'proceed; required FT markets for the day are settled',
    action_taken: `checked FT=${marketSettlement.ftMatchesChecked ?? 0}; repaired=${marketSettlement.marketsRepaired ?? 0}`,
    result: `unresolved_markets=${unresolved.length}`,
    blockers: unresolved.slice(0, 8).map((row) => `${row.label || row.matchId || 'match'}: ${row.reason || 'unsettled'}`),
    next_step: unresolved.length ? 'fetch provider actuals or add manual result import, then rerun results/upload' : 'continue Firestore upload verification',
    agent_intervention_required: unresolved.length > 0,
  };
}

function stepLastLine(step) {
  const lines = (step.stdout || '').split(/\r?\n/).filter((line) => line.trim());
  return lines.length ? lines[lines.length - 1] : '';
}

function renderMarkdown(log) {
  const lines = [
    '# Get Data Run Log',
    '',
    `Run ID: ${log.runId}`,
    `Mode: ${log.mode}`,
    `Started: ${log.startedAt}`,
    `Completed: ${log.completedAt}`,
    `Status: ${log.status}`,
    '',
    '## Firestore',
    '',
  ];

  const firestoreStep = log.steps.find((step) => step.id === 'upload_firestore');
  lines.push(`- Upload status: ${firestoreStep?.status || 'not_run'}`);
  lines.push(`- Last line: ${stepLastLine(firestoreStep || {}) || 'n/a'}`);

  if (log.artifacts.matchData) {
    const data = log.artifacts.matchData;
    lines.push(`- Firestore format: ${data.firestoreFormat || 'legacy'}`);
    lines.push(`- Captured at: ${data.capturedAt || 'n/a'}`);
    lines.push(`- Source: ${data.source || 'n/a'}`);
    lines.push(`- Leagues: ${data.leagueCount}`);
    lines.push(`- Matches: ${data.matchCount}`);
    lines.push(`- Largest league doc: ${data.largestLeagueDocBytes ? `${data.largestLeagueDocBytes} bytes` : 'n/a'}`);
    lines.push(`- Date window: ${data.dateWindow.start || 'n/a'} to ${data.dateWindow.end || 'n/a'}`);
    lines.push(`- Status counts: ${Object.entries(data.statusCounts).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
  } else {
    lines.push('- Match data summary: unavailable');
  }

  if (log.artifacts.resultSchedule) {
    const schedule = log.artifacts.resultSchedule;
    lines.push(`- Result due now: ${schedule.due_count ?? 0}`);
    lines.push(`- Result remaining tracked: ${schedule.remaining_count ?? 0}`);
    lines.push(`- Result schedule: \`${log.artifacts.resultSchedulePath}\``);
  }

  if (log.artifacts.routineProgress) {
    const progress = log.artifacts.routineProgress;
    lines.push(`- Routine progress: \`${log.artifacts.routineProgressPath}\``);
    lines.push(`- Latest / last day collected: ${progress.latestCollectedDate || 'n/a'}`);
    lines.push(`- Forecast through +6 days: ${progress.hasSevenDayForecast ? 'yes' : 'no'} (needs ${progress.requiredLatestDate || 'n/a'})`);
    lines.push(`- Progress pending/resulted: pending=${progress.pendingCount}, resulted=${progress.resultedCount}, overdue_pending=${progress.overduePendingCount}`);
  }

  if (log.artifacts.marketSettlement) {
    const marketSettlement = log.artifacts.marketSettlement;
    const unresolvedCount = Array.isArray(marketSettlement.unresolvedMarkets) ? marketSettlement.unresolvedMarkets.length : 0;
    lines.push(`- Market settlement verification: ${marketSettlement.status || 'unknown'} (FT=${marketSettlement.ftMatchesChecked ?? 0}, repaired=${marketSettlement.marketsRepaired ?? 0}, unresolved=${unresolvedCount})`);
    lines.push(`- Market settlement report: \`${log.artifacts.marketSettlementPath}\``);
  }

  if (log.decision) {
    lines.push('');
    lines.push('## Routine Decision');
    lines.push('');
    lines.push(`- Action: ${log.decision.action}`);
    lines.push(`- Reason: ${log.decision.reason}`);
    if (log.decision.targetDate) lines.push(`- Target date: ${log.decision.targetDate}`);
    if (Array.isArray(log.decision.targetDates) && log.decision.targetDates.length) {
      lines.push(`- Target dates: ${log.decision.targetDates.join(', ')}`);
    }
    if (Array.isArray(log.decision.due) && log.decision.due.length) {
      log.decision.due.forEach((row) => lines.push(`- Due: ${row}`));
    }
    if (Array.isArray(log.decision.nextDue) && log.decision.nextDue.length) {
      log.decision.nextDue.forEach((row) => lines.push(`- Next due: ${row}`));
    }
  }

  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Status | Exit | Duration | Last line |');
  lines.push('| --- | --- | --- | --- | --- |');
  if (log.steps.length) {
    log.steps.forEach((step) => {
      const duration = `${(step.durationMs / 1000).toFixed(2)}s`;
      const lastLine = stepLastLine(step).replace(/\|/g, '/').slice(0, 160);
      lines.push(`| ${step.label} | ${step.status} | ${step.exitCode ?? ''} | ${duration} | ${lastLine} |`);
    });
  } else {
    lines.push('| No operation | ok | 0 | 0.00s | Routine decision skipped execution |');
  }

  lines.push('');
  lines.push('## Output Files');
  lines.push('');
  lines.push(`- JSON log: \`${log.paths.json}\``);
  lines.push(`- Transcript: \`${log.paths.transcript}\``);
  lines.push(`- Phase run log: \`${log.artifacts.phaseRunLogPath}\``);
  lines.push(`- Phase daily summary: \`${log.artifacts.phaseSummaryPath}\``);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const started = new Date();
  const runId = runIdFromDate(started);
  const baseName = `get_data_${runId}`;
  const relativePaths = {
    json: path.join('docs', 'agent-system', 'outputs', `${baseName}.json`),
    markdown: path.join('docs', 'agent-system', 'outputs', `${baseName}.md`),
    transcript: path.join('docs', 'agent-system', 'outputs', `${baseName}.log`),
  };
  const paths = {
    json: path.join(ROOT, relativePaths.json),
    markdown: path.join(ROOT, relativePaths.markdown),
    transcript: path.join(ROOT, relativePaths.transcript),
  };

  const transcript = [
    `# get:data transcript ${runId}`,
    `root=${ROOT}`,
    `mode=${runMode}`,
    `started_at=${started.toISOString()}`,
    `npm_command=${npmCommand}`,
  ];

  const decision = sourceMode ? planSourceRun(sourceMode) : resultsOnly ? await planResultsRun({ forceResultsOnly: strictResultsOnly }) : topUpOnly ? {
    action: 'top-up-horizon',
    reason: 'manual top-up-only mode requested',
    targetDate: todayInAdelaide(),
    requiredSteps: TOP_UP_ONLY_STEPS,
  } : {
    action: 'full-refresh',
    reason: 'manual full 7-day refresh requested',
    requiredSteps: FULL_REFRESH_STEPS,
  };
  transcript.push(`decision_action=${decision.action}`);
  transcript.push(`decision_reason=${decision.reason}`);
  console.log(`[Routine decision] ${decision.action}: ${decision.reason}`);
  if (decision.due?.length) {
    decision.due.forEach((row) => console.log(`  due: ${row}`));
  }
  if (decision.nextDue?.length) {
    decision.nextDue.forEach((row) => console.log(`  next due: ${row}`));
  }

  const steps = [];
  const log = {
    runId,
    mode: runMode,
    status: 'running',
    startedAt: started.toISOString(),
    completedAt: null,
    paths: relativePaths,
    decision: {
      action: decision.action,
      reason: decision.reason,
      targetDate: decision.targetDate || null,
      targetDates: decision.targetDates || [],
      due: decision.due || [],
      nextDue: decision.nextDue || [],
    },
    steps,
    artifacts: {},
    stage: null,
  };

  await checkpointRoutineProgress(log, {
    id: 'decision',
    label: `Decision: ${decision.action}`,
    status: 'running',
  });

  for (const step of decision.requiredSteps) {
    await checkpointRoutineProgress(log, {
      id: step.id,
      label: `Starting: ${step.label}`,
      status: 'running',
    });

    if (resultsOnly && decision.action === 'results' && RESULT_UPLOAD_GATE_STEP_IDS.has(step.id)) {
      const interventionStep = await postResultsInterventionStep();
      if (interventionStep) {
        transcript.push('');
        transcript.push(`agent_intervention_required=${interventionStep.stderr}`);
        interventionStep.stdout.split(/\r?\n/).filter(Boolean).forEach((row) => transcript.push(`agent_intervention_match=${row}`));
        console.error(`[Agent intervention] ${interventionStep.stderr}`);
        interventionStep.stdout.split(/\r?\n/).filter(Boolean).forEach((row) => console.error(`  pending: ${row}`));
        steps.push(interventionStep);
        await checkpointRoutineProgress(log, {
          id: interventionStep.id,
          label: interventionStep.label,
          status: interventionStep.status,
          stepStatus: interventionStep.status,
          stepExitCode: interventionStep.exitCode,
        });
        break;
      }

      const postSettleSchedule = await readJsonSafe(path.join(OUT_DIR, 'result_check_schedule_latest.json'));
      const unresolvedDue = dueRows(postSettleSchedule);
      if (unresolvedDue.length) {
        const gateStep = unresolvedDueResultsStep(unresolvedDue);
        transcript.push('');
        transcript.push(`unresolved_due_results=${unresolvedDue.length}`);
        gateStep.stdout.split(/\r?\n/).filter(Boolean).forEach((row) => transcript.push(`unresolved_due=${row}`));
        console.error(`[Result gate] ${gateStep.stderr}`);
        gateStep.stdout.split(/\r?\n/).filter(Boolean).forEach((row) => console.error(`  unresolved: ${row}`));
        steps.push(gateStep);
        await checkpointRoutineProgress(log, {
          id: gateStep.id,
          label: gateStep.label,
          status: gateStep.status,
          stepStatus: gateStep.status,
          stepExitCode: gateStep.exitCode,
        });
        break;
      }
    }
    const result = await runStep(step, transcript);
    steps.push(result);
    await checkpointRoutineProgress(log, {
      id: result.id,
      label: `Completed: ${result.label}`,
      status: result.status === 'ok' ? 'running' : 'failed',
      stepStatus: result.status,
      stepExitCode: result.exitCode,
    });
    if (result.status === 'ok' && result.id === 'seed_next_day' && decision.targetDate) {
      await markSeeded(decision.targetDate, result);
    }
    if (result.status === 'ok' && result.id === 'top_up_horizon' && decision.targetDate) {
      const progress = await readRoutineProgressSnapshot(log);
      if (!progress.hasSevenDayForecast) {
        const incompleteStep = horizonTopUpIncompleteStep(progress);
        transcript.push('');
        transcript.push(`horizon_top_up_incomplete=${incompleteStep.stderr}`);
        transcript.push(incompleteStep.stdout);
        console.error(`[Forecast horizon] ${incompleteStep.stderr}`);
        steps.push(incompleteStep);
        await checkpointRoutineProgress(log, {
          id: incompleteStep.id,
          label: incompleteStep.label,
          status: incompleteStep.status,
          stepStatus: incompleteStep.status,
          stepExitCode: incompleteStep.exitCode,
        });
        continue;
      }
      await markHorizonTopUp(decision.targetDate, result);
    }
    if (result.status !== 'ok') break;
  }

  if (!decision.requiredSteps.length) {
    await checkpointRoutineProgress(log, {
      id: 'skip',
      label: 'No command needed',
      status: 'ok',
    });
  }

  const completedAt = nowIso();
  const artifacts = await collectArtifacts();
  const requiredStepsOk = decision.requiredSteps.every((requiredStep) =>
    steps.some((step) => step.id === requiredStep.id && step.status === 'ok'),
  );
  const status = requiredStepsOk && steps.every((step) => step.status === 'ok') ? 'ok' : 'failed';
  const uploadOk = steps.some((step) => step.id === 'upload_firestore' && step.status === 'ok');
  const marketSettlementChanged = Number(artifacts.marketSettlement?.marketsRepaired || 0) > 0;
  const localDataChanged = marketSettlementChanged || steps.some((step) => DATA_MUTATION_STEP_IDS.has(step.id) && step.status === 'ok');
  log.status = status;
  log.completedAt = completedAt;
  log.artifacts = artifacts;
  log.agentReviewGate = marketSettlementAgentReviewGate(artifacts.marketSettlement) || log.agentReviewGate || null;

  if (uploadOk) {
    await clearPendingUpload();
  } else if (localDataChanged) {
    await markPendingUpload(log, status === 'ok' ? 'upload step was not run after local data changed' : 'upload step failed after local data changed');
  }

  const progress = await writeRoutineProgress(log);
  await checkpointRoutineProgress(log, {
    id: 'completed',
    label: `Completed: ${status}`,
    status,
  });
  log.artifacts.routineProgressPath = path.join('docs', 'agent-system', 'outputs', 'routine_progress_latest.md');
  log.artifacts.routineProgress = {
    latestCollectedDate: progress.latestCollectedDate,
    requiredLatestDate: progress.requiredLatestDate,
    hasSevenDayForecast: progress.hasSevenDayForecast,
    pendingCount: progress.pendingCount,
    resultedCount: progress.resultedCount,
    overduePendingCount: progress.overduePendingCount,
    actions: progress.actions,
    agentReviewGate: progress.agentReviewGate,
  };

  transcript.push('');
  transcript.push(`completed_at=${completedAt}`);
  transcript.push(`status=${status}`);

  await writeFile(paths.transcript, `${transcript.join('\n')}\n`, 'utf8');
  await writeFile(paths.json, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
  await writeFile(paths.markdown, renderMarkdown(log), 'utf8');
  await writeFile(path.join(OUT_DIR, 'get_data_latest.json'), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
  await writeFile(path.join(OUT_DIR, 'get_data_latest.md'), renderMarkdown({
    ...log,
    paths: {
      json: path.join('docs', 'agent-system', 'outputs', 'get_data_latest.json'),
      markdown: path.join('docs', 'agent-system', 'outputs', 'get_data_latest.md'),
      transcript: relativePaths.transcript,
    },
  }), 'utf8');

  console.log('');
  console.log(`Get data log: ${relativePaths.markdown}`);
  console.log(`Get data JSON: ${relativePaths.json}`);
  console.log(`Get data transcript: ${relativePaths.transcript}`);

  if (status !== 'ok') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
