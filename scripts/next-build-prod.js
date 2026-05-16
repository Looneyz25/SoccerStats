const { spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
const devUrl = process.env.SOCCER_STATS_DEV_URL || 'http://localhost:3001';

function canReachDevServer() {
  return new Promise((resolve) => {
    const request = http.get(devUrl, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(true);
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function main() {
  if (await canReachDevServer()) {
    console.error(`Refusing to run production build while dev server is reachable at ${devUrl}.`);
    console.error('Stop dev first with: npm.cmd run dev:clean');
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NEXT_BUILD: 'prod',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
