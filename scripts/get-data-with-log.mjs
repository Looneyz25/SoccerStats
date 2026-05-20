import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'agent-system', 'outputs');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const argv = process.argv.slice(2);
const resultsOnly = argv.includes('--results-only') || process.env.SOCCER_DATA_MODE === 'results';
const runMode = resultsOnly ? 'results-only' : 'full-refresh';
const DEFAULT_ENV = {
  SOCCER_FIXTURE_DAYS: resultsOnly ? '1' : '7',
  SOCCER_ODDS_BUDGET: resultsOnly ? '80' : '720',
  SOCCER_SPORTSBET_DEEP_BUDGET: resultsOnly ? '120' : '420',
  SOCCER_RESULT_BUFFER_MINUTES: process.env.SOCCER_RESULT_BUFFER_MINUTES || '150',
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
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
  },
];

const RESULTS_ONLY_STEPS = [
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
    id: 'upload_firestore',
    label: 'Upload league docs to Firestore',
    command: 'node',
    args: ['scripts/upload_match_data_to_firestore.mjs'],
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

const STEPS = resultsOnly ? RESULTS_ONLY_STEPS : FULL_REFRESH_STEPS;

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

async function markSeeded(targetDate, step) {
  const markerPath = path.join(OUT_DIR, 'result_next_day_seed_latest.json');
  await writeFile(markerPath, `${JSON.stringify({
    targetDate,
    seededAt: nowIso(),
    stepStatus: step.status,
    stepExitCode: step.exitCode,
  }, null, 2)}\n`, 'utf8');
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

  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Status | Exit | Duration | Last line |');
  lines.push('| --- | --- | --- | --- | --- |');
  log.steps.forEach((step) => {
    const duration = `${(step.durationMs / 1000).toFixed(2)}s`;
    const lastLine = stepLastLine(step).replace(/\|/g, '/').slice(0, 160);
    lines.push(`| ${step.label} | ${step.status} | ${step.exitCode ?? ''} | ${duration} | ${lastLine} |`);
  });

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

  const steps = [];
  for (const step of STEPS) {
    if (resultsOnly && step.id === 'upload_firestore') {
      const decision = await seedDecision();
      transcript.push('');
      transcript.push(`seed_next_day_decision=${decision.reason}`);
      console.log(`[Seed day+1] ${decision.reason}`);
      if (decision.shouldSeed) {
        const seedResult = await runStep(SEED_NEXT_DAY_STEP, transcript);
        steps.push(seedResult);
        if (seedResult.status === 'ok') {
          await markSeeded(decision.targetDate, seedResult);
        } else {
          break;
        }
      }
    }
    const result = await runStep(step, transcript);
    steps.push(result);
    if (result.status !== 'ok') break;
  }

  const completedAt = nowIso();
  const artifacts = await collectArtifacts();
  const status = steps.length === STEPS.length && steps.every((step) => step.status === 'ok') ? 'ok' : 'failed';
  const log = {
    runId,
    mode: runMode,
    status,
    startedAt: started.toISOString(),
    completedAt,
    paths: relativePaths,
    steps,
    artifacts,
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
