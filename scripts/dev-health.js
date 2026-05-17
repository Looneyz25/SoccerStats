const http = require('node:http');

const BASE_URL = process.env.SOCCER_STATS_DEV_URL || 'http://localhost:3001';
const DASHBOARD_URL = `${BASE_URL.replace(/\/$/, '')}/dashboard`;

function getText(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 10000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out loading ${url}`));
    });
    request.on('error', reject);
  });
}

function fail(message) {
  console.error(`Dev health failed: ${message}`);
  console.error('Try: npm.cmd run dev:fresh');
  process.exitCode = 1;
}

async function main() {
  let page;
  try {
    page = await getText(DASHBOARD_URL);
  } catch (error) {
    fail(`dev server is not reachable at ${DASHBOARD_URL} (${error.message})`);
    return;
  }

  if (page.statusCode !== 200) {
    fail(`dev server returned HTTP ${page.statusCode} for ${DASHBOARD_URL}`);
    return;
  }

  console.log('Dev health OK');
  console.log(`URL: ${DASHBOARD_URL}`);
  console.log('Dashboard data source: Firestore only');
}

main().catch((error) => {
  fail(error.message);
});
