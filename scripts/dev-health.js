const http = require('node:http');

const BASE_URL = process.env.SOCCER_STATS_DEV_URL || 'http://localhost:3001';
const DATA_URL = `${BASE_URL}/data/match_data.json?health=${Date.now()}`;

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
    page = await getText(BASE_URL);
  } catch (error) {
    fail(`dev server is not reachable at ${BASE_URL} (${error.message})`);
    return;
  }

  if (page.statusCode !== 200) {
    fail(`dev server returned HTTP ${page.statusCode} for ${BASE_URL}`);
    return;
  }

  let dataResponse;
  try {
    dataResponse = await getText(DATA_URL);
  } catch (error) {
    fail(`data endpoint is not reachable (${error.message})`);
    return;
  }

  if (dataResponse.statusCode !== 200) {
    fail(`data endpoint returned HTTP ${dataResponse.statusCode}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(dataResponse.body);
  } catch (error) {
    fail(`data endpoint did not return valid JSON (${error.message})`);
    return;
  }

  const leagues = Array.isArray(data.leagues) ? data.leagues : [];
  const matchCount = leagues.reduce((total, league) => total + (Array.isArray(league.matches) ? league.matches.length : 0), 0);
  const firstLeague = leagues[0]?.name || 'none';

  if (!leagues.length || !matchCount) {
    fail(`data loaded but contains ${leagues.length} leagues and ${matchCount} matches`);
    return;
  }

  console.log('Dev health OK');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Leagues: ${leagues.length}`);
  console.log(`Matches: ${matchCount}`);
  console.log(`First data league: ${firstLeague}`);
  console.log(`Captured at: ${data.captured_at || 'unknown'}`);
}

main().catch((error) => {
  fail(error.message);
});
