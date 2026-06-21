'use client';

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '../auth-gate';
import { loadMatchDataFromFirestore, readMatchDataCache } from '../firestore-data';
import { accaLegKey, legFromMarketRow, combinedFromLegs } from './bet-slip-utils.mjs';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  CreditCard,
  Goal,
  GripVertical,
  Home as HomeIcon,
  ListFilter,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  ExternalLink,
  Settings,
  Share2,
  ShieldCheck,
  Star,
  UserRound,
  XCircle,
  ChevronDown,
  X,
} from 'lucide-react';

// Country for each tracked competition, so the UI reads country -> league -> match and
// same-named cups (e.g. England's Championship vs USA's USL Championship) are visibly
// distinct. Mirrors the pipeline's FLASH_LEAGUE_ALIASES; league identity itself is already
// guaranteed unique by tournament id.
const LEAGUE_COUNTRY = {
  'Premier League': 'England',
  'Championship': 'England',
  'League One': 'England',
  'League Two': 'England',
  'LaLiga': 'Spain',
  'Bundesliga': 'Germany',
  'Serie A': 'Italy',
  'Ligue 1': 'France',
  'Eredivisie': 'Netherlands',
  'Primeira Liga': 'Portugal',
  'A-League Men': 'Australia',
  'Scottish Premiership': 'Scotland',
  'J1 League': 'Japan',
  'UEFA Champions League': 'Europe',
  'UEFA Europa League': 'Europe',
  'UEFA Conference League': 'Europe',
  'MLS': 'USA',
  'Brasileirão Betano': 'Brazil',
  'CONMEBOL Libertadores': 'South America',
  'FIFA World Cup': 'World',
  'International Friendly Games': 'International',
  'Allsvenskan': 'Sweden',
  'Eliteserien': 'Norway',
};

function leagueCountryLabel(name) {
  return LEAGUE_COUNTRY[name] || '';
}

const GAMBLING_HELP_URL = 'https://www.gamblinghelponline.org.au/';
const BETSTOP_URL = 'https://www.betstop.gov.au/';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'lvrstats.com@gmail.com';
const FAVORITE_LEAGUES_STORAGE_KEY = 'favoriteLeagues';
const FAVORITE_TEAMS_STORAGE_KEY = 'favoriteTeams';
const MAX_FAVORITE_TEAMS = 100;
const PREDICTION_TRACKING_START_DATE = '2026-04-22';
const DRAW_NO_BET_TRACKING_START_DATE = '2026-05-25';
const WINNER_CONFIDENCE_THRESHOLD = 0.40;
const BOOKMAKER_WINNER_GUARD_THRESHOLD = 0.65;
const CORNER_MODEL_PROBABILITY_CAP = 0.72;
const NO_ODDS_CORNER_PROBABILITY_CAP = 0.55;

async function loadMatchData(date = '') {
  return loadMatchDataFromFirestore(date);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

class DashboardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the real stack visible in DevTools while avoiding the generic Next.js blank screen.
    console.error('Dashboard render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error instanceof Error && this.state.error.message
      ? this.state.error.message
      : 'The dashboard hit a render error.';
    return (
      <main className="min-h-screen bg-field px-4 py-10 text-ink">
        <section className="mx-auto max-w-xl rounded-lg border border-red-200 dark:border-red-500/40 bg-surface p-5 shadow-panel">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-semibold">Dashboard could not render</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Refresh the dashboard. If it happens again, send the console line that starts with
                <span className="font-semibold text-ink"> Dashboard render error</span>.
              </p>
              <p className="mt-3 rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300">{message}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex h-10 items-center rounded-md bg-header px-4 text-sm font-semibold text-white"
              >
                Refresh dashboard
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}

async function loadMatchDataWithRetry(date = '', retries = 1, retryDelayMs = 1200) {
  try {
    return await loadMatchData(date);
  } catch (error) {
    if (retries <= 0) throw error;
    await wait(retryDelayMs);
    return loadMatchDataWithRetry(date, retries - 1, retryDelayMs);
  }
}

const SPORTSBET_LEAGUE_SLUGS = {
  'Premier League': 'united-kingdom/english-premier-league',
  Championship: 'united-kingdom/english-championship',
  'League One': 'united-kingdom/english-league-one',
  'League Two': 'united-kingdom/english-league-two',
  LaLiga: 'spain/spanish-la-liga',
  'Serie A': 'italy/italian-serie-a',
  Bundesliga: 'germany/german-bundesliga',
  'Ligue 1': 'france/french-ligue-1',
  Eredivisie: 'rest-of-europe/dutch-eredivisie',
  'Primeira Liga': 'rest-of-europe/portuguese-primeira-liga',
  'UEFA Champions League': 'uefa-competitions/uefa-champions-league',
  'UEFA Europa League': 'uefa-competitions/uefa-europa-league',
  'UEFA Conference League': 'uefa-competitions/uefa-europa-conference-league',
  MLS: 'north-america/usa-major-league-soccer',
  'A-League Men': 'australia/australian-a-league-men',
  'Scottish Premiership': 'united-kingdom/scottish-premiership',
  'J1 League': 'asia/japanese-j1-league',
  'Brasileirão Betano': 'americas/brazilian-serie-a',
  'CONMEBOL Libertadores': 'americas/conmebol-copa-libertadores',
  'FIFA World Cup': 'world-cup/mens-world-cup',
  'International Friendly Games': 'international-soccer/international-friendlies',
  Allsvenskan: 'rest-of-europe/swedish-allsvenskan',
  Eliteserien: 'rest-of-europe/norwegian-eliteserien',
};

const BOOKMAKERS = {
  sportsbet: {
    id: 'sportsbet',
    name: 'Sportsbet',
    entryUrl: 'https://www.sportsbet.com.au/betting/soccer',
    logoSrc: '/bookmakers/sportsbet-logo.svg',
    buttonClass: 'border-[#0078be] bg-[#0078be] hover:border-[#0066a3] hover:bg-[#0066a3]',
  },
  bet365: {
    id: 'bet365',
    name: 'bet365',
    entryUrl: 'https://www.bet365.com.au/hub/en-au/sports-betting',
    logoSrc: '/bookmakers/bet365.svg',
    buttonClass: 'border-[#027b5b] bg-[#027b5b] hover:border-[#02694d] hover:bg-[#02694d]',
  },
  tab: {
    id: 'tab',
    name: 'TAB',
    entryUrl: 'https://www.tab.com.au/sports/betting/Soccer',
    logoSrc: '/bookmakers/tab.svg',
    buttonClass: 'border-[#004c4f] bg-[#004c4f] hover:border-[#003f42] hover:bg-[#003f42]',
  },
  ladbrokes: {
    id: 'ladbrokes',
    name: 'Ladbrokes',
    entryUrl: 'https://www.ladbrokes.com.au/sports/soccer',
    logoSrc: '/bookmakers/ladbrokes.svg',
    buttonClass: 'border-[#d71920] bg-[#d71920] hover:border-[#b9151b] hover:bg-[#b9151b]',
  },
  neds: {
    id: 'neds',
    name: 'Neds',
    entryUrl: 'https://www.neds.com.au/sports/soccer',
    logoSrc: '/bookmakers/neds.svg',
    buttonClass: 'border-[#ff5a00] bg-[#ff5a00] hover:border-[#d95a00] hover:bg-[#d95a00]',
  },
};

const DIRECT_MATCH_BOOKMAKERS = new Set(['sportsbet', 'ladbrokes', 'neds']);
const BOOKMAKER_OPTIONS = Object.values(BOOKMAKERS).filter((bookmaker) => DIRECT_MATCH_BOOKMAKERS.has(bookmaker.id));

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

function bookmakerMatchSearchUrl(match, bookmakerId) {
  const query = encodeURIComponent(bookmakerMatchQuery(match));
  if (!query) return null;

  if (bookmakerId === 'ladbrokes') return `https://www.ladbrokes.com.au/sports/soccer?search=${query}`;
  if (bookmakerId === 'neds') return `https://www.neds.com.au/sports/soccer?search=${query}`;
  return null;
}

function bookmakerUrl(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  if (!DIRECT_MATCH_BOOKMAKERS.has(bookmaker.id)) return bookmaker.entryUrl;
  const eventUrl =
    match.bookmaker_links?.[bookmaker.id] ||
    match.bookmaker_urls?.[bookmaker.id] ||
    match[`${bookmaker.id}_odds`]?.event_url;
  if (eventUrl) return eventUrl;
  if (bookmaker.id === 'sportsbet') return sportsbetEventUrl(match) || bookmaker.entryUrl;
  return bookmakerMatchSearchUrl(match, bookmaker.id) || bookmaker.entryUrl;
}

function sofascoreEventUrl(match) {
  const eventId = match?.id || match?.sofascore_id || match?.sofascoreId;
  if (!eventId) return null;
  return `https://www.sofascore.com/event/${eventId}`;
}

function hasDirectBookmakerMatchLink(match, bookmakerId) {
  const bookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  if (!DIRECT_MATCH_BOOKMAKERS.has(bookmaker.id)) return false;
  return Boolean(
      match.bookmaker_links?.[bookmaker.id] ||
      match.bookmaker_urls?.[bookmaker.id] ||
      match[`${bookmaker.id}_odds`]?.event_url ||
      (bookmaker.id === 'sportsbet' && sportsbetEventUrl(match)),
  );
}

function imageValue(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function teamLogo(match, side) {
  const team = match?.[side] || {};
  return imageValue(
    team.logo,
    team.firebase_logo,
    team.firebaseLogo,
    team.logo_url,
    team.badge_url,
    team.badge_download_url,
    team.badgeDownloadUrl,
    team.crest,
    team.badge,
  );
}

function leagueLogo(value) {
  return imageValue(
    value?.leagueLogo,
    value?.league_logo,
    value?.logo,
    value?.logo_url,
    value?.badge_download_url,
    value?.badgeDownloadUrl,
  );
}

function BrandMark({ className = '', responsive = false }) {
  const tail = responsive ? 'hidden lg:inline' : '';
  return (
    <span
      className={`inline-flex select-none items-baseline font-extrabold leading-none tracking-tight ${className}`}
      role="img"
      aria-label="LVRstats.com"
    >
      <span className="text-ink" aria-hidden="true">LVR</span>
      <span className={`text-blue-600 dark:text-blue-400 ${tail}`} aria-hidden="true">stats</span>
      <span className={`ml-px text-[0.5em] font-semibold text-faint ${tail}`} aria-hidden="true">.com</span>
    </span>
  );
}

function TeamBadge({ src, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-xs font-bold text-muted">
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-contain p-1" aria-hidden="true" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

function LeagueBadge({ src, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/20 bg-surface">
        <img src={src} alt="" className="h-full w-full object-contain p-1" aria-hidden="true" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/15 text-xs font-bold text-white">
      {String(name || '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

function statusClass(status) {
  if (status === 'FT') return 'bg-signal/10 text-signal ring-signal/20';
  if (status === 'live') return 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30';
  if (status === 'upcoming') return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30';
  return 'bg-warning/10 text-warning ring-warning/20';
}

// A match with a real in-play or final score (status "live" or "FT") shows its
// scoreline; everything else stays a prediction. Live matches keep predictions
// ungraded because every settlement check keys off status === 'FT'.
function hasScoreline(match) {
  return match?.status === 'FT' || match?.status === 'live';
}

function statusBadgeLabel(match) {
  if (match?.status === 'live') return match.live_minute ? `LIVE ${match.live_minute}` : 'LIVE';
  return match?.status;
}

function scorelineText(match) {
  return `${match?.home?.goals ?? '-'}-${match?.away?.goals ?? '-'}`;
}

function resultIcon(result) {
  if (result === 'hit') return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (result === 'miss') return <XCircle className="h-4 w-4 text-miss" aria-hidden="true" />;
  return <Clock3 className="h-4 w-4 text-muted" aria-hidden="true" />;
}

function marketPillClass(result) {
  if (result === 'hit') return 'result-hit-row';
  if (result === 'miss') return 'border-red-400 bg-red-100 shadow-panel dark:border-red-500/40 dark:bg-red-500/15';
  if (result === 'pass') return 'border-line bg-surface-3 shadow-panel';
  return 'border-line bg-surface shadow-panel';
}

function marketValueClass(result) {
  if (result === 'hit') return 'text-emerald-700 dark:text-emerald-300';
  if (result === 'miss') return 'text-red-700 dark:text-red-300';
  return 'text-ink';
}

function resultBadgeClass(result) {
  if (result === 'hit') return 'bg-emerald-200 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (result === 'miss') return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
  return 'bg-surface-3 text-muted dark:bg-white/10 dark:text-faint';
}

function visibleResultLabel(result) {
  if (result === 'miss') return '';
  return result || 'pending';
}

function streakCardClass(result) {
  if (result === 'hit') return 'result-hit-row';
  if (result === 'miss') return 'border-red-400 bg-red-100 shadow-panel dark:border-red-500/40 dark:bg-red-500/15';
  return 'border-line bg-surface shadow-panel';
}

function streakTextClass(result) {
  if (result === 'hit') return 'text-emerald-800 dark:text-emerald-200';
  if (result === 'miss') return 'text-red-800 dark:text-red-200';
  return 'text-ink';
}

function streakMetaClass(result) {
  if (result === 'hit') return 'text-emerald-700 dark:text-emerald-300';
  if (result === 'miss') return 'text-red-700 dark:text-red-300';
  return 'text-muted';
}

function teamNameForSide(side, match) {
  if (side === 'home') return match.home?.name || 'Home';
  if (side === 'away') return match.away?.name || 'Away';
  return 'both';
}

function oppositeSide(side) {
  if (side === 'home') return 'away';
  if (side === 'away') return 'home';
  return null;
}

function h2hWinnerTrendBias(trend) {
  const team = trend?.team;
  if (team !== 'home' && team !== 'away') return null;

  const label = (trend.label || '').toLowerCase();
  if (label === 'wins' || label === 'no losses') return team;
  if (label === 'losses' || label === 'no wins') return oppositeSide(team);
  return null;
}

function teamNameForCopy(name) {
  return String(name || '').replace(/^\d+\.\s+/, '');
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
  return Number(value || 0).toFixed(1);
}

function pricedMarketOdds(market) {
  if (market?.odds_estimated) return null;
  const odds = Number(market?.odds);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function marketReturnTotals(markets) {
  // Flat 1-unit stake P&L. A winner banks (odds - 1) profit (the stake is
  // returned, not winnings); a loser forfeits its 1-unit stake. Keeping both
  // sides on a profit basis makes `hit - loss` the true net return.
  return (markets || []).reduce((totals, market) => {
    const odds = pricedMarketOdds(market);
    if (!odds) return totals;
    if (market.result === 'hit') totals.hit += odds - 1;
    if (market.result === 'miss') totals.loss += 1;
    totals.priced += 1;
    return totals;
  }, { hit: 0, loss: 0, priced: 0 });
}

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
}

function doubleChanceResultFromActual(match, type) {
  const actual = winnerActualType(match);
  if (!actual || !type) return undefined;
  return String(type).split('_').includes(actual) ? 'hit' : 'miss';
}

function doubleChanceMarket(match) {
  const precomputed = match.display_markets?.double_chance?.market;
  if (precomputed) {
    return {
      ...precomputed,
      result: precomputed.result || doubleChanceResultFromActual(match, precomputed.type),
    };
  }
  const rows = match.display_summary?.winnerBreakdown || winnerProbabilityBreakdown(match);
  if (!Array.isArray(rows) || rows.length < 3) return null;
  const ranked = [...rows]
    .filter((row) => ['home', 'draw', 'away'].includes(row.key) && Number.isFinite(Number(row.model)))
    .sort((a, b) => Number(b.model) - Number(a.model));
  if (ranked.length < 2) return null;
  const selected = ranked.slice(0, 2).sort((a, b) => ['home', 'draw', 'away'].indexOf(a.key) - ['home', 'draw', 'away'].indexOf(b.key));
  const type = selected.map((row) => row.key).join('_');
  const probability = selected.reduce((sum, row) => sum + Number(row.model || 0), 0);
  return {
    pick: selected.map((row) => teamNameForSide(row.key, match)).join(' or '),
    type,
    probability: Number(probability.toFixed(4)),
    model_probability: Number(probability.toFixed(4)),
    sourceLabel: '1X2 model safety',
    result: doubleChanceResultFromActual(match, type),
  };
}

function drawNoBetResultFromActual(match, type) {
  const actual = winnerActualType(match);
  if (!actual || !type) return undefined;
  if (actual === 'draw') return 'pass';
  return actual === type ? 'hit' : 'miss';
}

function drawNoBetOdds(match, type) {
  if (!type || type === 'draw') return null;
  const pickKey = type === 'home' ? '1' : '2';
  const teamName = teamNameForSide(type, match);
  const markets = match?.sportsbet_markets || {};
  const direct = markets['Draw No Bet'] || markets['Draw no bet'] || markets['Draw No Bet 90 Minutes'] || {};
  const directPrice = direct[pickKey] ?? direct[teamName] ?? direct[String(teamName || '').replace(/\s+FC$/i, '')];
  if (Number.isFinite(Number(directPrice)) && Number(directPrice) > 1.01) {
    return { odds: Number(directPrice), estimated: false };
  }

  const noVig = bookmakerNoVigProbability(displayThreeWayOdds(match));
  const sideProbability = Number(noVig?.[type]);
  const oppositeProbability = Number(noVig?.[oppositeSide(type)]);
  if (Number.isFinite(sideProbability) && Number.isFinite(oppositeProbability) && sideProbability > 0 && oppositeProbability > 0) {
    return {
      odds: Number(((sideProbability + oppositeProbability) / sideProbability).toFixed(2)),
      estimated: true,
    };
  }
  return null;
}

function drawNoBetMarket(match) {
  const precomputed = match.display_markets?.draw_no_bet?.market;
  if (precomputed) {
    return {
      ...precomputed,
      result: precomputed.result || (String(match.date || '') >= DRAW_NO_BET_TRACKING_START_DATE ? drawNoBetResultFromActual(match, precomputed.type) : undefined),
    };
  }
  const rows = match.display_summary?.winnerBreakdown || winnerProbabilityBreakdown(match);
  if (!Array.isArray(rows) || rows.length < 3) return null;
  const byKey = Object.fromEntries(rows.map((row) => [row.key, Number(row.model)]));
  const teamRows = rows
    .filter((row) => ['home', 'away'].includes(row.key) && Number.isFinite(Number(row.model)))
    .sort((a, b) => Number(b.model) - Number(a.model));
  if (!teamRows.length) return null;
  const selected = teamRows[0];
  const sideProbability = Number(byKey[selected.key]);
  const oppositeProbability = Number(byKey[oppositeSide(selected.key)]);
  const drawProbability = Number(byKey.draw);
  const denominator = sideProbability + oppositeProbability;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const conditionalProbability = sideProbability / denominator;
  const odds = drawNoBetOdds(match, selected.key);
  return {
    pick: `${teamNameForSide(selected.key, match)} DNB`,
    type: selected.key,
    probability: Number(conditionalProbability.toFixed(4)),
    model_probability: Number(conditionalProbability.toFixed(4)),
    win_probability: Number(sideProbability.toFixed(4)),
    draw_push_probability: Number.isFinite(drawProbability) ? Number(drawProbability.toFixed(4)) : undefined,
    odds: odds?.odds,
    odds_estimated: odds?.estimated || undefined,
    sourceLabel: odds?.estimated ? '1X2 estimated DNB' : odds?.odds ? 'Draw no bet odds' : '1X2 model safety',
    result: String(match.date || '') >= DRAW_NO_BET_TRACKING_START_DATE ? drawNoBetResultFromActual(match, selected.key) : undefined,
  };
}

function displayBttsMarket(market, match = null) {
  if (!market) return null;
  if (match?.status === 'FT') return market;
  const f = match?.predictions?.factors || {};
  const probs = poissonMarketProbabilities(
    Number(f.lambda_home),
    Number(f.lambda_away),
    Number(f.dixon_coles_rho) || 0,
  );
  const pYes = probs?.bttsYes;
  const nextPick = Number.isFinite(pYes)
    ? pYes > 0.56 ? 'Yes' : 'No'
    : market.pick === 'Pass' ? 'No' : market.pick;
  if (nextPick === market.pick && market.pick !== 'Pass') return market;

  const probability = Number.isFinite(pYes)
    ? nextPick === 'Yes' ? pYes : 1 - pYes
    : Number(market.probability);
  const actual = market.actual_btts;
  const result = typeof actual === 'boolean'
    ? (nextPick === 'Yes') === actual ? 'hit' : 'miss'
    : market.result === 'pass' ? undefined : market.result;

  return {
    ...market,
    pick: nextPick,
    probability: Number.isFinite(probability) ? Number(probability.toFixed(4)) : market.probability,
    result,
  };
}

function parseStreakRatio(value) {
  const match = String(value || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const hits = Number(match[1]);
  const total = Number(match[2]);
  if (!total) return null;
  return { hits, total, rate: hits / total };
}

function marketResultFromActual(market, actual) {
  if (!market || actual === null || actual === undefined || Number.isNaN(Number(actual))) return undefined;
  const line = Number(market.line);
  if (!Number.isFinite(line)) return undefined;
  if (market.pick === 'Over') return Number(actual) > line ? 'hit' : 'miss';
  if (market.pick === 'Under') return Number(actual) < line ? 'hit' : 'miss';
  return undefined;
}

// Live "locked" totals. Goals come from the scoreline; cards/corners from the in-play
// ESPN stats collected by the routine (falling back to any partial actuals). Returns
// null when the live tally isn't available yet.
function liveMarketTotal(match, kind) {
  if (kind === 'goals') {
    const h = Number(match?.home?.goals);
    const a = Number(match?.away?.goals);
    return Number.isFinite(h) && Number.isFinite(a) ? h + a : null;
  }
  const es = match?.espn_stats || {};
  if (kind === 'corners') {
    const h = Number(es.home?.corners);
    const a = Number(es.away?.corners);
    if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
    const total = Number(match?.actuals?.corners_total);
    return Number.isFinite(total) ? total : null;
  }
  if (kind === 'cards') {
    const h = Number(es.home?.yellow_cards) + Number(es.home?.red_cards);
    const a = Number(es.away?.yellow_cards) + Number(es.away?.red_cards);
    if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
    const total = Number(match?.actuals?.cards_total);
    return Number.isFinite(total) ? total : null;
  }
  return null;
}

// During a live match an Over/Yes pick locks a hit the instant the live tally passes the
// line (totals can only climb), and the opposite Under/No pick is then a certain miss.
// Under/No only *win* at full time, so they never get a premature hit here.
function liveLockedResult(match, kind, market) {
  if (!market || match?.status !== 'live') return undefined;
  if (kind === 'btts') {
    const both = Number(match?.home?.goals) > 0 && Number(match?.away?.goals) > 0;
    if (!both) return undefined;
    if (market.pick === 'Yes') return 'hit';
    if (market.pick === 'No') return 'miss';
    return undefined;
  }
  const total = liveMarketTotal(match, kind);
  if (total === null) return undefined;
  const line = Number(market.line);
  if (!Number.isFinite(line)) return undefined;
  if (total > line) {
    if (market.pick === 'Over') return 'hit';
    if (market.pick === 'Under') return 'miss';
  }
  return undefined;
}

// Returns the market with a live-locked result applied, or the original untouched.
function withLiveResult(match, kind, market) {
  const result = liveLockedResult(match, kind, market);
  return result ? { ...market, result } : market;
}

function factorial(n) {
  let value = 1;
  for (let i = 2; i <= n; i++) value *= i;
  return value;
}

function poissonOverTotalProbability(lambda, line, max = 40) {
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line)) return null;
  const cutoff = Math.floor(line);
  let pUnderOrEqual = 0;
  for (let k = 0; k <= Math.min(cutoff, max); k++) {
    pUnderOrEqual += Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }
  return Math.max(0, Math.min(1, 1 - pUnderOrEqual));
}

function marketProbabilityFromTotalAverage(market, averageTotal) {
  if (!market) return null;
  const line = Number(market.line);
  const pOver = poissonOverTotalProbability(averageTotal, line);
  if (!Number.isFinite(pOver)) return null;
  if (market.pick === 'Over') return pOver;
  if (market.pick === 'Under') return 1 - pOver;
  return null;
}

function modelProbabilityForMarket(market) {
  for (const key of ['model_probability', 'probability']) {
    const value = Number(market?.[key]);
    if (Number.isFinite(value) && value > 0 && value < 1) return value;
  }
  return NaN;
}

function cornerBookmakerOdds(match, line, pick) {
  const lineKey = String(line ?? 10.5);
  const lineOdds = match.corner_odds?.[lineKey] || match.corner_odds?.[Number(line).toFixed(1)];
  const value = lineOdds?.[pick];
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function withCornerBookmakerOdds(match, market) {
  if (!market) return market;
  const line = Number(market.line ?? 10.5);
  const existingOdds = Number(market.odds);
  if (Number.isFinite(existingOdds) && existingOdds > 1.01) return { ...market, line };
  const exactOdds = cornerBookmakerOdds(match, line, market.pick);
  return Number.isFinite(exactOdds) ? { ...market, line, odds: exactOdds } : { ...market, line };
}

function hasDirectCornerContext(match, market) {
  const withOdds = withCornerBookmakerOdds(match, market);
  const odds = Number(withOdds?.odds);
  return Number.isFinite(odds) && odds > 1.01;
}

function capGenericCornerMarket(match, market) {
  if (!market || match.status === 'FT') return market;
  const probability = Number(market.model_probability ?? market.probability);
  const withOdds = withCornerBookmakerOdds(match, market);
  if (!hasDirectCornerContext(match, withOdds)) {
    const cappedProbability = Number.isFinite(probability) ? Math.min(probability, NO_ODDS_CORNER_PROBABILITY_CAP) : null;
    return {
      ...withOdds,
      probability: Number.isFinite(cappedProbability) ? cappedProbability : null,
      model_probability: null,
      confidence_hidden: true,
      confidence_reason: 'No Sportsbet corner odds for this side/line.',
      no_sportsbet_corner_odds: true,
      no_odds_probability_cap: Number.isFinite(cappedProbability) && cappedProbability < probability
        ? NO_ODDS_CORNER_PROBABILITY_CAP
        : withOdds.no_odds_probability_cap ?? null,
    };
  }
  if (!Number.isFinite(probability) || probability <= CORNER_MODEL_PROBABILITY_CAP) return withOdds;
  return {
    ...withOdds,
    probability: CORNER_MODEL_PROBABILITY_CAP,
    model_probability: CORNER_MODEL_PROBABILITY_CAP,
    model_probability_cap: CORNER_MODEL_PROBABILITY_CAP,
  };
}

function exactCardBookmakerOdds(match, line, pick) {
  const prediction = match.predictions?.ou_cards;
  if (Number(prediction?.line) === Number(line) && prediction?.pick === pick) {
    const predictionOdds = Number(prediction.odds);
    if (Number.isFinite(predictionOdds) && predictionOdds > 1.01) return predictionOdds;
  }

  const targetLine = Number(line);
  const streaks = [...(match.h2h_streaks || []), ...(match.team_streaks || [])];
  const matchPick = String(pick).toLowerCase();
  for (const streak of streaks) {
    const label = String(streak.label || '').toLowerCase();
    if (!label.includes('card')) continue;
    const labelLine = Number(label.match(/(\d+(?:\.\d+)?)/)?.[1]);
    if (!Number.isFinite(labelLine) || labelLine !== targetLine) continue;
    const labelPick = label.includes('over') || label.includes('more than') ? 'over' :
      label.includes('under') || label.includes('less than') ? 'under' :
        null;
    if (labelPick !== matchPick) continue;
    const odds = Number(streak.odds);
    if (Number.isFinite(odds) && odds > 1.01) return odds;
  }
  return undefined;
}

function estimatedOppositeOdds(knownOdds) {
  const knownProb = impliedProbability(knownOdds);
  if (!Number.isFinite(knownProb) || knownProb <= 0 || knownProb >= 1) return undefined;
  const oppositeOdds = decimalFromProbability(1 - knownProb);
  return Number.isFinite(oppositeOdds) && oppositeOdds > 1.01 ? Number(oppositeOdds.toFixed(2)) : undefined;
}

function cardBookmakerOddsInfo(match, line, pick) {
  const exactOdds = exactCardBookmakerOdds(match, line, pick);
  if (Number.isFinite(exactOdds)) return { odds: exactOdds, estimated: false };

  const oppositeOdds = exactCardBookmakerOdds(match, line, oppositeTotalPick(pick));
  const estimatedOdds = estimatedOppositeOdds(oppositeOdds);
  if (Number.isFinite(estimatedOdds)) return { odds: estimatedOdds, estimated: true };

  return { odds: undefined, estimated: false };
}

function oppositeTotalPick(pick) {
  if (pick === 'Over') return 'Under';
  if (pick === 'Under') return 'Over';
  return pick;
}

function cornerMarketFromStreaks(match, allMatches = []) {
  if (match.predictions?.ou_corners) {
    const prediction = match.predictions.ou_corners;
    const market = capGenericCornerMarket(match, {
      ...prediction,
      actual: prediction.actual ?? match.actuals?.corners_total,
      result: prediction.result || marketResultFromActual(prediction, match.actuals?.corners_total),
    });
    return withCornerBookmakerOdds(match, market);
  }
  const streaks = [...(match.h2h_streaks || []), ...(match.team_streaks || [])];
  const seen = new Set();
  const candidates = streaks
    .map((streak) => {
      const label = String(streak.label || '');
      const lower = label.toLowerCase();
      if (!lower.includes('corner')) return null;
      const lineMatch = lower.match(/(\d+(?:\.\d+)?)/);
      const line = lineMatch ? Number(lineMatch[1]) : 10.5;
      const pick = lower.includes('over') || lower.includes('more than') ? 'Over' :
        lower.includes('under') || lower.includes('less than') ? 'Under' :
          null;
      if (!pick || !Number.isFinite(line)) return null;
      const ratio = parseStreakRatio(streak.value);
      const key = `${streak.team || 'both'}|${pick}|${line}|${streak.value || ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        pick,
        line,
        odds: Number(streak.odds) || undefined,
        ratio,
        team: streak.team,
        label,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rateDiff = (b.ratio?.rate || 0) - (a.ratio?.rate || 0);
      if (rateDiff) return rateDiff;
      return (b.ratio?.total || 0) - (a.ratio?.total || 0);
    });

  const best = candidates[0];
  if (!best) {
    const homeCorners = recentTeamCorners(allMatches, match.home?.team_id, match.id);
    const awayCorners = recentTeamCorners(allMatches, match.away?.team_id, match.id);
    if (!homeCorners && !awayCorners) return null;
    const available = [homeCorners, awayCorners].filter(Boolean);
    const average = available.reduce((sum, item) => sum + item.avg, 0) / available.length;
    const line = 10.5;
    const fallback = {
      pick: average >= line ? 'Over' : 'Under',
      line,
      odds: cornerBookmakerOdds(match, line, average >= line ? 'Over' : 'Under'),
      actual: match.actuals?.corners_total,
      model_probability: marketProbabilityFromTotalAverage({ pick: average >= line ? 'Over' : 'Under', line }, average),
      model_average_total: average,
      sourceLabel: 'Recent corner average',
      sourceValue: `${average.toFixed(1)} avg`,
      team: 'both',
    };
    return {
      ...withCornerBookmakerOdds(match, fallback),
      result: marketResultFromActual(fallback, fallback.actual),
    };
  }
  const actual = match.actuals?.corners_total;
  const homeCorners = recentTeamCorners(allMatches, match.home?.team_id, match.id);
  const awayCorners = recentTeamCorners(allMatches, match.away?.team_id, match.id);
  const available = [homeCorners, awayCorners].filter(Boolean);
  const average = available.length ? available.reduce((sum, item) => sum + item.avg, 0) / available.length : null;
  const selected = { pick: best.pick, line: best.line };
  const averageProbability = marketProbabilityFromTotalAverage(selected, average);
  const modelSidePick = Number.isFinite(averageProbability) && averageProbability < 0.5 ? oppositeTotalPick(best.pick) : best.pick;
  const modelProbability = modelSidePick === best.pick ? averageProbability : 1 - averageProbability;
  const finalMarket = { pick: modelSidePick, line: best.line };
  const market = {
    pick: modelSidePick,
    line: best.line,
    odds: modelSidePick === best.pick
      ? best.odds || cornerBookmakerOdds(match, best.line, best.pick)
      : cornerBookmakerOdds(match, best.line, modelSidePick),
    actual,
    model_probability: Number.isFinite(modelProbability) ? modelProbability : best.ratio?.rate,
    model_average_total: average,
    result: marketResultFromActual(finalMarket, actual),
    sourceLabel: best.label,
    sourceValue: modelSidePick === best.pick
      ? best.ratio ? `${best.ratio.hits}/${best.ratio.total}` : best.label
      : average ? `${average.toFixed(1)} avg` : null,
    trendConflict: modelSidePick === best.pick ? null : {
      pick: best.pick,
      line: best.line,
      sourceValue: best.ratio ? `${best.ratio.hits}/${best.ratio.total}` : best.label,
    },
    team: best.team,
  };
  return withCornerBookmakerOdds(match, market);
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

function bookmakerNoVigProbability(odds, side) {
  const home = impliedProbability(odds?.home);
  const draw = impliedProbability(odds?.draw);
  const away = impliedProbability(odds?.away);
  if (![home, draw, away].every((p) => Number.isFinite(p) && p > 0)) return null;
  const total = home + draw + away;
  if (!(total > 0)) return null;
  const map = { home: home / total, draw: draw / total, away: away / total };
  return side ? map[side] ?? null : map;
}

function decimalFromProbability(probability) {
  return Number.isFinite(probability) && probability > 0 ? 1 / probability : null;
}

function hasThreeWayOdds(odds) {
  return ['home', 'draw', 'away'].every((key) => {
    const value = Number(odds?.[key]);
    return Number.isFinite(value) && value > 1.01;
  });
}

function displayThreeWayOdds(match) {
  if (match?.display_summary?.oddsStrip) return match.display_summary.oddsStrip;
  const originalOdds = match?.odds || {};
  const bookmakerOdds = match?.sportsbet_odds || {};
  if (match?.status === 'FT' && hasThreeWayOdds(originalOdds)) return originalOdds;
  if (hasThreeWayOdds(bookmakerOdds)) return bookmakerOdds;
  return originalOdds;
}

// Best price per outcome across Sportsbet and Ladbrokes (higher decimal = better for the
// bettor), with the winning book tagged so the card can show where to get it.
function bestThreeWayOdds(match) {
  const display = displayThreeWayOdds(match) || {};
  const sb = match?.sportsbet_odds || {};
  const lad = match?.ladbrokes_odds || {};
  const out = {};
  for (const key of ['home', 'draw', 'away']) {
    const dispv = Number(display[key]);
    let best = Number.isFinite(dispv) && dispv > 1.01
      ? { v: dispv, book: hasThreeWayOdds(sb) ? 'Sportsbet' : null }
      : null;
    const sbv = Number(sb[key]);
    if (Number.isFinite(sbv) && sbv > 1.01 && (!best || sbv > best.v)) best = { v: sbv, book: 'Sportsbet' };
    const ladv = Number(lad[key]);
    if (Number.isFinite(ladv) && ladv > 1.01 && (!best || ladv > best.v)) best = { v: ladv, book: 'Ladbrokes' };
    out[key] = best ? best.v : undefined;
    out[`${key}_book`] = best ? best.book : null;
  }
  return out;
}

function derivedDoubleChanceOdds(match, keys) {
  const odds = displayThreeWayOdds(match);
  const probability = keys
    .map((key) => impliedProbability(odds[key]))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  if (!probability) return null;
  return decimalFromProbability(Math.min(probability * 1.06, 0.99));
}

function fallbackStreakOdds(streak, match) {
  const existing = Number(streak?.odds);
  if (Number.isFinite(existing) && existing > 1.01) return existing;
  const label = String(streak?.label || '').toLowerCase();
  const team = streak?.team;
  const odds = displayThreeWayOdds(match);
  const btts = match.predictions?.btts;

  if (label.includes('both teams scoring') || label.includes('both teams to score') || label.includes('without clean sheet') || label.includes('no clean sheet')) {
    return Number.isFinite(Number(btts?.odds)) && btts?.pick === 'Yes' ? Number(btts.odds) : null;
  }
  if (label === 'clean sheet' || label.includes('no goals conceded')) {
    return Number.isFinite(Number(btts?.odds)) && btts?.pick === 'No' ? Number(btts.odds) : null;
  }
  if (label === 'wins') {
    return team === 'home' ? odds.home : team === 'away' ? odds.away : null;
  }
  if (label === 'losses') {
    return team === 'home' ? odds.away : team === 'away' ? odds.home : null;
  }
  if (label === 'draws') return odds.draw;
  if (label === 'no wins') {
    return team === 'home' ? derivedDoubleChanceOdds(match, ['draw', 'away']) : team === 'away' ? derivedDoubleChanceOdds(match, ['home', 'draw']) : null;
  }
  if (label === 'no losses') {
    return team === 'home' ? derivedDoubleChanceOdds(match, ['home', 'draw']) : team === 'away' ? derivedDoubleChanceOdds(match, ['draw', 'away']) : null;
  }
  if (label === 'no draws') return derivedDoubleChanceOdds(match, ['home', 'away']);

  const lineMatch = label.match(/(\d+(?:\.\d+)?)/);
  const line = lineMatch ? lineMatch[1] : null;
  const pick = label.includes('over') || label.includes('more than') ? 'Over' : label.includes('under') || label.includes('less than') ? 'Under' : null;
  if (line && pick && label.includes('corner')) return match.corner_odds?.[line]?.[pick] ?? null;
  if (line && pick && label.includes('card') && Number(match.predictions?.ou_cards?.line) === Number(line) && match.predictions?.ou_cards?.pick === pick) {
    return match.predictions.ou_cards.odds ?? null;
  }
  if (line && pick && label.includes('goal') && Number(match.predictions?.ou_goals?.line) === Number(line) && match.predictions?.ou_goals?.pick === pick) {
    return match.predictions.ou_goals.odds ?? null;
  }

  return Number.isFinite(existing) && existing > 0 ? existing : null;
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

// Bucket every settled headline pick by the model's stated probability and measure how
// often it actually hit — the basis for a reliability/calibration curve.
function calibrationBuckets(matches) {
  const bands = [[0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.8], [0.8, 1.01]];
  const stats = bands.map(([lo, hi]) => ({ lo, hi, hit: 0, total: 0 }));
  for (const m of arrayValue(matches)) {
    const headline = m?.display_summary?.headlineMarkets;
    if (!Array.isArray(headline)) continue;
    for (const mk of headline) {
      const p = Number(mk?.probability);
      const r = mk?.result;
      if (!Number.isFinite(p) || (r !== 'hit' && r !== 'miss')) continue;
      const band = stats.find((s) => p >= s.lo && p < s.hi);
      if (!band) continue;
      band.total += 1;
      if (r === 'hit') band.hit += 1;
    }
  }
  return stats
    .filter((s) => s.total > 0)
    .map((s) => ({ ...s, mid: (s.lo + s.hi) / 2, observed: s.hit / s.total }));
}

function CalibrationPanel({ matches }) {
  const buckets = useMemo(() => calibrationBuckets(matches), [matches]);
  const totalSamples = buckets.reduce((sum, b) => sum + b.total, 0);
  if (totalSamples < 40) return null;
  const mae = buckets.reduce((sum, b) => sum + Math.abs(b.observed - b.mid) * b.total, 0) / totalSamples;
  const verdict = mae < 0.04 ? 'Well calibrated' : mae < 0.08 ? 'Reasonably calibrated' : 'Slightly optimistic';
  const verdictTone = mae < 0.04 ? 'text-emerald-600 dark:text-emerald-400' : mae < 0.08 ? 'text-muted' : 'text-amber-600 dark:text-amber-400';
  const fmtBand = (b) => `${Math.round(b.lo * 100)}–${Math.round(b.hi > 1 ? 100 : b.hi * 100)}%`;

  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Model reliability</h3>
        <span className={`text-xs font-semibold ${verdictTone}`}>{verdict}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Across {totalSamples.toLocaleString()} settled picks, grouped by the probability we stated. The bar is how often they actually hit; the tick is what we predicted — close together means honest probabilities.
      </p>
      <div className="mt-3 space-y-2">
        {buckets.map((b) => {
          const observedPct = b.observed * 100;
          const predictedPct = b.mid * 100;
          const good = b.observed >= b.mid - 0.02;
          return (
            <div key={`${b.lo}`} className="grid grid-cols-[3.75rem_1fr_4.5rem] items-center gap-2 text-xs">
              <span className="font-mono text-muted">{fmtBand(b)}</span>
              <span className="relative h-4 overflow-hidden rounded-full bg-field">
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${good ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`}
                  style={{ width: `${Math.min(100, observedPct)}%` }}
                />
                <span className="absolute inset-y-0 w-px bg-ink/70" style={{ left: `${Math.min(100, predictedPct)}%` }} title={`Predicted ${predictedPct.toFixed(0)}%`} />
              </span>
              <span className="text-right font-mono text-ink">
                {observedPct.toFixed(0)}% <span className="text-faint">({b.hit}/{b.total})</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Cross-match value feed: every positive-edge pick on an upcoming match whose EV clears
// a threshold, ranked by EV. Reuses the same fair-vs-book odds the value tiles show.
function valueBoardPicks(matches, limit = 8, minEv = 0.03) {
  const picks = [];
  for (const m of arrayValue(matches)) {
    if (m?.status !== 'upcoming') continue;
    for (const row of positiveEdgesForMatch(m, matches)) {
      const fair = Number(row.comparison?.model?.odds);
      const book = Number(row.comparison?.bookmaker?.odds);
      if (!(fair > 1 && book > 1)) continue;
      const prob = 1 / fair;
      const ev = prob * book - 1;
      if (ev < minEv) continue;
      const kelly = Math.max(0, ((prob * book - 1) / (book - 1)) * 0.25);
      picks.push({ match: m, label: row.label, pick: formatMarketDetail(row.market), book, prob, ev, kelly, line: row.market?.line ?? null });
    }
  }
  picks.sort((a, b) => b.ev - a.ev);
  return picks.slice(0, limit);
}

// Flat-stake (1u) P&L over every settled suggested pick, chronologically — the equity
// curve that shows whether the model's edge actually pays out.
function bankrollSimulation(matches) {
  const bets = [];
  for (const m of arrayValue(matches)) {
    if (m?.status !== 'FT') continue;
    const cm = m?.display_summary?.compactMarket?.market;
    const odds = Number(cm?.odds);
    const res = cm?.result;
    if (!(odds > 1) || (res !== 'hit' && res !== 'miss')) continue;
    bets.push({ date: m.date || '', odds, win: res === 'hit' });
  }
  bets.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let equity = 0;
  let wins = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = [];
  for (const b of bets) {
    equity += b.win ? b.odds - 1 : -1;
    if (b.win) wins += 1;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    curve.push(equity);
  }
  const n = bets.length;
  if (!n) return null;
  return { n, net: equity, roi: equity / n, winRate: wins / n, maxDrawdown, curve };
}

function BankrollPanel({ matches }) {
  const sim = useMemo(() => bankrollSimulation(matches), [matches]);
  if (!sim || sim.n < 30) return null;
  const { n, net, roi, winRate, maxDrawdown, curve } = sim;
  const positive = net >= 0;
  const W = 320;
  const H = 64;
  const min = Math.min(0, ...curve);
  const max = Math.max(0, ...curve);
  const range = max - min || 1;
  const x = (i) => (curve.length > 1 ? (i / (curve.length - 1)) * W : 0);
  const y = (v) => H - ((v - min) / range) * H;
  const path = curve.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zeroY = y(0).toFixed(1);

  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Bankroll simulator</h3>
        <span className="text-xs text-muted">1u flat on every suggested pick</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className={`font-mono text-lg font-semibold ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{positive ? '+' : ''}{net.toFixed(1)}u</div>
          <div className="text-[11px] uppercase tracking-wide text-faint">Profit</div>
        </div>
        <div>
          <div className={`font-mono text-lg font-semibold ${roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{roi >= 0 ? '+' : ''}{(roi * 100).toFixed(1)}%</div>
          <div className="text-[11px] uppercase tracking-wide text-faint">ROI</div>
        </div>
        <div>
          <div className="font-mono text-lg font-semibold text-ink">{(winRate * 100).toFixed(0)}%</div>
          <div className="text-[11px] uppercase tracking-wide text-faint">{n} bets</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-16 w-full" aria-hidden="true">
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeWidth="0.5" className="text-line" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={positive ? '#34d6c8' : '#ef4444'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 text-[11px] text-muted">Max drawdown {maxDrawdown.toFixed(1)}u. Settled picks only, chronological, level stakes — not betting advice.</p>
    </section>
  );
}

function ValueBoard({ matches, onSelectMatch, accaKeys, onToggleLeg }) {
  const picks = useMemo(() => valueBoardPicks(matches), [matches]);
  if (!picks.length) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden="true" />
          Today's value
        </h3>
        <span className="rounded-full bg-field px-2 py-0.5 text-[11px] font-semibold text-muted">{picks.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {picks.map((p, i) => {
          const key = accaLegKey(p.match.id, p.label);
          const inSlip = accaKeys?.has(key);
          return (
            <li key={key} className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={() => onSelectMatch(p.match)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left transition hover:bg-surface-2"
              >
                <span className="w-4 shrink-0 text-center font-mono text-xs font-semibold text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{p.match.home?.name} v {p.match.away?.name}</span>
                  <span className="block truncate text-[11px] text-muted">{p.match.league} · {matchDisplayTime(p.match)} · <span className="font-semibold text-ink">{p.label} {p.pick}</span> @ {p.book.toFixed(2)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{(p.ev * 100).toFixed(0)}%</span>
                  <span className="block text-[10px] text-faint">¼K {(p.kelly * 100).toFixed(1)}%</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const leg = legFromMarketRow(
                    { label: p.label, pick: p.pick, book: p.book, prob: p.prob, line: p.line ?? p.market?.line ?? null },
                    p.match,
                  );
                  if (leg) onToggleLeg(leg);
                }}
                aria-pressed={inSlip}
                aria-label={inSlip ? 'Remove from bet slip' : 'Add to bet slip'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition active:scale-90 ${
                  inSlip ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-muted hover:text-ink'
                }`}
              >
                {inSlip ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : '+'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Trim text to fit a pixel width on a canvas, adding an ellipsis.
function fitCanvasText(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (ctx.measureText(str).width <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// Render a bet slip to a shareable PNG canvas (no external deps). Dark, branded
// card sized to the number of legs.
function drawBetSlipCanvas(slip) {
  const legs = Array.isArray(slip?.legs) ? slip.legs : [];
  const W = 660;
  const padX = 28;
  const headerH = 104;
  const legH = 60;
  const footerH = 96;
  const H = headerH + Math.max(1, legs.length) * legH + footerH;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  const ACCENT = '#34d6c8';
  const INK = '#e6eaf0';
  const MUTED = '#8b95a3';
  const FAINT = '#5b6573';
  const statusColors = {
    won: ['#10b981', '#ffffff'],
    lost: ['#ef4444', '#ffffff'],
    void: ['#39424d', '#c5ccd5'],
    pending: ['#f59e0b', '#1a1300'],
  };
  const legColor = { hit: '#34d399', miss: '#f87171', void: '#9aa4b0', pending: '#fbbf24' };
  const status = slip?.status || 'pending';

  // Background + accent stripe + border.
  ctx.fillStyle = '#0f1318';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 6);
  ctx.strokeStyle = '#222a33';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Header: brand + status pill.
  ctx.fillStyle = ACCENT;
  ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('LVRstats', padX, 44);
  ctx.fillStyle = MUTED;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('BET SLIP', padX, 66);

  const [pillBg, pillFg] = statusColors[status] || statusColors.pending;
  const pillLabel = String(status).toUpperCase();
  ctx.font = '700 13px system-ui, sans-serif';
  const pillW = ctx.measureText(pillLabel).width + 24;
  const pillX = W - padX - pillW;
  ctx.fillStyle = pillBg;
  const pr = 13;
  ctx.beginPath();
  ctx.roundRect(pillX, 30, pillW, 26, pr);
  ctx.fill();
  ctx.fillStyle = pillFg;
  ctx.fillText(pillLabel, pillX + 12, 47);

  // Combined odds (big, header right under brand).
  const combinedOdds = Number(slip?.combinedOdds || 0);
  ctx.fillStyle = INK;
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${legs.length} leg${legs.length === 1 ? '' : 's'} · ${combinedOdds.toFixed(2)}`, W - padX, 78);
  ctx.textAlign = 'left';

  // Legs.
  let y = headerH;
  ctx.strokeStyle = '#1d242c';
  legs.forEach((l) => {
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();
    const result = l.result || 'pending';
    // Match label.
    ctx.fillStyle = INK;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(fitCanvasText(ctx, l.matchLabel || '', W - padX * 2 - 70), padX, y + 26);
    // Market + pick + odds.
    ctx.fillStyle = MUTED;
    ctx.font = '400 13px system-ui, sans-serif';
    const sub = `${l.label} ${l.pick}${l.priceEstimated ? ' (est.)' : ''} @ ${Number(l.book).toFixed(2)}`;
    ctx.fillText(fitCanvasText(ctx, sub, W - padX * 2 - 70), padX, y + 46);
    // Result (right).
    ctx.fillStyle = legColor[result] || legColor.pending;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(result, W - padX, y + 30);
    ctx.textAlign = 'left';
    y += legH;
  });

  // Footer.
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(W - padX, y);
  ctx.stroke();
  const stake = Number(slip?.stake);
  const hasStake = Number.isFinite(stake) && stake > 0;
  ctx.fillStyle = MUTED;
  ctx.font = '400 13px system-ui, sans-serif';
  if (hasStake) {
    const potential = stake * combinedOdds;
    const retLabel = status === 'won' ? 'Returned' : 'Potential';
    ctx.fillText(`Stake ${stake.toFixed(0)}`, padX, y + 30);
    ctx.fillStyle = INK;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${retLabel} ${potential.toFixed(2)}`, W - padX, y + 30);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = FAINT;
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.fillText('lvrstats.com · not betting advice', padX, y + 58);
  return canvas;
}

function betSlipShareText(slip) {
  const legs = Array.isArray(slip?.legs) ? slip.legs : [];
  const odds = Number(slip?.combinedOdds || 0).toFixed(2);
  const status = slip?.status && slip.status !== 'pending' ? ` · ${String(slip.status).toUpperCase()}` : '';
  const head = `LVRstats bet slip — ${legs.length} leg${legs.length === 1 ? '' : 's'} @ ${odds}${status}`;
  const rows = legs.map((l) => `• ${l.matchLabel}: ${l.label} ${l.pick} @ ${Number(l.book).toFixed(2)}${l.result ? ` (${l.result})` : ''}`);
  return [head, ...rows, 'lvrstats.com'].join('\n');
}

// Share a bet slip as an image via the Web Share API, falling back to a download.
async function shareBetSlip(slip, onError) {
  try {
    const canvas = drawBetSlipCanvas(slip);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not render the slip image.');
    const file = new File([blob], 'lvrstats-betslip.png', { type: 'image/png' });
    const text = betSlipShareText(slip);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'LVRstats bet slip', text });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: 'LVRstats bet slip', text });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lvrstats-betslip.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    if (e?.name === 'AbortError') return; // user dismissed the share sheet
    onError?.(e?.message || 'Could not share the slip.');
  }
}

function AccaSlip({ legs, onRemoveLeg, onClear, onSaved }) {
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(10);
  const [tab, setTab] = useState('current');
  const [slips, setSlips] = useState([]);
  const [slipsLoading, setSlipsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const getToken = useCallback(async () => {
    const { getFirebaseAuth } = await import('../firebase');
    return getFirebaseAuth().currentUser?.getIdToken();
  }, []);

  const loadSlips = useCallback(async () => {
    setSlipsLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to load slips.');
      const res = await fetch(`/api/bet-slips?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load slips.');
      setSlips(Array.isArray(data.slips) ? data.slips : []);
      setHasMore(Boolean(data.hasMore));
    } catch (e) {
      setError(e.message || 'Could not load slips.');
    } finally {
      setSlipsLoading(false);
    }
  }, [getToken, limit]);

  useEffect(() => { if (open) loadSlips(); }, [open, loadSlips]);

  const saveSlip = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to save.');
      const res = await fetch('/api/bet-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'saveSlip', legs, stake: Number(stake) || 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save slip.');
      setSlips(Array.isArray(data.slips) ? data.slips : []);
      setHasMore(Boolean(data.hasMore));
      onSaved?.();
      setTab('pending');
    } catch (e) {
      setError(e.message || 'Could not save slip.');
    } finally {
      setBusy(false);
    }
  }, [getToken, legs, stake, onSaved]);

  const deleteSlip = useCallback(async (slipId) => {
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to delete.');
      const res = await fetch('/api/bet-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'deleteSlip', slipId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not delete slip.');
      setSlips(Array.isArray(data.slips) ? data.slips : []);
      setHasMore(Boolean(data.hasMore));
    } catch (e) {
      setError(e.message || 'Could not delete slip.');
    }
  }, [getToken]);

  const combined = combinedFromLegs(legs);
  const stakeNum = Number(stake) || 0;
  const returns = combined ? stakeNum * combined.odds : 0;
  const evPositive = combined && combined.ev > 0;
  const hasEstimated = legs.some((l) => l.priceEstimated);

  const statusBadge = (status) =>
    status === 'won' ? 'bg-emerald-500 text-white'
      : status === 'lost' ? 'bg-red-500 text-white'
        : status === 'void' ? 'bg-field text-muted'
          : 'bg-amber-500/80 text-white';
  const legResultClass = (result) =>
    result === 'hit' ? 'text-emerald-500'
      : result === 'miss' ? 'text-red-500'
        : result === 'void' ? 'text-muted' : 'text-amber-500';

  const pendingSlips = slips.filter((s) => (s.status || 'pending') === 'pending');
  const resultedSlips = slips.filter((s) => s.status && s.status !== 'pending');
  const tabSlips = tab === 'pending' ? pendingSlips : resultedSlips;
  const formatPlaced = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-header px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition active:scale-95 sm:bottom-6"
        aria-label={`Open bet slip, ${legs.length} legs`}
      >
        Bet slip
        {legs.length > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">{legs.length}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Bet slip">
          <button type="button" aria-label="Close bet slip" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative z-10 flex h-[100dvh] w-full flex-col border-line bg-surface shadow-2xl sm:h-[82vh] sm:w-[42rem] sm:max-w-[92vw] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-ink">Bet slip</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink active:scale-95">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex border-b border-line px-4">
              {[
                ['current', `Current${legs.length ? ` · ${legs.length}` : ''}`],
                ['pending', `Pending${pendingSlips.length ? ` · ${pendingSlips.length}` : ''}`],
                ['resulted', `Resulted${resultedSlips.length ? ` · ${resultedSlips.length}` : ''}`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${tab === id ? 'border-[#34d6c8] text-[#34d6c8]' : 'border-transparent text-muted hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'current' && (
              <>
                {!legs.length ? (
                  <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-muted">Your slip is empty. Add markets from the value board or a match's detail view.</div>
                ) : (
                  <>
                    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                      {legs.map((l) => (
                        <li key={accaLegKey(l.matchId, l.label)} className="flex items-center gap-2 px-4 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{l.matchLabel}</span>
                            <span className="block truncate text-[11px] text-muted">{l.label} {l.pick}{l.priceEstimated ? ' (est.)' : ''} @ <span className="font-mono font-semibold text-ink">{Number(l.book).toFixed(2)}</span>{Number.isFinite(Number(l.prob)) ? <> · model {(Number(l.prob) * 100).toFixed(0)}%</> : null}</span>
                          </span>
                          <button type="button" onClick={() => onRemoveLeg(l)} aria-label="Remove leg" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:text-red-500 active:scale-90">
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {combined && (
                      <div className="border-t border-line px-4 py-3">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="font-mono text-lg font-semibold text-ink">{combined.odds.toFixed(2)}</div>
                            <div className="text-[11px] uppercase tracking-wide text-faint">Odds</div>
                          </div>
                          <div>
                            <div className="font-mono text-lg font-semibold text-ink">{(combined.prob * 100).toFixed(1)}%</div>
                            <div className="text-[11px] uppercase tracking-wide text-faint">Model</div>
                          </div>
                          <div>
                            <div className={`font-mono text-lg font-semibold ${evPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{combined.ev >= 0 ? '+' : ''}{(combined.ev * 100).toFixed(0)}%</div>
                            <div className="text-[11px] uppercase tracking-wide text-faint">EV</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <label className="flex items-center gap-2 text-sm text-muted">
                            Stake
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={stake}
                              onChange={(e) => setStake(e.target.value)}
                              className="h-10 w-20 rounded-md border border-line bg-surface px-2 text-right font-mono text-sm text-ink"
                            />
                          </label>
                          <span className="ml-auto text-sm text-muted">
                            Returns <span className="font-mono text-base font-semibold text-ink">{returns.toFixed(2)}</span>
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] text-muted">Combined model probability assumes independent legs (one per match).{hasEstimated ? ' Includes model-estimated prices (est.).' : ''} Not betting advice.</p>
                      </div>
                    )}
                    <div className="flex items-center gap-3 border-t border-line px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                      <button type="button" onClick={onClear} className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-muted transition hover:text-ink active:scale-95">Clear</button>
                      <button type="button" onClick={() => shareBetSlip({ legs, combinedOdds: combined?.odds, stake: Number(stake) || 0, status: 'pending' }, setError)} disabled={!legs.length} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-[#34d6c8] px-4 text-sm font-semibold text-[#34d6c8] transition hover:bg-[#34d6c8]/10 active:scale-95 disabled:opacity-50"><Share2 className="h-4 w-4" aria-hidden="true" />Share</button>
                      <button type="button" onClick={saveSlip} disabled={!legs.length || busy} className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-header text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50">{busy ? 'Saving…' : 'Save slip'}</button>
                    </div>
                  </>
                )}
              </>
            )}

            {(tab === 'pending' || tab === 'resulted') && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {slipsLoading ? (
                  <p className="text-sm text-muted">Loading slips…</p>
                ) : !tabSlips.length ? (
                  <p className="text-sm text-muted">{tab === 'pending' ? 'No open slips. Build one in Current and tap Save slip.' : 'No resulted slips yet.'}</p>
                ) : (
                  <ul className="space-y-3">
                    {tabSlips.map((slip) => {
                      const tone = slip.status === 'won' ? 'border-emerald-500/40 bg-emerald-500/5'
                        : slip.status === 'lost' ? 'border-red-500/40 bg-red-500/5'
                          : slip.status === 'void' ? 'border-line bg-field'
                            : 'border-line bg-surface';
                      const slipReturns = slip.status === 'won' ? Number(slip.stake) * Number(slip.combinedOdds || 0) : 0;
                      const placed = formatPlaced(slip.savedAt);
                      return (
                        <li key={slip.id} className={`rounded-lg border ${tone} p-3`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                                {slip.legs.length} legs · {Number(slip.combinedOdds || 0).toFixed(2)}
                              </span>
                              {placed && <span className="block text-[11px] text-faint">Placed {placed}</span>}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadge(slip.status)}`}>{String(slip.status || 'pending').toUpperCase()}</span>
                              <button type="button" onClick={() => shareBetSlip(slip, setError)} aria-label="Share slip" className="inline-flex items-center gap-1 rounded-md border border-[#34d6c8] px-2 py-1 text-[11px] font-semibold text-[#34d6c8] transition hover:bg-[#34d6c8]/10 active:scale-95">
                                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />Share
                              </button>
                              <button type="button" onClick={() => deleteSlip(slip.id)} aria-label="Delete slip" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-muted transition hover:text-red-500">
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {slip.legs.map((l, i) => (
                              <li key={`${l.matchId}-${i}`} className="flex items-center justify-between gap-2 text-[12px]">
                                <span className="min-w-0 truncate text-muted">
                                  <span className="text-ink">{l.matchLabel}</span> · {l.label} {l.pick}{l.priceEstimated ? ' (est.)' : ''} @ {Number(l.book).toFixed(2)}
                                </span>
                                <span className={`shrink-0 font-semibold ${legResultClass(l.result)}`}>{l.result || 'pending'}</span>
                              </li>
                            ))}
                          </ul>
                          {slip.status === 'won' && (
                            <p className="mt-2 text-[12px] text-muted">Returns <span className="font-mono font-semibold text-ink">{slipReturns.toFixed(2)}</span> from stake {Number(slip.stake).toFixed(0)}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {hasMore && !slipsLoading && (
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + 50)}
                    className="mt-3 w-full rounded-md border border-line bg-surface py-2 text-xs font-semibold text-muted transition hover:text-ink active:scale-95"
                  >
                    Load more
                  </button>
                )}
              </div>
            )}

            {error && <p className="px-4 pb-2 text-[12px] text-red-500">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}

// Compact expected-goals (model lambda) readout. Deliberately no single predicted
// scoreline: the modal exact score is ~11% likely and clusters on 1-1, so it reads as
// a wrong "prediction". The xG split is the model's honest, differentiated signal.
function ScorelinePanel({ match }) {
  const f = match?.predictions?.factors || {};
  const xgHome = Number(f.lambda_home);
  const xgAway = Number(f.lambda_away);
  if (!Number.isFinite(xgHome) || !Number.isFinite(xgAway) || xgHome <= 0 || xgAway <= 0) return null;
  const total = xgHome + xgAway;
  const homePct = (xgHome / total) * 100;

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Goal className="h-4 w-4" aria-hidden="true" />
          Expected goals
        </h3>
        <span className="text-xs text-muted">Model xG · {total.toFixed(1)} total</span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="min-w-0 text-center">
          <div className="font-mono text-2xl font-semibold text-ink">{xgHome.toFixed(1)}</div>
          <div className="mt-0.5 truncate text-xs text-muted">{match.home?.name}</div>
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">xG</div>
        <div className="min-w-0 text-center">
          <div className="font-mono text-2xl font-semibold text-ink">{xgAway.toFixed(1)}</div>
          <div className="mt-0.5 truncate text-xs text-muted">{match.away?.name}</div>
        </div>
      </div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-[#34d6c8] transition-all" style={{ width: `${homePct}%` }} />
      </div>
    </div>
  );
}

function comparisonFromPrices({ title, modelProb, marketOdds, fallbackLabel = null, marketOddsEstimated = false, noOddsNote = null }) {
  const bookmakerLabel = marketOddsEstimated ? 'Book est.' : 'Bookmaker';
  if (!Number.isFinite(modelProb)) {
    const marketPrice = fmtPrice(marketOdds);
    return {
      title,
      badge: { label: fallbackLabel || 'Trend pick', tone: 'neutral' },
      bookmaker: { label: bookmakerLabel, odds: marketPrice || '-', probability: impliedProbability(marketOdds) ? fmtPct(impliedProbability(marketOdds)) : '-' },
      model: { odds: fallbackLabel || 'Trend pick', probability: '-' },
      edgePoints: 0,
      modelEdge: 0,
      note: noOddsNote || 'This pick comes from recent trends, so treat the bookmaker odds as a guide only.',
    };
  }

  const modelPrice = fmtPrice(1 / modelProb);
  const marketPrice = fmtPrice(marketOdds);
  const marketProb = impliedProbability(marketOdds);
  if (!modelPrice) return null;

  if (!marketPrice || !Number.isFinite(marketProb)) {
    const isModelSuggestion = modelProb >= 0.56;
    return {
      title,
      badge: { label: isModelSuggestion ? 'Model suggestion' : 'Model odds', tone: isModelSuggestion ? 'positive' : 'neutral' },
      bookmaker: { label: bookmakerLabel, odds: '-', probability: '-' },
      model: { odds: modelPrice, probability: fmtPct(modelProb) },
      edgePoints: 0,
      modelEdge: 0,
      note: noOddsNote || (isModelSuggestion
        ? 'Our model likes this from recent totals, but bookmaker odds are not available.'
        : 'Our model has a price from recent totals, but bookmaker odds are not available.'),
    };
  }

  const diff = modelProb - marketProb;
  const points = Math.abs(diff * 100).toFixed(0);
  const isClose = Math.abs(diff) < 0.02;
  const label = isClose ? 'Close to market' : diff > 0 ? `Model +${points}%` : `Bookmaker +${points}%`;
  const tone = isClose ? 'neutral' : diff > 0 ? 'positive' : 'warning';
  const note = isClose
    ? marketOddsEstimated
      ? 'No clear edge; this uses an estimated opposite-side price, so check the bookmaker first.'
      : 'No clear edge; bookmaker odds are about where we would expect.'
    : diff > 0
      ? marketOddsEstimated
        ? 'Our model rates this better than the estimated odds suggest, but check the bookmaker first.'
        : 'Our model predicts this has a better chance of hitting than the bookmaker odds suggest.'
      : marketOddsEstimated
        ? 'The estimated odds look too low for the risk, so check the bookmaker first.'
        : 'No clear edge; the bookmaker odds look too low for the risk.';
  return {
    title,
    badge: { label, tone },
    bookmaker: { label: bookmakerLabel, odds: marketPrice, probability: fmtPct(marketProb) },
    model: { odds: modelPrice, probability: fmtPct(modelProb) },
    edgePoints: Math.abs(diff * 100),
    modelEdge: diff,
    note,
  };
}

function withWinnerRiskCaution(comparison, match, market) {
  if (!comparison || !market || market.type === 'draw') return comparison;
  const teamId = market.type === 'home' ? match.home?.team_id : match.away?.team_id;
  const form = recentTeamForm(match.__allMatches || [], teamId, match.id);
  const bookmakerProb = impliedProbability(Number(comparison.bookmaker?.odds));
  const modelProb = impliedProbability(Number(comparison.model?.odds));
  const fallbackOdds = Number((match.odds || {})[market.type]);
  const selectedOdds = Number(displayThreeWayOdds(match)[market.type]);
  const fallbackProb = impliedProbability(fallbackOdds);
  const selectedProb = impliedProbability(selectedOdds);
  const pickedNoWins = (match.team_streaks || []).some((streak) => {
    const value = Number(String(streak.value || '').match(/\d+/)?.[0]);
    return streak.team === market.type && String(streak.label || '').toLowerCase() === 'no wins' && Number.isFinite(value) && value >= 5;
  });
  const poorForm = Number.isFinite(form?.pointsPerMatch) && form.pointsPerMatch < 1;
  const extremeMarketDisagreement =
    Number.isFinite(bookmakerProb) && Number.isFinite(modelProb) && Math.abs(modelProb - bookmakerProb) >= 0.2;
  const priceSourceMismatch =
    Number.isFinite(fallbackProb) && Number.isFinite(selectedProb) &&
    (Math.abs(fallbackProb - selectedProb) >= 0.1 || Math.max(fallbackOdds, selectedOdds) / Math.min(fallbackOdds, selectedOdds) >= 2.5);
  const noH2hAndMarketDisagrees = Number(match.predictions?.factors?.h2h_n || 0) === 0 && extremeMarketDisagreement;
  if (!poorForm && !pickedNoWins && !extremeMarketDisagreement && !priceSourceMismatch && !noH2hAndMarketDisagrees) return comparison;

  const reasons = [];
  if (poorForm) reasons.push(`picked team is only ${form.pointsPerMatch.toFixed(1)} PPG recently`);
  if (pickedNoWins) reasons.push('picked team has a long no-win streak');
  if (extremeMarketDisagreement) reasons.push('bookmaker market strongly disagrees');
  if (priceSourceMismatch) reasons.push('bookmaker sources are not aligned');
  if (noH2hAndMarketDisagrees) reasons.push('there is no exact H2H base for this market disagreement');

  const winnerRows = winnerProbabilityBreakdown(match) || [];
  const bookmakerFavourite = winnerRows
    .filter((row) => row.key === 'home' || row.key === 'away')
    .filter((row) => Number.isFinite(row.bookmaker))
    .sort((a, b) => b.bookmaker - a.bookmaker)[0];
  const bookmakerFavouriteText = bookmakerFavourite
    ? `${bookmakerFavourite.key === 'home' ? 'home' : 'away'} team (${teamNameForSide(bookmakerFavourite.key, match)})`
    : null;
  const contextReasons = reasons.filter((reason) => reason !== 'bookmaker market strongly disagrees');
  const note = extremeMarketDisagreement && bookmakerFavouriteText
    ? `Bookmakers favour the ${bookmakerFavouriteText}, but our model makes this a much closer game.${contextReasons.length ? ` Also check that ${contextReasons.join(' and ')}.` : ''}`
    : `Before taking this winner, check that ${reasons.join(' and ')}.`;

  return {
    ...comparison,
    badge: { label: 'Verify pick', tone: 'warning' },
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
    const odds = winnerGuidanceOdds(match);
    const comparison = withWinnerRiskCaution(comparisonFromPrices({
      title: 'Winner',
      modelProb: probs[market.type],
      marketOdds: Number(odds[market.type] ?? market.odds),
    }), match, market);
    return comparison ? { ...comparison, marketType: market.type } : null;
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
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      marketOddsEstimated: Boolean(market.odds_estimated),
      fallbackLabel: 'Trend pick',
    });
  }

  if (marketKey === 'ou_corners') {
    const line = market.line ?? 10.5;
    const hasOdds = hasDirectCornerContext(match, market);
    return comparisonFromPrices({
      title: `${market.pick || 'Corners'} ${line} Corners`,
      modelProb: hasOdds && !market.confidence_hidden ? modelProbabilityForMarket(market) : NaN,
      marketOdds: hasOdds ? Number(market.odds) : NaN,
      fallbackLabel: hasOdds ? 'Trend pick' : 'No corner odds',
      noOddsNote: 'No Sportsbet corner price is available for this side/line, so no confidence is shown.',
    });
  }

  if (marketKey === 'double_chance') {
    return comparisonFromPrices({
      title: 'Double Chance',
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      fallbackLabel: 'Model safety',
      noOddsNote: 'Our model likes this safer 1X2 angle, but bookmaker double-chance odds are not available.',
    });
  }

  if (marketKey === 'draw_no_bet') {
    return comparisonFromPrices({
      title: 'Draw No Bet',
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      marketOddsEstimated: Boolean(market.odds_estimated),
      fallbackLabel: 'DNB safety',
      noOddsNote: 'Our model likes this Draw No Bet side, but bookmaker DNB odds are not available.',
    });
  }

  return null;
}

function winnerProbabilityBreakdown(match) {
  const f = match.predictions?.factors || {};
  const probs = poissonMarketProbabilities(
    Number(f.lambda_home),
    Number(f.lambda_away),
    Number(f.dixon_coles_rho) || 0,
  );
  if (!probs) return null;

  const odds = winnerGuidanceOdds(match);
  return [
    { key: 'home', label: match.home?.short || match.home?.name || 'Home', model: probs.home, bookmaker: impliedProbability(odds.home) },
    { key: 'draw', label: 'Draw', model: probs.draw, bookmaker: impliedProbability(odds.draw) },
    { key: 'away', label: match.away?.short || match.away?.name || 'Away', model: probs.away, bookmaker: impliedProbability(odds.away) },
  ];
}

function WinnerProbabilityBreakdown({ match, comparison }) {
  const rows = match.display_summary?.winnerBreakdown || winnerProbabilityBreakdown(match);
  const pickType = comparison?.marketType || match.predictions?.winner?.type;
  const verifyPick = comparison?.badge?.label === 'Verify pick';
  if (!rows) return null;

  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2 text-xs shadow-panel">
      <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] gap-2 px-1.5 text-[11px] font-semibold uppercase text-muted">
        <span>1X2 split</span>
        <span className="text-right">Model</span>
        <span className="text-right">Bookmaker</span>
      </div>
      <div className="grid gap-1">
        {rows.map((row) => {
          const selected = row.key === pickType;
          const selectedClass = verifyPick
            ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/40'
            : 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/40';
          const selectedText = verifyPick ? 'font-semibold text-amber-800 dark:text-amber-200' : 'font-semibold text-emerald-800 dark:text-emerald-200';
          return (
            <div
              key={row.key}
              className={`grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] items-center gap-2 rounded px-1.5 py-1 ${
                selected ? selectedClass : 'text-muted'
              }`}
            >
              <span className={`truncate ${selected ? selectedText : ''}`}>{row.label}</span>
              <span className={`text-right font-mono ${selected ? selectedText : ''}`}>{fmtPct(row.model) || '-'}</span>
              <span className="text-right font-mono text-muted">{fmtPct(row.bookmaker) || '-'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function winnerActualType(match) {
  // Only completed matches are graded. A live scoreline (e.g. 1-0 at HT) is not a
  // settled result, so winner/DNB/double-chance must stay ungraded until status "FT"
  // — see hasScoreline: every settlement check keys off status === 'FT'.
  if (match?.status !== 'FT') return null;
  const homeGoals = Number(match.home?.goals);
  const awayGoals = Number(match.away?.goals);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

function winnerResultFromActual(match, type) {
  const actual = winnerActualType(match);
  if (!actual || !type) return undefined;
  return actual === type ? 'hit' : 'miss';
}

function winnerGuidanceOdds(match) {
  return displayThreeWayOdds(match);
}

function strongestBookmakerSide(odds) {
  const rows = ['home', 'draw', 'away']
    .map((type) => ({ type, odds: Number(odds?.[type]), probability: impliedProbability(Number(odds?.[type])) }))
    .filter((row) => Number.isFinite(row.odds) && row.odds > 1.01 && Number.isFinite(row.probability));
  if (!rows.length) return null;
  return rows.sort((a, b) => b.probability - a.probability)[0];
}

function sideHasNoWinsStreak(match, side, minimum = 5) {
  return (match.team_streaks || []).some((streak) => {
    const value = Number(String(streak.value || '').match(/\d+/)?.[0]);
    return streak.team === side && String(streak.label || '').toLowerCase() === 'no wins' && Number.isFinite(value) && value >= minimum;
  });
}

function withWinnerConfidenceGate(match, market) {
  if (!market?.type) return market;
  const odds = winnerGuidanceOdds(match);
  const noVig = bookmakerNoVigProbability(odds, market.type);
  if (!Number.isFinite(noVig)) return market;
  if (noVig >= WINNER_CONFIDENCE_THRESHOLD) return market;
  const gated = {
    ...market,
    lowConfidence: true,
    lowConfidenceProb: noVig,
    predictedType: market.type,
    predictedPick: market.pick || market.type,
    predictedResult: market.result,
  };
  return gated;
}

function winnerMarketWithGuidance(match, allMatches = []) {
  const market = match.predictions?.winner;
  if (!market?.type) return market || null;
  const confidenceGated = withWinnerConfidenceGate(match, market);
  if (match.status === 'FT') return confidenceGated;
  const rows = winnerProbabilityBreakdown(match);
  const selected = rows?.find((row) => row.key === market.type);
  const selectedModel = selected?.model;
  const strongestModel = rows?.reduce((best, row) => (!best || row.model > best.model ? row : best), null);
  const modelLead = Number.isFinite(selectedModel) && Number.isFinite(strongestModel?.model)
    ? selectedModel - rows.filter((row) => row.key !== market.type).reduce((best, row) => Math.max(best, row.model || 0), 0)
    : 0;
  const odds = winnerGuidanceOdds(match);
  const bookmakerSide = strongestBookmakerSide(odds);
  if (!bookmakerSide || bookmakerSide.type === market.type || bookmakerSide.type === 'draw') {
    return withWinnerConfidenceGate(match, market);
  }

  const pickedOdds = Number(odds?.[market.type]);
  const pickedBookProbability = impliedProbability(pickedOdds);
  const bookProbabilityGap = Number.isFinite(bookmakerSide.probability) && Number.isFinite(pickedBookProbability)
    ? bookmakerSide.probability - pickedBookProbability
    : 0;
  const oddsRatio = Number.isFinite(pickedOdds) && Number.isFinite(bookmakerSide.odds)
    ? pickedOdds / bookmakerSide.odds
    : 0;
  const pickedForm = recentTeamForm(allMatches || [], market.type === 'home' ? match.home?.team_id : match.away?.team_id, match.id, 8);
  const bookmakerForm = recentTeamForm(allMatches || [], bookmakerSide.type === 'home' ? match.home?.team_id : match.away?.team_id, match.id, 8);
  const pickedNoWins = sideHasNoWinsStreak(match, market.type);
  const bookmakerFormEdge = Number.isFinite(bookmakerForm?.pointsPerMatch) && Number.isFinite(pickedForm?.pointsPerMatch)
    ? bookmakerForm.pointsPerMatch - pickedForm.pointsPerMatch
    : 0;
  const noExactH2h = Number(match.predictions?.factors?.h2h_n || 0) === 0;
  const bookmakerGuardEligible = bookmakerSide.probability >= BOOKMAKER_WINNER_GUARD_THRESHOLD;
  const strongMarketDisagreement = bookProbabilityGap >= 0.18 || oddsRatio >= 2;
  const majorMarketDisagreement = bookProbabilityGap >= 0.25 || oddsRatio >= 3;
  const modelIsNotClear = !Number.isFinite(selectedModel) || selectedModel < 0.5 || modelLead <= 0.1;
  const modelCanOverrideBookmaker = Number.isFinite(selectedModel) && selectedModel >= 0.6 && modelLead >= 0.18;
  const contextSupportsBookmaker = pickedNoWins || bookmakerFormEdge >= 0.35 || noExactH2h;

  const shouldGuideToBookmaker =
    bookmakerGuardEligible &&
    !modelCanOverrideBookmaker &&
    (majorMarketDisagreement || (strongMarketDisagreement && modelIsNotClear && contextSupportsBookmaker));
  if (!shouldGuideToBookmaker) return withWinnerConfidenceGate(match, market);

  const guided = {
    ...market,
    pick: teamNameForSide(bookmakerSide.type, match),
    type: bookmakerSide.type,
    odds: bookmakerSide.odds,
    probability: Number.isFinite(rows?.find((row) => row.key === bookmakerSide.type)?.model)
      ? Number(rows.find((row) => row.key === bookmakerSide.type).model.toFixed(4))
      : market.probability,
    result: winnerResultFromActual(match, bookmakerSide.type) || market.result,
    guidance: {
      type: 'bookmaker_guard',
      originalPick: market.pick,
      originalType: market.type,
      reason: majorMarketDisagreement
        ? 'Direct bookmaker market strongly overrode a model lean.'
        : 'Bookmaker and context overrode a low-conviction model lean.',
    },
  };
  return withWinnerConfidenceGate(match, guided);
}

function displayWinnerMarket(match, allMatches = []) {
  const precomputed = match.display_markets?.winner?.market;
  if (!precomputed) return winnerMarketWithGuidance(match, allMatches);
  if (precomputed.guidance?.type !== 'bookmaker_guard') return precomputed;
  const liveGuided = winnerMarketWithGuidance(match, allMatches);
  return liveGuided?.type === precomputed.type && liveGuided?.guidance?.type === 'bookmaker_guard'
    ? precomputed
    : liveGuided;
}

function displayWinnerComparison(match, allMatches = [], winner = null) {
  const precomputed = match.display_markets?.winner;
  if (precomputed?.comparison && precomputed?.market?.type === winner?.type && precomputed?.market?.guidance?.type === winner?.guidance?.type) {
    return precomputed.comparison || modelVsBookmakerComparison({ ...match, __allMatches: allMatches }, 'winner', winner);
  }
  return modelVsBookmakerComparison({ ...match, __allMatches: allMatches }, 'winner', winner);
}

function winnerModelProbability(match, winner = match.predictions?.winner) {
  const pickType = winner?.type;
  if (!pickType) return null;
  const rows = winnerProbabilityBreakdown(match);
  const selected = rows?.find((row) => row.key === pickType);
  return Number.isFinite(selected?.model) ? selected.model : null;
}

function winnerPredictionSide(match, winner = match.predictions?.winner) {
  const side = winner?.type;
  return side === 'home' || side === 'away' || side === 'draw' ? side : null;
}

function winnerPredictionCardClass(match, side, winner = match.predictions?.winner) {
  const predictedSide = winnerPredictionSide(match, winner);
  if (predictedSide !== side) return 'border-line bg-field/60';
  if (winner?.result === 'hit') return 'border-emerald-400 bg-emerald-200 ring-1 ring-emerald-500 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:ring-emerald-500/50';
  if (winner?.result === 'miss') return 'border-red-300 bg-red-50 ring-1 ring-red-300 dark:border-red-500/40 dark:bg-red-500/15 dark:ring-red-500/40';
  return 'border-accent/50 bg-accent-soft ring-1 ring-accent/25';
}

function winnerPredictionScoreClass(match, winner = match.predictions?.winner) {
  if (winnerPredictionSide(match, winner) !== 'draw') return match.status === 'FT' ? 'rounded-md bg-header px-3 py-2 text-sm text-header-fg' : 'text-xs text-faint';
  if (winner?.result === 'hit') return 'rounded-md border border-emerald-400 bg-emerald-200 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-500 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/50';
  if (winner?.result === 'miss') return 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-300 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/40';
  return 'rounded-md border border-accent/50 bg-accent-soft px-3 py-2 text-sm text-accent-fg ring-1 ring-accent/25 dark:text-accent';
}

function WinnerPredictionMeta({ match, side, modelProbability, winner = match.predictions?.winner }) {
  if (!winner || winnerPredictionSide(match, winner) !== side) {
    return <div className="mt-2 h-7" aria-hidden="true" />;
  }
  const modelText = fmtPct(modelProbability);
  const predictionLabel = side === 'draw' ? 'Draw' : 'Prediction';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex h-7 items-center text-[11px] font-semibold uppercase tracking-wide text-faint">{predictionLabel}</span>
      {winner.lowConfidence && <span className="inline-flex h-7 items-center rounded-md bg-amber-100 px-2 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Caution</span>}
      {modelText && <span className="inline-flex h-7 items-center gap-1 font-medium text-muted">Model<span className="font-semibold text-ink">{modelText}</span></span>}
      {winner.result && (
        <span className={`inline-flex h-7 items-center gap-1 rounded-md font-semibold leading-none ${visibleResultLabel(winner.result) ? 'px-2' : 'px-1.5'} ${resultBadgeClass(winner.result)}`}>
          {resultIcon(winner.result)}
          {visibleResultLabel(winner.result) && <span>{visibleResultLabel(winner.result)}</span>}
        </span>
      )}
    </div>
  );
}

const MARKET_CONFIG = [
  { key: 'winner', label: 'Winner', getMarket: (match, allMatches) => displayWinnerMarket(match, allMatches) },
  { key: 'draw_no_bet', label: 'Draw No Bet', getMarket: (match) => drawNoBetMarket(match) },
  { key: 'btts', label: 'BTTS' },
  { key: 'ou_goals', label: 'Goals' },
  { key: 'ou_cards', label: 'Cards', getMarket: (match, allMatches) => cardsMarketWithModelProbability(match, allMatches) },
  { key: 'ou_corners', label: 'Corners', getMarket: (match, allMatches) => cornerMarketFromStreaks(match, allMatches) },
];
const HEADLINE_STATS_MARKETS = ['winner', 'btts', 'ou_goals', 'ou_cards', 'ou_corners'];

function marketForConfig(config, match, allMatches) {
  if (config.key === 'winner') return displayWinnerMarket(match, allMatches || match.__allMatches);
  if (config.key === 'draw_no_bet') return drawNoBetMarket(match);
  const precomputed = match.display_markets?.[config.key === 'ou_goals' ? 'goals' : config.key === 'ou_cards' ? 'cards' : config.key === 'ou_corners' ? 'corners' : config.key]?.market;
  if (precomputed) return config.key === 'ou_corners' ? withCornerBookmakerOdds(match, capGenericCornerMarket(match, precomputed)) : precomputed;
  if (config.getMarket) {
    const market = config.getMarket(match, allMatches || match.__allMatches);
    return config.key === 'ou_corners' ? withCornerBookmakerOdds(match, market) : market;
  }
  return match.predictions?.[config.key];
}

function comparisonHasBookmakerOdds(comparison) {
  const value = Number(comparison?.bookmaker?.odds);
  return Number.isFinite(value) && value > 1.01;
}

function marketHasBookmakerOdds(market) {
  const value = Number(market?.odds);
  return Number.isFinite(value) && value > 1.01;
}

function displayableMarketForKey(match, key, market) {
  if (!market) return false;
  if (['winner', 'draw_no_bet', 'btts', 'ou_goals', 'double_chance'].includes(key)) return true;
  if (match.status === 'FT' && ['hit', 'miss', 'pass'].includes(market.result)) return true;
  if (key === 'ou_cards') return marketHasBookmakerOdds(market);
  if (key === 'ou_corners') return hasDirectCornerContext(match, market);
  return true;
}

function comparisonForMarket(match, marketKey, market, precomputedComparison) {
  const hydratedMarket = marketKey === 'ou_corners' ? capGenericCornerMarket(match, withCornerBookmakerOdds(match, market)) : market;
  if (
    marketKey === 'ou_corners' &&
    hydratedMarket?.confidence_hidden
  ) {
    return precomputedComparison || modelVsBookmakerComparison(match, marketKey, hydratedMarket);
  }
  if (
    marketKey === 'ou_corners' &&
    ((marketHasBookmakerOdds(hydratedMarket) && !comparisonHasBookmakerOdds(precomputedComparison)) ||
      hydratedMarket?.model_probability_cap)
  ) {
    return modelVsBookmakerComparison(match, marketKey, hydratedMarket);
  }
  return precomputedComparison || modelVsBookmakerComparison(match, marketKey, hydratedMarket);
}

function headlineStatsMarkets(match) {
  if (match.status !== 'FT' || String(match.date || '') < PREDICTION_TRACKING_START_DATE) return [];
  return HEADLINE_STATS_MARKETS
    .map((key) => match.predictions?.[key])
    .filter((market) => market?.result === 'hit' || market?.result === 'miss');
}

function marketRowsForMatch(match, allMatches) {
  return MARKET_CONFIG.map((config) => {
    const market = marketForConfig(config, match, allMatches);
    const precomputedKey = config.key === 'ou_goals' ? 'goals' : config.key === 'ou_cards' ? 'cards' : config.key === 'ou_corners' ? 'corners' : config.key;
    return {
      ...config,
      market,
      comparison: config.key === 'winner'
        ? displayWinnerComparison(match, allMatches, market)
        : comparisonForMarket(match, config.key, market, match.display_markets?.[precomputedKey]?.comparison),
    };
  }).filter((row) => displayableMarketForKey(match, row.key, row.market));
}

function suggestedPickForMatch(match, allMatches) {
  const predictions = match.predictions || {};
  const precomputed = match.display_markets || {};
  const displayWinner = displayWinnerMarket(match, allMatches);
  const winnerComparison = precomputed.winner?.comparison || displayWinnerComparison(match, allMatches, displayWinner);
  const displayBtts = precomputed.btts?.market || displayBttsMarket(predictions.btts, match);
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = withCornerBookmakerOdds(match, capGenericCornerMarket(match, precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches)));
  const cornersComparison = comparisonForMarket(match, 'ou_corners', cornerMarket, precomputed.corners?.comparison);
  const drawNoBet = precomputed.draw_no_bet?.market || drawNoBetMarket(match);
  const drawNoBetComparison = precomputed.draw_no_bet?.comparison || modelVsBookmakerComparison(match, 'draw_no_bet', drawNoBet);
  const displayableCards = displayableMarketForKey(match, 'ou_cards', displayCards) ? displayCards : null;
  const displayableCorners = displayableMarketForKey(match, 'ou_corners', cornerMarket) ? cornerMarket : null;

  return suggestedMarketPick([
    { label: 'Winner', market: displayWinner, comparison: winnerComparison, modelProbability: precomputed.winner?.modelProbability ?? winnerModelProbability(match, displayWinner) },
    { label: 'Draw No Bet', market: drawNoBet, comparison: drawNoBetComparison, modelProbability: precomputed.draw_no_bet?.modelProbability ?? modelProbabilityForMarket(drawNoBet) },
    { label: 'BTTS', market: displayBtts, comparison: bttsComparison, modelProbability: precomputed.btts?.modelProbability },
    { label: 'Goals', market: predictions.ou_goals, comparison: goalsComparison, modelProbability: precomputed.goals?.modelProbability },
    { label: 'Cards', market: displayableCards, comparison: cardsComparison, modelProbability: precomputed.cards?.modelProbability },
    match.status !== 'FT' || predictions.ou_corners
      ? { label: 'Corners', market: displayableCorners, comparison: cornersComparison, modelProbability: precomputed.corners?.modelProbability }
      : null,
  ]);
}

function secondaryMarketScore(row) {
  if (!row?.market) return -Infinity;
  const modelProbability = Number(row.modelProbability ?? modelProbabilityForMarket(row.market));
  const edge = Number(row.comparison?.modelEdge || 0);
  const hasPositiveEdge = row.comparison?.badge?.tone === 'positive' && edge > 0;
  const hasOdds = marketHasBookmakerOdds(row.market) || comparisonHasBookmakerOdds(row.comparison);
  const hiddenConfidencePenalty = row.market?.confidence_hidden ? -0.08 : 0;
  return edge + (Number.isFinite(modelProbability) ? modelProbability / 10 : 0) + (hasPositiveEdge ? 0.05 : 0) + (hasOdds ? 0.02 : -0.04) + hiddenConfidencePenalty;
}

function secondaryTipRowsForMatch({ compactPick, displayBtts, bttsComparison, goalsMarket, goalsComparison, displayCards, cardsComparison, cornerMarket, cornersComparison, drawNoBet, drawNoBetComparison }) {
  const compactLabel = String(compactPick?.label || '').toLowerCase();
  const drawNoBetRow = drawNoBet
    ? {
      key: 'draw_no_bet',
      label: 'Draw No Bet',
      market: drawNoBet,
      comparison: drawNoBetComparison,
      modelProbability: modelProbabilityForMarket(drawNoBet),
    }
    : null;
  const rows = [
    { key: 'btts', label: 'BTTS', market: displayBtts, comparison: bttsComparison },
    { key: 'goals', label: 'Goals', market: goalsMarket, comparison: goalsComparison },
    { key: 'cards', label: 'Cards', market: displayCards, comparison: cardsComparison },
    { key: 'corners', label: 'Corners', market: cornerMarket, comparison: cornersComparison },
  ];

  const availableRows = rows.filter((row) => row.market && !(compactLabel && row.label.toLowerCase() === compactLabel));
  const resolvedDrawNoBetRow = compactLabel === 'draw no bet' ? null : drawNoBetRow;
  const selectedKeys = new Set(
    [...availableRows]
      .sort((a, b) => secondaryMarketScore(b) - secondaryMarketScore(a))
      .slice(0, resolvedDrawNoBetRow ? 3 : 4)
      .map((row) => row.key),
  );
  const resolved = [
    ...(resolvedDrawNoBetRow ? [resolvedDrawNoBetRow] : []),
    ...rows.filter((row) => selectedKeys.has(row.key)),
  ];

  return resolved.map((row) => ({
    ...row,
    modelProbability: row.market?.confidence_hidden ? null : row.modelProbability ?? modelProbabilityForMarket(row.market),
    edgeBadge: !row.market?.confidence_hidden && row.comparison?.badge?.tone === 'positive' && row.comparison.edgePoints > 0 ? row.comparison.badge.label : null,
  }));
}

function positiveEdgesForMatch(match, allMatches) {
  return marketRowsForMatch(match, allMatches)
    .filter((row) => row.comparison?.badge?.tone === 'positive' && row.comparison.modelEdge > 0)
    .sort((a, b) => b.comparison.modelEdge - a.comparison.modelEdge);
}

function topDivisionRank(league) {
  return leagueSortRank(league) < LEAGUE_PRIORITY.length;
}

function dataQualityForMatch(match) {
  const f = match.predictions?.factors || {};
  const odds = displayThreeWayOdds(match);
  const signals = [];
  const cautions = [];

  if (odds.home && odds.draw && odds.away) signals.push('1X2 odds');
  else cautions.push('missing 1X2 odds');

  if (match.sportsbet_odds?.event_url) signals.push('direct Sportsbet');
  else cautions.push('bookmaker link fallback');

  if (Number.isFinite(Number(f.lambda_home)) && Number.isFinite(Number(f.lambda_away))) signals.push('model expected goals');
  else cautions.push('model expected goals missing');

  if ((match.team_streaks || []).length >= 2) signals.push('team streaks');
  else cautions.push('thin team streaks');

  const h2hCount = Number(f.h2h_n || 0);
  if (h2hCount >= 3 || (match.h2h_streaks || []).length >= 2) signals.push('H2H context');
  else cautions.push('limited H2H');

  if (topDivisionRank(match.league)) signals.push('top division');

  const score = signals.length - Math.min(cautions.length, 2);
  const label = score >= 4 ? 'Data strong' : score >= 2 ? 'Data usable' : 'Data weak';
  const tone = score >= 4 ? 'positive' : score >= 2 ? 'neutral' : 'warning';
  return { label, tone, score, signals, cautions };
}

function confidenceForMatch(match, allMatches) {
  const edges = positiveEdgesForMatch(match, allMatches);
  const bestEdge = edges[0]?.comparison?.modelEdge || 0;
  const quality = dataQualityForMatch(match);

  if (!edges.length) {
    return { label: 'Winner caution', tone: 'warning', reason: 'Winner is predicted, but the model does not see enough value over the bookmaker.', edge: 0, quality };
  }
  if (bestEdge >= 0.05 && quality.score >= 3) {
    return { label: 'Strong edge', tone: 'positive', reason: `${edges[0].label} ${edges[0].comparison.badge.label}`, edge: bestEdge, quality };
  }
  if (bestEdge >= 0.02 && quality.score >= 2) {
    return { label: 'Watchlist', tone: 'neutral', reason: `${edges[0].label} ${edges[0].comparison.badge.label}`, edge: bestEdge, quality };
  }
  return { label: 'Data weak', tone: 'warning', reason: quality.cautions[0] || 'Thin supporting data', edge: bestEdge, quality };
}

function normalizeConfidenceLabel(confidence) {
  if (!confidence) return confidence;
  if (confidence.label === 'Avoid' || confidence.label === 'Avoid picking a winner') return { ...confidence, label: 'Winner caution' };
  return confidence;
}

function loadMatchConfidence(match, allMatches) {
  return normalizeConfidenceLabel(match.display_summary?.confidence) || confidenceForMatch(match, allMatches);
}

function confidenceDetailCopy(confidence) {
  if (!confidence) return 'Confidence is based on odds, model inputs, recent team context, H2H, and data availability.';
  if (confidence.tone === 'positive') return 'Strong confidence means the model sees a usable edge and enough supporting data behind it.';
  if (confidence.tone === 'warning') return 'Lower confidence means the pick depends on thin data, missing odds, or signals that disagree.';
  return 'Usable confidence means there is enough context to show the pick, but it still needs normal caution.';
}

function QualityDetailPanel({ confidence }) {
  const quality = confidence?.quality;
  if (!confidence || !quality) return null;
  const signals = Array.isArray(quality.signals) ? quality.signals : [];
  const cautions = Array.isArray(quality.cautions) ? quality.cautions : [];

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Data confidence</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{confidenceDetailCopy(confidence)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <ConfidenceBadge confidence={confidence} />
          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold leading-none ${toneBadgeClass(quality.tone)}`}>
            {quality.label}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
          <div className="text-xs font-semibold uppercase text-emerald-800 dark:text-emerald-300">Supporting signals</div>
          {signals.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {signals.map((item) => (
                <span key={item} className="rounded-md border border-emerald-200 bg-surface px-2 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-emerald-900 dark:text-emerald-200">No strong supporting data was available for this match.</p>
          )}
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="text-xs font-semibold uppercase text-amber-900 dark:text-amber-300">Caution notes</div>
          {cautions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cautions.map((item) => (
                <span key={item} className="rounded-md border border-amber-200 bg-surface px-2 py-1 text-xs font-semibold text-amber-900 dark:border-amber-500/40 dark:text-amber-200">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-amber-950 dark:text-amber-200">No major caution flags for the available data.</p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs leading-5 text-muted">
        Score {quality.score ?? 0}: odds, direct bookmaker link, model expected goals, team streaks, H2H context and league quality all contribute to this label.
      </div>
    </div>
  );
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

function formStrengthLabel(pickedPpm, otherPpm) {
  if (!Number.isFinite(pickedPpm)) return 'Recent form context';
  if (!Number.isFinite(otherPpm)) return 'Recent form context';
  const diff = Number(pickedPpm.toFixed(1)) - Number(otherPpm.toFixed(1));
  if (diff > 0.05) return 'Recent form is stronger';
  if (diff < -0.05) return 'Recent form is a caution';
  return 'Recent form is similar';
}

function formRecordLabel(form, context) {
  const ppm = Number(form?.pointsPerMatch);
  if (!Number.isFinite(ppm)) return context;
  if (ppm >= 1.6) return `${context} backs the pick`;
  if (ppm >= 1.0) return `${context} is mixed`;
  return `${context} is a caution`;
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

function recentH2hMeetings(allMatches, match, maxN = 6) {
  const homeId = match.home?.team_id;
  const awayId = match.away?.team_id;
  if (!homeId || !awayId || !Array.isArray(allMatches)) return [];

  if (Array.isArray(match.h2h_history) && match.h2h_history.length) {
    return match.h2h_history.slice(0, maxN).map((meeting, index) => {
      const actualHomeGoals = Number(meeting.home_score ?? meeting.h_scored);
      const actualAwayGoals = Number(meeting.away_score ?? meeting.a_scored);
      const actualHomeName = meeting.home_name || '';
      const actualAwayName = meeting.away_name || '';
      const currentHomeName = match.home?.name || '';
      const currentAwayName = match.away?.name || '';
      const actualHomeIsCurrentHome = actualHomeName === currentHomeName;
      const actualAwayIsCurrentHome = actualAwayName === currentHomeName;
      const currentHomeGoals =
        Number.isFinite(Number(meeting.current_home_scored)) ? Number(meeting.current_home_scored) :
          actualHomeIsCurrentHome ? actualHomeGoals :
            actualAwayIsCurrentHome ? actualAwayGoals :
              Number(meeting.h_scored);
      const currentAwayGoals =
        Number.isFinite(Number(meeting.current_away_scored)) ? Number(meeting.current_away_scored) :
          actualHomeName === currentAwayName ? actualHomeGoals :
            actualAwayName === currentAwayName ? actualAwayGoals :
              Number(meeting.a_scored);
      const winner =
        currentHomeGoals > currentAwayGoals ? 'home' :
          currentAwayGoals > currentHomeGoals ? 'away' :
            'draw';
      const totalGoals = actualHomeGoals + actualAwayGoals;
      const xg = h2hMeetingXg(meeting);
      return {
        id: meeting.event_id || `${match.id}-h2h-${index}`,
        date: meeting.date,
        venue: meeting.venue,
        homeName: meeting.home_name || match.home?.name,
        awayName: meeting.away_name || match.away?.name,
        score: `${actualHomeGoals}-${actualAwayGoals}`,
        winner,
        totalGoals,
        btts: actualHomeGoals > 0 && actualAwayGoals > 0,
        cards: meeting.cards,
        corners: meeting.corners,
        xg,
      };
    });
  }

  return allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === match.id) return false;
      const samePair =
        (sameTeamId(m.home?.team_id, homeId) && sameTeamId(m.away?.team_id, awayId)) ||
        (sameTeamId(m.home?.team_id, awayId) && sameTeamId(m.away?.team_id, homeId));
      return samePair && typeof m.home?.goals === 'number' && typeof m.away?.goals === 'number';
    })
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)))
    .slice(0, maxN)
    .map((m) => {
      const currentHomeWasHome = sameTeamId(m.home?.team_id, homeId);
      const currentHomeGoals = currentHomeWasHome ? m.home.goals : m.away.goals;
      const currentAwayGoals = currentHomeWasHome ? m.away.goals : m.home.goals;
      const winner =
        currentHomeGoals > currentAwayGoals ? 'home' :
          currentAwayGoals > currentHomeGoals ? 'away' :
            'draw';
      const totalGoals = currentHomeGoals + currentAwayGoals;
      const btts = currentHomeGoals > 0 && currentAwayGoals > 0;
      const homeXg = Number(m.xg?.home);
      const awayXg = Number(m.xg?.away);
      const xg = Number.isFinite(homeXg) && Number.isFinite(awayXg)
        ? {
            home: currentHomeWasHome ? homeXg : awayXg,
            away: currentHomeWasHome ? awayXg : homeXg,
          }
        : null;
      return {
        id: m.id,
        date: m.date,
        venue: m.venue,
        homeName: currentHomeWasHome ? m.home?.name : m.away?.name,
        awayName: currentHomeWasHome ? m.away?.name : m.home?.name,
        score: `${currentHomeGoals}-${currentAwayGoals}`,
        winner,
        totalGoals,
        btts,
        cards: m.predictions?.ou_cards?.actual,
        corners: m.actuals?.corners_total,
        xg,
      };
    });
}

function h2hMeetingXg(meeting) {
  const source = meeting?.xg || meeting?.expected_goals;
  const home = Number(source?.home ?? meeting?.home_xg ?? meeting?.xg_home);
  const away = Number(source?.away ?? meeting?.away_xg ?? meeting?.xg_away);
  if (Number.isFinite(home) && Number.isFinite(away)) return { home, away };

  const currentHome = Number(source?.current_home ?? meeting?.current_home_xg);
  const currentAway = Number(source?.current_away ?? meeting?.current_away_xg);
  if (Number.isFinite(currentHome) && Number.isFinite(currentAway)) {
    return { home: currentHome, away: currentAway };
  }
  return null;
}

function formatH2hXg(xg) {
  if (!xg) return '-';
  const home = Number(xg.home);
  const away = Number(xg.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return '-';
  return `${home.toFixed(1)}-${away.toFixed(1)}`;
}

function h2hContextForMatch(allMatches, match) {
  const meetings = recentH2hMeetings(allMatches, match, 10);
  const summary = recentH2hSummary(allMatches, match, 10) || h2hDuelSummary(match) || h2hFactorSummary(match);
  const homeName = teamNameForCopy(match.home?.name || 'Home');
  const awayName = teamNameForCopy(match.away?.name || 'Away');
  const lastHomeWin = meetings.find((meeting) => meeting.winner === 'home');
  const lastAwayWin = meetings.find((meeting) => meeting.winner === 'away');
  const bttsHits = meetings.filter((meeting) => meeting.btts).length;
  const over25Hits = meetings.filter((meeting) => meeting.totalGoals > 2.5).length;
  return {
    meetings,
    summary,
    homeName,
    awayName,
    lastHomeWin,
    lastAwayWin,
    bttsText: meetings.length ? `${bttsHits}/${meetings.length} BTTS` : 'BTTS unknown',
    goalsText: meetings.length ? `${over25Hits}/${meetings.length} over 2.5` : 'goals unknown',
  };
}

function h2hTrendSampleCount(match) {
  const counts = (match.h2h_streaks || [])
    .map((streak) => {
      const text = String(streak?.value || '');
      const fraction = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (fraction) return Number(fraction[2]);
      const whole = text.match(/^(\d+)$/);
      return whole ? Number(whole[1]) : 0;
    })
    .filter((count) => Number.isFinite(count) && count > 0);
  return counts.length ? Math.max(...counts) : 0;
}

function advantageContextForMatch(allMatches, match) {
  const h2h = h2hContextForMatch(allMatches, match);
  const h2hHomeWins = h2h.summary?.count ? h2h.summary.homeWins : h2h.meetings.filter((meeting) => meeting.winner === 'home').length;
  const h2hAwayWins = h2h.summary?.count ? h2h.summary.awayWins : h2h.meetings.filter((meeting) => meeting.winner === 'away').length;
  const h2hDraws = h2h.summary?.count ? h2h.summary.draws : h2h.meetings.filter((meeting) => meeting.winner === 'draw').length;
  const h2hCount = h2h.summary?.count || h2h.meetings.length;
  const h2hTrendCount = h2hTrendSampleCount(match);
  const homeForm = recentTeamForm(allMatches, match.home?.team_id, match.id, 10, { side: 'home' });
  const awayForm = recentTeamForm(allMatches, match.away?.team_id, match.id, 10, { side: 'away' });
  const f = match.predictions?.factors || {};
  const homeRank = Number(f.h_rank ?? match.home?.rank);
  const awayRank = Number(f.a_rank ?? match.away?.rank);
  const homeElo = Number(f.home_elo);
  const awayElo = Number(f.away_elo);

  const groundLeader =
    homeForm && awayForm
      ? homeForm.pointsPerMatch > awayForm.pointsPerMatch ? match.home?.short || h2h.homeName :
        awayForm.pointsPerMatch > homeForm.pointsPerMatch ? match.away?.short || h2h.awayName :
          'Even'
      : homeForm ? match.home?.short || h2h.homeName :
        awayForm ? match.away?.short || h2h.awayName :
          'Not enough form';
  const h2hLeader =
    h2hHomeWins > h2hAwayWins ? h2h.homeName :
      h2hAwayWins > h2hHomeWins ? h2h.awayName :
        h2hCount ? 'Even' : groundLeader;
  const h2hDetail =
    h2hCount
      ? `${h2hHomeWins}-${h2hAwayWins}-${h2hDraws} over last ${h2hCount}`
      : h2hTrendCount
        ? `H2H trend sample up to ${h2hTrendCount}; ground form used`
        : homeForm && awayForm
          ? `Home ${homeForm.count} at home · Away ${awayForm.count} away`
          : 'Needs exact H2H rows';
  const tableLeader =
    Number.isFinite(homeRank) && Number.isFinite(awayRank)
      ? homeRank < awayRank ? match.home?.short || h2h.homeName :
        awayRank < homeRank ? match.away?.short || h2h.awayName :
          'Even'
      : 'No table data';
  const eloLeader =
    Number.isFinite(homeElo) && Number.isFinite(awayElo)
      ? homeElo > awayElo ? match.home?.short || h2h.homeName :
        awayElo > homeElo ? match.away?.short || h2h.awayName :
          'Even'
      : 'No Elo data';

  return {
    h2h,
    homeForm,
    awayForm,
    items: [
      { label: 'H2H advantage', value: h2hLeader, detail: h2hDetail },
      { label: 'Ground form', value: groundLeader, detail: homeForm && awayForm ? `Home ${homeForm.pointsPerMatch.toFixed(1)} PPG · Away ${awayForm.pointsPerMatch.toFixed(1)} PPG` : 'Needs more local form' },
      { label: 'Table edge', value: tableLeader, detail: Number.isFinite(homeRank) && Number.isFinite(awayRank) ? `Rank ${homeRank} vs ${awayRank}` : 'Unavailable' },
      { label: 'Elo edge', value: eloLeader, detail: Number.isFinite(homeElo) && Number.isFinite(awayElo) ? `${homeElo.toFixed(0)} vs ${awayElo.toFixed(0)}` : 'Unavailable' },
    ],
  };
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

function h2hDuelSummary(match) {
  const duel = match.h2h_duel;
  if (!duel) return null;
  const homeWins = Number(duel.home_wins);
  const awayWins = Number(duel.away_wins);
  const draws = Number(duel.draws);
  if (!Number.isFinite(homeWins) || !Number.isFinite(awayWins) || !Number.isFinite(draws)) return null;
  const count = homeWins + awayWins + draws;
  if (!count) return null;
  return { count, homeWins, awayWins, draws };
}

function modelExpectedGoals(match) {
  const f = match.predictions?.factors || {};
  const home = Number(f.lambda_home);
  const away = Number(f.lambda_away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, total: home + away };
}

function formatExpectedGoals(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(1);
}

function expectedGoalsShape(xg) {
  if (!xg) return null;
  if (xg.total >= 3.05) return 'open game with chances for both sides';
  if (xg.total >= 2.55) return 'game with enough goal threat to respect the over';
  if (xg.total <= 2.15) return 'tight, lower-scoring game';
  return 'balanced game where one goal can change the read';
}

function stableNarrativeIndex(match, salt, count) {
  if (!count) return 0;
  const seed = `${match.id || ''}|${match.date || ''}|${match.home?.name || ''}|${match.away?.name || ''}|${salt}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % count;
}

function pickNarrative(match, salt, options) {
  return options[stableNarrativeIndex(match, salt, options.length)];
}

function expectedGoalsWinnerLead(match, winner) {
  const xg = modelExpectedGoals(match);
  const homeName = teamNameForCopy(match.home?.name || 'Home');
  const awayName = teamNameForCopy(match.away?.name || 'Away');
  if (winner.guidance?.type === 'bookmaker_guard') {
    const rows = winnerProbabilityBreakdown(match) || [];
    const originalType = winner.guidance.originalType;
    const originalName = teamNameForSide(originalType, match) || winner.guidance.originalPick || 'the original model side';
    const guidedName = teamNameForSide(winner.type, match) || winner.pick || 'the bookmaker side';
    const originalModel = fmtPct(rows.find((row) => row.key === originalType)?.model);
    const guidedModel = fmtPct(rows.find((row) => row.key === winner.type)?.model);
    const originalModelText = originalModel ? ` at ${originalModel}` : '';
    const guidedModelText = guidedModel ? ` (${guidedModel} model)` : '';
    const xgText = xg
      ? ` Expected goals were ${homeName} ${formatExpectedGoals(xg.home)} vs ${awayName} ${formatExpectedGoals(xg.away)}.`
      : '';
    return `Raw model leaned ${originalName}${originalModelText}, but the visible winner was guarded to ${guidedName}${guidedModelText} because the bookmaker market strongly disagreed.${xgText}`;
  }
  if (!xg) {
    if (winner.type === 'draw') return 'The model sees this as tight, but expected-goals detail is not available for this match.';
    const pickedName = winner.type === 'away' ? awayName : homeName;
    return `The model leans ${pickedName}, but expected-goals detail is not available for this match.`;
  }

  const homeXg = formatExpectedGoals(xg.home);
  const awayXg = formatExpectedGoals(xg.away);
  const gap = Math.abs(xg.home - xg.away);
  if (winner.type === 'draw' || gap < 0.18) {
    return `This looks tight: our model has ${homeName} around ${homeXg} expected goals and ${awayName} around ${awayXg}.`;
  }

  const pickedName = winner.type === 'away' ? awayName : homeName;
  const otherName = winner.type === 'away' ? homeName : awayName;
  const pickedXg = winner.type === 'away' ? awayXg : homeXg;
  const otherXg = winner.type === 'away' ? homeXg : awayXg;
  return `The model leans ${pickedName} because its expected-goals read is stronger: about ${pickedXg} for ${pickedName} vs ${otherXg} for ${otherName}.`;
}

function matchExpectationSummary(match, allMatches) {
  const stored = match.display_summary?.expectationSummary || match.display_summary?.plainEnglishSummary;
  if (typeof stored === 'string' && stored.trim()) return stored.trim();

  const homeName = teamNameForCopy(match.home?.name || 'Home');
  const awayName = teamNameForCopy(match.away?.name || 'Away');
  const xg = modelExpectedGoals(match);
  const statusPrefix = match.status === 'FT' ? 'The pre-match read was' : 'Expect';
  const shape = expectedGoalsShape(xg);
  const displayBtts = match.display_markets?.btts?.market || displayBttsMarket(match.predictions?.btts, match);
  const goals = match.display_markets?.goals?.market || match.predictions?.ou_goals;
  const suggested = suggestedPickForMatch(match, allMatches);
  const confidence = loadMatchConfidence(match, allMatches);
  const sentences = [];
  const homeXg = xg ? formatExpectedGoals(xg.home) : null;
  const awayXg = xg ? formatExpectedGoals(xg.away) : null;

  if (xg && shape) {
    sentences.push(pickNarrative(match, 'expectation-shape', [
      `${statusPrefix} a ${shape}: ${homeName} about ${homeXg} model expected goals, ${awayName} about ${awayXg}.`,
      `This profiles as a ${shape}. The model has ${homeName} near ${homeXg} expected goals and ${awayName} near ${awayXg}.`,
      `The game shape is ${shape}: ${homeName} ${homeXg} and ${awayName} ${awayXg} on the model expected-goals read.`,
      `Main read: not a runaway either way. The expected-goals line is ${homeName} ${homeXg}, ${awayName} ${awayXg}, which points to a ${shape}.`,
      `The model is pricing the match through chances first: ${homeName} ${homeXg} expected goals, ${awayName} ${awayXg}; that makes it a ${shape}.`,
    ]));
  } else {
    sentences.push(pickNarrative(match, 'expectation-missing-xg', [
      `${statusPrefix} based on model probabilities, bookmaker odds and recent team signals; model expected-goals detail is missing here.`,
      `This read leans on probabilities, market prices and recent team signals because the model expected-goals detail is missing.`,
      `There is no clean expected-goals number for this match, so the summary is driven by the market, team context and model probabilities.`,
    ]));
  }

  const marketReads = [];
  if (goals?.pick) marketReads.push(`${goals.pick} ${goals.line ?? 2.5} goals`);
  if (displayBtts?.pick) marketReads.push(`BTTS ${displayBtts.pick}`);
  if (marketReads.length) {
    const marketText = marketReads.join(' and ');
    sentences.push(pickNarrative(match, 'expectation-markets', [
      `That points toward ${marketText} rather than a blind winner bet.`,
      `The cleaner angle is ${marketText}; the winner market is less clear.`,
      `For the match markets, ${marketText} fits the model better than forcing a side.`,
      `That is why the card favours ${marketText} over a straight home-or-away call.`,
      `The totals read carries more weight here, with ${marketText} the main direction.`,
    ]));
  }

  if (suggested?.market) {
    const probability = fmtPct(suggested.modelProbability ?? modelProbabilityForMarket(suggested.market));
    const probabilityText = probability ? ` at ${probability}` : '';
    const suggestedText = `${suggested.label} ${formatMarketDetail(suggested.market)}${probabilityText}`;
    const confidenceText = confidence.label.toLowerCase();
    sentences.push(pickNarrative(match, 'expectation-suggested', [
      `Best pick is ${suggestedText}; ${confidenceText} means check the caution notes before staking.`,
      `The pick to notice is ${suggestedText}. With ${confidenceText}, it is a lean, not a guarantee.`,
      `Strongest card here is ${suggestedText}; the ${confidenceText} tag tells you how much trust to place in it.`,
      `If taking one view from this match, start with ${suggestedText}. The ${confidenceText} label is the risk guide.`,
      `Suggested pick: ${suggestedText}. Treat the ${confidenceText} label as the warning level around the data.`,
    ]));
  } else if (confidence?.label) {
    sentences.push(pickNarrative(match, 'expectation-no-pick', [
      `${confidence.label}: there is not enough clean edge to force a suggested pick.`,
      `${confidence.label}: the data is readable, but no market separates enough to call out.`,
      `${confidence.label}: better to watch this one than turn a thin edge into a forced pick.`,
    ]));
  }

  return sentences.slice(0, 3).join(' ');
}

function winnerRationale(match, allMatches, winnerMarket = null) {
  const w = winnerMarket || match.predictions?.winner;
  const f = match.predictions?.factors || {};
  if (!w) return null;
  const homeName = teamNameForCopy(match.home?.name || 'Home');
  const awayName = teamNameForCopy(match.away?.name || 'Away');
  const pickedName = w.type === 'away' ? awayName : w.type === 'draw' ? 'Draw' : homeName;
  const pickedTeamId = w.type === 'away' ? match.away?.team_id : w.type === 'home' ? match.home?.team_id : null;
  const otherTeamId = w.type === 'away' ? match.home?.team_id : w.type === 'home' ? match.away?.team_id : null;
  const priceComparison = modelVsBookmakerComparison({ ...match, __allMatches: allMatches }, 'winner', w);
  const parts = [];

  parts.push(expectedGoalsWinnerLead(match, w));
  if (priceComparison?.badge?.label === 'Verify pick') {
    parts.push('This is not a clean value bet yet; the market/context mismatch needs checking before trusting the winner.');
  }
  if (w.guidance?.type === 'bookmaker_guard') {
    parts.push(`Guided pick changed from ${w.guidance.originalPick} because the bookmaker/context signal strongly favours ${pickedName}.`);
  }
  const pickedOverall = recentTeamForm(allMatches, pickedTeamId, match.id, 10);
  const otherOverall = recentTeamForm(allMatches, otherTeamId, match.id, 10);
  if (pickedOverall && w.type !== 'draw') {
    const formLead = formStrengthLabel(pickedOverall.pointsPerMatch, otherOverall?.pointsPerMatch);
    const otherPpm = otherOverall ? `; the opponent is at ${pointText(otherOverall.pointsPerMatch)} per game` : '';
    parts.push(`${formLead}: ${pointText(pickedOverall.pointsPerMatch)} per game over the last ${formatCopyNumber(pickedOverall.count)} matches${otherPpm}.`);
  }

  if (w.type === 'home') {
    const venueForm = recentTeamForm(allMatches, pickedTeamId, match.id, 10, { venue: match.venue });
    const homeForm = venueForm?.count >= 2 ? venueForm : recentTeamForm(allMatches, pickedTeamId, match.id, 10, { side: 'home' });
    if (homeForm) {
      const label = venueForm?.count >= 2 && match.venue ? 'at this ground' : 'at home';
      parts.push(`${formRecordLabel(homeForm, `The ${label} record`)}: ${formatFormRecord(homeForm)} in the last ${formatCopyNumber(homeForm.count)} matches.`);
    }
  } else if (w.type === 'away') {
    const awayForm = recentTeamForm(allMatches, pickedTeamId, match.id, 10, { side: 'away' });
    if (awayForm) {
      parts.push(`${formRecordLabel(awayForm, 'The away record')}: ${formatFormRecord(awayForm)} in the last ${formatCopyNumber(awayForm.count)} matches.`);
    }
  }

  const h2h = recentH2hSummary(allMatches, match, 10) || h2hFactorSummary(match);
  if (h2h?.count) {
    const h2hLeaderSide =
      h2h.homeWins > h2h.awayWins ? 'home' :
      h2h.awayWins > h2h.homeWins ? 'away' :
      null;
    const h2hWinner = h2hLeaderSide ? teamNameForSide(h2hLeaderSide, match) : 'neither side';
    const h2hGoalText = Number.isFinite(h2h.homeGoals) && Number.isFinite(h2h.awayGoals)
      ? `, with goals ${h2h.homeGoals}-${h2h.awayGoals}`
      : '';
    const lastWinText = h2h.lastWinner && h2h.lastWinner !== 'draw'
      ? ` The most recent win went to ${h2h.lastWinner === 'home' ? homeName : awayName}.`
      : '';
    const h2hPrefix =
      !h2hLeaderSide ? 'Head to head is balanced' :
        w.type === 'draw' ? `Head to head leans ${h2hWinner}` :
          h2hLeaderSide === w.type ? `Head to head also backs ${pickedName}` :
            `Head to head is a caution because it leans ${h2hWinner}`;
    parts.push(`${h2hPrefix} across the last ${h2h.count}: ${homeName} ${h2h.homeWins}, ${awayName} ${h2h.awayWins}, draws ${h2h.draws}${h2hGoalText}.${lastWinText}`);
    if (h2h.atVenueCount >= 2 && match.venue) {
      parts.push(`At this ground, the last ${h2h.atVenueCount} meetings are ${homeName} ${h2h.atVenueHomeWins}, ${awayName} ${h2h.atVenueAwayWins}, draws ${h2h.atVenueDraws}.`);
    }
  } else if (match.h2h_streaks?.length) {
    const trend = match.h2h_streaks.find((s) => h2hWinnerTrendBias(s));
    if (trend) {
      const trendSide = h2hWinnerTrendBias(trend);
      const trendTeamName = teamNameForSide(trend.team, match);
      const trendText = `${trendTeamName} ${trend.label.toLowerCase()}${trend.value ? ` in ${trend.value}` : ''}`;

      if (w.type === 'draw') {
        parts.push(`The H2H note is mixed rather than a clean winner edge: ${trendText}.`);
      } else if (trendSide === w.type) {
        parts.push(`The useful H2H clue also backs ${pickedName}: ${trendText}.`);
      } else {
        parts.push(`The H2H caution is ${trendText}, so this pick is leaning more on the model edge than the matchup history.`);
      }
    }
  }

  const hRank = f.h_rank ?? match.home?.rank;
  const aRank = f.a_rank ?? match.away?.rank;
  if (hRank && aRank) {
    const rankLeader = Number(hRank) < Number(aRank) ? homeName : Number(aRank) < Number(hRank) ? awayName : null;
    const rankLeaderSide = Number(hRank) < Number(aRank) ? 'home' : Number(aRank) < Number(hRank) ? 'away' : null;
    if (rankLeader) {
      if (w.type === 'draw') {
        parts.push(`League position leans ${rankLeader}, so the draw pick is going against that table edge: ${hRank} vs ${aRank}.`);
      } else if (rankLeaderSide === w.type) {
        parts.push(`League position also points to ${rankLeader}: ${hRank} vs ${aRank}.`);
      } else {
        parts.push(`League position is a caution because it points to ${rankLeader}: ${hRank} vs ${aRank}.`);
      }
    }
  }

  if (!priceComparison) {
    const odds = displayThreeWayOdds(match);
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
  const b = displayBttsMarket(match.predictions?.btts, match);
  const f = match.predictions?.factors || {};
  if (!b) return null;
  const lh = Number(f.lambda_home);
  const la = Number(f.lambda_away);
  const parts = [];
  if (Number.isFinite(lh) && Number.isFinite(la)) {
    const pBoth = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
    if (b.pick === 'No') {
      parts.push(`BTTS No is the read because the model gives about ${((1 - pBoth) * 100).toFixed(0)}% chance that at least one team does not score.`);
    } else {
      parts.push(`BTTS Yes is the read because the model gives about ${(pBoth * 100).toFixed(0)}% chance both teams score.`);
    }
  }
  const streakHints = (match.team_streaks || []).filter((s) => {
    const l = (s.label || '').toLowerCase();
    return l.includes('without clean sheet') || l.includes('no clean sheet') || l.includes('no goals') || l.includes('clean sheet');
  });
  if (streakHints.length) {
    const first = streakHints[0];
    const teamName = teamNameForCopy(teamNameForSide(first.team, match));
    const label = (first.label || '').toLowerCase();
    const supportsYes = label.includes('without clean sheet') || label.includes('no clean sheet');
    const supportsNo = label.includes('no goals') || (label.includes('clean sheet') && !supportsYes);
    const pickSupported = (b.pick === 'Yes' && supportsYes) || (b.pick === 'No' && supportsNo);
    const cue = pickSupported ? 'supports the BTTS pick' : 'is a BTTS caution';
    parts.push(`${teamName} recent form ${cue}: ${first.label}${first.value ? ` (${first.value})` : ''}`);
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
    ? `Goals lean Over ${line}: about ${pct}% chance of 3 or more goals, with ${total} model expected goals.`
    : `Goals lean Under ${line}: about ${underPct}% chance the match stays below 3 goals, even though there is still ${pct}% goal-risk. Model expected goals total is ${total}.`;
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

function cardsMarketWithModelProbability(match, allMatches) {
  const market = match.predictions?.ou_cards;
  if (!market) return null;
  if (match.status === 'FT') return market;
  const homeCards = recentTeamCards(allMatches, match.home?.team_id, match.id);
  const awayCards = recentTeamCards(allMatches, match.away?.team_id, match.id);
  const available = [homeCards, awayCards].filter(Boolean);
  if (!available.length) return market;
  const average = available.reduce((sum, item) => sum + item.avg, 0) / available.length;
  const line = Number(market.line ?? 4.5);
  const modelProbability = marketProbabilityFromTotalAverage(market, average);
  if (Number.isFinite(modelProbability) && modelProbability < 0.5) {
    const guidedPick = oppositeTotalPick(market.pick);
    const oddsInfo = cardBookmakerOddsInfo(match, line, guidedPick);
    const guidedMarket = {
      ...market,
      pick: guidedPick,
      line,
      odds: oddsInfo.odds,
      odds_estimated: oddsInfo.estimated,
      model_probability: 1 - modelProbability,
      model_average_total: average,
      trendConflict: {
        pick: market.pick,
        line,
        model_probability: modelProbability,
      },
    };
    return {
      ...guidedMarket,
      result: marketResultFromActual(guidedMarket, market.actual),
    };
  }
  return {
    ...market,
    model_probability: modelProbability,
    model_average_total: average,
  };
}

function cardsRationale(match, allMatches) {
  const c = cardsMarketWithModelProbability(match, allMatches);
  if (!c) return null;
  const homeCards = recentTeamCards(allMatches, match.home?.team_id, match.id);
  const awayCards = recentTeamCards(allMatches, match.away?.team_id, match.id);
  if (!homeCards && !awayCards) return null;
  const parts = [];
  if (homeCards) {
    parts.push(`${teamNameForCopy(match.home?.name || 'Home')} matches averaging ${homeCards.avg.toFixed(1)} total cards over last ${homeCards.count}`);
  }
  if (awayCards) {
    parts.push(`${teamNameForCopy(match.away?.name || 'Away')} matches averaging ${awayCards.avg.toFixed(1)} total cards over last ${awayCards.count}`);
  }
  const line = Number(c.line ?? 4.5);
  if (Number.isFinite(line)) {
    const averages = [homeCards?.avg, awayCards?.avg].filter((value) => Number.isFinite(value));
    const avg = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
    if (Number.isFinite(avg)) {
      parts.unshift(`Card model leans ${c.pick} ${line} from recent averages.`);
      if (c.trendConflict) {
        const pct = fmtPct(c.trendConflict.model_probability);
        parts.push(`Opposite ${c.trendConflict.pick} signal is only ${pct || 'below 50%'}, so ${c.pick} ${line} is the guided market.`);
      }
    }
  }
  return parts.join(' · ');
}

function recentTeamCorners(allMatches, teamId, currentMatchId, n = 5) {
  if (!teamId || !Array.isArray(allMatches)) return null;
  const played = allMatches
    .filter((m) => {
      if (m.status !== 'FT' || m.id === currentMatchId) return false;
      if (m.home?.team_id !== teamId && m.away?.team_id !== teamId) return false;
      return typeof m.actuals?.corners_total === 'number';
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, n);
  if (!played.length) return null;
  const total = played.reduce((sum, m) => sum + m.actuals.corners_total, 0);
  return { count: played.length, avg: total / played.length };
}

function cornersRationale(match, allMatches, cornerMarket) {
  if (!cornerMarket) return null;
  const homeCorners = recentTeamCorners(allMatches, match.home?.team_id, match.id);
  const awayCorners = recentTeamCorners(allMatches, match.away?.team_id, match.id);
  const parts = [];
  const line = Number(cornerMarket.line ?? 10.5);
  if (cornerMarket.trendConflict) {
    parts.push(`Corner model leans ${cornerMarket.pick} ${line} from recent averages.`);
    parts.push(`Streak note is mixed: ${cornerMarket.trendConflict.sourceValue} for ${cornerMarket.trendConflict.pick} ${line}.`);
  } else if (cornerMarket.sourceValue) {
    parts.push(`Corner trend ${cornerMarket.sourceValue} for ${cornerMarket.pick} ${line}.`);
  }
  if (homeCorners) {
    parts.push(`${teamNameForCopy(match.home?.name || 'Home')} matches averaging ${homeCorners.avg.toFixed(1)} corners over last ${homeCorners.count}`);
  }
  if (awayCorners) {
    parts.push(`${teamNameForCopy(match.away?.name || 'Away')} matches averaging ${awayCorners.avg.toFixed(1)} corners over last ${awayCorners.count}`);
  }
  return parts.join(' · ');
}

function localTodayDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${date.year}-${date.month}-${date.day}`;
}

function addDaysToIsoDate(iso, days) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function weekStartMonday(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
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
  return arrayValue(data?.leagues).flatMap((league) => {
    const leagueName = textValue(league?.name, 'Unknown league');
    return arrayValue(league?.matches).map((match) => ({
      ...match,
      league: leagueName,
      leagueId: league?.id || leagueName,
      leagueLogo: leagueLogo(league),
    }));
  });
}

function teamPreferenceKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function favoriteTeamSet(favoriteTeams = []) {
  return new Set(favoriteTeams.map(teamPreferenceKey).filter(Boolean));
}

function matchHasFavoriteTeam(match, favoriteSet) {
  if (!favoriteSet?.size) return false;
  return favoriteSet.has(teamPreferenceKey(match.home?.name)) || favoriteSet.has(teamPreferenceKey(match.away?.name));
}

function teamOptionsFromMatches(matches) {
  const teams = new Map();
  arrayValue(matches).forEach((match) => {
    [match.home?.name, match.away?.name].forEach((name) => {
      const key = teamPreferenceKey(name);
      if (key && !teams.has(key)) teams.set(key, String(name || '').trim());
    });
  });
  return [...teams.values()].sort((a, b) => a.localeCompare(b));
}

function describeLoadError(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'type' in err) return `Data load failed: ${err.type}`;
  return 'Data load failed. Refresh the page or restart the dev server.';
}

const LEAGUE_PRIORITY = [
  'Premier League',
  'LaLiga',
  'Bundesliga',
  'Serie A',
  'Ligue 1',
  'UEFA Champions League',
  'UEFA Europa League',
  'UEFA Conference League',
  'Brasileirão Betano',
  'CONMEBOL Libertadores',
  'A-League Men',
  'FIFA World Cup',
  'International Friendly Games',
  'Eredivisie',
  'Primeira Liga',
  'MLS',
  'Scottish Premiership',
  'J1 League',
  'Championship',
  'League One',
  'League Two',
];

function leagueSortRank(league) {
  const rank = LEAGUE_PRIORITY.indexOf(league);
  return rank === -1 ? LEAGUE_PRIORITY.length : rank;
}

function compareLeagues(a, b) {
  const left = textValue(a, 'Unknown league');
  const right = textValue(b, 'Unknown league');
  const rankCompare = leagueSortRank(left) - leagueSortRank(right);
  return rankCompare || left.localeCompare(right);
}

function favoriteLeagueRank(league, favoriteLeagues) {
  const index = favoriteLeagues.indexOf(league);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function compareLeagueGroups(a, b, favoriteLeagues) {
  const leagueCompare = compareLeagues(a.league, b.league);
  if (leagueSortRank(a.league) < LEAGUE_PRIORITY.length || leagueSortRank(b.league) < LEAGUE_PRIORITY.length) {
    return leagueCompare;
  }
  const favoriteCompare = favoriteLeagueRank(a.league, favoriteLeagues) - favoriteLeagueRank(b.league, favoriteLeagues);
  return favoriteCompare || leagueCompare;
}

function groupMatchesByLeague(matches, favoriteLeagues = []) {
  const grouped = new Map();

  arrayValue(matches).forEach((match) => {
    const leagueName = textValue(match?.league, 'Unknown league');
    if (!grouped.has(leagueName)) {
      grouped.set(leagueName, {
        league: leagueName,
        leagueId: match.leagueId,
        logo: match.leagueLogo,
        matches: [],
      });
    }

    grouped.get(leagueName).matches.push(match);
  });

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      matches: group.matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    }))
    .sort((a, b) => compareLeagueGroups(a, b, favoriteLeagues));
}

function groupMatchesForDisplay(matches, favoriteLeagues = [], favoriteTeams = []) {
  const favSet = favoriteTeamSet(favoriteTeams);
  const favoriteMatches = matches.filter((match) => matchHasFavoriteTeam(match, favSet));
  const regularMatches = favSet.size ? matches.filter((match) => !matchHasFavoriteTeam(match, favSet)) : matches;
  const groups = groupMatchesByLeague(regularMatches, favoriteLeagues);
  if (!favoriteMatches.length) return groups;

  return [
    {
      league: 'Favourite teams',
      leagueId: 'favorite-teams',
      logo: null,
      matches: favoriteMatches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
      isFavoriteTeamGroup: true,
    },
    ...groups,
  ];
}

function groupFavoriteMatches(matches, favoriteLeagues = [], favoriteTeams = []) {
  const groups = [];
  const usedMatchKeys = new Set();
  const favSet = favoriteTeamSet(favoriteTeams);
  const favoriteTeamMatches = matches.filter((match) => matchHasFavoriteTeam(match, favSet));

  if (favoriteTeamMatches.length) {
    favoriteTeamMatches.forEach((match) => usedMatchKeys.add(`${match.league}-${match.id}`));
    groups.push({
      league: 'Favourite teams',
      leagueId: 'favorite-teams',
      logo: null,
      matches: favoriteTeamMatches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
      isFavoriteTeamGroup: true,
      isFavoritesViewGroup: true,
    });
  }

  favoriteLeagues.forEach((leagueName) => {
    const leagueMatches = matches
      .filter((match) => match.league === leagueName)
      .filter((match) => !usedMatchKeys.has(`${match.league}-${match.id}`))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!leagueMatches.length) return;
    leagueMatches.forEach((match) => usedMatchKeys.add(`${match.league}-${match.id}`));
    groups.push({
      league: leagueName,
      leagueId: `favorite-league-${teamPreferenceKey(leagueName)}`,
      logo: leagueMatches[0]?.leagueLogo || null,
      matches: leagueMatches,
      isFavoriteLeagueGroup: true,
      isFavoritesViewGroup: true,
    });
  });

  return groups;
}

function normalizeAllTimeSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const total = Number(summary.total);
  const finished = Number(summary.finished);
  const upcoming = Number(summary.upcoming);
  const accuracy = Number(summary.accuracy);
  const oddsHit = Number(summary.oddsTotals?.hit);
  const oddsLoss = Number(summary.oddsTotals?.loss);
  if (![total, finished, upcoming, accuracy].every(Number.isFinite)) return null;
  return {
    total,
    finished,
    upcoming,
    accuracy,
    oddsTotals: {
      hit: Number.isFinite(oddsHit) ? oddsHit : 0,
      loss: Number.isFinite(oddsLoss) ? oddsLoss : 0,
    },
  };
}

function summarize(matches, allTimeSummary = null) {
  const storedSummary = normalizeAllTimeSummary(allTimeSummary);
  if (storedSummary) return storedSummary;

  const total = matches.length;
  const finished = matches.filter((m) => m.status === 'FT').length;
  const upcoming = matches.filter((m) => m.status === 'upcoming').length;
  const settledMarkets = matches.flatMap(headlineStatsMarkets);
  const hits = settledMarkets.filter((market) => market.result === 'hit').length;
  const accuracy = settledMarkets.length ? Math.round((hits / settledMarkets.length) * 100) : 0;
  const oddsTotals = marketReturnTotals(settledMarkets);

  return { total, finished, upcoming, accuracy, oddsTotals };
}

function summarizeResultsByMarket(matches, allMatches = matches) {
  const suggestedSettled = matches
    .map((match) => suggestedPickForMatch(match, allMatches)?.market)
    .filter((market) => market?.result === 'hit' || market?.result === 'miss');
  const suggestedHits = suggestedSettled.filter((market) => market.result === 'hit');
  const suggestedMisses = suggestedSettled.filter((market) => market.result === 'miss');
  const suggestedRow = {
    key: 'suggested',
    label: 'Suggested pick',
    total: suggestedSettled.length,
    hits: suggestedHits.length,
    misses: suggestedMisses.length,
    hitRate: suggestedSettled.length ? Math.round((suggestedHits.length / suggestedSettled.length) * 100) : 0,
    ...marketReturnTotals(suggestedSettled),
    net: 0,
  };
  suggestedRow.oddsHit = suggestedRow.hit;
  suggestedRow.oddsMiss = suggestedRow.loss;
  suggestedRow.oddsPriced = suggestedRow.priced;
  suggestedRow.net = suggestedRow.oddsHit - suggestedRow.oddsMiss;
  delete suggestedRow.hit;
  delete suggestedRow.loss;
  delete suggestedRow.priced;

  return [suggestedRow, ...MARKET_CONFIG.map((config) => {
    const settled = matches
      .map((match) => marketForConfig(config, match, allMatches))
      .filter((market) => market?.result === 'hit' || market?.result === 'miss');
    const hits = settled.filter((market) => market.result === 'hit');
    const misses = settled.filter((market) => market.result === 'miss');
    const oddsTotals = marketReturnTotals(settled);
    return {
      ...config,
      total: settled.length,
      hits: hits.length,
      misses: misses.length,
      hitRate: settled.length ? Math.round((hits.length / settled.length) * 100) : 0,
      oddsHit: oddsTotals.hit,
      oddsMiss: oddsTotals.loss,
      oddsPriced: oddsTotals.priced,
      net: oddsTotals.hit - oddsTotals.loss,
    };
  })];
}

function trackedFinishedMatches(matches) {
  return matches
    .filter((match) => match.status === 'FT' && String(match.date || '') >= PREDICTION_TRACKING_START_DATE)
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)));
}

function matchHasReviewFilter(match, reviewFilter, allMatches) {
  if (!reviewFilter || reviewFilter === 'all') return true;
  if (reviewFilter === 'suggested') return Boolean(suggestedPickForMatch(match, allMatches)?.market);
  const config = MARKET_CONFIG.find((item) => item.key === reviewFilter);
  return config ? Boolean(marketForConfig(config, match, allMatches)) : true;
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

function Stat({ icon: Icon, label, value, tone = 'text-ink', sublabel = '', className = '', featured = false }) {
  return (
    <div className={`min-w-0 border-b border-line bg-surface px-3 py-3 text-center sm:border-b-0 sm:border-r sm:px-4 last:border-r-0 ${featured ? 'bg-surface-2/70' : ''} ${className}`}>
      <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-normal text-muted">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 flex justify-center ${featured ? 'text-2xl' : 'text-xl'} font-semibold sm:text-2xl ${tone}`}>{value}</div>
      {sublabel && <div className="mt-1 hidden text-[11px] font-semibold uppercase text-faint sm:block">{sublabel}</div>}
    </div>
  );
}

function MarketPill({ label, market, edgeBadge, modelProbability }) {
  const detail = market ? formatMarketDetail(market) : 'No pick';
  return (
    <div className={`flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 sm:px-3 ${market ? marketPillClass(market.result) : 'border-line bg-surface-2 text-faint'}`}>
      <span className="shrink-0 text-xs font-medium text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {edgeBadge && (
          <span className="hidden items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 sm:inline-flex">
            <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
            <span>{edgeBadge}</span>
          </span>
        )}
        <span className={`flex min-w-0 items-center justify-end gap-1 text-right text-sm font-semibold leading-5 ${market ? marketValueClass(market.result) : 'text-faint'}`}>
          {(market?.result === 'hit' || market?.result === 'miss') && resultIcon(market.result)}
          <span className="min-w-0 truncate">{detail || '-'}</span>
        </span>
      </span>
    </div>
  );
}

function WinProbabilityBar({ rows }) {
  if (!Array.isArray(rows) || rows.length !== 3) return null;
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const order = ['home', 'draw', 'away'];
  const vals = order.map((k) => (Number.isFinite(byKey[k]?.model) ? byKey[k].model : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const pct = vals.map((v) => (v / total) * 100);
  const ranked = [...vals].sort((a, b) => b - a);
  // Favoured outcome reads in accent; the other two recede to neutral greys.
  // Greens/reds stay reserved for hit/miss results.
  const tone = (v) => (v === ranked[0] ? 'bg-accent' : v === ranked[1] ? 'bg-faint' : 'bg-faint/40');
  return (
    <div className="mt-3 sm:mt-4">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Model win probability</div>
      <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-inset ring-line">
        {order.map((k, i) => (
          <div
            key={k}
            style={{ width: `${pct[i]}%` }}
            className={tone(vals[i])}
            title={`${byKey[k]?.label || k}: ${fmtPct(byKey[k]?.model)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px]">
        <span className="text-ink">{fmtPct(byKey.home?.model) || '-'}</span>
        <span className="text-faint">{fmtPct(byKey.draw?.model) || '-'}</span>
        <span className="text-ink">{fmtPct(byKey.away?.model) || '-'}</span>
      </div>
    </div>
  );
}

function teamStreakBadge(match, side) {
  const streaks = Array.isArray(match.team_streaks) ? match.team_streaks : [];
  const valOf = (re) => {
    const s = streaks.find((x) => x.team === side && re.test(String(x.label || '')));
    const n = s ? parseInt(String(s.value), 10) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  const wins = valOf(/^wins$/i);
  const unbeaten = valOf(/^no losses$/i);
  if (wins >= 2) return { text: `${wins} wins`, title: `On a ${wins}-game winning streak` };
  if (unbeaten >= 3) return { text: `${unbeaten} unbeaten`, title: `Unbeaten in ${unbeaten}` };
  return null;
}

function TeamStreakBadge({ match, side }) {
  const badge = teamStreakBadge(match, side);
  if (!badge) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent ring-1 ring-inset ring-accent/30"
      title={badge.title}
    >
      {badge.text}
    </span>
  );
}

function suggestedMarketPick(candidates, isFinished = false) {
  const available = candidates.filter((item) => item?.market);
  if (!available.length) return null;
  return available
    .map((item, index) => ({
      ...item,
      index,
      modelEdge: Number(item.comparison?.modelEdge || 0),
      modelProbability: Number(item.modelProbability ?? modelProbabilityForMarket(item.market)),
    }))
    .map((item) => {
      if (item.market?.confidence_hidden) return { ...item, suggestionScore: item.modelEdge - 0.08 };
      if (item.label !== 'Winner') return { ...item, suggestionScore: item.modelEdge };
      const strongModel = Number.isFinite(item.modelProbability) && item.modelProbability >= 0.6;
      const hasBookmakerConflict = item.market?.lowConfidence || item.market?.guidance?.type === 'bookmaker_guard' || item.comparison?.badge?.tone === 'warning';
      if (!strongModel || hasBookmakerConflict) return { ...item, suggestionScore: item.modelEdge - 0.12 };
      return { ...item, suggestionScore: item.modelEdge + 0.015 };
    })
    .sort((a, b) => {
      if (isFinished) {
        const resultRank = (item) => item.market?.result === 'hit' ? 2 : item.market?.result === 'miss' ? 0 : 1;
        const resultDiff = resultRank(b) - resultRank(a);
        if (resultDiff) return resultDiff;
      }
      const edgeDiff = b.suggestionScore - a.suggestionScore;
      if (edgeDiff) return edgeDiff;
      const probDiff = (Number.isFinite(b.modelProbability) ? b.modelProbability : 0) - (Number.isFinite(a.modelProbability) ? a.modelProbability : 0);
      if (probDiff) return probDiff;
      return a.index - b.index;
    })[0];
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-panel">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value ?? '-'}</div>
    </div>
  );
}

function toneBadgeClass(tone) {
  if (tone === 'positive') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (tone === 'warning') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300';
  return 'border-line bg-surface-2 text-muted dark:border-line dark:bg-white/5 dark:text-slate-200';
}

function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold leading-none ${toneBadgeClass(confidence.tone)}`}>
      {confidence.label}
    </span>
  );
}

function QualityBadges({ quality, compact = false }) {
  if (!quality) return null;
  const items = compact ? [quality.label] : [quality.label, ...quality.signals.slice(0, 3)];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className={`rounded-md border px-2 py-1 text-xs font-semibold leading-none ${toneBadgeClass(item === quality.label ? quality.tone : 'neutral')}`}>
          {item}
        </span>
      ))}
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
      className={`inline-flex h-11 w-full items-center justify-center rounded-md border px-3 text-sm font-semibold shadow-panel transition duration-150 ease-out-soft active:scale-[0.98] sm:w-52 sm:px-5 ${bookmaker.buttonClass}`}
      aria-label={`Open this market on ${bookmaker.name}`}
    >
      {bookmaker.logoSrc ? (
        <span className="inline-flex items-center justify-center">
          <img src={bookmaker.logoSrc} alt="" className="h-8 w-auto max-w-36 sm:h-9 sm:max-w-40" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
    </a>
  );
}

function TeamFavoriteButton({ teamName, favoriteTeams = [], onToggleFavoriteTeam }) {
  const cleanTeamName = String(teamName || '').trim();
  const isFavorite = favoriteTeamSet(favoriteTeams).has(teamPreferenceKey(cleanTeamName));
  if (!cleanTeamName || !onToggleFavoriteTeam) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleFavoriteTeam(cleanTeamName);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition duration-150 ease-out-soft active:scale-95 ${
        isFavorite
          ? 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/10'
          : 'border-line bg-white/80 dark:bg-white/10 text-faint hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/20'
      }`}
      aria-label={`${isFavorite ? 'Remove' : 'Add'} ${cleanTeamName} as favourite team`}
      title={`${isFavorite ? 'Remove from' : 'Add to'} favourite teams`}
    >
      <Star className={`h-4 w-4 ${isFavorite ? 'fill-amber-400' : ''}`} aria-hidden="true" />
    </button>
  );
}

function BookmakerSelect({ value, onChange, compact = false }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel ${
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

function ResponsibleGamblingNotice({ compact = false }) {
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-950 shadow-panel dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 ${compact ? 'px-3 py-2 text-xs leading-5' : 'p-4 text-sm leading-6'}`}>
      <div className="font-semibold">Prediction information only. 18+</div>
      <p className={compact ? 'mt-1' : 'mt-2'}>
        This dashboard is a predictor and guide only. It does not take bets, process wagering payments, or have bookmaker affiliation. Bookmaker links are external handoffs only. You are responsible for your own decisions and outcomes. Be sensible and gamble responsibly.
      </p>
      <div className={`flex flex-wrap gap-x-3 gap-y-1 ${compact ? 'mt-1' : 'mt-2'}`}>
        <a href={GAMBLING_HELP_URL} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          Gambling Help Online
        </a>
        <span>1800 858 858</span>
        <a href={BETSTOP_URL} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          BetStop
        </a>
      </div>
    </div>
  );
}

function SettingsView({
  bookmakerId,
  onBookmakerChange,
  onBack,
  leagueOptions = [],
  favoriteLeagues = [],
  onFavoriteLeaguesChange,
  teamOptions = [],
  favoriteTeams = [],
  onFavoriteTeamsChange,
}) {
  const selectedBookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [profile, setProfile] = useState(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');
  const [billingError, setBillingError] = useState('');
  const [profileForm, setProfileForm] = useState({ displayName: '', nickname: '', favoriteTeams });
  const [leagueToAdd, setLeagueToAdd] = useState('');
  const [dragLeague, setDragLeague] = useState('');
  const [teamToAdd, setTeamToAdd] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const { getUserProfile } = await import('../firestore-data');
        const user = getFirebaseAuth().currentUser;
        if (!user) return;
        const nextProfile = await getUserProfile(user.uid);
        if (active) {
          setProfile(nextProfile);
          setProfileForm({
            displayName: nextProfile?.displayName || user.displayName || '',
            nickname: nextProfile?.nickname || '',
            favoriteTeams: Array.isArray(nextProfile?.favoriteTeams) ? nextProfile.favoriteTeams : favoriteTeams,
          });
          if (Array.isArray(nextProfile?.favoriteTeams)) onFavoriteTeamsChange?.(nextProfile.favoriteTeams);
          setIsPlatformOwner(Boolean(nextProfile?.isPlatformOwner));
        }
      } catch (error) {
        if (active) {
          setProfile(null);
          setIsPlatformOwner(false);
        }
      }
    }

    loadProfile();
    return () => { active = false; };
  }, []);

  function handleProfileField(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
    setProfileMessage('');
    setProfileError('');
  }

  function updateFavoriteLeagueOrder(nextLeagues) {
    const cleanLeagues = [...new Set((nextLeagues || []).map((item) => String(item || '').trim()).filter(Boolean))]
      .filter((item) => !leagueOptions.length || leagueOptions.includes(item))
      .slice(0, 20);
    onFavoriteLeaguesChange?.(cleanLeagues);
    setProfileMessage('');
    setProfileError('');
  }

  function addFavoriteLeague() {
    const nextLeague = String(leagueToAdd || '').trim();
    if (!nextLeague || favoriteLeagues.includes(nextLeague)) return;
    updateFavoriteLeagueOrder([...favoriteLeagues, nextLeague]);
    setLeagueToAdd('');
  }

  function removeFavoriteLeague(leagueName) {
    updateFavoriteLeagueOrder(favoriteLeagues.filter((item) => item !== leagueName));
  }

  function moveFavoriteLeague(leagueName, direction) {
    const index = favoriteLeagues.indexOf(leagueName);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= favoriteLeagues.length) return;
    const next = [...favoriteLeagues];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateFavoriteLeagueOrder(next);
  }

  function dropFavoriteLeague(targetLeague) {
    if (!dragLeague || dragLeague === targetLeague) return;
    const next = favoriteLeagues.filter((item) => item !== dragLeague);
    const targetIndex = next.indexOf(targetLeague);
    if (targetIndex === -1) return;
    next.splice(targetIndex, 0, dragLeague);
    updateFavoriteLeagueOrder(next);
    setDragLeague('');
  }

  function addFavoriteTeam() {
    const nextTeam = String(teamToAdd || '').trim();
    if (!nextTeam) return;
    setProfileForm((current) => {
      const existing = favoriteTeamSet(current.favoriteTeams);
      if (existing.has(teamPreferenceKey(nextTeam))) return current;
      const next = [...(current.favoriteTeams || []), nextTeam].slice(0, MAX_FAVORITE_TEAMS);
      onFavoriteTeamsChange?.(next);
      return { ...current, favoriteTeams: next };
    });
    setTeamToAdd('');
    setProfileMessage('');
    setProfileError('');
  }

  function removeFavoriteTeam(team) {
    setProfileForm((current) => {
      const removeKey = teamPreferenceKey(team);
      const next = (current.favoriteTeams || []).filter((item) => teamPreferenceKey(item) !== removeKey);
      onFavoriteTeamsChange?.(next);
      return { ...current, favoriteTeams: next };
    });
    setProfileMessage('');
    setProfileError('');
  }

  async function saveProfile() {
    setProfileMessage('');
    setProfileError('');
    const nickname = profileForm.nickname.trim().slice(0, 40);
    if (!nickname) {
      setProfileError('Set a nickname before saving. Crowd features use nicknames for privacy.');
      return;
    }
    if (nickname.length < 2) {
      setProfileError('Nickname must be at least 2 characters.');
      return;
    }
    setProfileBusy(true);
    try {
      const { updateProfile } = await import('firebase/auth');
      const { getFirebaseAuth } = await import('../firebase');
      const { updateUserProfile } = await import('../firestore-data');
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in again before updating your profile.');

      const displayName = profileForm.displayName.trim().slice(0, 80);
      const favoriteTeams = [...new Set((profileForm.favoriteTeams || []).map((team) => String(team || '').trim()).filter(Boolean))].slice(0, MAX_FAVORITE_TEAMS);
      await updateProfile(user, { displayName });
      const savedProfile = await updateUserProfile(user.uid, { displayName, nickname, favoriteTeams });
      setProfile((current) => ({ ...(current || {}), ...savedProfile, profileUpdatedAt: new Date().toISOString() }));
      setProfileForm(savedProfile);
      onFavoriteTeamsChange?.(savedProfile.favoriteTeams || []);
      setProfileMessage('Profile updated.');
    } catch (error) {
      setProfileError(error.message || 'Profile could not be updated.');
    } finally {
      setProfileBusy(false);
    }
  }

  async function openBillingSession() {
    setBillingBusy(true);
    setBillingError('');
    setBillingMessage(hasStripeSubscription ? 'Opening billing portal...' : 'Opening secure checkout...');
    try {
      const { getFirebaseAuth } = await import('../firebase');
      const user = getFirebaseAuth().currentUser;
      if (!user) throw new Error('Sign in again before managing billing.');
      const token = await user.getIdToken();
      const response = await fetch(hasStripeSubscription ? '/api/stripe/create-portal' : '/api/stripe/create-checkout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Stripe session could not be opened.');
      }
      window.location.assign(payload.url);
    } catch (error) {
      setBillingError(error.message || 'Stripe session could not be opened.');
      setBillingMessage('');
      setBillingBusy(false);
    }
  }

  async function handleSignOut() {
    setSignOutBusy(true);
    const { signOut } = await import('firebase/auth');
    const { getFirebaseAuth } = await import('../firebase');
    await signOut(getFirebaseAuth());
  }

  const subscriptionStatus = profile?.subscriptionStatus || 'No Stripe subscription';
  const subscriptionRenewal = profile?.subscriptionCurrentPeriodEnd
    ? new Date(profile.subscriptionCurrentPeriodEnd).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const subscriptionTrialEnd = profile?.subscriptionTrialEnd
    ? new Date(profile.subscriptionTrialEnd).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const isTrialing = profile?.subscriptionStatus === 'trialing';
  const hasStripeSubscription = Boolean(
    profile?.subscriptionHasAccess ||
      profile?.subscriptionStatus === 'active' ||
      profile?.subscriptionStatus === 'trialing'
  );
  const billingActionLabel = hasStripeSubscription ? 'Manage subscription' : 'Start subscription';

  return (
    <main className="min-h-dvh bg-field pb-24 sm:pl-20 sm:pb-0 lg:pl-64">
      <header className="border-b border-line bg-surface sm:border-b-0 sm:bg-transparent">
        <div className="mx-auto max-w-5xl px-3 py-3 sm:px-6 sm:py-5 lg:px-8">
          <div className="flex w-full items-center justify-center rounded-lg border border-line bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_42%,#e8f5ff_100%)] px-2 py-2 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-white/80 dark:bg-[linear-gradient(135deg,#1d2128_0%,#15181d_42%,#123034_100%)] dark:ring-white/5 sm:hidden">
            <BrandMark className="text-3xl" />
          </div>
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-line bg-surface p-3 shadow-panel sm:mt-0 sm:p-4">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:bg-field"
              aria-label="Back to matches"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink">Settings</h1>
              <p className="mt-1 text-sm text-muted">Choose the default bookmaker used across match cards.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
        <div className="rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Default bookmaker</h2>
              <p className="mt-1 text-sm text-muted">Current choice: {selectedBookmaker.name}</p>
            </div>
            <BookmakerSelect value={selectedBookmaker.id} onChange={onBookmakerChange} />
          </div>

          <div className="mt-4 rounded-md border border-line bg-field p-3 text-sm text-muted">
            Sportsbet opens direct match pages when the Sportsbet event ID is available. Other bookmakers will open their soccer page unless their direct event URL is added to the match data.
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Account</h2>
              <p className="mt-1 text-sm text-muted">Leave this device signed out when you are finished.</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signOutBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-wait disabled:opacity-70"
            >
              {signOutBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Mail className="h-4 w-4 text-signal" aria-hidden="true" />
                Contact
              </h2>
              <p className="mt-1 text-sm text-muted">
                Send through billing, access, data, or account questions.
              </p>
              <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted">Support email</div>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-0.5 block truncate font-semibold text-ink underline-offset-2 hover:underline">
                    {SUPPORT_EMAIL}
                  </a>
                </div>
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted">Useful details</div>
                  <div className="mt-0.5 font-medium text-ink">Account email, match name, and screenshot</div>
                </div>
              </div>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=Soccer%20Stats%20support`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email support
            </a>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <UserRound className="h-4 w-4 text-signal" aria-hidden="true" />
                Profile
              </h2>
              <p className="mt-1 text-sm text-muted">Update the name admins see on your account.</p>
              {!String(profileForm.nickname || '').trim() && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  Set a nickname before using crowd features. Public vote areas show nicknames only.
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted">Name</span>
                <input
                  value={profileForm.displayName}
                  onChange={(event) => handleProfileField('displayName', event.target.value)}
                  maxLength={80}
                  className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-line"
                  placeholder="Your name"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted">Nickname required</span>
                <input
                  value={profileForm.nickname}
                  onChange={(event) => handleProfileField('nickname', event.target.value)}
                  maxLength={40}
                  required
                  className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-line"
                  placeholder="Choose a public nickname"
                />
                <span className="mt-1 block text-xs font-semibold text-muted">Shown instead of your real name in crowd votes.</span>
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted">
                Signed in as <span className="font-semibold text-ink">{profile?.email || '-'}</span>
              </div>
              <button
                type="button"
                onClick={saveProfile}
                disabled={profileBusy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-header px-3 text-sm font-semibold text-white shadow-panel hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
              >
                {profileBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
                Save profile
              </button>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3 shadow-panel">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Star className="h-4 w-4 text-muted" aria-hidden="true" />
                Favourite leagues
              </div>
              <div className="mt-3 flex gap-2">
                <select
                  value={leagueToAdd}
                  onChange={(event) => setLeagueToAdd(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-line"
                  aria-label="Add favourite league"
                >
                  <option value="">Select a league</option>
                  {leagueOptions
                    .filter((item) => !favoriteLeagues.includes(item))
                    .map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={addFavoriteLeague}
                  disabled={!leagueToAdd}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-line bg-field px-4 text-sm font-semibold text-ink shadow-panel hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {favoriteLeagues.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {favoriteLeagues.map((leagueName, index) => (
                    <div
                      key={leagueName}
                      draggable
                      onDragStart={() => setDragLeague(leagueName)}
                      onDragEnd={() => setDragLeague('')}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropFavoriteLeague(leagueName)}
                      className={`flex items-center gap-2 rounded-md border bg-field px-3 py-2 text-sm ${
                        dragLeague === leagueName ? 'border-ink opacity-70' : 'border-line'
                      }`}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-faint" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{leagueName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveFavoriteLeague(leagueName, -1)}
                          disabled={index === 0}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Move ${leagueName} up`}
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFavoriteLeague(leagueName, 1)}
                          disabled={index === favoriteLeagues.length - 1}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Move ${leagueName} down`}
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFavoriteLeague(leagueName)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-red-50 hover:text-miss dark:hover:bg-red-500/20"
                          aria-label={`Remove ${leagueName} from favourite leagues`}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Favourite leagues appear first on the dashboard. Star a league or add one here.</p>
              )}
            </div>
            <div className="rounded-lg border border-line bg-surface p-3 shadow-panel">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Star className="h-4 w-4 text-muted" aria-hidden="true" />
                Favourite teams
              </div>
              <div className="mt-3 flex gap-2">
                <select
                  value={teamToAdd}
                  onChange={(event) => setTeamToAdd(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-line"
                  aria-label="Add favourite team"
                >
                  <option value="">Select a team</option>
                  {teamOptions
                    .filter((team) => !favoriteTeamSet(profileForm.favoriteTeams).has(teamPreferenceKey(team)))
                    .map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={addFavoriteTeam}
                  disabled={!teamToAdd}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-line bg-field px-4 text-sm font-semibold text-ink shadow-panel hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {(profileForm.favoriteTeams || []).length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {profileForm.favoriteTeams.map((team) => (
                    <div key={teamPreferenceKey(team)} className="flex items-center gap-2 rounded-md border border-line bg-field px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{team}</span>
                      <button
                        type="button"
                        onClick={() => removeFavoriteTeam(team)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-red-50 hover:text-miss dark:hover:bg-red-500/20"
                        aria-label={`Remove ${team} from favourite teams`}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Favourite team matches will appear at the top of the dashboard.</p>
              )}
            </div>
            {profileMessage && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal dark:border-emerald-500/40 dark:bg-emerald-500/15">
                {profileMessage}
              </div>
            )}
            {profileError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300">
                {profileError}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <CreditCard className="h-4 w-4 text-signal" aria-hidden="true" />
                Subscription
              </h2>
              <p className="mt-1 text-sm text-muted">
                Manage your Soccer Stats Pro billing and payment method.
              </p>
              <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted">Status</div>
                  <div className="mt-0.5 font-semibold capitalize text-ink">{String(subscriptionStatus).replaceAll('_', ' ')}</div>
                </div>
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted">{isTrialing ? 'Trial ends' : 'Next renewal'}</div>
                  <div className="mt-0.5 font-semibold text-ink">{(isTrialing ? subscriptionTrialEnd || subscriptionRenewal : subscriptionRenewal) || '-'}</div>
                </div>
              </div>
              {isTrialing && (
                <p className="mt-2 text-xs font-medium text-muted">
                  Trial access stays active until the trial ends. Stripe will charge the saved payment method after the trial; without a payment method, the subscription cancels and dashboard access is removed.
                </p>
              )}
              {profile?.manualAccess && !hasStripeSubscription && (
                <p className="mt-2 text-xs font-medium text-muted">
                  Your access is currently managed by an administrator. You can still start your own subscription.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={openBillingSession}
              disabled={billingBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-not-allowed disabled:opacity-60"
            >
              {billingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
              {billingActionLabel}
            </button>
          </div>
          {billingMessage && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal dark:border-emerald-500/40 dark:bg-emerald-500/15">
              {billingMessage}
            </div>
          )}
          {billingError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300">
              {billingError}
            </div>
          )}
        </div>

        {isPlatformOwner && (
          <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4 text-signal" aria-hidden="true" />
                  Admin access
                </h2>
                <p className="mt-1 text-sm text-muted">View users, Stripe status, and manual access overrides.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  window.sessionStorage.setItem('looneyz-auth-return-path', '/dashboard/admin');
                  window.location.assign('/dashboard/admin');
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Manage users
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <ResponsibleGamblingNotice />
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
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={`flex items-center gap-1 text-sm font-semibold ${marketValueClass(market.result)}`}>
          {resultIcon(market.result)}
          {visibleResultLabel(market.result) && <span>{visibleResultLabel(market.result)}</span>}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-ink">{formatMarketDetail(market)}</span>
        <span className="text-muted">Odds {formatOdds(market.odds)}</span>
        {'actual' in market && <span className="text-muted">Actual {market.actual}</span>}
      </div>
    </div>
  );
}

function comparisonBadgeClass(tone) {
  if (tone === 'positive') return 'border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-200';
  if (tone === 'warning') return 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200';
  return 'border-line bg-surface-2 text-muted';
}

function comparisonOddsText(value) {
  return /^\d/.test(String(value)) ? `${value} odds` : value;
}

function summaryRowClass(result) {
  if (result === 'hit') return 'result-hit-row border-l-4 border-l-emerald-600';
  if (result === 'miss') return 'border border-red-300 border-l-4 border-l-red-600 bg-red-50/50 shadow-panel dark:border-red-500/40 dark:border-l-red-500 dark:bg-red-500/10';
  return 'border border-line border-l-4 border-l-slate-500 bg-surface-2 shadow-panel';
}

function ModelVsBookmakerComparison({ comparison }) {
  if (!comparison?.badge?.label) return null;
  const modelFavoured = comparison.badge.tone === 'positive';
  const bookmakerFavoured = comparison.badge.tone === 'warning';
  const bookmakerLabel = comparison.bookmaker.label || 'Bookmaker';
  const modelPanelClass = modelFavoured
    ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/40'
    : bookmakerFavoured
      ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/40'
      : 'bg-surface text-muted ring-1 ring-slate-300 dark:ring-line';

  // Expected value and quarter-Kelly, derived from the displayed fair (model) and
  // bookmaker prices. fmtPrice rounds odds to 2dp, which is fine for a displayed EV.
  const fairOdds = Number(comparison.model?.odds);
  const bookOdds = Number(comparison.bookmaker?.odds);
  const oddsEstimated = bookmakerLabel === 'Book est.';
  let evPct = null;
  let quarterKellyPct = null;
  if (Number.isFinite(fairOdds) && fairOdds > 1 && Number.isFinite(bookOdds) && bookOdds > 1) {
    const modelProb = 1 / fairOdds;
    evPct = (modelProb * bookOdds - 1) * 100;
    const kelly = (modelProb * bookOdds - 1) / (bookOdds - 1);
    quarterKellyPct = Math.max(0, kelly * 0.25) * 100;
  }

  return (
    <div className="w-full rounded-md border border-line bg-surface p-2 text-xs shadow-panel">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold text-muted">{comparison.title}</span>
        <span className={`inline-flex min-w-24 shrink-0 items-center justify-center rounded-md border px-2 py-1 font-semibold leading-none ${comparisonBadgeClass(comparison.badge.tone)}`}>
          {comparison.badge.label}
        </span>
      </div>
      <div className="grid gap-1">
        <div className="grid grid-cols-[5.5rem_5.25rem_3.5rem] items-center gap-2 rounded px-1.5 py-1">
          <span className="text-muted">{bookmakerLabel}</span>
          <span className="text-right font-mono font-semibold text-ink">{comparisonOddsText(comparison.bookmaker.odds)}</span>
          <span className="text-right font-mono text-muted">{comparison.bookmaker.probability}</span>
        </div>
        <div className={`rounded px-1.5 py-1 ${modelPanelClass}`}>
          <div className="grid grid-cols-[5.5rem_5.25rem_3.5rem] items-center gap-2">
            <span className={modelFavoured ? 'font-semibold text-emerald-800 dark:text-emerald-300' : bookmakerFavoured ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-muted'}>Model</span>
            <span className="text-right font-mono font-semibold text-ink">{comparisonOddsText(comparison.model.odds)}</span>
            <span className={`font-mono ${modelFavoured ? 'text-right font-semibold text-emerald-800 dark:text-emerald-300' : bookmakerFavoured ? 'text-right font-semibold text-amber-800 dark:text-amber-300' : 'text-right text-muted'}`}>{comparison.model.probability}</span>
          </div>
          <div className={`mt-1 leading-5 ${modelFavoured ? 'text-ink' : bookmakerFavoured ? 'text-amber-950 dark:text-amber-200' : 'text-muted'}`}>
            <span className={`font-semibold ${bookmakerFavoured ? 'text-amber-800 dark:text-amber-300' : 'text-muted'}`}>{bookmakerFavoured ? 'Caution: ' : 'Bet note: '}</span>
            {comparison.note}
          </div>
        </div>
        {evPct !== null && (
          <div className="flex items-center justify-between gap-2 rounded px-1.5 py-1">
            <span className="flex items-center gap-1 text-muted">
              Value{oddsEstimated && <span className="text-faint">(est.)</span>}
            </span>
            <span className="flex items-center gap-2 font-mono">
              <span
                className={`font-semibold ${evPct > 0.5 ? 'text-emerald-700 dark:text-emerald-300' : evPct < -0.5 ? 'text-amber-700 dark:text-amber-300' : 'text-muted'}`}
                title="Expected value per unit staked = model probability × bookmaker odds − 1"
              >
                EV {evPct >= 0 ? '+' : ''}{evPct.toFixed(1)}%
              </span>
              {quarterKellyPct > 0 && (
                <span className="text-muted" title="Suggested stake: quarter-Kelly, as a % of bankroll">
                  · ¼-Kelly {quarterKellyPct.toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        )}
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
          const displayOdds = fallbackStreakOdds(streak, match);
          return (
            <div key={`${title}-${streak.team}-${streak.label}-${index}`} className={`rounded-md border px-3 py-2 ${streakCardClass(result)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm font-semibold ${streakTextClass(result)}`}>{streak.label}</span>
                <span className={`max-w-[45%] truncate rounded bg-surface px-2 py-0.5 text-xs font-semibold ${streakMetaClass(result)}`}>
                  {displayTeam}
                </span>
              </div>
              <div className={`mt-1 flex items-center justify-between gap-2 text-xs ${streakMetaClass(result)}`}>
                <span>{streak.value}</span>
                <span>Odds {formatOdds(displayOdds)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultsReview({
  matches,
  selectedDate,
  reviewSummary,
  activeReviewFilter = 'all',
  onReviewFilterChange,
  onSelectToday,
  onMoveDate,
  onMoveWeek,
  canMovePreviousDate = true,
  canMoveNextDate = true,
  canMovePreviousWeek = true,
  canMoveNextWeek = true,
}) {
  const [reviewScope, setReviewScope] = useState('week');
  const effectiveSelectedDate = selectedDate && selectedDate !== 'all' ? selectedDate : localTodayDate();
  const selectedWeek = useMemo(() => weekStartMonday(effectiveSelectedDate), [effectiveSelectedDate]);
  const rowsForScope = useCallback((scope) => {
    const tracked = trackedFinishedMatches(matches);
    if (scope === 'date') {
      return summarizeResultsByMarket(
        tracked.filter((match) => match.date === effectiveSelectedDate),
        matches,
      ).filter((row) => row.total > 0);
    }
    if (scope === 'week') {
      return summarizeResultsByMarket(
        tracked.filter((match) => weekStartMonday(match.date) === selectedWeek),
        matches,
      ).filter((row) => row.total > 0);
    }
    return reviewSummary?.all || summarizeResultsByMarket(tracked, matches).filter((row) => row.total > 0);
  }, [effectiveSelectedDate, matches, reviewSummary, selectedWeek]);
  const scopeRows = {
    date: rowsForScope('date'),
    week: rowsForScope('week'),
    all: rowsForScope('all'),
  };
  const rows = scopeRows[reviewScope] || [];
  if (!rows.length && !scopeRows.all.length) return null;
  const best = [...rows].sort((a, b) => b.hitRate - a.hitRate)[0];
  const worst = [...rows].sort((a, b) => a.hitRate - b.hitRate)[0];
  const weekEnd = selectedWeek ? addDaysToIsoDate(selectedWeek, 6) : '';
  const isToday = effectiveSelectedDate === localTodayDate();
  const dayLabel = isToday ? 'Today' : formatDateDMY(effectiveSelectedDate);
  const weekLabel = selectedWeek
    ? `${formatDateDMY(selectedWeek).slice(0, 5)} – ${formatDateDMY(weekEnd).slice(0, 5)}`
    : 'This week';
  const insightPrefix = reviewScope === 'date' ? 'Date read' : reviewScope === 'week' ? 'Week read' : 'All-time read';
  const insight = best && worst
    ? `${insightPrefix}: ${best.label} is strongest at ${best.hitRate}%; ${worst.label} is weakest at ${worst.hitRate}%.`
    : best
      ? `${insightPrefix}: ${best.label} is the strongest market at ${best.hitRate}%.`
      : '';
  const topRows = rows.slice(0, 3);
  const lowerRows = rows.slice(3);
  const renderReviewRow = (row) => {
    const active = activeReviewFilter === row.key;
    const isSuggested = row.key === 'suggested';
    const hasPricedOdds = Number(row.oddsPriced || 0) > 0 || Number(row.oddsHit || 0) > 0 || Number(row.oddsMiss || 0) > 0;
    const rowTone =
      row.hitRate >= 55
        ? 'result-hit-row hover:border-emerald-500'
        : row.hitRate < 45
          ? 'border-red-200 bg-red-50/45 hover:border-red-300 dark:border-red-500/40 dark:bg-red-500/10'
          : 'border-line bg-field hover:border-line hover:bg-surface';
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => onReviewFilterChange?.(active ? 'all' : row.key)}
        aria-pressed={active}
        className={`rounded-md border px-2.5 py-2 text-left transition sm:px-3 ${
          active ? 'border-ink bg-surface ring-2 ring-ink/15' : rowTone
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold uppercase text-muted">
            <span>{row.label}</span>
            {isSuggested && <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-line">Primary</span>}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row.hitRate >= 55 ? 'bg-emerald-200 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' : row.hitRate < 45 ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-surface-3 text-muted'}`}>
            {row.hitRate}%
          </span>
        </div>
        <div className="mt-2 text-sm font-semibold leading-5 text-ink">{row.hits} hit / {row.misses} loss</div>
        <div className="mt-1 text-xs text-muted">
          {hasPricedOdds
            ? <>Priced odds {formatOddsTotal(row.oddsHit)} v {formatOddsTotal(row.oddsMiss)}</>
            : <>Odds not available</>}
        </div>
      </button>
    );
  };

  return (
    <section className="mt-3 rounded-lg border border-line bg-surface p-3 shadow-panel sm:mt-5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Results review</h2>
          <p className="mt-1 text-xs font-semibold text-muted">Tracked from {formatDateDMY(PREDICTION_TRACKING_START_DATE)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:min-w-[26rem]">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setReviewScope('date');
                onMoveDate?.(-1);
              }}
              disabled={!canMovePreviousDate}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous results day"
              title="Previous day"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewScope('date');
                onSelectToday?.();
              }}
              aria-pressed={reviewScope === 'date'}
              title="Jump to today"
              className={`inline-flex h-9 items-center justify-center rounded-md border px-3 transition ${
                reviewScope === 'date' ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted hover:bg-field'
              }`}
            >
              <span className="truncate">{dayLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewScope('date');
                onMoveDate?.(1);
              }}
              disabled={!canMoveNextDate}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next results day"
              title="Next day"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setReviewScope('week');
                onMoveWeek?.(-1);
              }}
              disabled={!canMovePreviousWeek}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous results week"
              title="Previous week"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setReviewScope('week')}
              aria-pressed={reviewScope === 'week'}
              title="This week"
              className={`inline-flex h-9 items-center justify-center rounded-md border px-3 transition ${
                reviewScope === 'week' ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted hover:bg-field'
              }`}
            >
              <span className="truncate">Week {weekLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewScope('week');
                onMoveWeek?.(1);
              }}
              disabled={!canMoveNextWeek}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next results week"
              title="Next week"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReviewScope('all')}
            aria-pressed={reviewScope === 'all'}
            className={`h-9 rounded-md border px-3 text-xs font-semibold transition ${
              reviewScope === 'all' ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted hover:bg-field'
            }`}
          >
            All time
          </button>
        </div>
      </div>
      {insight && (
        <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm font-semibold leading-5 text-muted">
          {insight}
        </div>
      )}
      {(best || worst) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          {best && <span className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-1 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">Best {best.label} {best.hitRate}%</span>}
          {worst && <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300">Weakest {worst.label} {worst.hitRate}%</span>}
        </div>
      )}
      {rows.length ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {topRows.map(renderReviewRow)}
          </div>
          {lowerRows.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {lowerRows.map(renderReviewRow)}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
          No resulted prediction markets in this range yet.
        </div>
      )}
    </section>
  );
}

function H2HContextPanel({ match, allMatches }) {
  const advantage = advantageContextForMatch(allMatches, match);
  const context = advantage.h2h;
  const { meetings, summary } = context;
  const h2hStreaks = match.h2h_streaks || [];
  if (!summary?.count && !meetings.length && !h2hStreaks.length) return null;
  const hasMeetingStats = meetings.length > 0;
  const displayedMeetings = meetings.slice(0, 5);
  const h2hXgCount = displayedMeetings.filter((meeting) => meeting.xg).length;

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Head to head context</h3>
          {summary?.count && (
            <p className="mt-1 text-sm text-muted">
              Last {summary.count}: {context.homeName} {summary.homeWins}, {context.awayName} {summary.awayWins}, draws {summary.draws}
            </p>
          )}
          {!summary?.count && h2hStreaks.length > 0 && (
            <p className="mt-1 text-sm text-muted">Imported H2H trend data is available, but exact recent meeting rows are not in this local match file.</p>
          )}
        </div>
        {hasMeetingStats && (
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-muted">{context.bttsText}</span>
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-muted">{context.goalsText}</span>
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-muted">{h2hXgCount ? `${h2hXgCount}/${displayedMeetings.length} with xG` : 'xG not available'}</span>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {advantage.items.map((item) => (
          <div key={item.label} className="rounded-md border border-line bg-field px-3 py-2">
            <div className="text-xs font-semibold uppercase text-muted">{item.label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-ink">{item.value}</div>
            <div className="mt-0.5 text-xs text-muted">{item.detail}</div>
          </div>
        ))}
      </div>

      {h2hStreaks.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {h2hStreaks.slice(0, 4).map((streak, index) => {
            const result = streakResultFor(streak, match);
            return (
              <div key={`${streak.label}-${index}`} className={`rounded-md border px-3 py-2 ${streakCardClass(result)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm font-semibold ${streakTextClass(result)}`}>{streak.label}</span>
                  <span className={`rounded bg-surface px-2 py-0.5 text-xs font-semibold ${streakMetaClass(result)}`}>{streak.value || '-'}</span>
                </div>
                <div className={`mt-1 flex items-center justify-between gap-2 text-xs ${streakMetaClass(result)}`}>
                  <span>{displayTeamForStreak(streak, match)}</span>
                  <span>Odds {formatOdds(streak.odds)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMeetingStats && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DetailStat label={`Last ${context.homeName} win`} value={context.lastHomeWin ? `${formatDateDMY(context.lastHomeWin.date)} (${context.lastHomeWin.score})` : 'No recent local win'} />
          <DetailStat label={`Last ${context.awayName} win`} value={context.lastAwayWin ? `${formatDateDMY(context.lastAwayWin.date)} (${context.lastAwayWin.score})` : 'No recent local win'} />
        </div>
      )}

      {displayedMeetings.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-line">
          <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem_3.25rem] gap-2 border-b border-line bg-surface-2 px-3 py-2 text-xs font-semibold uppercase text-muted sm:grid-cols-[5.5rem_minmax(0,1fr)_4rem_4rem_5rem_5rem]">
            <span>Date</span>
            <span>Versus</span>
            <span>Score</span>
            <span>xG</span>
            <span className="hidden sm:block">BTTS</span>
            <span className="hidden sm:block">Cards</span>
          </div>
          {displayedMeetings.map((meeting) => (
            <div key={meeting.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem_3.25rem] gap-2 border-b border-line bg-surface px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[5.5rem_minmax(0,1fr)_4rem_4rem_5rem_5rem]">
              <span className="font-semibold text-muted">{formatDateDMY(meeting.date)}</span>
              <span className="min-w-0 truncate text-muted">{teamNameForCopy(meeting.homeName)} v {teamNameForCopy(meeting.awayName)}</span>
              <span className="font-semibold text-ink">{meeting.score}</span>
              <span className="font-semibold text-muted">{formatH2hXg(meeting.xg)}</span>
              <span className="hidden text-muted sm:block">{meeting.btts ? 'BTTS' : 'No BTTS'}</span>
              <span className="hidden text-muted sm:block">{meeting.cards ?? '-'} cards</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictionSummaryCard({ match, allMatches, voteState = null, accaKeys, onToggleLeg }) {
  const matchWithContext = { ...match, __allMatches: allMatches };
  const predictions = match.predictions || {};
  const precomputed = match.display_markets || {};
  const confidence = loadMatchConfidence(match, allMatches);
  const winner = displayWinnerMarket(match, allMatches);
  const winnerLowConfidence = Boolean(winner?.lowConfidence);
  const winnerComparison = displayWinnerComparison(matchWithContext, allMatches, winner);
  const drawNoBet = drawNoBetMarket(match);
  const drawNoBetComparison = precomputed.draw_no_bet?.comparison || modelVsBookmakerComparison(match, 'draw_no_bet', drawNoBet);
  const displayBtts = withLiveResult(match, 'btts', precomputed.btts?.market || displayBttsMarket(predictions.btts, match));
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const goalsMarket = withLiveResult(match, 'goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = withCornerBookmakerOdds(match, capGenericCornerMarket(match, precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches)));
  const cornersComparison = comparisonForMarket(match, 'ou_corners', cornerMarket, precomputed.corners?.comparison);
  const displayableCards = displayableMarketForKey(match, 'ou_cards', displayCards) ? withLiveResult(match, 'cards', displayCards) : null;
  const displayableCorners = displayableMarketForKey(match, 'ou_corners', cornerMarket) ? withLiveResult(match, 'corners', cornerMarket) : null;

  const winnerPick = winner ? formatMarketDetail(winner) : null;
  const rawWinner = predictions.winner;
  const predictedWinnerType = winner?.predictedType || rawWinner?.type;
  const predictedWinnerName = predictedWinnerType === 'draw' ? 'Draw' : teamNameForCopy(teamNameForSide(predictedWinnerType, match));
  const actualWinnerType = Number(match.home?.goals) > Number(match.away?.goals)
    ? 'home'
    : Number(match.away?.goals) > Number(match.home?.goals)
      ? 'away'
      : Number.isFinite(Number(match.home?.goals)) && Number.isFinite(Number(match.away?.goals))
        ? 'draw'
        : null;
  const actualWinnerName = actualWinnerType === 'draw' ? 'Draw' : actualWinnerType ? teamNameForCopy(teamNameForSide(actualWinnerType, match)) : null;
  const rawWinnerResult = winner?.predictedResult || rawWinner?.result;
  const lowConfidenceWinnerText = [
    `Caution: this Winner prediction is outside the stronger market-confidence band because the bookmaker no-vig probability is below ${Math.round(WINNER_CONFIDENCE_THRESHOLD * 100)}%. Treat it as a weaker winner call, not the suggested best pick.`,
    match.status === 'FT' && rawWinner?.type && actualWinnerName && rawWinnerResult
      ? `Predicted: ${predictedWinnerName}; result: ${actualWinnerName}; model ${rawWinnerResult}.`
      : null,
  ].filter(Boolean).join(' ');
  const winnerText = winnerLowConfidence
    ? lowConfidenceWinnerText
    : winnerRationale(match, allMatches, winner);
  const drawNoBetText = drawNoBet
    ? `${teamNameForSide(drawNoBet.type, match)} is the safer side if you want a team angle: a win cashes, a draw returns. The model has it around ${fmtPct(modelProbabilityForMarket(drawNoBet)) || '-'} once the draw is removed${fmtPct(Number(drawNoBet.draw_push_probability)) ? `, with about ${fmtPct(Number(drawNoBet.draw_push_probability))} draw-push risk` : ''}.`
    : '';
  const expectationSummary = matchExpectationSummary(match, allMatches);

  const lines = [
    { label: 'Winner', voteKey: 'winner', pick: winnerPick, text: winnerText, comparison: winnerComparison, result: winner?.result, market: winner, modelProbability: winnerModelProbability(match, winner) },
    { label: 'Draw No Bet', pick: drawNoBet ? formatMarketDetail(drawNoBet) : null, text: drawNoBetText, comparison: drawNoBetComparison, result: drawNoBet?.result, market: drawNoBet, modelProbability: modelProbabilityForMarket(drawNoBet) },
    { label: 'BTTS', voteKey: 'btts', pick: displayBtts ? formatMarketDetail(displayBtts) : null, text: bttsRationale(match), comparison: bttsComparison, result: displayBtts?.result, market: displayBtts, modelProbability: precomputed.btts?.modelProbability ?? modelProbabilityForMarket(displayBtts) },
    { label: 'Goals', voteKey: 'goals', pick: goalsMarket ? formatMarketDetail(goalsMarket) : null, text: goalsRationale(match, allMatches), comparison: goalsComparison, result: goalsMarket?.result, market: goalsMarket, modelProbability: precomputed.goals?.modelProbability ?? modelProbabilityForMarket(goalsMarket) },
    { label: 'Cards', voteKey: 'cards', pick: displayableCards ? formatMarketDetail(displayableCards) : null, text: cardsRationale(match, allMatches), comparison: cardsComparison, result: displayableCards?.result, market: displayableCards, modelProbability: precomputed.cards?.modelProbability ?? modelProbabilityForMarket(displayableCards) },
    { label: 'Corners', voteKey: 'corners', pick: displayableCorners ? formatMarketDetail(displayableCorners) : null, text: cornersRationale(match, allMatches, displayableCorners), comparison: cornersComparison, result: displayableCorners?.result, market: displayableCorners, modelProbability: precomputed.corners?.modelProbability ?? modelProbabilityForMarket(displayableCorners) },
  ].filter((row) => row.pick && (row.text || row.comparison));
  const voteCutoff = formatVoteCutoff(voteState?.data?.cutoffAt);

  if (!lines.length) return null;

  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-ink">Prediction summary</h3>
          <p className="mt-1 text-xs text-muted">{confidence.reason}</p>
        </div>
        {voteState && (
          <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted">
            <span>Crowd votes</span>
            <span className="text-faint">·</span>
            <span>{voteState.data?.locked ? 'Closed' : voteCutoff ? `Closes ${voteCutoff}` : 'Open'}</span>
          </div>
        )}
      </div>
      {voteState?.message && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">{voteState.message}</div>}
      {voteState?.error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">{voteState.error}</div>}
      {expectationSummary && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/70 px-3 py-3 text-sm leading-6 text-muted dark:border-blue-500/40 dark:bg-blue-500/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-300">What to expect</div>
          <p className="mt-1">{expectationSummary}</p>
        </div>
      )}
      <ul className="mt-4 space-y-3 text-sm">
        {lines.map((row) => (
          <li key={row.label} className={`grid gap-3 rounded-md px-3 py-3 sm:grid-cols-[24rem_minmax(0,1fr)] sm:items-start ${summaryRowClass(row.result)}`}>
            <span className="min-w-0">
              <span className="grid min-h-6 grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  {row.result && resultIcon(row.result)}
                  <span>{row.label}</span>
                </span>
                <span className="min-w-0 truncate font-semibold leading-5 text-ink">{row.pick}</span>
                {onToggleLeg && (() => {
                  const leg = legFromMarketRow({
                    label: row.label,
                    pick: row.pick,
                    book: Number(row.comparison?.bookmaker?.odds),
                    modelOdds: Number(row.comparison?.model?.odds),
                    prob: row.modelProbability,
                    line: row.market?.line ?? null,
                  }, match);
                  if (!leg) return null;
                  const inSlip = accaKeys?.has(accaLegKey(match.id, row.label));
                  return (
                    <button
                      type="button"
                      onClick={() => onToggleLeg(leg)}
                      aria-pressed={inSlip}
                      aria-label={inSlip ? 'Remove from bet slip' : 'Add to bet slip'}
                      className={`inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${inSlip ? 'border border-[#34d6c8] bg-[#34d6c8]/10 text-[#34d6c8]' : 'bg-[#34d6c8] text-[#06231f] shadow-sm hover:brightness-110'}`}
                    >
                      {inSlip ? <><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> In slip</> : <><span aria-hidden="true" className="text-sm font-bold leading-none">+</span> Add to slip</>}
                    </button>
                  );
                })()}
              </span>
              <span className="mt-2 block">
                <ModelVsBookmakerComparison comparison={row.comparison} />
                {row.label === 'Winner' && !winnerLowConfidence && <WinnerProbabilityBreakdown match={matchWithContext} comparison={winnerComparison} />}
              </span>
            </span>
            <span className="min-w-0 leading-5 text-muted">
              {row.text}
              {row.result && row.result !== 'miss' && (
                <span className={`ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 align-baseline text-xs font-semibold leading-none ${resultBadgeClass(row.result)}`}>
                  {resultIcon(row.result)}
                  <span>{row.result}</span>
                </span>
              )}
              <MarketVoteControls voteState={voteState} marketKey={row.voteKey} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatVoteCutoff(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function voteSummaryOption(summary, marketKey, optionValue) {
  return summary?.markets?.[marketKey]?.options?.[optionValue] || null;
}

function votePercent(summary, marketKey, optionValue) {
  const market = summary?.markets?.[marketKey];
  const count = Number(voteSummaryOption(summary, marketKey, optionValue)?.count || 0);
  const total = Number(market?.total || 0);
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function matchVoteErrorMessage(result, fallback = 'Could not load crowd votes yet.') {
  const raw = result?.detail || result?.error || fallback;
  if (raw === 'missing-token' || raw === 'invalid-token') return 'Sign in again before voting.';
  if (raw === 'no-access') return 'Your account needs dashboard access before voting.';
  if (raw === 'nickname-required') return result?.detail || 'Set a nickname in Settings before saving crowd votes.';
  if (raw === 'match-not-found') return 'Crowd voting could not find this match yet.';
  if (raw === 'voting-closed') return result?.detail || 'Voting is closed for this match.';
  return raw;
}

function MarketVoteControls({ voteState, marketKey }) {
  if (!voteState || !marketKey) return null;
  const { data, loading, busyKey, onVote } = voteState;
  const market = data?.options?.[marketKey];
  if (loading) {
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-white/70 dark:bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading crowd votes
      </div>
    );
  }
  if (!market?.options?.length) return null;

  const summary = data?.summary || {};
  const selectedValue = data?.myVotes?.[marketKey];
  const locked = Boolean(data?.locked);
  const voterGroups = market.options
    .map((option) => ({
      label: option.label,
      voters: voteSummaryOption(summary, marketKey, option.value)?.voters || [],
    }))
    .filter((group) => group.voters.length > 0);

  return (
    <div className="mt-3 rounded-md border border-line bg-white/75 p-2 dark:bg-white/[0.04]">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase text-muted">
        <span>Crowd vote</span>
        <span>{summary.markets?.[marketKey]?.total || 0} votes</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {market.options.map((option) => {
          const selected = selectedValue === option.value;
          const count = Number(voteSummaryOption(summary, marketKey, option.value)?.count || 0);
          const percent = votePercent(summary, marketKey, option.value);
          const busy = busyKey === `${marketKey}:${option.value}`;
          return (
            <button
              key={option.value}
              type="button"
              disabled={locked || Boolean(busyKey)}
              onClick={() => onVote?.(marketKey, option.value)}
              className={`min-h-11 rounded-md border px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                selected ? 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-400 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/40' : 'border-line bg-surface text-ink hover:border-line'
              }`}
            >
              <span className="flex items-center justify-between gap-1.5">
                <span className="min-w-0 truncate text-xs font-semibold">{option.label}</span>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : selected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : null}
              </span>
              <span className="mt-0.5 block text-[11px] font-semibold text-muted">{percent}% · {count}</span>
            </button>
          );
        })}
      </div>
      {voterGroups.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          {voterGroups.map((group) => (
            <div key={group.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-[11px] leading-5">
              <span className="truncate font-semibold text-muted">{group.label}</span>
              <span className="flex min-w-0 flex-wrap gap-1">
                {group.voters.slice(0, 6).map((voter, index) => (
                  <span
                    key={`${group.label}-${voter.label}-${index}`}
                    className={`max-w-28 truncate rounded px-1.5 py-0.5 font-semibold ${
                      voter.isMe ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-surface-3 text-muted'
                    }`}
                  >
                    {voter.isMe ? 'You' : voter.label}
                  </span>
                ))}
                {group.voters.length > 6 && <span className="rounded bg-surface-3 px-1.5 py-0.5 font-semibold text-muted">+{group.voters.length - 6}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VoteLeaderboard({ data, loading, error, bookmakerId, onFollowUser, followBusyUid = '', followError = '' }) {
  const rankedLeaders = (data?.leaders || []).map((leader, index) => ({ ...leader, rank: index + 1 }));
  const topLeaders = rankedLeaders.slice(0, 5);
  const myLeader = rankedLeaders.find((leader) => leader.isMe);
  const popularPicks = data?.popularPicks || [];
  const followingPicks = data?.followingPicks || [];
  const myFollowers = data?.myFollowers || [];
  const openPicks = popularPicks.filter((pick) => !pick.result);
  const resultedPicks = popularPicks.filter((pick) => pick.result);
  return (
    <div className="mt-3 grid gap-3 sm:mt-5 xl:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Crowd leaderboard</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {myLeader ? 'Your crowd vote stats' : data ? `${data.totalVoters || 0} voters · ${data.totalVotes || 0} market votes` : 'Live from crowd votes'}
            </p>
          </div>
          {data?.settledVotes > 0 && (
            <span className="inline-flex w-fit rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              {data.settledVotes} settled votes scored
            </span>
          )}
        </div>

        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-field px-3 py-3 text-sm font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading crowd leaderboard
          </div>
        )}
        {!loading && error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && followError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {followError}
          </div>
        )}
        {!loading && !error && !topLeaders.length && (
          <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
            No data captured yet.
          </div>
        )}
        {!loading && !error && data && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-line bg-field px-2 py-2">
              <div className="text-base font-semibold text-ink">{data.totalVoters || 0}</div>
              <div className="font-semibold text-muted">Voters</div>
            </div>
            <div className="rounded-md border border-line bg-field px-2 py-2">
              <div className="text-base font-semibold text-ink">{data.totalVotes || 0}</div>
              <div className="font-semibold text-muted">Market votes</div>
            </div>
            <div className="rounded-md border border-line bg-field px-2 py-2">
              <div className="text-base font-semibold text-ink">{data.settledVotes || 0}</div>
              <div className="font-semibold text-muted">Settled</div>
            </div>
          </div>
        )}
        {!loading && !error && topLeaders.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Top 5 users</h3>
              <span className="text-xs font-semibold text-muted">{topLeaders.length} ranked</span>
            </div>
            <div className="mt-2 overflow-hidden rounded-md border border-line">
              {topLeaders.map((leader) => (
                <div
                  key={`${leader.uid || leader.label}-${leader.rank}`}
                  className={`grid gap-3 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_5.75rem_5.75rem_5.75rem_5.75rem_6.5rem_6.5rem] sm:items-center ${
                    leader.settled && leader.hits === leader.settled ? 'result-hit-row' : leader.isMe ? 'bg-emerald-50/80 dark:bg-emerald-500/10' : 'bg-field'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                      leader.isMe ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-surface text-muted'
                    }`}>
                      #{leader.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{leader.isMe ? 'You' : leader.label}</div>
                      <div className="text-xs font-semibold text-muted">Crowd voter</div>
                    </div>
                  </div>

                  <LeaderboardMetric label="Votes" value={leader.votes} />
                  <LeaderboardMetric label="Matches" value={leader.matchesVoted} />
                  <LeaderboardMetric label="Followers" value={leader.followerCount || 0} />
                  <LeaderboardMetric label="Hit" value={leader.settled ? `${leader.hits}/${leader.settled}` : '-'} />

                  <div className="flex items-center justify-between gap-2 sm:block sm:text-right">
                    <span className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${
                      leader.hitRate === null
                        ? 'bg-surface-3 text-muted'
                        : leader.hitRate >= 55
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : leader.hitRate < 45
                            ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                            : 'bg-surface-3 text-muted'
                    }`}>
                      {leader.hitRate === null ? 'Pending' : `${leader.hitRate}% hit`}
                    </span>
                    {!leader.isMe && leader.uid && (
                      <button
                        type="button"
                        disabled={followBusyUid === leader.uid}
                        onClick={() => onFollowUser?.(leader.uid, !leader.isFollowing)}
                        className={`mt-0 inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-semibold transition sm:mt-2 sm:w-full ${
                          leader.isFollowing
                            ? 'border-line bg-surface text-muted hover:bg-surface-2'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/20'
                        } disabled:cursor-wait disabled:opacity-60`}
                      >
                        {followBusyUid === leader.uid ? 'Saving...' : leader.isFollowing ? 'Following' : 'Follow'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Following picks</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {data?.followingCount ? `${data.followingCount} followed users` : 'Follow leaderboard users to track picks'}
            </p>
          </div>
          {followingPicks.length > 0 && (
            <span className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              {followingPicks.length} picks
            </span>
          )}
        </div>
        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-field px-3 py-3 text-sm font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading followed picks
          </div>
        )}
        {!loading && !error && followingPicks.length > 0 && (
          <div className="mt-3 grid gap-2">
            {followingPicks.map((pick, index) => <VotePickSummaryRow key={`${pick.matchId}-${pick.market}-${pick.option}-${index}`} pick={pick} bookmakerId={bookmakerId} />)}
          </div>
        )}
        {!loading && !error && !followingPicks.length && (
          <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
            No followed picks yet.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Your followers</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {myFollowers.length
                ? `${myFollowers.length} ${myFollowers.length === 1 ? 'person follows' : 'people follow'} you`
                : 'No one follows you yet'}
            </p>
          </div>
          {myFollowers.length > 0 && (
            <span className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              {myFollowers.length}
            </span>
          )}
        </div>
        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-field px-3 py-3 text-sm font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading followers
          </div>
        )}
        {!loading && !error && myFollowers.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {myFollowers.map((follower) => (
              <li
                key={follower.uid}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-field px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-muted">
                    {String(follower.label || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{follower.label}</span>
                </div>
                {follower.isFollowing ? (
                  <span className="inline-flex shrink-0 items-center rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                    Following
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={followBusyUid === follower.uid}
                    onClick={() => onFollowUser?.(follower.uid, true)}
                    className="inline-flex shrink-0 items-center rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted transition duration-150 ease-out-soft hover:text-ink active:scale-95 disabled:cursor-wait disabled:opacity-60"
                  >
                    {followBusyUid === follower.uid ? 'Saving…' : 'Follow back'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && !myFollowers.length && (
          <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
            No one follows you yet.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Markets picked</h2>
            <p className="mt-1 text-xs font-semibold text-muted">Open voted markets</p>
          </div>
          {openPicks.length > 0 && (
            <span className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              Top {openPicks.length}
            </span>
          )}
        </div>
        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-field px-3 py-3 text-sm font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading picked markets
          </div>
        )}
        {!loading && !error && openPicks.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Voted markets</h3>
              <span className="text-xs font-semibold text-muted">Open</span>
            </div>
            <div className="mt-2 grid gap-2">
              {openPicks.map((pick) => <VotePickSummaryRow key={`${pick.matchId}-${pick.market}-${pick.option}`} pick={pick} bookmakerId={bookmakerId} />)}
            </div>
          </div>
        )}
        {!loading && !error && !openPicks.length && (
          <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
            No open voted markets captured yet.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-3 shadow-panel sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Resulted Picks</h2>
            <p className="mt-1 text-xs font-semibold text-muted">Completed voted markets</p>
          </div>
          {resultedPicks.length > 0 && (
            <span className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              {resultedPicks.length} settled
            </span>
          )}
        </div>
        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-field px-3 py-3 text-sm font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading resulted picks
          </div>
        )}
        {!loading && !error && resultedPicks.length > 0 && (
          <div className="mt-3 grid gap-2">
            {resultedPicks.map((pick) => <VotePickSummaryRow key={`${pick.matchId}-${pick.market}-${pick.option}`} pick={pick} bookmakerId={bookmakerId} />)}
          </div>
        )}
        {!loading && !error && !resultedPicks.length && (
          <div className="mt-3 rounded-md border border-line bg-field px-3 py-3 text-sm text-muted">
            No resulted crowd picks yet.
          </div>
        )}
      </section>
    </div>
  );
}

function VotePickSummaryRow({ pick, bookmakerId }) {
  const href = votePickBookmakerMatch(pick, bookmakerId);
  return (
    <VotePickRow pick={pick} bookmakerId={bookmakerId}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-ink">{pick.home} v {pick.away}</div>
        <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{pick.count} votes</span>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
        <span className="max-w-36 truncate text-[11px] font-semibold text-muted">{pick.league || 'Match'}{pick.date ? ` · ${formatDateDMY(pick.date)}` : ''}</span>
        <span className="rounded border border-line bg-surface px-2 py-0.5 font-semibold text-muted">{pick.marketLabel}</span>
        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">{pick.optionLabel}</span>
        {href && (
          <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span>{BOOKMAKERS[bookmakerId]?.name || 'Bookmaker'}</span>
          </span>
        )}
        {pick.result && (
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${resultBadgeClass(pick.result)}`}>
            {resultIcon(pick.result)}
            <span>{pick.result}</span>
          </span>
        )}
        {(pick.voters || []).slice(0, 3).map((voter, index) => (
          <span
            key={`${pick.matchId}-${pick.market}-${voter.label}-${index}`}
            className={`max-w-20 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              voter.isMe ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-surface text-muted'
            }`}
          >
            {voter.isMe ? 'You' : voter.label}
          </span>
        ))}
        {(pick.voters || []).length > 3 && <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">+{pick.voters.length - 3}</span>}
      </div>
    </VotePickRow>
  );
}

function LeaderboardMetric({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1.5 text-xs sm:block sm:bg-transparent sm:px-0 sm:py-0 sm:text-center">
      <div className="font-semibold text-ink">{value}</div>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function votePickBookmakerMatch(pick, bookmakerId) {
  const match = {
    id: pick?.matchId,
    date: pick?.date,
    time: pick?.time,
    league: pick?.league,
    home: { name: pick?.home },
    away: { name: pick?.away },
    bookmaker_links: pick?.bookmaker_links,
    bookmaker_urls: pick?.bookmaker_urls,
    sportsbet_odds: pick?.sportsbet_odds,
    ladbrokes_odds: pick?.ladbrokes_odds,
    neds_odds: pick?.neds_odds,
  };
  return hasDirectBookmakerMatchLink(match, bookmakerId) ? bookmakerUrl(match, bookmakerId) : '';
}

function VotePickRow({ pick, bookmakerId, children }) {
  const href = votePickBookmakerMatch(pick, bookmakerId);
  const resultClass = pick?.result === 'hit'
    ? 'result-hit-row'
    : pick?.result === 'miss'
      ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
      : 'border-line bg-field';
  const className = `block rounded-md border px-3 py-2 text-left transition ${resultClass} ${
    href && !pick?.result ? 'hover:border-line hover:bg-surface hover:shadow-sm' : ''
  }`;
  if (!href) return <div className={className}>{children}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`Open ${BOOKMAKERS[bookmakerId]?.name || 'bookmaker'} match page`}
    >
      {children}
    </a>
  );
}

function EspnStatBar({ label, homeVal, awayVal, homeRaw, awayRaw }) {
  const total = (homeRaw || 0) + (awayRaw || 0);
  const homePct = total > 0 ? (homeRaw / total) * 100 : 50;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="w-10 font-semibold text-ink">{homeVal ?? '-'}</span>
        <span className="text-xs text-muted">{label}</span>
        <span className="w-10 text-right font-semibold text-ink">{awayVal ?? '-'}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full">
        <div className="h-full bg-[#34d6c8] transition-all" style={{ width: `${homePct}%` }} />
        <div className="h-full flex-1 bg-white/15" />
      </div>
    </div>
  );
}

function EspnStatsSection({ espnStats, homeName, awayName }) {
  if (!espnStats) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
        Stats not yet available — check back after the match starts.
      </div>
    );
  }

  const home = espnStats.home || {};
  const away = espnStats.away || {};
  const keyEvents = espnStats.key_events || [];
  const h2h = espnStats.h2h || [];

  return (
    <div className="space-y-4">
      {/* Match stats */}
      <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
          <span className="truncate">{homeName}</span>
          <span className="shrink-0 px-3">vs</span>
          <span className="truncate text-right">{awayName}</span>
        </div>
        <div className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-muted">Match Statistics</div>
        <div className="space-y-3">
          {home.possession != null && <EspnStatBar label="Possession" homeVal={`${home.possession}%`} awayVal={`${away.possession}%`} homeRaw={home.possession} awayRaw={away.possession} />}
          {home.shots != null && <EspnStatBar label="Shots" homeVal={home.shots} awayVal={away.shots} homeRaw={home.shots} awayRaw={away.shots} />}
          {home.shots_on_target != null && <EspnStatBar label="On target" homeVal={home.shots_on_target} awayVal={away.shots_on_target} homeRaw={home.shots_on_target} awayRaw={away.shots_on_target} />}
          {home.corners != null && <EspnStatBar label="Corners" homeVal={home.corners} awayVal={away.corners} homeRaw={home.corners} awayRaw={away.corners} />}
          {home.fouls != null && <EspnStatBar label="Fouls" homeVal={home.fouls} awayVal={away.fouls} homeRaw={home.fouls} awayRaw={away.fouls} />}
          {home.yellow_cards != null && <EspnStatBar label="Yellow cards" homeVal={home.yellow_cards} awayVal={away.yellow_cards} homeRaw={home.yellow_cards} awayRaw={away.yellow_cards} />}
          {home.red_cards != null && <EspnStatBar label="Red cards" homeVal={home.red_cards} awayVal={away.red_cards} homeRaw={home.red_cards} awayRaw={away.red_cards} />}
          {home.saves != null && <EspnStatBar label="Saves" homeVal={home.saves} awayVal={away.saves} homeRaw={home.saves} awayRaw={away.saves} />}
          {home.offsides != null && <EspnStatBar label="Offsides" homeVal={home.offsides} awayVal={away.offsides} homeRaw={home.offsides} awayRaw={away.offsides} />}
        </div>
      </div>

      {/* Key events */}
      {keyEvents.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-ink">Key Events</h3>
          <div className="space-y-2">
            {keyEvents.map((ev, i) => {
              const typeL = (ev.type || '').toLowerCase();
              // Match cards by the word "card" — "Penalty - Scored" contains "red" and
              // must not be read as a red card. Scored penalties are goals.
              const icon = typeL.includes('card')
                ? (typeL.includes('yellow') && !typeL.includes('red') ? '🟨' : '🟥')
                : typeL.includes('goal') || typeL.includes('scored') ? '⚽'
                  : typeL.includes('sub') ? '🔄' : '•';
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">{ev.clock}</span>
                  <span className="text-base leading-none">{icon}</span>
                  <span className="min-w-0 flex-1 text-ink">{ev.participant || ev.text}</span>
                  {ev.team && <span className="shrink-0 text-xs text-muted">{ev.team}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* H2H */}
      {h2h.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-ink">Head to Head</h3>
          <div className="space-y-1.5">
            {h2h.map((g, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-field px-3 py-2 text-sm">
                <span className="w-20 shrink-0 text-xs text-muted">{g.date}</span>
                <span className="min-w-0 flex-1 text-center font-semibold text-ink">{g.home_team} {g.home_score ?? '?'} – {g.away_score ?? '?'} {g.away_team}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted opacity-60">Stats via ESPN</p>
    </div>
  );
}

function MatchDetailView({ match, onBack, allMatches, bookmakerId, onBookmakerChange, favoriteTeams = [], onToggleFavoriteTeam, isPlatformOwner = false, onVoteSaved, embedded = false, accaKeys, onToggleLeg }) {
  const predictions = match.predictions || {};
  const odds = displayThreeWayOdds(match);
  const actuals = match.actuals || {};
  const selectedBookmaker = BOOKMAKERS[bookmakerId] || BOOKMAKERS.sportsbet;
  const selectedBookmakerHref = bookmakerUrl(match, selectedBookmaker.id);
  const sofaScoreHref = sofascoreEventUrl(match);
  const hasDirectBookmakerLink = hasDirectBookmakerMatchLink(match, selectedBookmaker.id);
  const confidence = loadMatchConfidence(match, allMatches);
  const bookmakerButtonLabel =
    selectedBookmaker.id === 'sportsbet'
      ? `${selectedBookmaker.name} odds ${formatOdds(odds.home)} / ${formatOdds(odds.draw)} / ${formatOdds(odds.away)}`
      : `${hasDirectBookmakerLink ? 'Open' : 'Find'} ${selectedBookmaker.name} match`;
  const [voteData, setVoteData] = useState(null);
  const [voteLoading, setVoteLoading] = useState(true);
  const [voteBusyKey, setVoteBusyKey] = useState('');
  const [voteError, setVoteError] = useState('');
  const [voteMessage, setVoteMessage] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadVotes() {
      setVoteLoading(true);
      setVoteError('');
      setVoteMessage('');
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) throw new Error('Sign in again before voting.');
        const params = new URLSearchParams({
          matchId: String(match.id || ''),
          date: String(match.date || ''),
        });
        const response = await fetch(`/api/match-votes?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(matchVoteErrorMessage(result));
        if (active) setVoteData(result);
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (active) setVoteError(error.message || 'Could not load crowd votes yet.');
      } finally {
        if (active) setVoteLoading(false);
      }
    }

    if (match.id) loadVotes();
    return () => {
      active = false;
      controller.abort();
    };
  }, [match.date, match.id]);

  const submitVote = useCallback(
    async (marketKey, optionValue) => {
      const busyKey = `${marketKey}:${optionValue}`;
      setVoteBusyKey(busyKey);
      setVoteError('');
      setVoteMessage('');
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) throw new Error('Sign in again before voting.');
        const response = await fetch('/api/match-votes', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
          body: JSON.stringify({
            matchId: String(match.id || ''),
            date: match.date,
            market: marketKey,
            option: optionValue,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(matchVoteErrorMessage(result));
        setVoteData(result);
        setVoteMessage('Vote saved.');
        onVoteSaved?.();
      } catch (error) {
        setVoteError(error.message || 'Could not save your vote.');
      } finally {
        setVoteBusyKey('');
      }
    },
    [match.date, match.id, onVoteSaved],
  );

  const voteState = useMemo(
    () => ({
      data: voteData,
      loading: voteLoading,
      busyKey: voteBusyKey,
      error: voteError,
      message: voteMessage,
      onVote: submitVote,
    }),
    [submitVote, voteBusyKey, voteData, voteError, voteLoading, voteMessage],
  );

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onBack();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  useEffect(() => {
    setActiveTab('overview');
  }, [match.id, match.date]);

  return (
    <div className={embedded ? 'overflow-hidden rounded-xl border border-line bg-surface shadow-sm' : 'min-h-screen bg-field'}>
      <div className={embedded ? 'border-b border-line bg-surface' : 'sticky top-0 z-20 border-b border-line bg-surface'}>
        <div className={`mx-auto flex items-start gap-3 px-3 py-3 sm:px-5 sm:py-4 ${embedded ? 'max-w-none' : 'max-w-3xl'}`}>
          {!embedded && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:bg-field"
              aria-label="Back to matches"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted">
              <span className="truncate">{match.league}{leagueCountryLabel(match.league) && <span className="font-normal text-faint"> · {leagueCountryLabel(match.league)}</span>}</span>
              <span>{matchDisplayDate(match)}</span>
              <span>{matchDisplayTime(match)}</span>
              <span className={`rounded-full px-2 py-1 ring-1 ${statusClass(match.status)}`}>{statusBadgeLabel(match)}</span>
            </div>
            <h2 className="mt-1.5 text-base font-semibold leading-snug text-ink sm:text-xl">
              {match.home?.name} vs {match.away?.name}
            </h2>
          </div>
        </div>
        <div className={`mx-auto flex border-t border-line/40 px-3 sm:px-5 ${embedded ? 'max-w-none' : 'max-w-3xl'}`}>
          {[['overview', 'Overview'], ['stats', 'Stats']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${activeTab === id ? 'border-[#34d6c8] text-[#34d6c8]' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`mx-auto space-y-5 px-3 py-4 tabular-nums sm:px-5 sm:py-5 ${embedded ? 'max-w-none' : 'max-w-3xl'}`}>
        {activeTab === 'overview' ? (<>
        <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_auto_1fr] sm:gap-2">
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5 text-center shadow-sm sm:py-3 sm:text-left dark:bg-[radial-gradient(120%_120%_at_100%_0%,rgba(52,214,200,0.06),transparent_55%),linear-gradient(180deg,#1a1e24_0%,#121419_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_-16px_rgba(0,0,0,0.6)]">
            <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
              <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
              <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.home?.name}</div><TeamStreakBadge match={match} side="home" />
              <TeamFavoriteButton teamName={match.home?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
            </div>
            <div className="mt-1 text-xs text-muted">Rank {match.home?.rank ?? '-'} · {match.home?.pts ?? '-'} pts</div>
          </div>
          {hasScoreline(match) && (
            <div className={`justify-self-center rounded-xl px-3 py-1.5 text-center font-mono text-sm font-semibold text-white shadow-panel sm:px-3 sm:py-3 sm:text-base ${match.status === 'live' ? 'bg-red-600' : 'bg-header'}`}>
              {scorelineText(match)}
            </div>
          )}
          {!hasScoreline(match) && <div className="hidden sm:block" />}
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5 text-center shadow-sm sm:py-3 sm:text-left dark:bg-[radial-gradient(120%_120%_at_100%_0%,rgba(52,214,200,0.06),transparent_55%),linear-gradient(180deg,#1a1e24_0%,#121419_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_-16px_rgba(0,0,0,0.6)]">
            <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
              <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
              <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.away?.name}</div><TeamStreakBadge match={match} side="away" />
              <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
            </div>
            <div className="mt-1 text-xs text-muted">Rank {match.away?.rank ?? '-'} · {match.away?.pts ?? '-'} pts</div>
          </div>
        </div>

        {selectedBookmakerHref && (
          <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <BookmakerSelect value={selectedBookmaker.id} onChange={onBookmakerChange} />
            <BookmakerLink bookmakerId={selectedBookmaker.id} href={selectedBookmakerHref} label={bookmakerButtonLabel} />
          </div>
        )}

        {isPlatformOwner && (
          <div className="grid gap-2">
            {sofaScoreHref && (
              <a
                href={sofaScoreHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-panel transition hover:bg-field"
              >
                Open SofaScore match id {match.id}
              </a>
            )}
          </div>
        )}

        {(match.venue || match.referee) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {match.venue && (
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted shadow-panel">
                <MapPin className="h-4 w-4 text-muted" aria-hidden="true" />
                <span className="min-w-0 truncate">{match.venue}</span>
              </div>
            )}
            {match.referee && (
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted shadow-panel">
                <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {match.referee.name} · YC {match.referee.avg_yellow ?? '-'} · RC {match.referee.avg_red ?? '-'}
                </span>
              </div>
            )}
          </div>
        )}

        <PredictionSummaryCard match={match} allMatches={allMatches} voteState={voteState} accaKeys={accaKeys} onToggleLeg={onToggleLeg} />
        <ScorelinePanel match={match} />
        <QualityDetailPanel confidence={confidence} />

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

        <H2HContextPanel match={match} allMatches={allMatches} />

        <StreakList title="Team streaks" streaks={match.team_streaks} match={match} />
        </>) : (
          <EspnStatsSection espnStats={match.espn_stats} homeName={match.home?.name} awayName={match.away?.name} />
        )}
      </div>
    </div>
  );
}

function MatchCard({ match, onSelect, bookmakerId, allMatches, favoriteTeams = [], onToggleFavoriteTeam }) {
  const predictions = match.predictions || {};
  const odds = displayThreeWayOdds(match);
  const bestOdds = bestThreeWayOdds(match);
  const actuals = match.actuals || {};
  const precomputed = match.display_markets || {};
  const displayWinner = displayWinnerMarket(match, allMatches);
  const predictedWinnerSide = winnerPredictionSide(match, displayWinner);
  const displayBtts = precomputed.btts?.market || displayBttsMarket(predictions.btts, match);
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = withCornerBookmakerOdds(match, capGenericCornerMarket(match, precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches)));
  const cornersComparison = comparisonForMarket(match, 'ou_corners', cornerMarket, precomputed.corners?.comparison);
  const displayableCards = displayableMarketForKey(match, 'ou_cards', displayCards) ? displayCards : null;
  const displayableCorners = displayableMarketForKey(match, 'ou_corners', cornerMarket) ? cornerMarket : null;
  const drawNoBet = drawNoBetMarket(match);
  const drawNoBetComparison = precomputed.draw_no_bet?.comparison || modelVsBookmakerComparison(match, 'draw_no_bet', drawNoBet);
  const confidence = loadMatchConfidence(match, allMatches);
  const winnerBreakdown = match.display_summary?.winnerBreakdown || winnerProbabilityBreakdown(match);
  const winnerModelPct = precomputed.winner?.market?.type === displayWinner?.type
    ? precomputed.winner?.modelProbability ?? winnerModelProbability(match, displayWinner)
    : winnerModelProbability(match, displayWinner);
  const edgeBadgeFor = (comparison) =>
    comparison?.badge?.tone === 'positive' && comparison.edgePoints > 0 ? comparison.badge.label : null;
  const isFinished = match.status === 'FT';
  const rawCompactPick = suggestedPickForMatch(match, allMatches);
  const compactPickKind = { BTTS: 'btts', Goals: 'goals', Cards: 'cards', Corners: 'corners' }[rawCompactPick?.label];
  const compactPick = compactPickKind
    ? { ...rawCompactPick, market: withLiveResult(match, compactPickKind, rawCompactPick.market) }
    : rawCompactPick;
  const secondaryTips = secondaryTipRowsForMatch({
    compactPick,
    displayBtts: withLiveResult(match, 'btts', displayBtts),
    bttsComparison,
    goalsMarket: withLiveResult(match, 'goals', predictions.ou_goals),
    goalsComparison,
    displayCards: withLiveResult(match, 'cards', displayableCards),
    cardsComparison,
    cornerMarket: withLiveResult(match, 'corners', displayableCorners),
    cornersComparison,
    drawNoBet,
    drawNoBetComparison,
  });
  const openMatch = () => onSelect(match);
  const handleCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openMatch();
  };

  return (
    <article className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm tabular-nums transition duration-200 ease-out-soft active:scale-[0.99] dark:bg-[radial-gradient(120%_90%_at_100%_-10%,rgba(52,214,200,0.07),transparent_55%),linear-gradient(180deg,#1a1e24_0%,#121419_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_-16px_rgba(0,0,0,0.75)] sm:hover:-translate-y-0.5 sm:hover:border-accent/40 sm:hover:shadow-lg sm:hover:shadow-accent/10 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-accent/60 before:to-transparent before:opacity-0 before:transition-opacity before:duration-200 dark:before:opacity-70 sm:hover:before:opacity-100">
      <div
        role="button"
        tabIndex={0}
        onClick={openMatch}
        onKeyDown={handleCardKeyDown}
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        aria-label={`View details for ${match.home?.name} vs ${match.away?.name}`}
      >
      <div className="border-b border-line px-3 py-3 sm:px-4">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-sm text-muted">
          <span className="min-w-0 truncate">{matchDisplayDate(match)}</span>
          <span className="flex min-w-0 items-center justify-center gap-1">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{matchDisplayTime(match)}</span>
          </span>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(match.status)}`}>
            {statusBadgeLabel(match)}
          </span>
        </div>
      </div>

      <div className="px-3 py-3 sm:px-4 sm:py-4">
        <div className="grid gap-1.5 sm:hidden">
          <div className={`min-h-[5.75rem] rounded-md border px-2.5 py-2 ${winnerPredictionCardClass(match, 'home', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
                <div className="min-w-0 whitespace-normal break-words text-left text-sm font-semibold leading-snug text-ink sm:text-base">{match.home?.name}</div><TeamStreakBadge match={match} side="home" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.home?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="home" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          <div className={`min-h-[5.75rem] rounded-md border px-2.5 py-2 ${winnerPredictionCardClass(match, 'away', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
                <div className="min-w-0 whitespace-normal break-words text-left text-sm font-semibold leading-snug text-ink sm:text-base">{match.away?.name}</div><TeamStreakBadge match={match} side="away" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="away" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          {predictedWinnerSide === 'draw' && (
            <div className={`rounded-md border px-2.5 py-2 text-center font-semibold ${winnerPredictionScoreClass(match, displayWinner)}`}>
              <div>{hasScoreline(match) ? scorelineText(match) : 'Draw'}</div>
              <WinnerPredictionMeta match={match} side="draw" modelProbability={winnerModelPct} winner={displayWinner} />
            </div>
          )}
        </div>

        <div className="hidden items-stretch gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] sm:gap-3">
          <div className={`flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-md border px-2.5 py-2 text-left ${winnerPredictionCardClass(match, 'home', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
                <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.home?.name}</div><TeamStreakBadge match={match} side="home" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.home?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="home" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          <div className={`self-center justify-self-center text-center font-semibold ${hasScoreline(match) ? `rounded-md px-3 py-2 text-sm text-white ${match.status === 'live' ? 'bg-red-600' : 'bg-header'}` : 'text-xs text-faint'}`}>
            <div>
              {hasScoreline(match) ? (
                scorelineText(match)
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-field text-[11px] uppercase shadow-sm">
                  v
                </span>
              )}
            </div>
          </div>
          <div className={`flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-md border px-2.5 py-2 text-left ${winnerPredictionCardClass(match, 'away', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
                <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.away?.name}</div><TeamStreakBadge match={match} side="away" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="away" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          {predictedWinnerSide === 'draw' && (
            <div className={`col-span-3 text-center font-semibold ${winnerPredictionScoreClass(match, displayWinner)}`}>
              <WinnerPredictionMeta match={match} side="draw" modelProbability={winnerModelPct} winner={displayWinner} />
            </div>
          )}
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 ${compactPick ? marketPillClass(compactPick.market?.result) : 'border-line bg-surface-2 text-faint'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><span className="h-3 w-1 rounded-full bg-signal" aria-hidden="true" />Suggested pick</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {compactPick?.market?.result && (
                  <span className={`inline-flex items-center gap-1 rounded-md py-0.5 text-[11px] font-semibold leading-none ${visibleResultLabel(compactPick.market.result) ? 'px-1.5' : 'px-1'} ${resultBadgeClass(compactPick.market.result)}`}>
                    {resultIcon(compactPick.market.result)}
                    {visibleResultLabel(compactPick.market.result) && <span>{visibleResultLabel(compactPick.market.result)}</span>}
                  </span>
                )}
                {compactPick && edgeBadgeFor(compactPick.comparison) && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
                    {edgeBadgeFor(compactPick.comparison)}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`text-lg font-semibold leading-6 ${compactPick ? 'text-ink' : 'text-faint'}`}>{compactPick ? `${compactPick.label} ${formatMarketDetail(compactPick.market)}` : 'No suggested pick'}</span>
              {compactPick && fmtPct(compactPick.modelProbability) && <span className="inline-flex items-center gap-1 text-xs font-medium text-muted">Model<span className="font-semibold text-ink">{fmtPct(compactPick.modelProbability)}</span></span>}
            </div>
          </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {secondaryTips.map((row, index) => (
            <MarketPill
              key={`${row.key}-${index}`}
              label={row.label}
              market={row.market}
              edgeBadge={row.edgeBadge}
              modelProbability={row.modelProbability}
            />
          ))}
        </div>

        <WinProbabilityBar rows={winnerBreakdown} />

        <div className="mt-3 sm:mt-4">
          {match.ladbrokes_odds && (
            <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-faint">Best price · Sportsbet + Ladbrokes</div>
          )}
          <div className="grid grid-cols-3 gap-1 rounded-md bg-field p-2 text-center sm:gap-2">
            {[['home', 'Home'], ['draw', 'Draw'], ['away', 'Away']].map(([key, label], i) => (
              <div key={key} className={i === 1 ? 'border-x border-line' : ''}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
                <div className="flex items-center justify-center gap-1 font-mono text-sm font-semibold sm:text-base">
                  {formatOdds(bestOdds[key])}
                  {bestOdds[`${key}_book`] === 'Ladbrokes' && (
                    <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold leading-none text-amber-600 dark:text-amber-400" title="Best price at Ladbrokes">L</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <ConfidenceBadge confidence={confidence} />
          <QualityBadges quality={confidence.quality} compact />
        </div>

        {match.status === 'FT' && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
            {'corners_total' in actuals && <span className="rounded bg-field px-2 py-1">Corners {actuals.corners_total}</span>}
            {'fouls_total' in actuals && <span className="rounded bg-field px-2 py-1">Fouls {actuals.fouls_total}</span>}
            {'first_scorer' in actuals && <span className="rounded bg-field px-2 py-1">First scorer {actuals.first_scorer}</span>}
          </div>
        )}
      </div>
      </div>
    </article>
  );
}

function MobileBottomNav({
  active,
  onDashboard,
  onMatches,
  onWatchlist,
  onSettings,
}) {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: HomeIcon, onClick: onDashboard },
    { key: 'matches', label: 'Matches', icon: ListFilter, onClick: onMatches },
    { key: 'watchlist', label: 'Watchlist', icon: Star, onClick: onWatchlist },
    { key: 'settings', label: 'Settings', icon: Settings, onClick: onSettings },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.10)] backdrop-blur sm:hidden" aria-label="Mobile app navigation">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {navItems.map(({ key, label, icon: Icon, onClick }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={onClick}
              aria-pressed={selected}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-semibold transition duration-150 ease-out-soft active:scale-95 ${
                selected ? 'bg-header text-white' : 'text-muted hover:bg-field hover:text-ink'
              }`}
            >
              <Icon className={`h-5 w-5 ${key === 'watchlist' && selected ? 'fill-amber-300 text-amber-300' : ''}`} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function DesktopSidePanel({
  active,
  onDashboard,
  onMatches,
  onWatchlist,
  onSettings,
}) {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: HomeIcon, onClick: onDashboard },
    { key: 'matches', label: 'Matches', icon: ListFilter, onClick: onMatches },
    { key: 'watchlist', label: 'Fav', icon: Star, onClick: onWatchlist },
    { key: 'settings', label: 'Settings', icon: Settings, onClick: onSettings },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 border-r border-line bg-surface px-2 py-4 shadow-[12px_0_34px_rgba(15,23,42,0.08)] backdrop-blur sm:flex lg:w-64 lg:px-4">
      <div className="flex min-h-0 w-full flex-col">
        <button
          type="button"
          onClick={onDashboard}
          className="flex h-14 items-center justify-center rounded-md border border-line bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#e8f5ff_100%)] px-2 shadow-sm transition duration-150 ease-out-soft active:scale-[0.98] dark:bg-[linear-gradient(135deg,#1d2128_0%,#15181d_55%,#123034_100%)]"
          aria-label="Open dashboard"
        >
          <BrandMark responsive className="text-2xl lg:text-3xl" />
        </button>
        <nav className="mt-5 flex flex-1 flex-col gap-1" aria-label="Dashboard page navigation">
          {navItems.map(({ key, label, icon: Icon, onClick }) => {
            const selected = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={onClick}
                aria-pressed={selected}
                title={label}
                className={`inline-flex h-12 items-center justify-center gap-3 rounded-md text-sm font-semibold transition duration-150 ease-out-soft active:scale-[0.97] lg:justify-start lg:px-3 ${
                  selected ? 'bg-header text-white shadow-sm' : 'text-muted hover:bg-field hover:text-ink'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${key === 'watchlist' && selected ? 'fill-amber-300 text-amber-300' : ''}`} aria-hidden="true" />
                <span className="hidden lg:inline">{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-2 hidden rounded-md border border-line bg-field px-3 py-2 text-xs font-semibold leading-5 text-muted lg:block">
          Live Firestore data
        </div>
      </div>
    </aside>
  );
}

function ViewModeToggle({ value, onChange }) {
  const items = [
    { key: 'cards', label: 'Cards' },
    { key: 'split', label: 'Split' },
  ];
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface p-0.5">
      {items.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition duration-150 ease-out-soft active:scale-95 ${
            value === key ? 'bg-header text-white shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CompactMatchRow({ match, allMatches, selected, onSelect }) {
  const rawPick = suggestedPickForMatch(match, allMatches);
  const pickKind = { BTTS: 'btts', Goals: 'goals', Cards: 'cards', Corners: 'corners' }[rawPick?.label];
  const compactPick = pickKind
    ? { ...rawPick, market: withLiveResult(match, pickKind, rawPick.market) }
    : rawPick;
  const settled = compactPick?.market?.result;
  return (
    <button
      type="button"
      onClick={() => onSelect(match)}
      aria-pressed={selected}
      className={`flex w-full items-stretch gap-2.5 border-b border-line px-3 py-2.5 text-left tabular-nums transition last:border-b-0 ${
        selected ? 'bg-accent-soft ring-1 ring-inset ring-accent/30' : 'hover:bg-surface-2'
      }`}
    >
      <div className="flex w-11 shrink-0 flex-col items-center justify-center text-center">
        {hasScoreline(match) ? (
          <span className={`font-mono text-sm font-semibold ${match.status === 'live' ? 'text-red-500 dark:text-red-400' : 'text-ink'}`}>{scorelineText(match)}</span>
        ) : (
          <span className="font-mono text-xs text-muted">{matchDisplayTime(match)}</span>
        )}
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">{statusBadgeLabel(match)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{match.home?.name}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{match.away?.name}</span>
        </div>
      </div>
      {compactPick && (
        <div className="flex w-24 shrink-0 flex-col items-end justify-center gap-1 text-right">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Pick</span>
          <span className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${settled ? resultBadgeClass(settled) : 'bg-surface-3 text-ink'}`}>
            {settled && resultIcon(settled)}
            <span className="truncate">{compactPick.label}</span>
          </span>
        </div>
      )}
    </button>
  );
}

function SplitView({ groups, selectedMatch, onSelectRow, bookmakerId, allMatches, onBookmakerChange, favoriteTeams, onToggleFavoriteTeam, isPlatformOwner, onVoteSaved, accaKeys, onToggleLeg }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-4">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100dvh-9.5rem)] lg:overflow-y-auto">
        {groups.map((group) => (
          <div key={group.leagueId || group.league}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-header px-3 py-2 text-xs font-semibold text-header-fg">
              <span className="flex min-w-0 items-center gap-2">
                <LeagueBadge src={group.logo} name={group.league} />
                <span className="min-w-0">
                  <span className="block truncate leading-tight">{group.league}</span>
                  {leagueCountryLabel(group.league) && (
                    <span className="block truncate text-[10px] font-normal leading-tight text-white/55">{leagueCountryLabel(group.league)}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{group.matches.length}</span>
            </div>
            {group.matches.map((m) => (
              <CompactMatchRow
                key={`${m.league}-${m.id}`}
                match={m}
                allMatches={allMatches}
                selected={String(selectedMatch?.id) === String(m.id)}
                onSelect={onSelectRow}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="hidden lg:sticky lg:top-[8.5rem] lg:block lg:max-h-[calc(100dvh-9.5rem)] lg:overflow-y-auto">
        {selectedMatch ? (
          <MatchDetailView
            key={selectedMatch.id}
            embedded
            match={selectedMatch}
            onBack={() => {}}
            allMatches={allMatches}
            bookmakerId={bookmakerId}
            onBookmakerChange={onBookmakerChange}
            favoriteTeams={favoriteTeams}
            onToggleFavoriteTeam={onToggleFavoriteTeam}
            isPlatformOwner={isPlatformOwner}
            onVoteSaved={onVoteSaved}
            accaKeys={accaKeys}
            onToggleLeg={onToggleLeg}
          />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-muted">Select a match to see details.</div>
        )}
      </div>
    </div>
  );
}

// Mobile compact list: a league heading mirroring the row format, then dense
// CompactMatchRows. Tapping a row opens the full match detail (same as the cards).
// Header is intentionally non-sticky — the date-swipe wrapper applies a translateX
// transform, under which position:sticky breaks.
function CompactLeagueSection({ group, allMatches, onSelectMatch, isFavorite = false, onToggleFavorite, sectionRef = null }) {
  const isFavoriteTeamGroup = Boolean(group.isFavoriteTeamGroup);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section ref={sectionRef} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm scroll-mt-4 dark:shadow-[0_18px_40px_-22px_rgba(0,0,0,0.8)]">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-header px-3 py-2 text-header-fg">
        <span className="flex min-w-0 items-center gap-2">
          {isFavoriteTeamGroup ? (
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/15 text-amber-200">
              <Star className="h-3.5 w-3.5 fill-amber-300" aria-hidden="true" />
            </span>
          ) : (
            <LeagueBadge src={group.logo} name={group.league} />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{group.league}</span>
            {leagueCountryLabel(group.league) && (
              <span className="block truncate text-[10px] font-normal leading-tight text-white/55">{leagueCountryLabel(group.league)}</span>
            )}
          </span>
          {!isFavoriteTeamGroup && (
            <button
              type="button"
              onClick={() => onToggleFavorite(group.league)}
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition duration-150 ease-out-soft active:scale-95 ${
                isFavorite
                  ? 'border-amber-300 bg-amber-400/15 text-amber-300'
                  : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
              }`}
              aria-label={`${isFavorite ? 'Remove' : 'Add'} ${group.league} as favourite league`}
              title={`${isFavorite ? 'Remove from' : 'Add to'} favourite leagues`}
            >
              <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-300' : ''}`} aria-hidden="true" />
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.league}`}
          className="flex shrink-0 items-center gap-2 rounded-full py-0.5 pl-2 text-header-fg transition active:scale-95"
        >
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{group.matches.length}</span>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} aria-hidden="true" />
        </button>
      </div>
      {!collapsed && (
        <div>
          {group.matches.map((m) => (
            <CompactMatchRow
              key={`${m.league}-${m.id}`}
              match={m}
              allMatches={allMatches}
              selected={false}
              onSelect={onSelectMatch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LeagueSection({ group, onSelectMatch, bookmakerId, allMatches, isFavorite = false, onToggleFavorite, favoriteTeams = [], onToggleFavoriteTeam, sectionRef = null }) {
  const isFavoriteTeamGroup = Boolean(group.isFavoriteTeamGroup);
  const finished = group.matches.filter((match) => match.status === 'FT').length;
  const upcoming = group.matches.filter((match) => match.status === 'upcoming').length;

  return (
    <section ref={sectionRef} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm scroll-mt-4 dark:shadow-[0_18px_40px_-22px_rgba(0,0,0,0.8)]">
      <div className="flex flex-col gap-2 border-b border-line bg-header px-3 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {isFavoriteTeamGroup ? (
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/15 text-amber-200">
              <Star className="h-4 w-4 fill-amber-300" aria-hidden="true" />
            </span>
          ) : (
            <LeagueBadge src={group.logo} name={group.league} />
          )}
          <span className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight sm:text-lg">{group.league}</h2>
            {leagueCountryLabel(group.league) && (
              <span className="block truncate text-[11px] font-normal leading-tight text-white/60">{leagueCountryLabel(group.league)}</span>
            )}
          </span>
          {!isFavoriteTeamGroup && (
            <button
              type="button"
              onClick={() => onToggleFavorite(group.league)}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition duration-150 ease-out-soft active:scale-95 ${
                isFavorite
                  ? 'border-amber-300 bg-amber-400/15 text-amber-300'
                  : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
              }`}
              aria-label={`${isFavorite ? 'Remove' : 'Add'} ${group.league} as favourite league`}
              title={`${isFavorite ? 'Remove from' : 'Add to'} favourite leagues`}
            >
              <Star className={`h-4 w-4 ${isFavorite ? 'fill-amber-300' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-white/15 px-2.5 py-1">{group.matches.length} matches</span>
          <span className="rounded-full bg-white/15 px-2.5 py-1">{upcoming} upcoming</span>
          <span className="rounded-full bg-white/15 px-2.5 py-1">{finished} finished</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 bg-field p-2 sm:gap-4 sm:p-4 lg:grid-cols-2 2xl:grid-cols-3">
        {group.matches.map((match) => (
          <MatchCard
            key={`${match.league}-${match.id}`}
            match={match}
            onSelect={onSelectMatch}
            bookmakerId={bookmakerId}
            allMatches={allMatches}
            favoriteTeams={favoriteTeams}
            onToggleFavoriteTeam={onToggleFavoriteTeam}
          />
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
  const [selectedDate, setSelectedDate] = useState(() => localTodayDate());
  const [query, setQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [bookmakerId, setBookmakerId] = useState('sportsbet');
  const [favoriteLeagues, setFavoriteLeagues] = useState([]);
  const [favoriteTeams, setFavoriteTeams] = useState([]);
  const [allTeamOptions, setAllTeamOptions] = useState([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [mobileNavActive, setMobileNavActive] = useState('dashboard');
  const [viewMode, setViewMode] = useState('cards');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accaLegs, setAccaLegs] = useState([]);
  const [splitSelectedId, setSplitSelectedId] = useState(null);
  const [isLg, setIsLg] = useState(false);
  const [voteLeaderboard, setVoteLeaderboard] = useState(null);
  const [voteLeaderboardLoading, setVoteLeaderboardLoading] = useState(true);
  const [voteLeaderboardError, setVoteLeaderboardError] = useState('');
  const [voteLeaderboardRefreshKey, setVoteLeaderboardRefreshKey] = useState(0);
  const [followBusyUid, setFollowBusyUid] = useState('');
  const [followError, setFollowError] = useState('');

  const dashboardRef = useRef(null);
  const resultsRef = useRef(null);
  const matchesRef = useRef(null);
  const watchlistRef = useRef(null);
  const scrollPositionRef = useRef(0);
  const swipeStartRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const pointerSwipeRef = useRef(null);
  const suppressClickRef = useRef(false);
  const dragStateRef = useRef({ active: false, committed: false });
  const [dragOffset, setDragOffset] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [snapBack, setSnapBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const initialDate = localTodayDate();

    setSelectedDate((current) => current || initialDate);
    const cached = readMatchDataCache(initialDate) || readMatchDataCache();
    const hasCache = Boolean(cached && Array.isArray(cached.leagues) && cached.leagues.length);
    if (hasCache) {
      setData(cached);
      setError('');
    }

    loadMatchDataWithRetry(initialDate)
      .then((nextData) => {
        if (cancelled) return;
        setData(nextData);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        if (!hasCache) {
          setError('Could not load Firestore match data. Try refreshing in a moment.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem('preferredBookmaker');
    if (saved && DIRECT_MATCH_BOOKMAKERS.has(saved)) setBookmakerId(saved);
    else if (saved) window.localStorage.setItem('preferredBookmaker', 'sportsbet');
  }, []);

  useEffect(() => {
    if (matchParam || isSettingsView) return;
    const saved = window.localStorage.getItem('activeSection');
    if (saved && ['dashboard', 'matches', 'watchlist', 'results'].includes(saved)) {
      setMobileNavActive(saved);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('activeSection', mobileNavActive);
  }, [mobileNavActive]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(FAVORITE_LEAGUES_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        setFavoriteLeagues(saved.filter((item) => typeof item === 'string' && item.trim()));
      }
    } catch {
      setFavoriteLeagues([]);
    }
  }, [voteLeaderboardRefreshKey]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(FAVORITE_TEAMS_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        setFavoriteTeams(saved.filter((item) => typeof item === 'string' && item.trim()));
      }
    } catch {
      setFavoriteTeams([]);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsLg(mq.matches);
    const handler = (e) => setIsLg(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const isSplit = isLg && viewMode === 'split' && (mobileNavActive === 'matches' || mobileNavActive === 'watchlist');
    document.documentElement.style.overflowY = isSplit ? 'hidden' : '';
    return () => { document.documentElement.style.overflowY = ''; };
  }, [viewMode, mobileNavActive, isLg]);

  // Lock background scroll while the mobile filters modal is open.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [filtersOpen]);

  // Bet slip (accumulator) — persisted to the user's account (draft doc).
  const draftLoadedRef = useRef(false);
  const draftSaveTimer = useRef(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/bet-slips', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        // Only enable draft saving once we've conclusively read the server draft
        // (ok, or 404 = no draft yet). On a transient 5xx, leave saving disabled
        // so the next edit can't overwrite the real draft with an empty array.
        if (!res.ok && res.status !== 404) return;
        const data = await res.json().catch(() => ({}));
        if (active && Array.isArray(data?.draft?.legs)) setAccaLegs(data.draft.legs);
        if (active) draftLoadedRef.current = true;
      } catch {}
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!draftLoadedRef.current) return undefined; // don't clobber the server draft before it loads
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(async () => {
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) return;
        await fetch('/api/bet-slips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'saveDraft', legs: accaLegs, stake: 10 }),
        });
      } catch {}
    }, 800);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [accaLegs]);
  const accaKeys = useMemo(() => new Set(accaLegs.map((l) => accaLegKey(l.matchId, l.label))), [accaLegs]);
  const toggleAccaLeg = useCallback((leg) => {
    setAccaLegs((legs) => {
      const key = accaLegKey(leg.matchId, leg.label);
      if (legs.some((l) => accaLegKey(l.matchId, l.label) === key)) {
        return legs.filter((l) => accaLegKey(l.matchId, l.label) !== key);
      }
      // One leg per match keeps the combined probability valid.
      return [...legs.filter((l) => String(l.matchId) !== String(leg.matchId)), leg];
    });
  }, []);
  const removeAccaLeg = useCallback((leg) => {
    setAccaLegs((legs) => legs.filter((l) => accaLegKey(l.matchId, l.label) !== accaLegKey(leg.matchId, leg.label)));
  }, []);
  const clearAcca = useCallback(() => setAccaLegs([]), []);

  useEffect(() => {
    let active = true;

    async function loadFavoriteTeamsFromProfile() {
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const { getUserProfile } = await import('../firestore-data');
        const user = getFirebaseAuth().currentUser;
        if (!user) return;
        const nextProfile = await getUserProfile(user.uid);
        if (active) setIsPlatformOwner(Boolean(nextProfile?.isPlatformOwner));
        const nextTeams = Array.isArray(nextProfile?.favoriteTeams) ? nextProfile.favoriteTeams : [];
        if (!active || !nextTeams.length) return;
        setFavoriteTeams(nextTeams);
        window.localStorage.setItem(FAVORITE_TEAMS_STORAGE_KEY, JSON.stringify(nextTeams));
      } catch {
        if (active) setIsPlatformOwner(false);
        // Local preferences remain available if profile loading is unavailable.
      }
    }

    loadFavoriteTeamsFromProfile();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAllTeamOptions() {
      try {
        const { loadTeamOptionsFromFirestore } = await import('../firestore-data');
        const nextOptions = await loadTeamOptionsFromFirestore();
        if (active && Array.isArray(nextOptions) && nextOptions.length) {
          setAllTeamOptions(nextOptions);
        }
      } catch {
        // The currently loaded slate still provides a smaller fallback list.
      }
    }

    loadAllTeamOptions();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadVoteLeaderboard() {
      setVoteLeaderboardLoading(true);
      setVoteLeaderboardError('');
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) throw new Error('Sign in again to load crowd votes.');
        const response = await fetch('/api/match-votes?scope=leaderboard', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(matchVoteErrorMessage(result, 'No data captured yet.'));
        if (active) setVoteLeaderboard(result);
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (active) setVoteLeaderboardError(error.message || 'No data captured yet.');
      } finally {
        if (active) setVoteLeaderboardLoading(false);
      }
    }

    loadVoteLeaderboard();
    return () => {
      active = false;
      controller.abort();
    };
  }, [voteLeaderboardRefreshKey]);

  const handleBookmakerChange = useCallback((nextBookmakerId) => {
    const safeBookmakerId = DIRECT_MATCH_BOOKMAKERS.has(nextBookmakerId) ? nextBookmakerId : 'sportsbet';
    setBookmakerId(safeBookmakerId);
    window.localStorage.setItem('preferredBookmaker', safeBookmakerId);
  }, []);

  const handleFollowUser = useCallback(async (targetUid, shouldFollow) => {
    const cleanTargetUid = String(targetUid || '').trim();
    if (!cleanTargetUid) return;
    setFollowBusyUid(cleanTargetUid);
    setFollowError('');
    try {
      const { getFirebaseAuth } = await import('../firebase');
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sign in again to follow users.');
      const response = await fetch('/api/match-votes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({
          action: shouldFollow ? 'followUser' : 'unfollowUser',
          targetUid: cleanTargetUid,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(matchVoteErrorMessage(result, shouldFollow ? 'Could not follow this user.' : 'Could not unfollow this user.'));
      setVoteLeaderboard(result);
      setVoteLeaderboardRefreshKey((value) => value + 1);
    } catch (error) {
      setFollowError(error.message || 'Could not update following.');
    } finally {
      setFollowBusyUid('');
    }
  }, []);

  const refreshMatchData = useCallback(async (dateOverride = selectedDate) => {
    const cacheDate = dateOverride === 'all' ? '' : dateOverride;
    const nextData = await loadMatchDataWithRetry(cacheDate);
    setData(nextData);
    setError('');
    return nextData;
  }, [selectedDate]);

  const matches = useMemo(() => flattenMatches(data), [data]);
  const leagues = useMemo(() => [...new Set(matches.map((match) => match.league))].sort(compareLeagues), [matches]);
  const visibleTeamOptions = useMemo(() => teamOptionsFromMatches(matches), [matches]);
  const teamOptions = allTeamOptions.length ? allTeamOptions : visibleTeamOptions;
  const favoriteLeagueSet = useMemo(() => new Set(favoriteLeagues), [favoriteLeagues]);
  const dates = useMemo(
    () => [...new Set((data?.availableDates?.length ? data.availableDates : matches.map((match) => match.date)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [data?.availableDates, matches],
  );
  const stats = useMemo(() => summarize(matches, data?.allTimeSummary), [matches, data?.allTimeSummary]);
  const todayDate = useMemo(() => localTodayDate(), []);
  const dateOptions = useMemo(
    () => [...new Set([...dates, todayDate].filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [dates, todayDate],
  );
  const selectedDateIndex = dateOptions.indexOf(selectedDate);
  const todayDateIndex = dateOptions.indexOf(todayDate);

  useEffect(() => {
    if (selectedDate || !dates.length) return;
    setSelectedDate(defaultMatchDate(dates, data?.captured_at));
  }, [data?.captured_at, dates, selectedDate]);

  useEffect(() => {
    if (!selectedDate || data?.date === selectedDate) return;
    let cancelled = false;
    const cacheDate = selectedDate === 'all' ? '' : selectedDate;
    const cached = readMatchDataCache(cacheDate);
    if (cached && Array.isArray(cached.leagues) && cached.leagues.length) {
      setData(cached);
      setError('');
    }
    const hasUsableData = Boolean(data && Array.isArray(data.leagues) && data.leagues.length);
    loadMatchDataWithRetry(cacheDate)
      .then((nextData) => {
        if (cancelled) return;
        setData(nextData);
        setError('');
      })
      .catch(() => {
        if (!cancelled && !hasUsableData && !(cached && Array.isArray(cached.leagues) && cached.leagues.length)) {
          setError('Could not load Firestore match data. Try refreshing in a moment.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data?.date, selectedDate]);

  useEffect(() => {
    if (!leagues.length || !favoriteLeagues.length) return;
    const available = new Set(leagues);
    const nextFavorites = favoriteLeagues.filter((item) => available.has(item));
    if (nextFavorites.length !== favoriteLeagues.length) {
      setFavoriteLeagues(nextFavorites);
      window.localStorage.setItem(FAVORITE_LEAGUES_STORAGE_KEY, JSON.stringify(nextFavorites));
    }
  }, [favoriteLeagues, leagues]);

  useEffect(() => {
    if (!allTeamOptions.length || !favoriteTeams.length) return;
    const available = favoriteTeamSet(allTeamOptions);
    const nextFavorites = favoriteTeams.filter((item) => available.has(teamPreferenceKey(item)));
    if (nextFavorites.length !== favoriteTeams.length) {
      setFavoriteTeams(nextFavorites);
      window.localStorage.setItem(FAVORITE_TEAMS_STORAGE_KEY, JSON.stringify(nextFavorites));
    }
  }, [allTeamOptions, favoriteTeams]);

  const handleFavoriteTeamsChange = useCallback((nextTeams) => {
    const cleanTeams = [...new Set((nextTeams || []).map((team) => String(team || '').trim()).filter(Boolean))].slice(0, MAX_FAVORITE_TEAMS);
    setFavoriteTeams(cleanTeams);
    window.localStorage.setItem(FAVORITE_TEAMS_STORAGE_KEY, JSON.stringify(cleanTeams));
  }, []);

  const handleFavoriteLeaguesChange = useCallback((nextLeagues) => {
    const available = new Set(leagues);
    const cleanLeagues = [...new Set((nextLeagues || []).map((item) => String(item || '').trim()).filter(Boolean))]
      .filter((item) => !available.size || available.has(item))
      .slice(0, 20);
    setFavoriteLeagues(cleanLeagues);
    window.localStorage.setItem(FAVORITE_LEAGUES_STORAGE_KEY, JSON.stringify(cleanLeagues));
  }, [leagues]);

  const saveFavoriteTeamsToProfile = useCallback((nextTeams) => {
    async function save() {
      try {
        const { getFirebaseAuth } = await import('../firebase');
        const { updateUserFavoriteTeams } = await import('../firestore-data');
        const user = getFirebaseAuth().currentUser;
        if (!user) return;
        await updateUserFavoriteTeams(user.uid, nextTeams);
      } catch {
        // Local favourites still work if profile persistence is temporarily unavailable.
      }
    }

    save();
  }, []);

  const handleFavoriteTeamToggle = useCallback((teamName) => {
    const cleanTeam = String(teamName || '').trim();
    const cleanKey = teamPreferenceKey(cleanTeam);
    if (!cleanTeam || !cleanKey) return;

    setFavoriteTeams((current) => {
      const currentSet = favoriteTeamSet(current);
      const next = currentSet.has(cleanKey)
        ? current.filter((item) => teamPreferenceKey(item) !== cleanKey)
        : [...current, cleanTeam].slice(0, MAX_FAVORITE_TEAMS);
      window.localStorage.setItem(FAVORITE_TEAMS_STORAGE_KEY, JSON.stringify(next));
      saveFavoriteTeamsToProfile(next);
      return next;
    });
  }, [saveFavoriteTeamsToProfile]);

  const handleFavoriteLeagueToggle = useCallback((nextLeague) => {
    setFavoriteLeagues((current) => {
      const next = current.includes(nextLeague)
        ? current.filter((item) => item !== nextLeague)
        : [...current, nextLeague];
      window.localStorage.setItem(FAVORITE_LEAGUES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [slideDir, setSlideDir] = useState(0);
  const selectAllDates = useCallback(() => {
    setSlideDir(0);
    setSelectedDate('all');
  }, []);
  const selectToday = useCallback(() => {
    if (todayDateIndex === -1) return;
    const nextDirection = selectedDateIndex === -1 ? 0 : todayDateIndex > selectedDateIndex ? 1 : todayDateIndex < selectedDateIndex ? -1 : 0;
    setSlideDir(nextDirection);
    setSelectedDate(todayDate);
  }, [selectedDateIndex, todayDate, todayDateIndex]);
  // Reset every match filter back to its default (today / all leagues / all statuses / no search).
  const resetFilters = useCallback(() => {
    setLeague('all');
    setStatus('all');
    setQuery('');
    setSlideDir(0);
    setSelectedDate(todayDate);
  }, [todayDate]);

  const moveDate = useCallback(
    (direction) => {
      if (!dateOptions.length) return;
      setSlideDir(direction > 0 ? 1 : -1);

      // With no specific date selected (e.g. "All dates"), step relative to today so a
      // forward swipe lands on tomorrow — not the oldest/newest extreme.
      const anchorIndex = selectedDateIndex === -1 ? todayDateIndex : selectedDateIndex;
      if (anchorIndex === -1) {
        setSelectedDate(direction > 0 ? dateOptions[0] : dateOptions[dateOptions.length - 1]);
        return;
      }

      const nextIndex = Math.min(Math.max(anchorIndex + direction, 0), dateOptions.length - 1);
      setSelectedDate(dateOptions[nextIndex]);
    },
    [dateOptions, selectedDateIndex, todayDateIndex],
  );

  const reviewDate = selectedDate && selectedDate !== 'all' ? selectedDate : todayDate;
  const earliestReviewDate = dateOptions[0] || '';
  const latestReviewDate = dateOptions[dateOptions.length - 1] || '';
  const reviewWeek = weekStartMonday(reviewDate);
  const canMoveReviewDatePrevious = dateOptions.length > 0 && reviewDate > earliestReviewDate;
  const canMoveReviewDateNext = dateOptions.length > 0 && reviewDate < latestReviewDate;
  const canMoveReviewWeekPrevious = dateOptions.length > 0 && reviewWeek > weekStartMonday(earliestReviewDate);
  const canMoveReviewWeekNext = dateOptions.length > 0 && reviewWeek < weekStartMonday(latestReviewDate);
  const moveReviewDate = useCallback(
    (direction) => {
      if (!dateOptions.length) return;
      const anchor = selectedDate && selectedDate !== 'all' ? selectedDate : todayDate;
      const anchorIndex = dateOptions.indexOf(anchor);
      let target;
      if (anchorIndex !== -1) {
        const nextIndex = Math.min(Math.max(anchorIndex + direction, 0), dateOptions.length - 1);
        target = dateOptions[nextIndex];
      } else if (direction > 0) {
        // Anchor is between match days (e.g. after a week jump) — step to the
        // nearest available date in the requested direction.
        target = dateOptions.find((date) => date > anchor) || dateOptions[dateOptions.length - 1];
      } else {
        target = [...dateOptions].reverse().find((date) => date < anchor) || dateOptions[0];
      }
      setSlideDir(direction > 0 ? 1 : -1);
      setSelectedDate(target);
    },
    [dateOptions, selectedDate, todayDate],
  );
  const moveReviewWeek = useCallback(
    (direction) => {
      if (!dateOptions.length) return;
      const anchor = selectedDate && selectedDate !== 'all' ? selectedDate : todayDate;
      let target = addDaysToIsoDate(anchor, direction * 7);
      if (!target) return;
      if (target < dateOptions[0]) target = dateOptions[0];
      if (target > dateOptions[dateOptions.length - 1]) target = dateOptions[dateOptions.length - 1];
      setSlideDir(direction > 0 ? 1 : -1);
      setSelectedDate(target);
    },
    [dateOptions, selectedDate, todayDate],
  );

  const handleReviewFilterChange = useCallback((nextFilter) => {
    const safeFilter = nextFilter || 'all';
    setReviewFilter(safeFilter);
    if (safeFilter !== 'all') {
      setStatus('FT');
      setSlideDir(0);
    }
  }, []);
  const refreshVoteLeaderboard = useCallback(() => {
    setVoteLeaderboardRefreshKey((key) => key + 1);
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return matches
      .filter((match) => (league === 'all' ? true : match.league === league))
      .filter((match) => (!selectedDate || selectedDate === 'all' ? true : match.date === selectedDate))
      .filter((match) => {
        if (status === 'all') return true;
        if (status === 'FT') return match.status === 'FT';
        if (status === 'live') return match.status === 'live';
        return match.status !== 'FT';
      })
      .filter((match) => matchHasReviewFilter(match, reviewFilter, matches))
      .filter((match) => {
        if (!normalized) return true;
        return `${match.home?.name || ''} ${match.away?.name || ''} ${match.league}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }, [league, matches, query, reviewFilter, selectedDate, status]);
  const groupedMatches = useMemo(() => groupMatchesForDisplay(filtered, favoriteLeagues, favoriteTeams), [favoriteLeagues, favoriteTeams, filtered]);
  const favoriteGroups = useMemo(() => groupFavoriteMatches(filtered, favoriteLeagues, favoriteTeams), [favoriteLeagues, favoriteTeams, filtered]);
  const displayedGroups = mobileNavActive === 'watchlist' ? favoriteGroups : groupedMatches;
  // Count of active non-default filters (date stepper and Live are their own controls).
  const activeFilterCount = (league !== 'all' ? 1 : 0) + (status !== 'all' && status !== 'live' ? 1 : 0) + (query.trim() ? 1 : 0);

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

  const splitSelectedMatch = useMemo(() => {
    for (const g of displayedGroups) {
      const m = g.matches.find((x) => String(x.id) === String(splitSelectedId));
      if (m) return m;
    }
    return displayedGroups[0]?.matches?.[0] || null;
  }, [displayedGroups, splitSelectedId]);

  const handleSplitSelect = useCallback(
    (match) => {
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
        setSplitSelectedId(String(match.id));
      } else {
        handleSelectMatch(match);
      }
    },
    [handleSelectMatch],
  );

  const changeViewMode = useCallback((mode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem('dashboardViewMode', mode);
    } catch {
      // View preference is non-critical.
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem('dashboardViewMode');
    if (saved === 'split' || saved === 'cards') setViewMode(saved);
  }, []);

  const openSettings = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('match');
    params.set('view', 'settings');
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const scrollToSection = useCallback((ref, activeKey) => {
    setMobileNavActive(activeKey);
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const openDashboardSection = useCallback(() => scrollToSection(dashboardRef, 'dashboard'), [scrollToSection]);
  const openMatchesSection = useCallback(() => scrollToSection(matchesRef, 'matches'), [scrollToSection]);
  const openWatchlistSection = useCallback(() => {
    scrollToSection(watchlistRef.current ? watchlistRef : matchesRef, 'watchlist');
  }, [scrollToSection]);
  const openMobileSettings = useCallback(() => {
    setMobileNavActive('settings');
    openSettings();
  }, [openSettings]);

  const leaveSettingsForSection = useCallback((activeKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.delete('match');
    setMobileNavActive(activeKey);
    const next = params.toString();
    router.push(next ? `?${next}` : '/dashboard', { scroll: false });
  }, [router, searchParams]);

  const settingsNavDashboard = useCallback(() => leaveSettingsForSection('dashboard'), [leaveSettingsForSection]);
  const settingsNavMatches = useCallback(() => leaveSettingsForSection('matches'), [leaveSettingsForSection]);
  const settingsNavWatchlist = useCallback(() => leaveSettingsForSection('watchlist'), [leaveSettingsForSection]);

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

  // Touch handlers — fast-swipe for quick flicks, long-press-and-drag for grabbable scrubbing.
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback((event) => {
    if (event.touches.length !== 1) {
      swipeStartRef.current = null;
      clearLongPressTimer();
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    dragStateRef.current = { active: false, committed: false };
    setSnapBack(false);
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      dragStateRef.current.active = true;
      setDragActive(true);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(8); } catch {}
      }
    }, 260);
  }, [clearLongPressTimer]);

  const onTouchMove = useCallback((event) => {
    const start = swipeStartRef.current;
    if (!start) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!dragStateRef.current.active) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPressTimer();
      return;
    }
    // Rubber-band damping past 40% of viewport width
    const w = typeof window !== 'undefined' ? window.innerWidth || 360 : 360;
    const max = w * 0.4;
    const damped = Math.abs(dx) <= max ? dx : Math.sign(dx) * (max + (Math.abs(dx) - max) * 0.35);
    setDragOffset(damped);
  }, [clearLongPressTimer]);

  const onTouchEnd = useCallback(
    (event) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      clearLongPressTimer();
      const dragging = dragStateRef.current.active;
      dragStateRef.current.active = false;

      if (!start) {
        if (dragging) {
          setDragActive(false);
          setDragOffset(0);
        }
        return;
      }
      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - start.x : 0;
      const dy = touch ? touch.clientY - start.y : 0;
      const dt = Date.now() - start.time;

      if (dragging) {
        const w = typeof window !== 'undefined' ? window.innerWidth || 360 : 360;
        const commitThreshold = Math.min(120, w * 0.22);
        if (Math.abs(dx) >= commitThreshold) {
          setDragActive(false);
          setDragOffset(0);
          moveDate(dx < 0 ? 1 : -1);
        } else {
          setSnapBack(true);
          setDragOffset(0);
          setDragActive(false);
          setTimeout(() => setSnapBack(false), 220);
        }
        return;
      }

      // Fast-swipe fallback (no long-press): keep the original quick-flick behaviour.
      if (dt > 600) return;
      if (Math.abs(dy) > 30) return;
      if (Math.abs(dx) < 50) return;
      moveDate(dx < 0 ? 1 : -1);
    },
    [clearLongPressTimer, moveDate],
  );

  const onTouchCancel = useCallback(() => {
    swipeStartRef.current = null;
    clearLongPressTimer();
    if (dragStateRef.current.active) {
      dragStateRef.current.active = false;
      setDragActive(false);
      setSnapBack(true);
      setDragOffset(0);
      setTimeout(() => setSnapBack(false), 220);
    }
  }, [clearLongPressTimer]);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) return;
    pointerSwipeRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      active: false,
      pointerId: event.pointerId,
    };
    setSnapBack(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event) => {
    const start = pointerSwipeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!start.active) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      start.active = true;
      setDragActive(true);
    }

    event.preventDefault();
    const w = typeof window !== 'undefined' ? window.innerWidth || 360 : 360;
    const max = w * 0.4;
    const damped = Math.abs(dx) <= max ? dx : Math.sign(dx) * (max + (Math.abs(dx) - max) * 0.35);
    setDragOffset(damped);
  }, []);

  const onPointerEnd = useCallback(
    (event) => {
      const start = pointerSwipeRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      pointerSwipeRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      if (!start.active) return;
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const w = typeof window !== 'undefined' ? window.innerWidth || 360 : 360;
      const commitThreshold = Math.min(120, w * 0.22);

      if (Math.abs(dx) >= commitThreshold && Math.abs(dx) > Math.abs(dy) * 1.15) {
        setDragActive(false);
        setDragOffset(0);
        moveDate(dx < 0 ? 1 : -1);
        return;
      }

      setSnapBack(true);
      setDragOffset(0);
      setDragActive(false);
      setTimeout(() => setSnapBack(false), 220);
    },
    [moveDate],
  );

  const onPointerCancel = useCallback((event) => {
    const start = pointerSwipeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pointerSwipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start.active) return;
    setSnapBack(true);
    setDragOffset(0);
    setDragActive(false);
    setTimeout(() => setSnapBack(false), 220);
  }, []);

  const onDateFrameClickCapture = useCallback((event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  if (selectedMatch) {
    return (
      <MatchDetailView
        match={selectedMatch}
        onBack={handleBack}
        allMatches={matches}
        bookmakerId={bookmakerId}
        onBookmakerChange={handleBookmakerChange}
        favoriteTeams={favoriteTeams}
        onToggleFavoriteTeam={handleFavoriteTeamToggle}
        isPlatformOwner={isPlatformOwner}
        onVoteSaved={refreshVoteLeaderboard}
        accaKeys={accaKeys}
        onToggleLeg={toggleAccaLeg}
      />
    );
  }

  if (isSettingsView) {
    return (
      <>
        <DesktopSidePanel
          active="settings"
          onDashboard={settingsNavDashboard}
          onMatches={settingsNavMatches}
          onWatchlist={settingsNavWatchlist}
          onSettings={openMobileSettings}
        />
        <SettingsView
          bookmakerId={bookmakerId}
          onBookmakerChange={handleBookmakerChange}
          onBack={closeSettings}
          leagueOptions={leagues}
          favoriteLeagues={favoriteLeagues}
          onFavoriteLeaguesChange={handleFavoriteLeaguesChange}
          teamOptions={teamOptions}
          favoriteTeams={favoriteTeams}
          onFavoriteTeamsChange={handleFavoriteTeamsChange}
        />
        <MobileBottomNav
          active="settings"
          onDashboard={settingsNavDashboard}
          onMatches={settingsNavMatches}
          onWatchlist={settingsNavWatchlist}
          onSettings={openMobileSettings}
        />
      </>
    );
  }

  return (
    <main className="min-h-dvh bg-field pb-24 sm:pl-20 sm:pb-0 lg:pl-64">
      <DesktopSidePanel
        active={mobileNavActive}
        onDashboard={openDashboardSection}
        onMatches={openMatchesSection}
        onWatchlist={openWatchlistSection}
        onSettings={openMobileSettings}
      />
      <header className="border-b border-line bg-surface sm:hidden">
        <div className="mx-auto max-w-[112rem] px-3 py-3 sm:px-6 sm:py-4 lg:px-8">
          <div className="flex items-center justify-center gap-3 rounded-lg border border-line bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_42%,#e8f5ff_100%)] px-2 py-2 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-white/80 dark:bg-[linear-gradient(135deg,#1d2128_0%,#15181d_42%,#123034_100%)] dark:ring-white/5 sm:justify-between sm:px-5 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start">
              <div className="flex w-full shrink items-center justify-center sm:w-auto sm:shrink-0">
                <BrandMark className="text-3xl sm:text-2xl" />
              </div>
              <div className="hidden min-w-0 sm:block">
                <div className="text-sm font-semibold uppercase tracking-wide text-muted">Smarter football picks</div>
                <div className="mt-0.5 text-base font-semibold text-ink">Model-backed edges, odds and match signals in one view</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section ref={dashboardRef} className="mx-auto max-w-[112rem] scroll-mt-4 px-2 py-3 sm:px-6 sm:py-5 lg:px-8">
        <div className={`${mobileNavActive === 'dashboard' ? 'block' : 'hidden'} overflow-hidden rounded-lg border border-line bg-surface`}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2 sm:hidden">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">All-time overview</span>
            <span className="text-xs font-semibold text-faint">{stats.finished} settled</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5">
            <Stat icon={Goal} label="Hit Rate" value={`${stats.accuracy}%`} sublabel="All time" featured />
            <Stat
              icon={BarChart3}
              label="Odds Hit / Loss"
              sublabel="All time"
              featured
              value={
                <span className="flex flex-nowrap items-baseline gap-x-1.5 whitespace-nowrap text-lg sm:gap-x-2 sm:text-2xl">
                  <span className="text-signal">{formatOddsTotal(stats.oddsTotals?.hit)}</span>
                  <span className="text-sm font-semibold text-faint">v</span>
                  <span className="text-miss">{formatOddsTotal(stats.oddsTotals?.loss)}</span>
                </span>
              }
            />
            <Stat icon={CheckCircle2} label="Finished" value={stats.finished} tone="text-signal" sublabel="All time" />
            <Stat icon={Clock3} label="Upcoming" value={stats.upcoming} tone="text-blue-700 dark:text-blue-300" sublabel="All time" />
            <Stat icon={Activity} label="Matches" value={stats.total} sublabel="All time" className="col-span-2 sm:col-span-1" />
          </div>
        </div>

        <div ref={resultsRef} className={`${mobileNavActive === 'dashboard' || mobileNavActive === 'results' ? 'block' : 'hidden'} scroll-mt-4`}>
          <div className="mb-4">
            <ValueBoard matches={matches} onSelectMatch={handleSelectMatch} accaKeys={accaKeys} onToggleLeg={toggleAccaLeg} />
          </div>
          <ResultsReview
            matches={matches}
            selectedDate={selectedDate}
            reviewSummary={data?.allTimeSummary?.review}
            activeReviewFilter={reviewFilter}
            onReviewFilterChange={handleReviewFilterChange}
            onSelectToday={selectToday}
            onMoveDate={moveReviewDate}
            onMoveWeek={moveReviewWeek}
            canMovePreviousDate={canMoveReviewDatePrevious}
            canMoveNextDate={canMoveReviewDateNext}
            canMovePreviousWeek={canMoveReviewWeekPrevious}
            canMoveNextWeek={canMoveReviewWeekNext}
          />
          <VoteLeaderboard
            data={voteLeaderboard}
            loading={voteLeaderboardLoading}
            error={voteLeaderboardError}
            bookmakerId={bookmakerId}
            onFollowUser={handleFollowUser}
            followBusyUid={followBusyUid}
            followError={followError}
          />
          <div className="mt-4">
            <BankrollPanel matches={matches} />
          </div>
          <div className="mt-4">
            <CalibrationPanel matches={matches} />
          </div>
        </div>

        <div className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'block' : 'hidden'} sticky top-0 z-30 -mx-2 bg-field px-2 pb-2 pt-3 sm:hidden`}>
          <div className="flex items-center gap-2">
            {/* Left/right date stepper — tap the centre to jump to today */}
            <div className="flex min-w-0 flex-1 items-center rounded-full border border-line bg-surface">
              <button
                type="button"
                onClick={() => moveDate(-1)}
                disabled={!dateOptions.length || selectedDateIndex === 0}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted disabled:opacity-30"
                aria-label="Previous match date"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={selectToday}
                className="min-w-0 flex-1 truncate px-1 text-center text-sm font-semibold text-ink"
                aria-label="Show today's matches"
              >
                {!selectedDate || selectedDate === todayDate
                  ? 'Today'
                  : selectedDate === 'all'
                    ? 'All dates'
                    : formatDateDMY(selectedDate)}
              </button>
              <button
                type="button"
                onClick={() => moveDate(1)}
                disabled={!dateOptions.length || selectedDateIndex === dateOptions.length - 1}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted disabled:opacity-30"
                aria-label="Next match date"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {/* Live quick-filter */}
            <button
              type="button"
              onClick={() => setStatus((s) => (s === 'live' ? 'all' : 'live'))}
              aria-pressed={status === 'live'}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition ${
                status === 'live' ? 'border-red-500 bg-red-600 text-white' : 'border-line bg-surface text-muted'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${status === 'live' ? 'animate-pulse bg-white' : 'bg-red-500'}`} aria-hidden="true" />
              Live
            </button>
            {/* All-in-one filters */}
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-label="Filters"
              className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
                filtersOpen || activeFilterCount > 0 ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-muted'
              }`}
            >
              <ListFilter className="h-5 w-5" aria-hidden="true" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

        </div>

        {/* Mobile filters modal — multiple filters, reset and close */}
        {filtersOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:hidden" role="dialog" aria-modal="true" aria-label="Filters">
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => setFiltersOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <div className="relative z-10 flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-base font-semibold text-ink">Filters</h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label="Close"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink active:scale-95"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Date</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={selectToday}
                      aria-pressed={selectedDate === todayDate}
                      className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${selectedDate === todayDate ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted'}`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={selectAllDates}
                      aria-pressed={selectedDate === 'all'}
                      className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${selectedDate === 'all' ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted'}`}
                    >
                      All dates
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Status</h3>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'all', label: 'All' },
                      { value: 'upcoming', label: 'Upcoming' },
                      { value: 'live', label: 'Live' },
                      { value: 'FT', label: 'Finished' },
                    ].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStatus(value)}
                        aria-pressed={status === value}
                        className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${status === value ? 'border-ink bg-header text-white' : 'border-line bg-surface text-muted'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">League</h3>
                  <select
                    value={league}
                    onChange={(event) => setLeague(event.target.value)}
                    className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm"
                    aria-label="League"
                  >
                    <option value="all">All leagues</option>
                    {leagues.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Search</h3>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search teams or league"
                    className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 border-t border-line px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-5 text-sm font-semibold text-muted transition hover:text-ink active:scale-95"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-header text-sm font-semibold text-white transition active:scale-95"
                >
                  Show {displayedGroups.reduce((total, group) => total + (group.matches?.length || 0), 0)} matches
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={matchesRef} className={`scroll-mt-4 ${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'sm:sticky sm:top-0 z-30 -mx-2 bg-field px-2 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8' : ''}`}>
        <div className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'hidden sm:grid' : 'hidden'} mt-3 scroll-mt-4 gap-2 rounded-lg border border-line bg-surface p-3 sm:mt-5 sm:grid-cols-[12rem_10rem_minmax(18rem,1fr)_minmax(16rem,1fr)] sm:items-center sm:gap-3`}>
          <select
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-center text-sm sm:h-10 sm:text-left"
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
            className="hidden h-11 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm sm:block sm:h-10"
            aria-label="Status"
          >
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="FT">Finished</option>
            <option value="all">All statuses</option>
          </select>
          <div className="hidden min-w-0 flex-nowrap items-center gap-1.5 rounded-md border border-line bg-field p-1 sm:flex">
            <button
              type="button"
              onClick={selectAllDates}
              disabled={selectedDate === 'all'}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-muted hover:bg-white/80 dark:bg-white/10 disabled:border-ink disabled:bg-header disabled:text-white disabled:opacity-100"
              aria-label="Show all match dates"
            >
              All dates
            </button>
            <button
              type="button"
              onClick={selectToday}
              disabled={selectedDate === todayDate}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-muted hover:bg-white/80 dark:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Show today's matches"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => moveDate(-1)}
              disabled={!dateOptions.length || selectedDateIndex === 0}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-white/80 dark:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous match date"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <select
              value={selectedDate || 'all'}
              onChange={(event) => { setSlideDir(0); setSelectedDate(event.target.value); }}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-center text-sm sm:text-left"
              aria-label="Match date"
            >
              <option value="all">All dates</option>
              {dateOptions.map((date) => (
                <option key={date} value={date}>
                  {formatDateDMY(date)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => moveDate(1)}
              disabled={!dateOptions.length || selectedDateIndex === dateOptions.length - 1}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-white/80 dark:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next match date"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams or league"
            className="h-11 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-center text-sm placeholder:text-center sm:h-10 sm:text-left sm:placeholder:text-left"
          />
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-miss/20 bg-miss/10 p-4 text-sm text-miss">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'flex' : 'hidden'} mt-3 items-center justify-between gap-3 sm:mt-5`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            {displayedGroups.reduce((total, group) => total + (group.matches?.length || 0), 0)} matches
          </span>
          <div className="hidden lg:block">
            <ViewModeToggle value={viewMode} onChange={changeViewMode} />
          </div>
        </div>
        </div>

        <div
          className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'block' : 'hidden'} ${viewMode === 'split' && isLg ? '' : 'date-slide-frame'} mt-3${dragActive ? ' date-slide-grabbing' : ''}`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onClickCapture={onDateFrameClickCapture}
        >
          <div
            key={`${selectedDate || 'all'}-${slideDir}`}
            className={`space-y-4 sm:space-y-5 ${slideDir > 0 ? 'date-slide-next' : slideDir < 0 ? 'date-slide-prev' : ''}${dragActive ? ' date-slide-dragging' : ''}${snapBack ? ' date-slide-snapback' : ''}`}
            style={dragActive || snapBack ? { transform: `translateX(${dragOffset}px)` } : undefined}
          >
          {!isLg ? (
            // Mobile: dense compact list (cards are desktop-only).
            displayedGroups.map((group) => (
              <CompactLeagueSection
                key={group.leagueId || group.league}
                group={group}
                allMatches={matches}
                onSelectMatch={handleSelectMatch}
                isFavorite={favoriteLeagueSet.has(group.league)}
                onToggleFavorite={handleFavoriteLeagueToggle}
                sectionRef={group.isFavoriteTeamGroup || group.isFavoriteLeagueGroup ? watchlistRef : null}
              />
            ))
          ) : viewMode === 'split' ? (
            <SplitView
              groups={displayedGroups}
              selectedMatch={splitSelectedMatch}
              onSelectRow={handleSplitSelect}
              bookmakerId={bookmakerId}
              allMatches={matches}
              onBookmakerChange={handleBookmakerChange}
              favoriteTeams={favoriteTeams}
              onToggleFavoriteTeam={handleFavoriteTeamToggle}
              isPlatformOwner={isPlatformOwner}
              onVoteSaved={refreshVoteLeaderboard}
              accaKeys={accaKeys}
              onToggleLeg={toggleAccaLeg}
            />
          ) : (
            displayedGroups.map((group) => (
              <LeagueSection
                key={group.leagueId || group.league}
                group={group}
                onSelectMatch={handleSelectMatch}
                bookmakerId={bookmakerId}
                allMatches={matches}
                isFavorite={favoriteLeagueSet.has(group.league)}
                onToggleFavorite={handleFavoriteLeagueToggle}
                favoriteTeams={favoriteTeams}
                onToggleFavoriteTeam={handleFavoriteTeamToggle}
                sectionRef={group.isFavoriteTeamGroup || group.isFavoriteLeagueGroup ? watchlistRef : null}
              />
            ))
          )}

          {!error && filtered.length === 0 && mobileNavActive !== 'watchlist' && (
            <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-muted">
              No matches found for the selected filters.
            </div>
          )}
          {!error && mobileNavActive === 'watchlist' && !favoriteGroups.length && (
            <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-muted">
              No favourite matches for these filters. Add favourite teams or leagues in Settings.
            </div>
          )}
          </div>
        </div>

      </section>
      <AccaSlip legs={accaLegs} onRemoveLeg={removeAccaLeg} onClear={clearAcca} onSaved={() => setAccaLegs([])} />
      <MobileBottomNav
        active={mobileNavActive}
        onDashboard={openDashboardSection}
        onMatches={openMatchesSection}
        onWatchlist={openWatchlistSection}
        onSettings={openMobileSettings}
      />
    </main>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <DashboardErrorBoundary>
        <Suspense fallback={<main className="min-h-screen bg-field" />}>
          <HomeInner />
        </Suspense>
      </DashboardErrorBoundary>
    </AuthGate>
  );
}
