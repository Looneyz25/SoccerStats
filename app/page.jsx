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
  Shield,
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

function bookmakerUrl(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const eventUrl =
    match.bookmaker_links?.[bookmaker.id] ||
    match.bookmaker_urls?.[bookmaker.id] ||
    match[`${bookmaker.id}_odds`]?.event_url;
  if (eventUrl) return eventUrl;
  if (bookmaker.id === 'sportsbet') return sportsbetEventUrl(match) || bookmaker.entryUrl;
  return bookmaker.entryUrl;
}

function hasDirectBookmakerMatchLink(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  return Boolean(
    match.bookmaker_links?.[bookmaker.id] ||
      match.bookmaker_urls?.[bookmaker.id] ||
      match[`${bookmaker.id}_odds`]?.event_url ||
      (bookmaker.id === 'sportsbet' && sportsbetEventUrl(match)),
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

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
}

function fmtLambda(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value).toFixed(2);
}

function winnerRationale(match) {
  const w = match.predictions?.winner;
  const f = match.predictions?.factors || {};
  if (!w) return null;
  const lh = fmtLambda(f.lambda_home);
  const la = fmtLambda(f.lambda_away);
  const homeName = match.home?.name || 'Home';
  const awayName = match.away?.name || 'Away';
  const parts = [];

  if (lh && la) {
    if (w.type === 'home') {
      parts.push(`${homeName} expected to outscore ${awayName} (${lh} to ${la} goals)`);
    } else if (w.type === 'away') {
      parts.push(`${awayName} expected to outscore ${homeName} (${la} to ${lh} goals)`);
    } else {
      parts.push(`Both teams projected close (${lh} to ${la} goals)`);
    }
  }

  const hRank = f.h_rank ?? match.home?.rank;
  const aRank = f.a_rank ?? match.away?.rank;
  if (hRank && aRank) {
    parts.push(`league rank ${hRank} vs ${aRank}`);
  }

  const odds = match.sportsbet_odds || match.odds || {};
  if (odds.home && odds.away) {
    const oh = Number(odds.home);
    const oa = Number(odds.away);
    if (Number.isFinite(oh) && Number.isFinite(oa)) {
      const favSide = oh < oa ? 'home' : 'away';
      const favName = favSide === 'home' ? homeName : awayName;
      if (favSide === w.type) {
        parts.push(`bookmaker agrees, ${favName} favoured (${oh.toFixed(2)} / ${oa.toFixed(2)})`);
      } else if (w.type === 'draw') {
        parts.push(`bookmaker favours ${favName} (${oh.toFixed(2)} / ${oa.toFixed(2)})`);
      } else {
        parts.push(`going against the bookmaker favourite (${oh.toFixed(2)} / ${oa.toFixed(2)})`);
      }
    }
  }

  if (!parts.length) return null;
  return parts.join(' · ');
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
    const teamName = teamNameForSide(first.team, match);
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

function recentTeamForm(allMatches, teamId, currentMatchId, n = 5) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT') return false;
      if (m.id === currentMatchId) return false;
      const hid = m.home?.team_id;
      const aid = m.away?.team_id;
      if (hid !== teamId && aid !== teamId) return false;
      const hg = m.home?.goals;
      const ag = m.away?.goals;
      return typeof hg === 'number' && typeof ag === 'number';
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, n);
  if (!played.length) return null;
  let scored = 0;
  let conceded = 0;
  for (const m of played) {
    if (m.home?.team_id === teamId) {
      scored += m.home.goals;
      conceded += m.away.goals;
    } else {
      scored += m.away.goals;
      conceded += m.home.goals;
    }
  }
  return {
    count: played.length,
    avgScored: scored / played.length,
    avgConceded: conceded / played.length,
  };
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
  const pct = (pOver * 100).toFixed(0);
  const total = (lh + la).toFixed(2);

  const homeForm = recentTeamForm(allMatches, match.home?.team_id, match.id);
  const awayForm = recentTeamForm(allMatches, match.away?.team_id, match.id);
  const formParts = [];
  if (homeForm) {
    formParts.push(
      `${match.home?.name || 'Home'} scoring ${homeForm.avgScored.toFixed(1)}/conceding ${homeForm.avgConceded.toFixed(1)} per match over last ${homeForm.count}`,
    );
  }
  if (awayForm) {
    formParts.push(
      `${match.away?.name || 'Away'} scoring ${awayForm.avgScored.toFixed(1)}/conceding ${awayForm.avgConceded.toFixed(1)} per match over last ${awayForm.count}`,
    );
  }

  const lead = g.pick === 'Over'
    ? `${pct}% chance of 3 or more goals — model picks Over (expected total ${total})`
    : `${pct}% chance of 3 or more goals — not high enough for Over, so Under (expected total ${total})`;
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
    parts.push(`${match.home?.name || 'Home'} averaging ${homeCards.avg.toFixed(1)} cards per match over last ${homeCards.count}`);
  }
  if (awayCards) {
    parts.push(`${match.away?.name || 'Away'} averaging ${awayCards.avg.toFixed(1)} cards per match over last ${awayCards.count}`);
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
  const sportsbet = matches.filter((m) => m.sportsbet_odds).length;
  return { total, finished, upcoming, accuracy, sportsbet };
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

function MarketPill({ label, market }) {
  if (!market) return null;
  const detail = formatMarketDetail(market);
  return (
    <div className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-2.5 py-2 sm:px-3 ${marketPillClass(market.result)}`}>
      <span className="shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className={`flex min-w-0 items-center gap-1 text-right text-sm font-semibold ${marketValueClass(market.result)}`}>
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
  const headline = headlineParts.length ? `Picks: ${headlineParts.join(' · ')}.` : null;

  const lines = [
    { label: 'Winner', pick: winner ? formatMarketDetail(winner) : null, text: winnerRationale(match) },
    { label: 'BTTS', pick: predictions.btts ? formatMarketDetail(predictions.btts) : null, text: bttsRationale(match) },
    { label: 'Goals', pick: predictions.ou_goals ? formatMarketDetail(predictions.ou_goals) : null, text: goalsRationale(match, allMatches) },
    { label: 'Cards', pick: predictions.ou_cards ? formatMarketDetail(predictions.ou_cards) : null, text: cardsRationale(match, allMatches) },
  ].filter((row) => row.pick && row.text);

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
            <li key={row.label} className="grid gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[7rem_8.5rem_minmax(0,1fr)] sm:items-start">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</span>
              <span className="font-semibold leading-5 text-ink">{row.pick}</span>
              <span className="min-w-0 leading-5 text-slate-600">{row.text}</span>
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
  const bookmakerButtonLabel =
    selectedBookmaker.id === 'sportsbet'
      ? `${selectedBookmaker.name} odds ${formatOdds(odds.home)} / ${formatOdds(odds.draw)} / ${formatOdds(odds.away)}`
      : `Open ${selectedBookmaker.name} soccer`;

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

        <div>
          <h3 className="text-sm font-semibold text-ink">Predictions</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <PredictionDetail label="Winner" market={predictions.winner} />
            <PredictionDetail label="BTTS" market={predictions.btts} />
            <PredictionDetail label="Goals" market={predictions.ou_goals} />
            <PredictionDetail label="Cards" market={predictions.ou_cards} />
          </div>
        </div>

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
          <MarketPill label="Winner" market={predictions.winner} />
          <MarketPill label="BTTS" market={predictions.btts} />
          <MarketPill label="Goals" market={predictions.ou_goals} />
          <MarketPill label="Cards" market={predictions.ou_cards} />
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
            <Stat icon={Shield} label="Sportsbet Odds" value={stats.sportsbet} />
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
