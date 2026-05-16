'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Goal,
  MapPin,
  Settings,
  Star,
  Trophy,
  UserRound,
  XCircle,
} from 'lucide-react';

const DATA_URL = 'data/match_data.json';

const SPORTSBET_LEAGUE_SLUGS = {
  'Premier League': 'united-kingdom/english-premier-league',
  Championship: 'united-kingdom/english-championship',
  'League One': 'united-kingdom/english-league-one',
  'League Two': 'united-kingdom/english-league-two',
  LaLiga: 'spain/spanish-la-liga',
  Bundesliga: 'germany/german-bundesliga',
  'Ligue 1': 'france/french-ligue-1',
  Eredivisie: 'rest-of-europe/dutch-eredivisie',
  'UEFA Champions League': 'uefa-competitions/uefa-champions-league',
  MLS: 'north-america/usa-major-league-soccer',
};

const TAB_LEAGUE_NAMES = {
  'Premier League': 'English Premier League',
  Championship: 'English Championship',
  'League One': 'English League One',
  'League Two': 'English League Two',
  LaLiga: 'Spanish La Liga',
  Bundesliga: 'German Bundesliga',
  'Ligue 1': 'French Ligue 1',
  Eredivisie: 'Dutch Eredivisie',
  'UEFA Champions League': 'UEFA Champions League',
  MLS: 'US Major League Soccer',
};

const BOOKMAKERS = {
  sportsbet: {
    id: 'sportsbet',
    name: 'Sportsbet',
    entryUrl: 'https://www.sportsbet.com.au/betting/soccer',
    logoSrc: 'bookmakers/sportsbet.svg',
    buttonClass: 'border-[#0078be] bg-[#0078be] hover:border-[#0066a3] hover:bg-[#0066a3]',
  },
  bet365: {
    id: 'bet365',
    name: 'bet365',
    entryUrl: 'https://www.bet365.com.au/hub/en-au/sports-betting',
    logoSrc: 'bookmakers/bet365.svg',
    buttonClass: 'border-[#027b5b] bg-[#027b5b] hover:border-[#02694d] hover:bg-[#02694d]',
  },
  tab: {
    id: 'tab',
    name: 'TAB',
    entryUrl: 'https://www.tab.com.au/sports/betting/Soccer',
    logoSrc: 'bookmakers/tab.svg',
    buttonClass: 'border-[#004c4f] bg-[#004c4f] hover:border-[#003f42] hover:bg-[#003f42]',
  },
  ladbrokes: {
    id: 'ladbrokes',
    name: 'Ladbrokes',
    entryUrl: 'https://www.ladbrokes.com.au/sports/soccer',
    logoSrc: 'bookmakers/ladbrokes.svg',
    buttonClass: 'border-[#d71920] bg-[#d71920] hover:border-[#b9151b] hover:bg-[#b9151b]',
  },
  neds: {
    id: 'neds',
    name: 'Neds',
    entryUrl: 'https://www.neds.com.au/sports/soccer',
    logoSrc: 'bookmakers/neds.svg',
    buttonClass: 'border-[#ff5a00] bg-[#ff5a00] hover:border-[#d95a00] hover:bg-[#d95a00]',
  },
};

const BOOKMAKER_OPTIONS = Object.values(BOOKMAKERS);

function sportsbetSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sportsbetEventUrl(match) {
  if (match.sportsbet_odds?.event_url) return match.sportsbet_odds.event_url;
  const eventId = match.sportsbet_odds?.event_id;
  const leagueSlug = SPORTSBET_LEAGUE_SLUGS[match.league];
  if (!eventId || !leagueSlug) return null;
  const home = sportsbetSlug(match.home?.name);
  const away = sportsbetSlug((match.away?.name || '').replace(/\s+FC$/i, ''));
  if (!home || !away) return null;
  return `https://www.sportsbet.com.au/betting/soccer/${leagueSlug}/${home}-v-${away}-${eventId}`;
}

function bookmakerTeamName(value) {
  return String(value || '')
    .replace(/\s+FC$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bookmakerMatchQuery(match) {
  return [bookmakerTeamName(match.home?.name), bookmakerTeamName(match.away?.name)].filter(Boolean).join(' v ');
}

function tabMatchUrl(match) {
  const competition = TAB_LEAGUE_NAMES[match.league] || match.league;
  const query = bookmakerMatchQuery(match);
  if (!competition || !query) return null;
  return `https://www.tab.com.au/sports/betting/Soccer/competitions/${encodeURIComponent(
    competition,
  )}/matches/${encodeURIComponent(query)}`;
}

function bookmakerMatchSearchUrl(match, bookmakerId) {
  const query = encodeURIComponent(bookmakerMatchQuery(match));
  if (!query) return null;

  if (bookmakerId === 'tab') return `https://www.tab.com.au/sports/betting/Soccer?search=${query}`;
  if (bookmakerId === 'ladbrokes') return `https://www.ladbrokes.com.au/sports/soccer?search=${query}`;
  if (bookmakerId === 'neds') return `https://www.neds.com.au/sports/soccer?search=${query}`;
  if (bookmakerId === 'bet365') return `https://www.bet365.com.au/hub/en-au/sports-betting?search=${query}`;
  return null;
}

function bookmakerUrl(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const eventUrl =
    match.bookmaker_links?.[bookmaker.id] ||
    match.bookmaker_urls?.[bookmaker.id] ||
    match[`${bookmaker.id}_odds`]?.event_url;
  if (eventUrl) return eventUrl;
  if (bookmaker.id === 'sportsbet') return sportsbetEventUrl(match) || bookmaker.entryUrl;
  if (bookmaker.id === 'tab') return tabMatchUrl(match) || bookmaker.entryUrl;
  return bookmakerMatchSearchUrl(match, bookmaker.id) || bookmaker.entryUrl;
}

function hasDirectBookmakerMatchLink(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  return Boolean(
      match.bookmaker_links?.[bookmaker.id] ||
      match.bookmaker_urls?.[bookmaker.id] ||
      match[`${bookmaker.id}_odds`]?.event_url ||
      (bookmaker.id === 'sportsbet' && sportsbetEventUrl(match)) ||
      (bookmaker.id === 'tab' && tabMatchUrl(match)),
  );
}

function statusClass(status) {
  if (status === 'FT') return 'bg-signal/10 text-signal ring-signal/20';
  if (status === 'upcoming') return 'bg-blue-50 text-blue-700 ring-blue-200';
  return 'bg-warning/10 text-warning ring-warning/20';
}

function resultIcon(result) {
  if (result === 'hit') return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (result === 'miss') return <XCircle className="h-4 w-4 text-miss" aria-hidden="true" />;
  return <Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />;
}

function marketPillClass(result) {
  if (result === 'hit') return 'border-emerald-400 bg-emerald-100 shadow-panel';
  if (result === 'miss') return 'border-red-400 bg-red-100 shadow-panel';
  return 'border-slate-300 bg-white shadow-panel';
}

function marketValueClass(result) {
  if (result === 'hit') return 'text-emerald-700';
  if (result === 'miss') return 'text-red-700';
  return 'text-ink';
}

function streakCardClass(result) {
  if (result === 'hit') return 'border-emerald-400 bg-emerald-100 shadow-panel';
  if (result === 'miss') return 'border-red-400 bg-red-100 shadow-panel';
  return 'border-slate-300 bg-white shadow-panel';
}

function streakTextClass(result) {
  if (result === 'hit') return 'text-emerald-800';
  if (result === 'miss') return 'text-red-800';
  return 'text-ink';
}

function streakMetaClass(result) {
  if (result === 'hit') return 'text-emerald-700';
  if (result === 'miss') return 'text-red-700';
  return 'text-slate-600';
}

function teamNameForSide(side, match) {
  if (side === 'home') return match.home?.name || 'Home';
  if (side === 'away') return match.away?.name || 'Away';
  return 'both';
}

function teamNameForCopy(name) {
  return (name || '').replace(/^\d+\.\s+/, '');
}

function formatPlainNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatCopyNumber(value) {
  const number = Number(value);
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  if (Number.isInteger(number) && number >= 0 && number <= 10) return words[number];
  return formatPlainNumber(value);
}

function pointText(value) {
  return `${formatCopyNumber(value)} ${Number(value) === 1 ? 'point' : 'points'}`;
}

function displayTeamForStreak(streak, match) {
  const label = (streak.label || '').toLowerCase();
  const side =
    label.includes('first to score') && streak.team === 'both' && match.actuals?.first_to_score
      ? match.actuals.first_to_score
      : streak.team;

  return teamNameForSide(side, match);
}

function formatOdds(value) {
  return value ? Number(value).toFixed(2) : '-';
}

function formatOddsTotal(value) {
  return Number(value || 0).toFixed(2);
}

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
}

function fmtLambda(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value).toFixed(2);
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(0)}%`;
}

function fmtPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(2);
}

function impliedProbability(odds) {
  const value = Number(odds);
  return Number.isFinite(value) && value > 0 ? 1 / value : null;
}

function poissonMarketProbabilities(lh, la, rho = 0, line = 2.5) {
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  const pmf = (k, l) => Math.exp(-l) * Math.pow(l, k) / [1, 1, 2, 6, 24, 120, 720][k];
  const grid = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => pmf(i, lh) * pmf(j, la)));
  grid[0][0] *= 1 - lh * la * rho;
  grid[1][0] *= 1 + la * rho;
  grid[0][1] *= 1 + lh * rho;
  grid[1][1] *= 1 - rho;
  const total = grid.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0);
  if (total <= 0) return null;

  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let overGoals = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const p = grid[i][j] / total;
      if (i > j) home += p;
      else if (j > i) away += p;
      else draw += p;
      if (i > 0 && j > 0) bttsYes += p;
      if (i + j > line) overGoals += p;
    }
  }
  return { home, draw, away, bttsYes, overGoals };
}

function comparisonFromPrices({ title, modelProb, marketOdds, fallbackLabel = null }) {
  if (!Number.isFinite(modelProb)) {
    const marketPrice = fmtPrice(marketOdds);
    if (!marketPrice) return null;
    return {
      title,
      badge: { label: fallbackLabel || 'Trend pick', tone: 'neutral' },
      bookmaker: { odds: marketPrice, probability: impliedProbability(marketOdds) ? fmtPct(impliedProbability(marketOdds)) : '-' },
      model: { odds: fallbackLabel || 'Trend pick', probability: '-' },
      edgePoints: 0,
      modelEdge: 0,
      note: 'Streak-led pick; use the bookmaker price as context, not a fair-odds edge.',
    };
  }

  const modelPrice = fmtPrice(1 / modelProb);
  const marketPrice = fmtPrice(marketOdds);
  const marketProb = impliedProbability(marketOdds);
  if (!modelPrice || !marketPrice || !Number.isFinite(marketProb)) return null;

  const diff = modelProb - marketProb;
  const points = Math.abs(diff * 100).toFixed(0);
  const isClose = Math.abs(diff) < 0.02;
  const label = isClose ? 'Close to market' : diff > 0 ? `Model +${points}%` : `Bookmaker +${points}%`;
  const tone = isClose ? 'neutral' : diff > 0 ? 'positive' : 'warning';
  const note = isClose
    ? 'No clear edge; only bet if other markets agree.'
    : diff > 0
      ? 'Model sees value; price is better than our fair odds.'
      : 'No model edge; bookmaker price looks short.';
  return {
    title,
    badge: { label, tone },
    bookmaker: { odds: marketPrice, probability: fmtPct(marketProb) },
    model: { odds: modelPrice, probability: fmtPct(modelProb) },
    edgePoints: Math.abs(diff * 100),
    modelEdge: diff,
    note,
  };
}

function modelVsBookmakerComparison(match, marketKey, market) {
  if (!market) return null;
  const f = match.predictions?.factors || {};
  const lh = Number(f.lambda_home);
  const la = Number(f.lambda_away);
  const probs = poissonMarketProbabilities(lh, la, Number(f.dixon_coles_rho) || 0, Number(market.line ?? 2.5));

  if (marketKey === 'winner') {
    if (!market.type || market.type === 'draw' || !probs) return null;
    const odds = match.sportsbet_odds || match.odds || {};
    return comparisonFromPrices({
      title: 'Winner',
      modelProb: probs[market.type],
      marketOdds: Number(odds[market.type]),
    });
  }

  if (marketKey === 'btts' && probs) {
    const modelProb = market.pick === 'No' ? 1 - probs.bttsYes : probs.bttsYes;
    return comparisonFromPrices({ title: 'BTTS', modelProb, marketOdds: Number(market.odds) });
  }

  if (marketKey === 'ou_goals' && probs) {
    const modelProb = market.pick === 'Under' ? 1 - probs.overGoals : probs.overGoals;
    const line = market.line ?? 2.5;
    return comparisonFromPrices({ title: `${market.pick || 'Goals'} ${line} Goals`, modelProb, marketOdds: Number(market.odds) });
  }

  if (marketKey === 'ou_cards') {
    const line = market.line ?? 4.5;
    return comparisonFromPrices({
      title: `${market.pick || 'Cards'} ${line} Cards`,
      modelProb: NaN,
      marketOdds: Number(market.odds),
      fallbackLabel: 'Trend pick',
    });
  }

  return null;
}

function sameTeamId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function matchSortKey(match) {
  return `${match?.date || ''} ${match?.time || ''}`;
}

function teamGoalsInMatch(match, teamId) {
  if (sameTeamId(match.home?.team_id, teamId)) {
    return { scored: match.home?.goals, conceded: match.away?.goals, side: 'home' };
  }
  if (sameTeamId(match.away?.team_id, teamId)) {
    return { scored: match.away?.goals, conceded: match.home?.goals, side: 'away' };
  }
  return null;
}

function resultForTeam(scored, conceded) {
  if (scored > conceded) return 'W';
  if (scored < conceded) return 'L';
  return 'D';
}

function recentTeamForm(allMatches, teamId, currentMatchId, n = 5, options = {}) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      const goals = teamGoalsInMatch(m, teamId);
      if (!goals || typeof goals.scored !== 'number' || typeof goals.conceded !== 'number') return false;
      if (options.side && goals.side !== options.side) return false;
      if (options.venue && m.venue !== options.venue) return false;
      return true;
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, n);
  if (!played.length) return null;

  const summary = { count: played.length, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 };
  for (const m of played) {
    const goals = teamGoalsInMatch(m, teamId);
    summary.scored += goals.scored;
    summary.conceded += goals.conceded;
    const result = resultForTeam(goals.scored, goals.conceded);
    if (result === 'W') summary.wins += 1;
    else if (result === 'D') summary.draws += 1;
    else summary.losses += 1;
  }
  return {
    ...summary,
    avgScored: summary.scored / summary.count,
    avgConceded: summary.conceded / summary.count,
    goalDiff: summary.scored - summary.conceded,
    pointsPerMatch: (summary.wins * 3 + summary.draws) / summary.count,
  };
}

function formatFormRecord(form) {
  if (!form) return null;
  const gd = form.goalDiff > 0 ? `+${form.goalDiff}` : `${form.goalDiff}`;
  const winWord = form.wins === 1 ? 'win' : 'wins';
  const drawWord = form.draws === 1 ? 'draw' : 'draws';
  const lossWord = form.losses === 1 ? 'loss' : 'losses';
  return `${formatCopyNumber(form.wins)} ${winWord}, ${formatCopyNumber(form.draws)} ${drawWord}, ${formatCopyNumber(form.losses)} ${lossWord} with a ${gd} goal difference`;
}

function recentH2hSummary(allMatches, match, maxN = 10) {
  const homeId = match.home?.team_id;
  const awayId = match.away?.team_id;
  if (!homeId || !awayId || !Array.isArray(allMatches)) return null;
  const meetings = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === match.id) return false;
      const mh = m.home?.team_id;
      const ma = m.away?.team_id;
      const samePair =
        (sameTeamId(mh, homeId) && sameTeamId(ma, awayId)) ||
        (sameTeamId(mh, awayId) && sameTeamId(ma, homeId));
      return samePair && typeof m.home?.goals === 'number' && typeof m.away?.goals === 'number';
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, maxN);
  if (!meetings.length) return null;

  const summary = {
    count: meetings.length,
    homeWins: 0,
    awayWins: 0,
    draws: 0,
    homeGoals: 0,
    awayGoals: 0,
    atVenueCount: 0,
    atVenueHomeWins: 0,
    atVenueAwayWins: 0,
    atVenueDraws: 0,
    lastWinner: null,
  };

  for (const m of meetings) {
    const currentHomeWasHome = sameTeamId(m.home?.team_id, homeId);
    const currentHomeGoals = currentHomeWasHome ? m.home.goals : m.away.goals;
    const currentAwayGoals = currentHomeWasHome ? m.away.goals : m.home.goals;
    summary.homeGoals += currentHomeGoals;
    summary.awayGoals += currentAwayGoals;

    let winner = 'draw';
    if (currentHomeGoals > currentAwayGoals) {
      summary.homeWins += 1;
      winner = 'home';
    } else if (currentAwayGoals > currentHomeGoals) {
      summary.awayWins += 1;
      winner = 'away';
    } else {
      summary.draws += 1;
    }
    if (!summary.lastWinner) summary.lastWinner = winner;

    if (match.venue && m.venue === match.venue) {
      summary.atVenueCount += 1;
      if (winner === 'home') summary.atVenueHomeWins += 1;
      else if (winner === 'away') summary.atVenueAwayWins += 1;
      else summary.atVenueDraws += 1;
    }
  }

  return summary;
}

function h2hFactorSummary(match) {
  const f = match.predictions?.factors || {};
  const count = Number(f.h2h_n);
  if (!Number.isFinite(count) || count <= 0) return null;
  const homeWins = Number(f.h2h_home_wins);
  const awayWins = Number(f.h2h_away_wins);
  const draws = Number(f.h2h_draws);
  if (!Number.isFinite(homeWins) || !Number.isFinite(awayWins) || !Number.isFinite(draws)) return null;
  return {
    count,
    homeWins,
    awayWins,
    draws,
    homeGoals: Number(f.h2h_home_goals),
    awayGoals: Number(f.h2h_away_goals),
  };
}

function winnerRationale(match, allMatches) {
  const w = match.predictions?.winner;
  const f = match.predictions?.factors || {};
  if (!w) return null;
  const homeName = teamNameForCopy(match.home?.name || 'Home');
  const awayName = teamNameForCopy(match.away?.name || 'Away');
  const pickedName = w.type === 'away' ? awayName : w.type === 'draw' ? 'Draw' : homeName;
  const pickedTeamId = w.type === 'away' ? match.away?.team_id : w.type === 'home' ? match.home?.team_id : null;
  const otherTeamId = w.type === 'away' ? match.home?.team_id : w.type === 'home' ? match.away?.team_id : null;
  const priceComparison = modelVsBookmakerComparison(match, 'winner', w);
  const parts = [];

  if (w.type === 'home') {
    parts.push(`The model leans ${homeName} because it expects them to create more good chances than ${awayName}.`);
  } else if (w.type === 'away') {
    parts.push(`The model leans ${awayName} because it expects them to create more good chances than ${homeName}.`);
  } else {
    parts.push('The model sees this as tight, with both teams projected close on chances.');
  }
  const pickedOverall = recentTeamForm(allMatches, pickedTeamId, match.id, 10);
  const otherOverall = recentTeamForm(allMatches, otherTeamId, match.id, 10);
  if (pickedOverall && w.type !== 'draw') {
    const formLead = pickedOverall.pointsPerMatch >= (otherOverall?.pointsPerMatch ?? 0)
      ? 'Recent form is stronger'
      : 'Recent form is not the main edge';
    const otherPpm = otherOverall ? `; the opponent is at ${pointText(otherOverall.pointsPerMatch)} per game` : '';
    parts.push(`${formLead}: ${pointText(pickedOverall.pointsPerMatch)} per game over the last ${formatCopyNumber(pickedOverall.count)} matches${otherPpm}.`);
  }

  if (w.type === 'home') {
    const venueForm = recentTeamForm(allMatches, pickedTeamId, match.id, 10, { venue: match.venue });
    const homeForm = venueForm?.count >= 2 ? venueForm : recentTeamForm(allMatches, pickedTeamId, match.id, 10, { side: 'home' });
    if (homeForm) {
      const label = venueForm?.count >= 2 && match.venue ? 'at this ground' : 'at home';
      parts.push(`They have been solid ${label}: ${formatFormRecord(homeForm)} in the last ${formatCopyNumber(homeForm.count)} matches.`);
    }
  } else if (w.type === 'away') {
    const awayForm = recentTeamForm(allMatches, pickedTeamId, match.id, 10, { side: 'away' });
    if (awayForm) {
      parts.push(`Their away record backs the pick: ${formatFormRecord(awayForm)} in the last ${formatCopyNumber(awayForm.count)} matches.`);
    }
  }

  const h2h = recentH2hSummary(allMatches, match, 10) || h2hFactorSummary(match);
  if (h2h?.count) {
    const h2hWinner =
      h2h.homeWins > h2h.awayWins ? homeName :
      h2h.awayWins > h2h.homeWins ? awayName :
      'neither side';
    const h2hGoalText = Number.isFinite(h2h.homeGoals) && Number.isFinite(h2h.awayGoals)
      ? `, with goals ${h2h.homeGoals}-${h2h.awayGoals}`
      : '';
    const lastWinText = h2h.lastWinner && h2h.lastWinner !== 'draw'
      ? ` The most recent win went to ${h2h.lastWinner === 'home' ? homeName : awayName}.`
      : '';
    parts.push(`Head to head, ${h2hWinner} has had the better of the last ${h2h.count}: ${homeName} ${h2h.homeWins}, ${awayName} ${h2h.awayWins}, draws ${h2h.draws}${h2hGoalText}.${lastWinText}`);
    if (h2h.atVenueCount >= 2 && match.venue) {
      parts.push(`At this ground, the last ${h2h.atVenueCount} meetings are ${homeName} ${h2h.atVenueHomeWins}, ${awayName} ${h2h.atVenueAwayWins}, draws ${h2h.atVenueDraws}.`);
    }
  } else if (match.h2h_streaks?.length) {
    const trend = match.h2h_streaks.find((s) => ['wins', 'no losses', 'over 2.5 goals', 'both teams to score'].includes((s.label || '').toLowerCase()));
    if (trend) {
      const teamName = teamNameForSide(trend.team, match);
      parts.push(`The useful H2H clue is ${teamName} ${trend.label.toLowerCase()}${trend.value ? ` in ${trend.value}` : ''}.`);
    }
  }

  const hRank = f.h_rank ?? match.home?.rank;
  const aRank = f.a_rank ?? match.away?.rank;
  if (hRank && aRank) {
    const rankLeader = Number(hRank) < Number(aRank) ? homeName : Number(aRank) < Number(hRank) ? awayName : null;
    if (rankLeader) parts.push(`League position also points to ${rankLeader}: ${hRank} vs ${aRank}.`);
  }

  if (!priceComparison) {
    const odds = match.sportsbet_odds || match.odds || {};
    if (odds.home && odds.away) {
      const oh = Number(odds.home);
      const oa = Number(odds.away);
      if (Number.isFinite(oh) && Number.isFinite(oa)) {
        const favSide = oh < oa ? 'home' : 'away';
        const favName = favSide === 'home' ? homeName : awayName;
        if (favSide === w.type) {
          parts.push(`The bookmaker agrees, with ${favName} favoured at ${oh.toFixed(2)} vs ${oa.toFixed(2)}.`);
        } else if (w.type === 'draw') {
          parts.push(`The bookmaker leans ${favName}, so the draw pick is going against the market.`);
        } else {
          parts.push(`This goes against the bookmaker favourite, priced ${oh.toFixed(2)} vs ${oa.toFixed(2)}.`);
        }
      }
    }
  }

  if (!parts.length) return null;
  return parts.slice(0, 5).join(' ');
}

function bttsRationale(match) {
  const b = match.predictions?.btts;
  const f = match.predictions?.factors || {};
  if (!b) return null;
  const lh = Number(f.lambda_home);
  const la = Number(f.lambda_away);
  const parts = [];
  if (Number.isFinite(lh) && Number.isFinite(la)) {
    const pBoth = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
    parts.push(`${(pBoth * 100).toFixed(0)}% chance both teams score`);
  }
  const streakHints = (match.team_streaks || []).filter((s) => {
    const l = (s.label || '').toLowerCase();
    return l.includes('without clean sheet') || l.includes('no clean sheet') || l.includes('no goals') || l.includes('clean sheet');
  });
  if (streakHints.length) {
    const first = streakHints[0];
    const teamName = teamNameForCopy(teamNameForSide(first.team, match));
    parts.push(`${teamName} recent form: ${first.label}${first.value ? ` (${first.value})` : ''}`);
  }
  if (!parts.length) return null;
  return parts.join(' · ');
}

// Predictor (soccer_routine.py) uses a 7x7 Poisson grid and picks Over only when
// P(total >= 3) >= 0.55. Mirror that math here so the rationale matches the pick.
function poissonGoalsOverProb(lh, la, line = 2.5) {
  const pmf = (k, l) => Math.exp(-l) * Math.pow(l, k) / [1, 1, 2, 6, 24, 120, 720][k];
  let pUnder = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      if (i + j < Math.ceil(line)) pUnder += pmf(i, lh) * pmf(j, la);
    }
  }
  return 1 - pUnder;
}

function goalsRationale(match, allMatches) {
  const g = match.predictions?.ou_goals;
  const f = match.predictions?.factors || {};
  if (!g) return null;
  const lh = Number(f.lambda_home);
  const la = Number(f.lambda_away);
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  const line = g.line ?? 2.5;
  const pOver = poissonGoalsOverProb(lh, la, line);
  const pUnder = 1 - pOver;
  const pct = (pOver * 100).toFixed(0);
  const underPct = (pUnder * 100).toFixed(0);
  const total = (lh + la).toFixed(2);

  const homeForm = recentTeamForm(allMatches, match.home?.team_id, match.id);
  const awayForm = recentTeamForm(allMatches, match.away?.team_id, match.id);
  const formParts = [];
  if (homeForm) {
    formParts.push(
      `${teamNameForCopy(match.home?.name || 'Home')} scoring ${homeForm.avgScored.toFixed(1)}/conceding ${homeForm.avgConceded.toFixed(1)} per match over last ${homeForm.count}`,
    );
  }
  if (awayForm) {
    formParts.push(
      `${teamNameForCopy(match.away?.name || 'Away')} scoring ${awayForm.avgScored.toFixed(1)}/conceding ${awayForm.avgConceded.toFixed(1)} per match over last ${awayForm.count}`,
    );
  }

  const lead = g.pick === 'Over'
    ? `The model leans Over ${line}: ${pct}% chance of 3 or more goals, with ${total} expected goals.`
    : `The model leans Under ${line}: ${underPct}% chance the match stays below 3 goals, even though there is still a ${pct}% goal-risk. Expected total is ${total}.`;
  return formParts.length ? `${lead} · ${formParts.join(' · ')}` : lead;
}

function recentTeamCards(allMatches, teamId, currentMatchId, n = 5) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      if (m.home?.team_id !== teamId && m.away?.team_id !== teamId) return false;
      return typeof m.predictions?.ou_cards?.actual === 'number';
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, n);
  if (!played.length) return null;
  const total = played.reduce((sum, m) => sum + m.predictions.ou_cards.actual, 0);
  return { count: played.length, avg: total / played.length };
}

function cardsRationale(match, allMatches) {
  const c = match.predictions?.ou_cards;
  if (!c) return null;
  const homeCards = recentTeamCards(allMatches, match.home?.team_id, match.id);
  const awayCards = recentTeamCards(allMatches, match.away?.team_id, match.id);
  if (!homeCards && !awayCards) return null;
  const parts = [];
  if (homeCards) {
    parts.push(`${teamNameForCopy(match.home?.name || 'Home')} averaging ${homeCards.avg.toFixed(1)} cards per match over last ${homeCards.count}`);
  }
  if (awayCards) {
    parts.push(`${teamNameForCopy(match.away?.name || 'Away')} averaging ${awayCards.avg.toFixed(1)} cards per match over last ${awayCards.count}`);
  }
  return parts.join(' · ');
}

function localTodayDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDMY(iso) {
  if (!iso) return iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

// Pipeline writes `date` + `time` (HH:MM) as Adelaide-local. Convert back to a
// real UTC instant so we can display in the viewer's browser timezone.
function adelaideToLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(naive);
  const m = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const adlAsIfUtc = new Date(`${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:${m.second}Z`);
  const offsetMs = adlAsIfUtc.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

function matchDisplayDate(match) {
  if (!match?.date) return '-';
  if (match.time && /^\d{2}:\d{2}$/.test(match.time)) {
    const d = adelaideToLocal(match.date, match.time);
    if (d) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  }
  return formatDateDMY(match.date);
}

function matchDisplayTime(match) {
  if (!match?.time) return '-';
  if (!/^\d{2}:\d{2}$/.test(match.time)) return match.time;
  const d = adelaideToLocal(match.date, match.time);
  if (!d) return match.time;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function defaultMatchDate(dates, capturedAt) {
  if (!dates.length) return 'all';
  const today = capturedAt || localTodayDate();
  return dates.includes(today) ? today : dates.find((date) => date >= today) || dates[dates.length - 1];
}

function flattenMatches(data) {
  return (data?.leagues || []).flatMap((league) =>
    (league.matches || []).map((match) => ({
      ...match,
      league: league.name,
      leagueId: league.id,
    })),
  );
}

function groupMatchesByLeague(matches) {
  const grouped = new Map();

  matches.forEach((match) => {
    if (!grouped.has(match.league)) {
      grouped.set(match.league, {
        league: match.league,
        leagueId: match.leagueId,
        matches: [],
      });
    }

    grouped.get(match.league).matches.push(match);
  });

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      matches: group.matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    }))
    .sort((a, b) => {
      const firstMatchA = a.matches[0];
      const firstMatchB = b.matches[0];
      const dateCompare = `${firstMatchA?.date || ''} ${firstMatchA?.time || ''}`.localeCompare(
        `${firstMatchB?.date || ''} ${firstMatchB?.time || ''}`,
      );
      return dateCompare || a.league.localeCompare(b.league);
    });
}

function summarize(matches) {
  const total = matches.length;
  const finished = matches.filter((m) => m.status === 'FT').length;
  const upcoming = total - finished;
  const winnerResults = matches
    .map((m) => m.predictions?.winner?.result)
    .filter((value) => value === 'hit' || value === 'miss');
  const hits = winnerResults.filter((value) => value === 'hit').length;
  const accuracy = winnerResults.length ? Math.round((hits / winnerResults.length) * 100) : 0;
  const oddsTotals = matches.reduce(
    (totals, match) => {
      Object.values(match.predictions || {}).forEach((market) => {
        const odds = Number(market?.odds);
        if (!Number.isFinite(odds)) return;
        if (market.result === 'hit') totals.hit += odds;
        if (market.result === 'miss') totals.loss += odds;
      });
      return totals;
    },
    { hit: 0, loss: 0 },
  );

  return { total, finished, upcoming, accuracy, oddsTotals };
}

function getNumericLine(label) {
  const match = label.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function streakResultFor(streak, match) {
  if (match.status !== 'FT') return null;

  const label = (streak.label || '').toLowerCase();
  const team = streak.team || 'both';
  const actuals = match.actuals || {};
  const homeGoals = Number(match.home?.goals ?? 0);
  const awayGoals = Number(match.away?.goals ?? 0);
  const totalGoals = homeGoals + awayGoals;
  const draw = homeGoals === awayGoals;
  const line = getNumericLine(label);
  const cards = match.predictions?.ou_cards?.actual;
  const corners = actuals.corners_total;

  const teamWon =
    team === 'both'
      ? null
      : team === 'home'
        ? homeGoals > awayGoals
        : awayGoals > homeGoals;
  const teamLost =
    team === 'both'
      ? null
      : team === 'home'
        ? homeGoals < awayGoals
        : awayGoals < homeGoals;
  const teamScored =
    team === 'both'
      ? homeGoals > 0 && awayGoals > 0
      : team === 'home'
        ? homeGoals > 0
        : awayGoals > 0;
  const teamConceded =
    team === 'both'
      ? homeGoals > 0 && awayGoals > 0
      : team === 'home'
        ? awayGoals > 0
        : homeGoals > 0;

  if (label.includes('goal') && line !== null) {
    if (label.includes('over') || label.includes('more than')) return totalGoals > line ? 'hit' : 'miss';
    if (label.includes('under') || label.includes('less than')) return totalGoals < line ? 'hit' : 'miss';
  }
  if (label.includes('both teams')) return homeGoals > 0 && awayGoals > 0 ? 'hit' : 'miss';
  if (label.includes('cards') && line !== null && cards !== undefined) {
    if (label.includes('over') || label.includes('more than')) return cards > line ? 'hit' : 'miss';
    if (label.includes('under') || label.includes('less than')) return cards < line ? 'hit' : 'miss';
  }
  if (label.includes('corners') && line !== null && corners !== undefined) {
    if (label.includes('over') || label.includes('more than')) return corners > line ? 'hit' : 'miss';
    if (label.includes('under') || label.includes('less than')) return corners < line ? 'hit' : 'miss';
  }
  if (label.includes('first to score') && actuals.first_to_score) return actuals.first_to_score === team ? 'hit' : 'miss';
  if (label.includes('first to concede') && actuals.first_to_score) return actuals.first_to_score !== team ? 'hit' : 'miss';
  if (label.includes('first half winner') && actuals.ht_winner) return actuals.ht_winner === team ? 'hit' : 'miss';
  if (label.includes('first half loser') && actuals.ht_winner) return actuals.ht_winner !== team && actuals.ht_winner !== 'draw' ? 'hit' : 'miss';
  if (label === 'wins') return teamWon ? 'hit' : 'miss';
  if (label === 'losses') return teamLost ? 'hit' : 'miss';
  if (label === 'no losses') return !teamLost ? 'hit' : 'miss';
  if (label === 'no wins') return !teamWon ? 'hit' : 'miss';
  if (label === 'draws') return draw ? 'hit' : 'miss';
  if (label.includes('without clean sheet') || label.includes('no clean sheet')) return teamConceded ? 'hit' : 'miss';
  if (label.includes('clean sheet')) return !teamConceded ? 'hit' : 'miss';
  if (label.includes('no goals')) return !teamScored ? 'hit' : 'miss';

  return null;
}

function Stat({ icon: Icon, label, value, tone = 'text-ink' }) {
  return (
    <div className="min-w-0 border-b border-line bg-white px-3 py-3 sm:border-b-0 sm:border-r sm:px-4 last:border-r-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-slate-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-semibold sm:text-2xl ${tone}`}>{value}</div>
    </div>
  );
}

function MarketPill({ label, market, edgeBadge }) {
  if (!market) return null;
  const detail = formatMarketDetail(market);
  return (
    <div className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-2.5 py-2 sm:px-3 ${marketPillClass(market.result)}`}>
      <span className="shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className={`flex min-w-0 items-center gap-1 text-right text-sm font-semibold ${marketValueClass(market.result)}`}>
        {edgeBadge && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700">
            <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
            <span>{edgeBadge}</span>
          </span>
        )}
        {resultIcon(market.result)}
        <span className="truncate">{detail || '-'}</span>
      </span>
    </div>
  );
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-panel">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value ?? '-'}</div>
    </div>
  );
}

function BookmakerLink({ bookmakerId, href, label }) {
  if (!href) return null;
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-5 text-sm font-semibold shadow-panel transition sm:w-52 ${bookmaker.buttonClass}`}
      aria-label={`Open this market on ${bookmaker.name}`}
    >
      {bookmaker.logoSrc ? (
        <>
          <img src={bookmaker.logoSrc} alt="" className="h-8 w-auto max-w-36" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </a>
  );
}

function BookmakerSelect({ value, onChange, compact = false }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel ${
        compact ? 'h-10' : 'h-11'
      }`}
      aria-label="Bookmaker"
    >
      {BOOKMAKER_OPTIONS.map((bookmaker) => (
        <option key={bookmaker.id} value={bookmaker.id}>
          {bookmaker.name}
        </option>
      ))}
    </select>
  );
}

function SettingsView({ bookmakerId, onBookmakerChange, onBack }) {
  const selectedBookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;

  return (
    <main className="min-h-screen bg-field">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-start gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-slate-600 hover:bg-field"
            aria-label="Back to matches"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">Settings</h1>
            <p className="mt-1 text-sm text-slate-500">Choose the default bookmaker used across match cards.</p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-3 py-4 sm:px-5 sm:py-5">
        <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Default bookmaker</h2>
              <p className="mt-1 text-sm text-slate-500">Current choice: {selectedBookmaker.name}</p>
            </div>
            <BookmakerSelect value={selectedBookmaker.id} onChange={onBookmakerChange} />
          </div>

          <div className="mt-4 rounded-md border border-line bg-field p-3 text-sm text-slate-600">
            Sportsbet opens direct match pages when the Sportsbet event ID is available. Other bookmakers will open their soccer page unless their direct event URL is added to the match data.
          </div>
        </div>
      </section>
    </main>
  );
}

function PredictionDetail({ label, market }) {
  if (!market) return null;
  return (
    <div className={`rounded-md border px-3 py-2 ${marketPillClass(market.result)}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex items-center gap-1 text-sm font-semibold ${marketValueClass(market.result)}`}>
          {resultIcon(market.result)}
          {market.result || 'pending'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-ink">{formatMarketDetail(market)}</span>
        <span className="text-slate-600">Odds {formatOdds(market.odds)}</span>
        {'actual' in market && <span className="text-slate-600">Actual {market.actual}</span>}
      </div>
    </div>
  );
}

function comparisonBadgeClass(tone) {
  if (tone === 'positive') return 'border-emerald-600 bg-emerald-100 text-emerald-800';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function comparisonOddsText(value) {
  return /^\d/.test(String(value)) ? `${value} odds` : value;
}

function summaryRowClass(result) {
  if (result === 'hit') return 'border-l-4 border-l-emerald-500 bg-emerald-50/40';
  if (result === 'miss') return 'border-l-4 border-l-red-500 bg-red-50/40';
  return 'border-l-4 border-l-slate-400 bg-slate-100/70';
}

function ModelVsBookmakerComparison({ comparison }) {
  if (!comparison?.badge?.label) return null;
  const modelFavoured = comparison.badge.tone === 'positive';
  return (
    <div className="w-full rounded-md border border-slate-500 bg-white p-2 text-xs shadow-panel">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-500">{comparison.title}</span>
        <span className={`inline-flex min-w-24 shrink-0 items-center justify-center rounded-md border px-2 py-1 font-semibold leading-none ${comparisonBadgeClass(comparison.badge.tone)}`}>
          {comparison.badge.label}
        </span>
      </div>
      <div className="grid gap-1">
        <div className="grid grid-cols-[5.5rem_5.25rem_3.5rem] items-center gap-2 rounded px-1.5 py-1">
          <span className="text-slate-500">Bookmaker</span>
          <span className="text-right font-semibold text-ink">{comparisonOddsText(comparison.bookmaker.odds)}</span>
          <span className="text-right text-slate-500">{comparison.bookmaker.probability}</span>
        </div>
        <div className={`grid grid-cols-[5.5rem_5.25rem_3.5rem] items-center gap-2 rounded px-1.5 py-1 ${modelFavoured ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500' : ''}`}>
          <span className={modelFavoured ? 'font-semibold text-emerald-800' : 'text-slate-500'}>Model</span>
          <span className="text-right font-semibold text-ink">{comparisonOddsText(comparison.model.odds)}</span>
          <span className={modelFavoured ? 'text-right font-semibold text-emerald-800' : 'text-right text-slate-500'}>{comparison.model.probability}</span>
        </div>
        <div className={`rounded px-1.5 py-1 leading-5 ${modelFavoured ? 'bg-emerald-50 text-slate-800 ring-1 ring-emerald-400' : 'bg-white text-slate-600 ring-1 ring-slate-300'}`}>
          <span className="font-semibold text-slate-500">Bet note: </span>
          {comparison.note}
        </div>
      </div>
    </div>
  );
}

function StreakList({ title, streaks, match }) {
  if (!streaks?.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {streaks.map((streak, index) => {
          const result = streakResultFor(streak, match);
          const displayTeam = displayTeamForStreak(streak, match);
          return (
            <div key={`${title}-${streak.team}-${streak.label}-${index}`} className={`rounded-md border px-3 py-2 ${streakCardClass(result)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm font-semibold ${streakTextClass(result)}`}>{streak.label}</span>
                <span className={`max-w-[45%] truncate rounded bg-white px-2 py-0.5 text-xs font-semibold ${streakMetaClass(result)}`}>
                  {displayTeam}
                </span>
              </div>
              <div className={`mt-1 flex items-center justify-between gap-2 text-xs ${streakMetaClass(result)}`}>
                <span>{streak.value}</span>
                <span>Odds {formatOdds(streak.odds)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PredictionSummaryCard({ match, allMatches }) {
  const predictions = match.predictions || {};
  const winner = predictions.winner;
  const winnerComparison = modelVsBookmakerComparison(match, 'winner', winner);
  const bttsComparison = modelVsBookmakerComparison(match, 'btts', predictions.btts);
  const goalsComparison = modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const cardsComparison = modelVsBookmakerComparison(match, 'ou_cards', predictions.ou_cards);

  // Headline = one-line summary of every pick, so it doesn't duplicate the per-market bullets below.
  const headlineParts = [];
  if (winner?.pick) headlineParts.push(`${winner.pick} to win`);
  if (predictions.ou_goals?.pick) {
    const line = predictions.ou_goals.line ?? 2.5;
    headlineParts.push(`${predictions.ou_goals.pick} ${line} goals`);
  }
  if (predictions.btts?.pick) {
    headlineParts.push(predictions.btts.pick === 'Yes' ? 'both teams to score' : 'one team blanks');
  }
  if (predictions.ou_cards?.pick) {
    const line = predictions.ou_cards.line ?? 4.5;
    headlineParts.push(`${predictions.ou_cards.pick} ${line} cards`);
  }
  const headline = headlineParts.length ? `Picks: ${headlineParts.join(' / ')}.` : null;

  const lines = [
    { label: 'Winner', pick: winner ? formatMarketDetail(winner) : null, text: winnerRationale(match, allMatches), comparison: winnerComparison, result: winner?.result },
    { label: 'BTTS', pick: predictions.btts ? formatMarketDetail(predictions.btts) : null, text: bttsRationale(match), comparison: bttsComparison, result: predictions.btts?.result },
    { label: 'Goals', pick: predictions.ou_goals ? formatMarketDetail(predictions.ou_goals) : null, text: goalsRationale(match, allMatches), comparison: goalsComparison, result: predictions.ou_goals?.result },
    { label: 'Cards', pick: predictions.ou_cards ? formatMarketDetail(predictions.ou_cards) : null, text: cardsRationale(match, allMatches), comparison: cardsComparison, result: predictions.ou_cards?.result },
  ].filter((row) => row.pick && (row.text || row.comparison));

  if (!headlineParts.length && !lines.length) return null;

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-panel ring-1 ring-signal/20 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="text-base font-semibold leading-6 text-ink">Prediction summary</h3>
        {headlineParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            {headlineParts.map((part) => (
              <span
                key={part}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium leading-none text-slate-700"
              >
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {lines.map((row) => (
            <li key={row.label} className={`grid gap-3 rounded-md px-2 py-3 first:pt-3 last:pb-3 sm:grid-cols-[24rem_minmax(0,1fr)] sm:items-start ${summaryRowClass(row.result)}`}>
              <span className="min-w-0">
                <span className="grid min-h-6 grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {row.result && resultIcon(row.result)}
                    <span>{row.label}</span>
                  </span>
                  <span className="min-w-0 truncate font-semibold leading-5 text-ink">{row.pick}</span>
                </span>
                <span className="mt-2 block">
                  <ModelVsBookmakerComparison comparison={row.comparison} />
                </span>
              </span>
              <span className="min-w-0 leading-5 text-slate-600">
                {row.text}
                {row.result && (
                  <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${row.result === 'hit' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {row.result}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchDetailView({ match, onBack, allMatches, bookmakerId, onBookmakerChange }) {
  const predictions = match.predictions || {};
  const odds = match.sportsbet_odds || match.odds || {};
  const actuals = match.actuals || {};
  const selectedBookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const selectedBookmakerHref = bookmakerUrl(match, selectedBookmaker.id);
  const hasDirectBookmakerLink = hasDirectBookmakerMatchLink(match, selectedBookmaker.id);
  const bookmakerButtonLabel =
    selectedBookmaker.id === 'sportsbet'
      ? `${selectedBookmaker.name} odds ${formatOdds(odds.home)} / ${formatOdds(odds.draw)} / ${formatOdds(odds.away)}`
      : `${hasDirectBookmakerLink ? 'Open' : 'Find'} ${selectedBookmaker.name} match`;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onBack();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  return (
    <div className="min-h-screen bg-field">
      <div className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-start gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-slate-600 hover:bg-field"
            aria-label="Back to matches"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
              <span className="truncate">{match.league}</span>
              <span>{matchDisplayDate(match)}</span>
              <span>{matchDisplayTime(match)}</span>
              <span className={`rounded-full px-2 py-1 ring-1 ${statusClass(match.status)}`}>{match.status}</span>
            </div>
            <h2 className="mt-1.5 truncate text-base font-semibold text-ink sm:text-xl">
              {match.home?.name} vs {match.away?.name}
            </h2>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-3 text-left shadow-panel">
            <div className="truncate text-base font-semibold text-ink">{match.home?.name}</div>
            <div className="mt-1 text-xs text-slate-500">Rank {match.home?.rank ?? '-'} · {match.home?.pts ?? '-'} pts</div>
          </div>
          <div className="rounded-md bg-ink px-3 py-3 text-center text-base font-semibold text-white shadow-panel">
            {match.status === 'FT' ? `${match.home?.goals ?? '-'}-${match.away?.goals ?? '-'}` : 'vs'}
          </div>
          <div className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-3 text-right shadow-panel">
            <div className="truncate text-base font-semibold text-ink">{match.away?.name}</div>
            <div className="mt-1 text-xs text-slate-500">Rank {match.away?.rank ?? '-'} · {match.away?.pts ?? '-'} pts</div>
          </div>
        </div>

        {selectedBookmakerHref && (
          <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <BookmakerSelect value={selectedBookmaker.id} onChange={onBookmakerChange} />
            <BookmakerLink bookmakerId={selectedBookmaker.id} href={selectedBookmakerHref} label={bookmakerButtonLabel} />
          </div>
        )}

        {(match.venue || match.referee) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {match.venue && (
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-panel">
                <MapPin className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span className="min-w-0 truncate">{match.venue}</span>
              </div>
            )}
            {match.referee && (
              <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-panel">
                <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {match.referee.name} · YC {match.referee.avg_yellow ?? '-'} · RC {match.referee.avg_red ?? '-'}
                </span>
              </div>
            )}
          </div>
        )}

        <PredictionSummaryCard match={match} allMatches={allMatches} />

        {Object.keys(actuals).length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Actuals
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <DetailStat label="Corners" value={actuals.corners_total} />
              <DetailStat label="Fouls" value={actuals.fouls_total} />
              <DetailStat label="Shots on target" value={`${actuals.home_sot ?? '-'}-${actuals.away_sot ?? '-'}`} />
              <DetailStat label="Half time" value={`${actuals.ht_home ?? '-'}-${actuals.ht_away ?? '-'}`} />
            </div>
          </div>
        )}

        <StreakList title="Team streaks" streaks={match.team_streaks} match={match} />
        <StreakList title="Head to head streaks" streaks={match.h2h_streaks} match={match} />
      </div>
    </div>
  );
}

function MatchCard({ match, onSelect, bookmakerId }) {
  const predictions = match.predictions || {};
  const odds = match.sportsbet_odds || match.odds || {};
  const actuals = match.actuals || {};
  const selectedBookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const hasDirectBookmakerLink = hasDirectBookmakerMatchLink(match, selectedBookmaker.id);
  const winnerComparison = modelVsBookmakerComparison(match, 'winner', predictions.winner);
  const bttsComparison = modelVsBookmakerComparison(match, 'btts', predictions.btts);
  const goalsComparison = modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const cardsComparison = modelVsBookmakerComparison(match, 'ou_cards', predictions.ou_cards);
  const edgeBadgeFor = (comparison) =>
    comparison?.badge?.tone === 'positive' && comparison.edgePoints > 0 ? comparison.badge.label : null;

  return (
    <article className="rounded-lg border border-line bg-white shadow-panel transition active:scale-[0.99] sm:hover:-translate-y-0.5 sm:hover:border-slate-300 sm:hover:shadow-lg">
      <button
        type="button"
        onClick={() => onSelect(match)}
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        aria-label={`View details for ${match.home?.name} vs ${match.away?.name}`}
      >
      <div className="border-b border-line px-3 py-3 sm:px-4">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-sm text-slate-600">
          <span className="flex min-w-0 items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{matchDisplayDate(match)}</span>
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{matchDisplayTime(match)}</span>
          </span>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(match.status)}`}>
            {match.status}
          </span>
        </div>
      </div>

      <div className="px-3 py-3 sm:px-4 sm:py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
          <div className="min-w-0 text-left">
            <div className="truncate text-sm font-semibold text-ink sm:text-base">{match.home?.name}</div>
            <div className="mt-1 text-xs text-slate-500">Home</div>
          </div>
          <div className="rounded-md bg-ink px-2 py-2 text-center text-sm font-semibold text-white">
            {match.status === 'FT' ? `${match.home?.goals ?? '-'}-${match.away?.goals ?? '-'}` : 'vs'}
          </div>
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold text-ink sm:text-base">{match.away?.name}</div>
            <div className="mt-1 text-xs text-slate-500">Away</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <MarketPill label="Winner" market={predictions.winner} edgeBadge={edgeBadgeFor(winnerComparison)} />
          <MarketPill label="BTTS" market={predictions.btts} edgeBadge={edgeBadgeFor(bttsComparison)} />
          <MarketPill label="Goals" market={predictions.ou_goals} edgeBadge={edgeBadgeFor(goalsComparison)} />
          <MarketPill label="Cards" market={predictions.ou_cards} edgeBadge={edgeBadgeFor(cardsComparison)} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-md bg-field p-2 text-center sm:gap-2">
          <div>
            <div className="text-xs text-slate-500">Home</div>
            <div className="text-sm font-semibold sm:text-base">{formatOdds(odds.home)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Draw</div>
            <div className="text-sm font-semibold sm:text-base">{formatOdds(odds.draw)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Away</div>
            <div className="text-sm font-semibold sm:text-base">{formatOdds(odds.away)}</div>
          </div>
        </div>

        <div className="mt-3 flex justify-center">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${hasDirectBookmakerLink ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {selectedBookmaker.name}
          </span>
        </div>

        {match.status === 'FT' && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
            {'corners_total' in actuals && <span className="rounded bg-field px-2 py-1">Corners {actuals.corners_total}</span>}
            {'fouls_total' in actuals && <span className="rounded bg-field px-2 py-1">Fouls {actuals.fouls_total}</span>}
            {'first_scorer' in actuals && <span className="rounded bg-field px-2 py-1">First scorer {actuals.first_scorer}</span>}
          </div>
        )}
      </div>
      </button>
    </article>
  );
}

function LeagueSection({ group, onSelectMatch, bookmakerId }) {
  const finished = group.matches.filter((match) => match.status === 'FT').length;
  const upcoming = group.matches.length - finished;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-2 border-b border-line bg-ink px-3 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Trophy className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h2 className="truncate text-base font-semibold sm:text-lg">{group.league}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-white/12 px-2.5 py-1">{group.matches.length} matches</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{upcoming} upcoming</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{finished} finished</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 bg-field p-2 sm:gap-4 sm:p-4 lg:grid-cols-2">
        {group.matches.map((match) => (
          <MatchCard key={`${match.league}-${match.id}`} match={match} onSelect={onSelectMatch} bookmakerId={bookmakerId} />
        ))}
      </div>
    </section>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchParam = searchParams.get('match');
  const isSettingsView = searchParams.get('view') === 'settings';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [league, setLeague] = useState('all');
  const [status, setStatus] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [query, setQuery] = useState('');
  const [bookmakerId, setBookmakerId] = useState('sportsbet');

  const scrollPositionRef = useRef(0);
  const swipeStartRef = useRef(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
        return response.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem('preferredBookmaker');
    if (saved && BOOKMAKERS[saved]) setBookmakerId(saved);
  }, []);

  const handleBookmakerChange = useCallback((nextBookmakerId) => {
    const safeBookmakerId = BOOKMAKERS[nextBookmakerId] ? nextBookmakerId : 'sportsbet';
    setBookmakerId(safeBookmakerId);
    window.localStorage.setItem('preferredBookmaker', safeBookmakerId);
  }, []);

  const matches = useMemo(() => flattenMatches(data), [data]);
  const leagues = useMemo(() => [...new Set(matches.map((match) => match.league))], [matches]);
  const dates = useMemo(
    () => [...new Set(matches.map((match) => match.date).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [matches],
  );
  const stats = useMemo(() => summarize(matches), [matches]);
  const selectedDateIndex = dates.indexOf(selectedDate);

  useEffect(() => {
    if (selectedDate || !dates.length) return;
    setSelectedDate(defaultMatchDate(dates, data?.captured_at));
  }, [data?.captured_at, dates, selectedDate]);

  const [slideDir, setSlideDir] = useState(0);
  const moveDate = useCallback(
    (direction) => {
      if (!dates.length) return;
      setSlideDir(direction > 0 ? 1 : -1);

      if (selectedDateIndex === -1) {
        setSelectedDate(direction > 0 ? dates[0] : dates[dates.length - 1]);
        return;
      }

      const nextIndex = Math.min(Math.max(selectedDateIndex + direction, 0), dates.length - 1);
      setSelectedDate(dates[nextIndex]);
    },
    [dates, selectedDateIndex],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return matches
      .filter((match) => (league === 'all' ? true : match.league === league))
      .filter((match) => (!selectedDate || selectedDate === 'all' ? true : match.date === selectedDate))
      .filter((match) => {
        if (status === 'all') return true;
        if (status === 'FT') return match.status === 'FT';
        return match.status !== 'FT';
      })
      .filter((match) => {
        if (!normalized) return true;
        return `${match.home?.name || ''} ${match.away?.name || ''} ${match.league}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }, [league, matches, query, selectedDate, status]);
  const groupedMatches = useMemo(() => groupMatchesByLeague(filtered), [filtered]);

  // Look up the selected match across the entire dataset so detail view works
  // even when the current filters would exclude it.
  const selectedMatch = useMemo(() => {
    if (!matchParam) return null;
    return matches.find((m) => String(m.id) === String(matchParam)) || null;
  }, [matchParam, matches]);

  const handleSelectMatch = useCallback(
    (match) => {
      scrollPositionRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
      const params = new URLSearchParams(searchParams.toString());
      params.delete('view');
      params.set('match', String(match.id));
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const openSettings = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('match');
    params.set('view', 'settings');
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const closeSettings = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    const next = params.toString();
    router.push(next ? `?${next}` : '/', { scroll: false });
  }, [router, searchParams]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // Restore scroll position when returning to the list view.
  useEffect(() => {
    if (matchParam) {
      // Detail view: scroll to top so user starts at the header.
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
      return;
    }
    if (scrollPositionRef.current > 0 && typeof window !== 'undefined') {
      const y = scrollPositionRef.current;
      // Defer so the DOM is laid out before scroll restore.
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [matchParam]);

  // Swipe handlers — bound to the list wrapper only.
  const onTouchStart = useCallback((event) => {
    if (event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, []);

  const onTouchMove = useCallback(() => {
    // Intentionally empty — never preventDefault, so vertical scrolling stays smooth.
  }, []);

  const onTouchEnd = useCallback(
    (event) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const dt = Date.now() - start.time;
      if (dt > 600) return;
      if (Math.abs(dy) > 30) return;
      if (Math.abs(dx) < 50) return;
      // Swipe left (dx < 0) → next date; swipe right (dx > 0) → previous date.
      moveDate(dx < 0 ? 1 : -1);
    },
    [moveDate],
  );

  if (selectedMatch) {
    return (
      <MatchDetailView
        match={selectedMatch}
        onBack={handleBack}
        allMatches={matches}
        bookmakerId={bookmakerId}
        onBookmakerChange={handleBookmakerChange}
      />
    );
  }

  if (isSettingsView) {
    return <SettingsView bookmakerId={bookmakerId} onBookmakerChange={handleBookmakerChange} onBack={closeSettings} />;
  }

  return (
    <main className="min-h-screen bg-field">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">Lonny&apos;s Predictions</h1>
            <p className="mt-1 text-sm text-slate-500">
              Stats-led football picks across Europe&apos;s top leagues — refreshed every few hours.
            </p>
            {data?.captured_at && (
              <p className="mt-0.5 text-xs text-slate-400">
                Last updated {formatDateDMY(data.captured_at)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openSettings}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field sm:w-auto"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
          </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-2 py-3 sm:px-6 sm:py-5 lg:px-8">
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="grid grid-cols-2 sm:grid-cols-5">
            <Stat icon={Activity} label="Matches" value={stats.total} />
            <Stat icon={CheckCircle2} label="Finished" value={stats.finished} tone="text-signal" />
            <Stat icon={Clock3} label="Upcoming" value={stats.upcoming} tone="text-blue-700" />
            <Stat icon={Goal} label="Winner Hit Rate" value={`${stats.accuracy}%`} />
            <Stat
              icon={BarChart3}
              label="Odds Hit / Loss"
              value={
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-signal">{formatOddsTotal(stats.oddsTotals?.hit)}</span>
                  <span className="text-sm font-semibold text-slate-400">v</span>
                  <span className="text-miss">{formatOddsTotal(stats.oddsTotals?.loss)}</span>
                </span>
              }
            />
          </div>
        </div>

        <div className="mt-3 grid gap-2 rounded-lg border border-line bg-white p-3 sm:mt-5 sm:grid-cols-[auto_12rem_10rem_16rem_minmax(0,1fr)] sm:items-center sm:gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filters
          </div>
          <select
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm sm:h-10"
            aria-label="League"
          >
            <option value="all">All leagues</option>
            {leagues.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm sm:h-10"
            aria-label="Status"
          >
            <option value="upcoming">Upcoming</option>
            <option value="FT">Finished</option>
            <option value="all">All statuses</option>
          </select>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => moveDate(-1)}
              disabled={!dates.length || selectedDateIndex === 0}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
              aria-label="Previous match date"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <select
              value={selectedDate || 'all'}
              onChange={(event) => { setSlideDir(0); setSelectedDate(event.target.value); }}
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm sm:h-10"
              aria-label="Match date"
            >
              <option value="all">All dates</option>
              {dates.map((date) => (
                <option key={date} value={date}>
                  {formatDateDMY(date)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => moveDate(1)}
              disabled={!dates.length || selectedDateIndex === dates.length - 1}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
              aria-label="Next match date"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams or league"
            className="h-11 min-w-0 rounded-md border border-line bg-white px-3 text-sm sm:h-10"
          />
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-miss/20 bg-miss/10 p-4 text-sm text-miss">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div
          className="mt-3 sm:mt-5"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div
            key={`${selectedDate || 'all'}-${slideDir}`}
            className={`space-y-4 sm:space-y-5 ${slideDir > 0 ? 'date-slide-next' : slideDir < 0 ? 'date-slide-prev' : ''}`}
          >
          {groupedMatches.map((group) => (
            <LeagueSection
              key={group.leagueId || group.league}
              group={group}
              onSelectMatch={handleSelectMatch}
              bookmakerId={bookmakerId}
            />
          ))}

          {!error && filtered.length === 0 && (
            <div className="rounded-lg border border-line bg-white p-8 text-center text-sm text-slate-500">
              No matches found for the selected filters.
            </div>
          )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-field" />}>
      <HomeInner />
    </Suspense>
  );
}
