const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'match_data.json');
const pagePath = path.join(root, 'app', 'dashboard', 'page.jsx');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sameTeamId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function oppositeSide(side) {
  if (side === 'home') return 'away';
  if (side === 'away') return 'home';
  return null;
}

function h2hWinnerTrendBias(trend) {
  const team = trend && trend.team;
  if (team !== 'home' && team !== 'away') return null;

  const label = String(trend.label || '').toLowerCase();
  if (label === 'wins' || label === 'no losses') return team;
  if (label === 'losses' || label === 'no wins') return oppositeSide(team);
  return null;
}

function flattenMatches(data) {
  return (data.leagues || []).flatMap((league) =>
    (league.matches || []).map((match) => ({
      ...match,
      league: league.name,
    })),
  );
}

function teamNameForSide(match, side) {
  if (side === 'home') return match.home && match.home.name ? match.home.name : 'Home';
  if (side === 'away') return match.away && match.away.name ? match.away.name : 'Away';
  if (side === 'draw') return 'Draw';
  return 'Unknown';
}

function normalizeTeamName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(left, right) {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function winnerPickNameIssue(match) {
  const winner = match.predictions && match.predictions.winner;
  if (!winner) return null;

  const expected = teamNameForSide(match, winner.type);
  if (winner.type === 'draw') {
    return String(winner.pick || '').toLowerCase() === 'draw'
      ? null
      : `winner pick "${winner.pick}" has type draw`;
  }

  if (winner.type !== 'home' && winner.type !== 'away') {
    return `winner has unsupported type "${winner.type}"`;
  }

  return sameTeamId(winner.type === 'home' ? match.home && match.home.team_id : match.away && match.away.team_id, winner.team_id) ||
    namesMatch(winner.pick, expected)
    ? null
    : `winner pick "${winner.pick}" does not match ${winner.type} team "${expected}"`;
}

function marketPickIssue(match, key, allowed) {
  const market = match.predictions && match.predictions[key];
  if (!market || !market.pick) return null;
  return allowed.includes(market.pick) ? null : `${key} has unsupported pick "${market.pick}"`;
}

function rankSignal(match) {
  const winner = match.predictions && match.predictions.winner;
  if (!winner || winner.type === 'draw') return null;
  const factors = (match.predictions && match.predictions.factors) || {};
  const hRank = Number(factors.h_rank || (match.home && match.home.rank));
  const aRank = Number(factors.a_rank || (match.away && match.away.rank));
  if (!Number.isFinite(hRank) || !Number.isFinite(aRank) || hRank === aRank) return null;
  const leader = hRank < aRank ? 'home' : 'away';
  return leader === winner.type ? 'supports' : 'caution';
}

function h2hSignal(match) {
  const winner = match.predictions && match.predictions.winner;
  if (!winner || winner.type === 'draw') return null;
  const trend = (match.h2h_streaks || []).find((item) => h2hWinnerTrendBias(item));
  if (!trend) return null;
  return h2hWinnerTrendBias(trend) === winner.type ? 'supports' : 'caution';
}

function sourceCopyIssue(source) {
  const checks = [
    {
      label: 'old H2H support-only copy',
      ok: !source.includes('The useful H2H clue is'),
    },
    {
      label: 'old unconditional away-record backing copy',
      ok: !source.includes('Their away record backs the pick'),
    },
    {
      label: 'old unconditional solid-home copy',
      ok: !source.includes('They have been solid'),
    },
    {
      label: 'BTTS No branch',
      ok: source.includes("b.pick === 'No'") && source.includes('chance at least one team blanks'),
    },
    {
      label: 'rank caution branch',
      ok: source.includes('League position is a caution'),
    },
    {
      label: 'H2H caution branch',
      ok: source.includes('The H2H caution is') || source.includes('Head to head is a caution'),
    },
  ];

  return checks.filter((check) => !check.ok).map((check) => check.label);
}

const data = readJson(dataPath);
const source = fs.readFileSync(pagePath, 'utf8');
const matches = flattenMatches(data);

const issues = [];
const signalCounts = {
  winnerRows: 0,
  h2hSupports: 0,
  h2hCautions: 0,
  rankSupports: 0,
  rankCautions: 0,
};

for (const match of matches) {
  const winner = match.predictions && match.predictions.winner;
  if (winner) signalCounts.winnerRows += 1;

  const winnerIssue = winnerPickNameIssue(match);
  if (winnerIssue) issues.push({ id: match.id, market: 'winner', issue: winnerIssue });

  for (const [key, allowed] of [
    ['btts', ['Yes', 'No']],
    ['ou_goals', ['Over', 'Under']],
    ['ou_cards', ['Over', 'Under']],
  ]) {
    const issue = marketPickIssue(match, key, allowed);
    if (issue) issues.push({ id: match.id, market: key, issue });
  }

  const h2h = h2hSignal(match);
  if (h2h === 'supports') signalCounts.h2hSupports += 1;
  if (h2h === 'caution') signalCounts.h2hCautions += 1;

  const rank = rankSignal(match);
  if (rank === 'supports') signalCounts.rankSupports += 1;
  if (rank === 'caution') signalCounts.rankCautions += 1;
}

for (const issue of sourceCopyIssue(source)) {
  issues.push({ id: 'app/page.jsx', market: 'summary-copy', issue });
}

console.log(JSON.stringify({
  captured_at: data.captured_at,
  totalMatches: matches.length,
  signalCounts,
  issueCount: issues.length,
  issues: issues.slice(0, 50),
}, null, 2));

if (issues.length) {
  process.exitCode = 1;
}
