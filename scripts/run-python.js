const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = process.argv[2];
const args = process.argv.slice(3);
const localPython = process.platform === 'win32'
  ? path.join(root, '.venv-local', 'Scripts', 'python.exe')
  : path.join(root, '.venv-local', 'bin', 'python');

if (!script) {
  console.error('Usage: node scripts/run-python.js <script.py> [args...]');
  process.exit(1);
}

const candidates = process.platform === 'win32'
  ? [
      { command: localPython, args: [] },
      { command: 'py', args: ['-3'] },
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ]
  : [
      { command: localPython, args: [] },
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

let lastError = '';

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.args, script, ...args], {
    cwd: root,
    stdio: 'inherit',
  });

  if (!result.error) {
    process.exit(result.status ?? 1);
  }

  lastError = `${candidate.command}: ${result.error.message}`;
}

console.error(`Could not find a usable Python interpreter. Last error: ${lastError}`);
process.exit(1);
