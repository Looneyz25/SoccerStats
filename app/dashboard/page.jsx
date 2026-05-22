'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '../auth-gate';
import { loadMatchDataFromFirestore, readMatchDataCache } from '../firestore-data';
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
  Settings,
  ShieldCheck,
  Star,
  UploadCloud,
  UserRound,
  XCircle,
  ChevronDown,
} from 'lucide-react';

const GAMBLING_HELP_URL = 'https://www.gamblinghelponline.org.au/';
const BETSTOP_URL = 'https://www.betstop.gov.au/';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'lvrstats.com@gmail.com';
const FAVORITE_LEAGUES_STORAGE_KEY = 'favoriteLeagues';
const FAVORITE_TEAMS_STORAGE_KEY = 'favoriteTeams';
const MAX_FAVORITE_TEAMS = 100;
const PREDICTION_TRACKING_START_DATE = '2026-04-22';
const WINNER_CONFIDENCE_THRESHOLD = 0.40;
const BOOKMAKER_WINNER_GUARD_THRESHOLD = 0.65;
const RESULT_IMPORT_TIMEOUT_MS = 30000;

async function loadMatchData(date = '') {
  return loadMatchDataFromFirestore(date);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePastedJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const start = [objectStart, arrayStart].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  const json = end >= start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    return JSON.parse(json);
  } catch (error) {
    const repaired = json
      .replace(/}\s*(?="[^"]+"\s*:)/g, '},')
      .replace(/]\s*(?="[^"]+"\s*:)/g, '],')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch {
      throw error;
    }
  }
}

function ownerImportErrorMessage(result, fallback = 'Result import failed.') {
  const raw = result?.detail || result?.error || fallback;
  if (raw === 'platform-owner-required') return 'Only the platform owner can import match results.';
  if (raw === 'missing-token' || raw === 'invalid-token') return 'Sign in again before importing results.';
  if (raw === 'no-matching-firestore-match') return 'No matching Firestore match was found for this card.';
  if (raw === 'invalid-import-json') return result?.detail || 'The pasted JSON could not be read.';
  return raw;
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
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white text-xs font-bold text-slate-500">
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
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/20 bg-white">
        <img src={src} alt="" className="h-full w-full object-contain p-1" aria-hidden="true" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/12 text-xs font-bold text-white">
      {String(name || '?').slice(0, 2).toUpperCase()}
    </span>
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
  if (result === 'pass') return 'border-slate-300 bg-slate-100 shadow-panel';
  return 'border-slate-300 bg-white shadow-panel';
}

function marketValueClass(result) {
  if (result === 'hit') return 'text-emerald-700';
  if (result === 'miss') return 'text-red-700';
  return 'text-ink';
}

function resultBadgeClass(result) {
  if (result === 'hit') return 'bg-emerald-100 text-emerald-700';
  if (result === 'miss') return 'bg-red-100 text-red-700';
  return 'bg-slate-200 text-slate-600';
}

function visibleResultLabel(result) {
  if (result === 'miss') return '';
  return result || 'pending';
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
  return Number(value || 0).toFixed(1);
}

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
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
    return {
      ...prediction,
      actual: prediction.actual ?? match.actuals?.corners_total,
      result: prediction.result || marketResultFromActual(prediction, match.actuals?.corners_total),
    };
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
      ...fallback,
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
  return {
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

function comparisonFromPrices({ title, modelProb, marketOdds, fallbackLabel = null, marketOddsEstimated = false }) {
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
      note: 'This pick comes from recent trends, so treat the bookmaker odds as a guide only.',
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
      note: isModelSuggestion
        ? 'Our model likes this from recent totals, but bookmaker odds are not available.'
        : 'Our model has a price from recent totals, but bookmaker odds are not available.',
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
    return comparisonFromPrices({
      title: `${market.pick || 'Corners'} ${line} Corners`,
      modelProb: modelProbabilityForMarket(market),
      marketOdds: Number(market.odds),
      fallbackLabel: 'Trend pick',
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
    <div className="mt-2 rounded-md border border-slate-300 bg-white p-2 text-xs shadow-panel">
      <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] gap-2 px-1.5 text-[11px] font-semibold uppercase text-slate-500">
        <span>1X2 split</span>
        <span className="text-right">Model</span>
        <span className="text-right">Bookmaker</span>
      </div>
      <div className="grid gap-1">
        {rows.map((row) => {
          const selected = row.key === pickType;
          const selectedClass = verifyPick
            ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-400'
            : 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500';
          const selectedText = verifyPick ? 'font-semibold text-amber-800' : 'font-semibold text-emerald-800';
          return (
            <div
              key={row.key}
              className={`grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] items-center gap-2 rounded px-1.5 py-1 ${
                selected ? selectedClass : 'text-slate-600'
              }`}
            >
              <span className={`truncate ${selected ? selectedText : ''}`}>{row.label}</span>
              <span className={`text-right ${selected ? selectedText : ''}`}>{fmtPct(row.model) || '-'}</span>
              <span className="text-right text-slate-500">{fmtPct(row.bookmaker) || '-'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function winnerActualType(match) {
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
  if (match.status === 'FT') return market;
  const odds = winnerGuidanceOdds(match);
  const noVig = bookmakerNoVigProbability(odds, market.type);
  if (!Number.isFinite(noVig)) return market;
  if (noVig >= WINNER_CONFIDENCE_THRESHOLD) return market;
  return { ...market, lowConfidence: true, lowConfidenceProb: noVig };
}

function winnerMarketWithGuidance(match, allMatches = []) {
  const market = match.predictions?.winner;
  if (!market?.type) return market || null;
  if (match.status === 'FT') return market;
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
  if (precomputed?.market?.type === winner?.type && precomputed?.market?.guidance?.type === winner?.guidance?.type) {
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
  if (winner?.lowConfidence) return null;
  const side = winner?.type;
  return side === 'home' || side === 'away' || side === 'draw' ? side : null;
}

function winnerPredictionCardClass(match, side, winner = match.predictions?.winner) {
  const predictedSide = winnerPredictionSide(match, winner);
  if (predictedSide !== side) return 'border-line bg-field/60';
  if (winner?.result === 'hit') return 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-500';
  if (winner?.result === 'miss') return 'border-red-300 bg-red-50 ring-1 ring-red-300';
  return 'border-amber-300 bg-amber-50';
}

function winnerPredictionScoreClass(match, winner = match.predictions?.winner) {
  if (winnerPredictionSide(match, winner) !== 'draw') return match.status === 'FT' ? 'rounded-md bg-ink px-3 py-2 text-sm text-white' : 'text-xs text-slate-400';
  if (winner?.result === 'hit') return 'rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-500';
  if (winner?.result === 'miss') return 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-300';
  return 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800';
}

function WinnerPredictionMeta({ match, side, modelProbability, winner = match.predictions?.winner }) {
  if (winner?.lowConfidence && side === 'home') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex h-7 items-center rounded-md bg-slate-100 px-2 font-semibold text-slate-500">
          Low confidence — no Winner pick
        </span>
      </div>
    );
  }
  if (!winner || winnerPredictionSide(match, winner) !== side) {
    return <div className="mt-2 h-7" aria-hidden="true" />;
  }
  const modelText = fmtPct(modelProbability);
  const predictionLabel = side === 'draw' ? 'Draw' : 'Prediction';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex h-7 items-center rounded-md bg-white/70 px-2 font-semibold text-slate-700">{predictionLabel}</span>
      {modelText && <span className="inline-flex h-7 items-center rounded-md bg-white/70 px-2 font-semibold text-slate-700">Model {modelText}</span>}
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
  { key: 'btts', label: 'BTTS' },
  { key: 'ou_goals', label: 'Goals' },
  { key: 'ou_cards', label: 'Cards', getMarket: (match, allMatches) => cardsMarketWithModelProbability(match, allMatches) },
  { key: 'ou_corners', label: 'Corners', getMarket: (match, allMatches) => cornerMarketFromStreaks(match, allMatches) },
];
const HEADLINE_STATS_MARKETS = ['winner', 'btts', 'ou_goals', 'ou_cards', 'ou_corners'];

function marketForConfig(config, match, allMatches) {
  if (config.key === 'winner') return displayWinnerMarket(match, allMatches || match.__allMatches);
  const precomputed = match.display_markets?.[config.key === 'ou_goals' ? 'goals' : config.key === 'ou_cards' ? 'cards' : config.key === 'ou_corners' ? 'corners' : config.key]?.market;
  if (precomputed) return precomputed;
  if (config.getMarket) return config.getMarket(match, allMatches || match.__allMatches);
  return match.predictions?.[config.key];
}

function headlineStatsMarkets(match) {
  if (Array.isArray(match.display_summary?.headlineMarkets)) return match.display_summary.headlineMarkets;
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
        : match.display_markets?.[precomputedKey]?.comparison || modelVsBookmakerComparison(match, config.key, market),
    };
  }).filter((row) => row.market);
}

function suggestedPickForMatch(match, allMatches) {
  const predictions = match.predictions || {};
  const precomputed = match.display_markets || {};
  const displayBtts = precomputed.btts?.market || displayBttsMarket(predictions.btts, match);
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches);
  const cornersComparison = precomputed.corners?.comparison || modelVsBookmakerComparison(match, 'ou_corners', cornerMarket);

  return suggestedMarketPick([
    { label: 'BTTS', market: displayBtts, comparison: bttsComparison, modelProbability: precomputed.btts?.modelProbability },
    { label: 'Goals', market: predictions.ou_goals, comparison: goalsComparison, modelProbability: precomputed.goals?.modelProbability },
    { label: 'Cards', market: displayCards, comparison: cardsComparison, modelProbability: precomputed.cards?.modelProbability },
    { label: 'Corners', market: cornerMarket, comparison: cornersComparison, modelProbability: precomputed.corners?.modelProbability },
  ]);
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
    return { label: 'Avoid picking a winner', tone: 'warning', reason: 'Our model does not see better odds than the bookmaker', edge: 0, quality };
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
  if (confidence.label === 'Avoid') return { ...confidence, label: 'Avoid picking a winner' };
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
    <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Data confidence</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{confidenceDetailCopy(confidence)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <ConfidenceBadge confidence={confidence} />
          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold leading-none ${toneBadgeClass(quality.tone)}`}>
            {quality.label}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="text-xs font-semibold uppercase text-emerald-800">Supporting signals</div>
          {signals.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {signals.map((item) => (
                <span key={item} className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-800">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-emerald-900">No strong supporting data was available for this match.</p>
          )}
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3">
          <div className="text-xs font-semibold uppercase text-amber-900">Caution notes</div>
          {cautions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cautions.map((item) => (
                <span key={item} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-amber-900">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-amber-950">No major caution flags for the available data.</p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
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
  return (data?.leagues || []).flatMap((league) =>
    (league.matches || []).map((match) => ({
      ...match,
      league: league.name,
      leagueId: league.id,
      leagueLogo: leagueLogo(league),
    })),
  );
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
  matches.forEach((match) => {
    [match.home?.name, match.away?.name].forEach((name) => {
      const key = teamPreferenceKey(name);
      if (key && !teams.has(key)) teams.set(key, name);
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
  const rankCompare = leagueSortRank(a) - leagueSortRank(b);
  return rankCompare || a.localeCompare(b);
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

  matches.forEach((match) => {
    if (!grouped.has(match.league)) {
      grouped.set(match.league, {
        league: match.league,
        leagueId: match.leagueId,
        logo: match.leagueLogo,
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
  const upcoming = total - finished;
  const settledMarkets = matches.flatMap(headlineStatsMarkets);
  const hits = settledMarkets.filter((market) => market.result === 'hit').length;
  const accuracy = settledMarkets.length ? Math.round((hits / settledMarkets.length) * 100) : 0;
  const oddsTotals = settledMarkets.reduce((totals, market) => {
    const odds = Number(market?.odds);
    if (!Number.isFinite(odds)) return totals;
    if (market.result === 'hit') totals.hit += odds;
    if (market.result === 'miss') totals.loss += odds;
    return totals;
  }, { hit: 0, loss: 0 });

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
    oddsHit: suggestedHits.reduce((sum, market) => sum + (Number(market.odds) || 0), 0),
    oddsMiss: suggestedMisses.reduce((sum, market) => sum + (Number(market.odds) || 0), 0),
    net: 0,
  };
  suggestedRow.net = suggestedRow.oddsHit - suggestedRow.oddsMiss;

  return [suggestedRow, ...MARKET_CONFIG.map((config) => {
    const settled = matches
      .map((match) => marketForConfig(config, match, allMatches))
      .filter((market) => market?.result === 'hit' || market?.result === 'miss');
    const hits = settled.filter((market) => market.result === 'hit');
    const misses = settled.filter((market) => market.result === 'miss');
    const oddsHit = hits.reduce((sum, market) => sum + (Number(market.odds) || 0), 0);
    const oddsMiss = misses.reduce((sum, market) => sum + (Number(market.odds) || 0), 0);
    return {
      ...config,
      total: settled.length,
      hits: hits.length,
      misses: misses.length,
      hitRate: settled.length ? Math.round((hits.length / settled.length) * 100) : 0,
      oddsHit,
      oddsMiss,
      net: oddsHit - oddsMiss,
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
    <div className={`min-w-0 border-b border-line bg-white px-3 py-3 text-center sm:border-b-0 sm:border-r sm:px-4 last:border-r-0 ${featured ? 'bg-slate-50/70' : ''} ${className}`}>
      <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-normal text-slate-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 flex justify-center ${featured ? 'text-2xl' : 'text-xl'} font-semibold sm:text-2xl ${tone}`}>{value}</div>
      {sublabel && <div className="mt-1 hidden text-[11px] font-semibold uppercase text-slate-400 sm:block">{sublabel}</div>}
    </div>
  );
}

function MarketPill({ label, market, edgeBadge, modelProbability }) {
  const detail = market ? formatMarketDetail(market) : 'No pick';
  const modelPercent = fmtPct(modelProbability);
  return (
    <div className={`flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 sm:px-3 ${market ? marketPillClass(market.result) : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
      <span className="shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {modelPercent && <span className="hidden rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-slate-700 sm:inline-flex">Model {modelPercent}</span>}
        {edgeBadge && (
          <span className="hidden items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700 sm:inline-flex">
            <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
            <span>{edgeBadge}</span>
          </span>
        )}
        <span className={`flex min-w-0 items-center justify-end gap-1 text-right text-sm font-semibold leading-5 ${market ? marketValueClass(market.result) : 'text-slate-400'}`}>
          {market && resultIcon(market.result)}
          <span className="min-w-0 truncate">{detail || '-'}</span>
        </span>
      </span>
    </div>
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
    .sort((a, b) => {
      if (isFinished) {
        const resultRank = (item) => item.market?.result === 'hit' ? 2 : item.market?.result === 'miss' ? 0 : 1;
        const resultDiff = resultRank(b) - resultRank(a);
        if (resultDiff) return resultDiff;
      }
      const edgeDiff = b.modelEdge - a.modelEdge;
      if (edgeDiff) return edgeDiff;
      const probDiff = (Number.isFinite(b.modelProbability) ? b.modelProbability : 0) - (Number.isFinite(a.modelProbability) ? a.modelProbability : 0);
      if (probDiff) return probDiff;
      return a.index - b.index;
    })[0];
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-panel">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value ?? '-'}</div>
    </div>
  );
}

function toneBadgeClass(tone) {
  if (tone === 'positive') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (tone === 'warning') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-300 bg-slate-50 text-slate-700';
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
      className={`inline-flex h-11 w-full items-center justify-center rounded-md border px-3 text-sm font-semibold shadow-panel transition sm:w-52 sm:px-5 ${bookmaker.buttonClass}`}
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
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition ${
        isFavorite
          ? 'border-amber-300 bg-amber-50 text-amber-600'
          : 'border-slate-200 bg-white/80 text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
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

function ResponsibleGamblingNotice({ compact = false }) {
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-950 shadow-panel ${compact ? 'px-3 py-2 text-xs leading-5' : 'p-4 text-sm leading-6'}`}>
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
    setProfileBusy(true);
    setProfileMessage('');
    setProfileError('');
    try {
      const { updateProfile } = await import('firebase/auth');
      const { getFirebaseAuth } = await import('../firebase');
      const { updateUserProfile } = await import('../firestore-data');
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in again before updating your profile.');

      const displayName = profileForm.displayName.trim().slice(0, 80);
      const nickname = profileForm.nickname.trim().slice(0, 40);
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
    <main className="min-h-screen bg-field">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-3xl px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_42%,#e8f5ff_100%)] px-2 py-2 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-white/80 sm:hidden">
            <img
              src="/LVR-LOGO.png"
              alt="LVRstats.com"
              className="h-24 w-full object-cover object-center"
            />
          </div>
          <div className="mt-3 flex items-start gap-3 sm:mt-0">
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

        <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Account</h2>
              <p className="mt-1 text-sm text-slate-500">Leave this device signed out when you are finished.</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signOutBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-wait disabled:opacity-70"
            >
              {signOutBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Mail className="h-4 w-4 text-signal" aria-hidden="true" />
                Contact
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Send through billing, access, data, or account questions.
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">Support email</div>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-0.5 block truncate font-semibold text-ink underline-offset-2 hover:underline">
                    {SUPPORT_EMAIL}
                  </a>
                </div>
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">Useful details</div>
                  <div className="mt-0.5 font-medium text-ink">Account email, match name, and screenshot</div>
                </div>
              </div>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=Soccer%20Stats%20support`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email support
            </a>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <UserRound className="h-4 w-4 text-signal" aria-hidden="true" />
                Profile
              </h2>
              <p className="mt-1 text-sm text-slate-500">Update the name admins see on your account.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
                <input
                  value={profileForm.displayName}
                  onChange={(event) => handleProfileField('displayName', event.target.value)}
                  maxLength={80}
                  className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-slate-400"
                  placeholder="Your name"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Nickname</span>
                <input
                  value={profileForm.nickname}
                  onChange={(event) => handleProfileField('nickname', event.target.value)}
                  maxLength={40}
                  className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-slate-400"
                  placeholder="Optional nickname"
                />
              </label>
            </div>
            <div className="rounded-md border border-line bg-field p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                Favourite leagues
              </div>
              <div className="mt-2 flex gap-2">
                <select
                  value={leagueToAdd}
                  onChange={(event) => setLeagueToAdd(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-slate-400"
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
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
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
                      className={`flex items-center gap-2 rounded-md border bg-white px-2.5 py-2 text-sm shadow-panel ${
                        dragLeague === leagueName ? 'border-ink opacity-70' : 'border-line'
                      }`}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{leagueName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveFavoriteLeague(leagueName, -1)}
                          disabled={index === 0}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Move ${leagueName} up`}
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFavoriteLeague(leagueName, 1)}
                          disabled={index === favoriteLeagues.length - 1}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Move ${leagueName} down`}
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFavoriteLeague(leagueName)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-red-50 hover:text-miss"
                          aria-label={`Remove ${leagueName} from favourite leagues`}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Favourite leagues appear first on the dashboard. Star a league or add one here.</p>
              )}
            </div>
            <div className="rounded-md border border-line bg-field p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                Favourite teams
              </div>
              <div className="mt-2 flex gap-2">
                <select
                  value={teamToAdd}
                  onChange={(event) => setTeamToAdd(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-slate-400"
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
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {(profileForm.favoriteTeams || []).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {profileForm.favoriteTeams.map((team) => (
                    <span key={teamPreferenceKey(team)} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900">
                      <span className="truncate">{team}</span>
                      <button
                        type="button"
                        onClick={() => removeFavoriteTeam(team)}
                        className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-amber-800 hover:bg-amber-100"
                        aria-label={`Remove ${team} from favourite teams`}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Favourite team matches will appear at the top of the dashboard.</p>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                Signed in as <span className="font-semibold text-ink">{profile?.email || '-'}</span>
              </div>
              <button
                type="button"
                onClick={saveProfile}
                disabled={profileBusy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-wait disabled:opacity-70"
              >
                {profileBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
                Save profile
              </button>
            </div>
            {profileMessage && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal">
                {profileMessage}
              </div>
            )}
            {profileError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss">
                {profileError}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <CreditCard className="h-4 w-4 text-signal" aria-hidden="true" />
                Subscription
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Manage your Soccer Stats Pro billing and payment method.
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">Status</div>
                  <div className="mt-0.5 font-semibold capitalize text-ink">{String(subscriptionStatus).replaceAll('_', ' ')}</div>
                </div>
                <div className="rounded-md border border-line bg-field px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">{isTrialing ? 'Trial ends' : 'Next renewal'}</div>
                  <div className="mt-0.5 font-semibold text-ink">{(isTrialing ? subscriptionTrialEnd || subscriptionRenewal : subscriptionRenewal) || '-'}</div>
                </div>
              </div>
              {isTrialing && (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Trial access stays active until the trial ends. Stripe will charge the saved payment method after the trial; without a payment method, the subscription cancels and dashboard access is removed.
                </p>
              )}
              {profile?.manualAccess && !hasStripeSubscription && (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Your access is currently managed by an administrator. You can still start your own subscription.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={openBillingSession}
              disabled={billingBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field disabled:cursor-not-allowed disabled:opacity-60"
            >
              {billingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
              {billingActionLabel}
            </button>
          </div>
          {billingMessage && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal">
              {billingMessage}
            </div>
          )}
          {billingError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss">
              {billingError}
            </div>
          )}
        </div>

        {isPlatformOwner && (
          <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4 text-signal" aria-hidden="true" />
                  Admin access
                </h2>
                <p className="mt-1 text-sm text-slate-500">View users, Stripe status, and manual access overrides.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  window.sessionStorage.setItem('looneyz-auth-return-path', '/dashboard/admin');
                  window.location.assign('/dashboard/admin');
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
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
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex items-center gap-1 text-sm font-semibold ${marketValueClass(market.result)}`}>
          {resultIcon(market.result)}
          {visibleResultLabel(market.result) && <span>{visibleResultLabel(market.result)}</span>}
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
  if (tone === 'warning') return 'border-amber-400 bg-amber-100 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function comparisonOddsText(value) {
  return /^\d/.test(String(value)) ? `${value} odds` : value;
}

function summaryRowClass(result) {
  if (result === 'hit') return 'border border-emerald-300 border-l-4 border-l-emerald-600 bg-emerald-50/50 shadow-panel';
  if (result === 'miss') return 'border border-red-300 border-l-4 border-l-red-600 bg-red-50/50 shadow-panel';
  return 'border border-slate-300 border-l-4 border-l-slate-500 bg-slate-50 shadow-panel';
}

function ModelVsBookmakerComparison({ comparison }) {
  if (!comparison?.badge?.label) return null;
  const modelFavoured = comparison.badge.tone === 'positive';
  const bookmakerFavoured = comparison.badge.tone === 'warning';
  const bookmakerLabel = comparison.bookmaker.label || 'Bookmaker';
  const modelPanelClass = modelFavoured
    ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500'
    : bookmakerFavoured
      ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-400'
      : 'bg-white text-slate-600 ring-1 ring-slate-300';
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
          <span className="text-slate-500">{bookmakerLabel}</span>
          <span className="text-right font-semibold text-ink">{comparisonOddsText(comparison.bookmaker.odds)}</span>
          <span className="text-right text-slate-500">{comparison.bookmaker.probability}</span>
        </div>
        <div className={`rounded px-1.5 py-1 ${modelPanelClass}`}>
          <div className="grid grid-cols-[5.5rem_5.25rem_3.5rem] items-center gap-2">
            <span className={modelFavoured ? 'font-semibold text-emerald-800' : bookmakerFavoured ? 'font-semibold text-amber-800' : 'text-slate-500'}>Model</span>
            <span className="text-right font-semibold text-ink">{comparisonOddsText(comparison.model.odds)}</span>
            <span className={modelFavoured ? 'text-right font-semibold text-emerald-800' : bookmakerFavoured ? 'text-right font-semibold text-amber-800' : 'text-right text-slate-500'}>{comparison.model.probability}</span>
          </div>
          <div className={`mt-1 leading-5 ${modelFavoured ? 'text-slate-800' : bookmakerFavoured ? 'text-amber-950' : 'text-slate-600'}`}>
            <span className={`font-semibold ${bookmakerFavoured ? 'text-amber-800' : 'text-slate-500'}`}>{bookmakerFavoured ? 'Caution: ' : 'Bet note: '}</span>
            {comparison.note}
          </div>
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
          const displayOdds = fallbackStreakOdds(streak, match);
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
                <span>Odds {formatOdds(displayOdds)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultsReview({ matches, selectedDate, reviewSummary, activeReviewFilter = 'all', onReviewFilterChange }) {
  const [reviewScope, setReviewScope] = useState('date');
  const selectedWeek = useMemo(() => weekStartMonday(selectedDate), [selectedDate]);
  const rowsForScope = useCallback((scope) => {
    if (scope === 'date' && selectedDate && selectedDate !== 'all') {
      return reviewSummary?.byDate?.[selectedDate] || summarizeResultsByMarket(trackedFinishedMatches(matches).filter((match) => match.date === selectedDate), matches).filter((row) => row.total > 0);
    }
    if (scope === 'week' && selectedWeek) {
      return reviewSummary?.byWeek?.[selectedWeek] || summarizeResultsByMarket(
        trackedFinishedMatches(matches).filter((match) => weekStartMonday(match.date) === selectedWeek),
        matches,
      ).filter((row) => row.total > 0);
    }
    return reviewSummary?.all || summarizeResultsByMarket(trackedFinishedMatches(matches), matches).filter((row) => row.total > 0);
  }, [matches, reviewSummary, selectedDate, selectedWeek]);
  const scopeRows = {
    date: rowsForScope('date'),
    week: rowsForScope('week'),
    all: rowsForScope('all'),
  };
  const rows = scopeRows[reviewScope] || [];
  if (!rows.length && !scopeRows.all.length) return null;
  const best = [...rows].sort((a, b) => b.hitRate - a.hitRate)[0];
  const worst = [...rows].sort((a, b) => a.hitRate - b.hitRate)[0];
  const scopeOptions = [
    { key: 'date', label: selectedDate && selectedDate !== 'all' ? formatDateDMY(selectedDate) : 'Selected date' },
    { key: 'week', label: 'This week' },
    { key: 'all', label: 'All time' },
  ];
  const activeScope = scopeOptions.find((option) => option.key === reviewScope) || scopeOptions[0];
  const weekEnd = selectedWeek ? addDaysToIsoDate(selectedWeek, 6) : '';
  const rangeLabel =
    reviewScope === 'date'
      ? selectedDate && selectedDate !== 'all' ? formatDateDMY(selectedDate) : 'Selected date'
      : reviewScope === 'week' && selectedWeek
        ? `${formatDateDMY(selectedWeek)} to ${formatDateDMY(weekEnd)}`
        : 'All time';
  const insightPrefix = reviewScope === 'date' ? 'Date read' : reviewScope === 'week' ? 'Week read' : 'All-time read';
  const insight = best && worst
    ? `${insightPrefix}: ${best.label} is strongest at ${best.hitRate}%; ${worst.label} is weakest at ${worst.hitRate}%.`
    : best
      ? `${insightPrefix}: ${best.label} is the strongest market at ${best.hitRate}%.`
      : '';

  return (
    <section className="mt-3 rounded-lg border border-slate-300 bg-white p-3 shadow-panel sm:mt-5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Results review</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Tracked from {formatDateDMY(PREDICTION_TRACKING_START_DATE)}</p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-1 text-xs font-semibold sm:min-w-80">
          {scopeOptions.map((option) => {
            const active = reviewScope === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setReviewScope(option.key)}
                className={`rounded-md border px-2 py-1 ${
                  active ? 'border-ink bg-ink text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-field'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {insight && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-5 text-slate-700">
          {insight}
        </div>
      )}
      {(best || worst) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          {best && <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">Best {best.label} {best.hitRate}%</span>}
          {worst && <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700">Weakest {worst.label} {worst.hitRate}%</span>}
        </div>
      )}
      {rows.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((row) => {
            const active = activeReviewFilter === row.key;
            const isSuggested = row.key === 'suggested';
            const rowTone =
              row.hitRate >= 55
                ? 'border-emerald-200 bg-emerald-50/45 hover:border-emerald-300'
                : row.hitRate < 45
                  ? 'border-red-200 bg-red-50/45 hover:border-red-300'
                  : 'border-slate-300 bg-field hover:border-slate-400 hover:bg-white';
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onReviewFilterChange?.(active ? 'all' : row.key)}
                aria-pressed={active}
                className={`rounded-md border px-2.5 py-2 text-left transition sm:px-3 ${isSuggested ? 'col-span-2 sm:col-span-2' : ''} ${
                  active ? 'border-ink bg-white ring-2 ring-ink/15' : rowTone
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
                    <span>{row.label}</span>
                    {isSuggested && <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">Primary</span>}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row.hitRate >= 55 ? 'bg-emerald-100 text-emerald-700' : row.hitRate < 45 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {row.hitRate}%
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold leading-5 text-ink">{row.hits} hit / {row.misses} loss</div>
                <div className="mt-1 text-xs text-slate-500">
                  Odds {formatOddsTotal(row.oddsHit)} v {formatOddsTotal(row.oddsMiss)}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-slate-300 bg-field px-3 py-3 text-sm text-slate-500">
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
    <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Head to head context</h3>
          {summary?.count && (
            <p className="mt-1 text-sm text-slate-600">
              Last {summary.count}: {context.homeName} {summary.homeWins}, {context.awayName} {summary.awayWins}, draws {summary.draws}
            </p>
          )}
          {!summary?.count && h2hStreaks.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">Imported H2H trend data is available, but exact recent meeting rows are not in this local match file.</p>
          )}
        </div>
        {hasMeetingStats && (
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">{context.bttsText}</span>
            <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">{context.goalsText}</span>
            <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">{h2hXgCount ? `${h2hXgCount}/${displayedMeetings.length} with xG` : 'xG not available'}</span>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {advantage.items.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-300 bg-field px-3 py-2">
            <div className="text-xs font-semibold uppercase text-slate-500">{item.label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-ink">{item.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{item.detail}</div>
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
                  <span className={`rounded bg-white px-2 py-0.5 text-xs font-semibold ${streakMetaClass(result)}`}>{streak.value || '-'}</span>
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
        <div className="mt-3 overflow-hidden rounded-md border border-slate-300">
          <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem_3.25rem] gap-2 border-b border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500 sm:grid-cols-[5.5rem_minmax(0,1fr)_4rem_4rem_5rem_5rem]">
            <span>Date</span>
            <span>Versus</span>
            <span>Score</span>
            <span>xG</span>
            <span className="hidden sm:block">BTTS</span>
            <span className="hidden sm:block">Cards</span>
          </div>
          {displayedMeetings.map((meeting) => (
            <div key={meeting.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem_3.25rem] gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[5.5rem_minmax(0,1fr)_4rem_4rem_5rem_5rem]">
              <span className="font-semibold text-slate-500">{formatDateDMY(meeting.date)}</span>
              <span className="min-w-0 truncate text-slate-700">{teamNameForCopy(meeting.homeName)} v {teamNameForCopy(meeting.awayName)}</span>
              <span className="font-semibold text-ink">{meeting.score}</span>
              <span className="font-semibold text-slate-700">{formatH2hXg(meeting.xg)}</span>
              <span className="hidden text-slate-500 sm:block">{meeting.btts ? 'BTTS' : 'No BTTS'}</span>
              <span className="hidden text-slate-500 sm:block">{meeting.cards ?? '-'} cards</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictionSummaryCard({ match, allMatches, voteState = null }) {
  const matchWithContext = { ...match, __allMatches: allMatches };
  const predictions = match.predictions || {};
  const precomputed = match.display_markets || {};
  const confidence = loadMatchConfidence(match, allMatches);
  const winner = displayWinnerMarket(match, allMatches);
  const winnerLowConfidence = Boolean(winner?.lowConfidence);
  const winnerComparison = winnerLowConfidence ? null : displayWinnerComparison(matchWithContext, allMatches, winner);
  const displayBtts = precomputed.btts?.market || displayBttsMarket(predictions.btts, match);
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches);
  const cornersComparison = precomputed.corners?.comparison || modelVsBookmakerComparison(match, 'ou_corners', cornerMarket);

  const winnerPick = winnerLowConfidence ? 'Low confidence — no Winner pick' : (winner ? formatMarketDetail(winner) : null);
  const winnerText = winnerLowConfidence
    ? `Bookmaker no-vig probability for every side is below ${Math.round(WINNER_CONFIDENCE_THRESHOLD * 100)}%; outside the band where our backtest shows real edge.`
    : winnerRationale(match, allMatches, winner);
  const expectationSummary = matchExpectationSummary(match, allMatches);

  const lines = [
    { label: 'Winner', voteKey: 'winner', pick: winnerPick, text: winnerText, comparison: winnerComparison, result: winnerLowConfidence ? null : winner?.result },
    { label: 'BTTS', voteKey: 'btts', pick: displayBtts ? formatMarketDetail(displayBtts) : null, text: bttsRationale(match), comparison: bttsComparison, result: displayBtts?.result },
    { label: 'Goals', voteKey: 'goals', pick: predictions.ou_goals ? formatMarketDetail(predictions.ou_goals) : null, text: goalsRationale(match, allMatches), comparison: goalsComparison, result: predictions.ou_goals?.result },
    { label: 'Cards', voteKey: 'cards', pick: displayCards ? formatMarketDetail(displayCards) : null, text: cardsRationale(match, allMatches), comparison: cardsComparison, result: displayCards?.result },
    { label: 'Corners', voteKey: 'corners', pick: cornerMarket ? formatMarketDetail(cornerMarket) : null, text: cornersRationale(match, allMatches, cornerMarket), comparison: cornersComparison, result: cornerMarket?.result },
  ].filter((row) => row.pick && (row.text || row.comparison));
  const voteCutoff = formatVoteCutoff(voteState?.data?.cutoffAt);

  if (!lines.length) return null;

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3 shadow-panel sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-ink">Prediction summary</h3>
          <p className="mt-1 text-xs text-slate-500">{confidence.reason}</p>
        </div>
        {voteState && (
          <div className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
            <span>Crowd votes</span>
            <span className="text-slate-400">·</span>
            <span>{voteState.data?.locked ? 'Closed' : voteCutoff ? `Closes ${voteCutoff}` : 'Open'}</span>
          </div>
        )}
      </div>
      {voteState?.message && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{voteState.message}</div>}
      {voteState?.error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{voteState.error}</div>}
      {expectationSummary && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/70 px-3 py-3 text-sm leading-6 text-slate-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">What to expect</div>
          <p className="mt-1">{expectationSummary}</p>
        </div>
      )}
      <ul className="mt-4 space-y-3 text-sm">
        {lines.map((row) => (
          <li key={row.label} className={`grid gap-3 rounded-md px-3 py-3 sm:grid-cols-[24rem_minmax(0,1fr)] sm:items-start ${summaryRowClass(row.result)}`}>
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
                {row.label === 'Winner' && !winnerLowConfidence && <WinnerProbabilityBreakdown match={matchWithContext} comparison={winnerComparison} />}
              </span>
            </span>
            <span className="min-w-0 leading-5 text-slate-600">
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

function MatchResultImportPanel({ match, onImported }) {
  const [open, setOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submitImport(event) {
    event.preventDefault();
    setBusy(true);
    setBusyStage('Checking JSON...');
    setMessage('');
    setError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), RESULT_IMPORT_TIMEOUT_MS);
    try {
      if (!jsonText.trim()) throw new Error('Paste the JSON result first.');
      const parsedRaw = parsePastedJson(jsonText);
      const parsed = Array.isArray(parsedRaw) ? parsedRaw[0] : parsedRaw;
      if (!parsed || typeof parsed !== 'object') throw new Error('Paste one JSON result object for this match.');
      const payload = {
        ...parsed,
        id: match.id,
        date: match.date,
        league: match.league,
        home: match.home?.name,
        away: match.away?.name,
        status: 'FT',
      };
      const { getFirebaseAuth } = await import('../firebase');
      setBusyStage('Checking owner access...');
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sign in again before importing results.');

      setBusyStage('Updating Firestore...');
      const response = await fetch('/api/admin/import-result', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(ownerImportErrorMessage(result));
      const updated = result.updated?.[0];
      setBusyStage('Refreshing match...');
      try {
        await onImported?.(match.date);
        setJsonText('');
        setOpen(false);
        setMessage(updated ? `Updated ${updated.home} ${updated.score} ${updated.away}. Card refreshed.` : 'Match updated and refreshed.');
      } catch {
        setMessage(updated ? `Updated ${updated.home} ${updated.score} ${updated.away}. Refresh the page if the card has not changed yet.` : 'Match updated. Refresh the page if the card has not changed yet.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Upload timed out after 30 seconds. Refresh and check the match before trying again.');
      } else {
        setError(err.message || 'Could not import this result.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
      setBusyStage('');
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Owner result import</div>
          <div className="mt-0.5 text-xs text-slate-600">Paste the JSON from ChatGPT for this match only. The match id, teams, date and league are filled in automatically.</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
        >
          <UploadCloud className="h-4 w-4" aria-hidden="true" />
          {open ? 'Close import' : 'Import result'}
        </button>
      </div>

      {open && (
        <form onSubmit={submitImport} className="mt-3 space-y-3">
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            spellCheck={false}
            placeholder="Paste the JSON result here"
            className="min-h-60 w-full rounded-md border border-amber-200 bg-white p-3 font-mono text-xs leading-5 text-ink outline-none focus:border-amber-400"
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="text-xs text-slate-600">
              Needs final score. Stats can include corners, fouls, shotsOnTarget, yellowCards, redCards and firstToScore.
            </div>
            <button
              type="submit"
              disabled={busy || !jsonText.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-500"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
              {busy ? busyStage || 'Updating...' : 'Update Firestore'}
            </button>
          </div>
          {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">{message}</div>}
          {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</div>}
        </form>
      )}
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
      <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading crowd votes
      </div>
    );
  }
  if (!market?.options?.length) return null;

  const summary = data?.summary || {};
  const selectedValue = data?.myVotes?.[marketKey];
  const locked = Boolean(data?.locked);

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white/75 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase text-slate-500">
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
                selected ? 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-400' : 'border-slate-300 bg-white text-ink hover:border-slate-400'
              }`}
            >
              <span className="flex items-center justify-between gap-1.5">
                <span className="min-w-0 truncate text-xs font-semibold">{option.label}</span>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : selected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : null}
              </span>
              <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{percent}% · {count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MatchDetailView({ match, onBack, allMatches, bookmakerId, onBookmakerChange, favoriteTeams = [], onToggleFavoriteTeam, isPlatformOwner = false, onMatchImported }) {
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
      } catch (error) {
        setVoteError(error.message || 'Could not save your vote.');
      } finally {
        setVoteBusyKey('');
      }
    },
    [match.date, match.id],
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
            <h2 className="mt-1.5 text-base font-semibold leading-snug text-ink sm:text-xl">
              {match.home?.name} vs {match.away?.name}
            </h2>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_auto_1fr] sm:gap-2">
          <div className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-center shadow-panel sm:py-3 sm:text-left">
            <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
              <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
              <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.home?.name}</div>
              <TeamFavoriteButton teamName={match.home?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
            </div>
            <div className="mt-1 text-xs text-slate-500">Rank {match.home?.rank ?? '-'} · {match.home?.pts ?? '-'} pts</div>
          </div>
          {match.status === 'FT' && (
            <div className="justify-self-center rounded-md bg-ink px-3 py-1.5 text-center text-sm font-semibold text-white shadow-panel sm:px-3 sm:py-3 sm:text-base">
              {match.home?.goals ?? '-'}-{match.away?.goals ?? '-'}
            </div>
          )}
          {match.status !== 'FT' && <div className="hidden sm:block" />}
          <div className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-center shadow-panel sm:py-3 sm:text-left">
            <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
              <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
              <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.away?.name}</div>
              <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
            </div>
            <div className="mt-1 text-xs text-slate-500">Rank {match.away?.rank ?? '-'} · {match.away?.pts ?? '-'} pts</div>
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel transition hover:bg-field"
              >
                Open SofaScore match id {match.id}
              </a>
            )}
            <MatchResultImportPanel match={match} onImported={onMatchImported} />
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

        <PredictionSummaryCard match={match} allMatches={allMatches} voteState={voteState} />
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
      </div>
    </div>
  );
}

function MatchCard({ match, onSelect, bookmakerId, allMatches, favoriteTeams = [], onToggleFavoriteTeam }) {
  const predictions = match.predictions || {};
  const odds = displayThreeWayOdds(match);
  const actuals = match.actuals || {};
  const precomputed = match.display_markets || {};
  const displayWinner = displayWinnerMarket(match, allMatches);
  const displayBtts = precomputed.btts?.market || displayBttsMarket(predictions.btts, match);
  const bttsComparison = precomputed.btts?.comparison || modelVsBookmakerComparison(match, 'btts', displayBtts);
  const goalsComparison = precomputed.goals?.comparison || modelVsBookmakerComparison(match, 'ou_goals', predictions.ou_goals);
  const displayCards = precomputed.cards?.market || cardsMarketWithModelProbability(match, allMatches);
  const cardsComparison = precomputed.cards?.comparison || modelVsBookmakerComparison(match, 'ou_cards', displayCards);
  const cornerMarket = precomputed.corners?.market || cornerMarketFromStreaks(match, allMatches);
  const cornersComparison = precomputed.corners?.comparison || modelVsBookmakerComparison(match, 'ou_corners', cornerMarket);
  const confidence = loadMatchConfidence(match, allMatches);
  const winnerModelPct = precomputed.winner?.market?.type === displayWinner?.type
    ? precomputed.winner?.modelProbability ?? winnerModelProbability(match, displayWinner)
    : winnerModelProbability(match, displayWinner);
  const edgeBadgeFor = (comparison) =>
    comparison?.badge?.tone === 'positive' && comparison.edgePoints > 0 ? comparison.badge.label : null;
  const isFinished = match.status === 'FT';
  const compactPick = suggestedPickForMatch(match, allMatches);
  const openMatch = () => onSelect(match);
  const handleCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openMatch();
  };

  return (
    <article className="rounded-lg border border-line bg-white shadow-panel transition active:scale-[0.99] sm:hover:-translate-y-0.5 sm:hover:border-slate-300 sm:hover:shadow-lg">
      <div
        role="button"
        tabIndex={0}
        onClick={openMatch}
        onKeyDown={handleCardKeyDown}
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        aria-label={`View details for ${match.home?.name} vs ${match.away?.name}`}
      >
      <div className="border-b border-line px-3 py-3 sm:px-4">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-sm text-slate-600">
          <span className="min-w-0 truncate">{matchDisplayDate(match)}</span>
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
        <div className="grid gap-1.5 sm:hidden">
          <div className={`min-h-[5.75rem] rounded-md border px-2.5 py-2 ${winnerPredictionCardClass(match, 'home', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
                <div className="min-w-0 whitespace-normal break-words text-left text-sm font-semibold leading-snug text-ink sm:text-base">{match.home?.name}</div>
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
                <div className="min-w-0 whitespace-normal break-words text-left text-sm font-semibold leading-snug text-ink sm:text-base">{match.away?.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="away" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          {winnerPredictionSide(match, displayWinner) === 'draw' && (
            <div className={`rounded-md border px-2.5 py-2 text-center font-semibold ${winnerPredictionScoreClass(match, displayWinner)}`}>
              <div>{match.status === 'FT' ? `${match.home?.goals ?? '-'}-${match.away?.goals ?? '-'}` : 'Draw'}</div>
              <WinnerPredictionMeta match={match} side="draw" modelProbability={winnerModelPct} winner={displayWinner} />
            </div>
          )}
        </div>

        <div className="hidden items-stretch gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
          <div className={`flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-md border px-2.5 py-2 text-left ${winnerPredictionCardClass(match, 'home', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'home')} name={match.home?.name} />
                <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.home?.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.home?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="home" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
          <div className={`self-center justify-self-center text-center font-semibold ${winnerPredictionScoreClass(match, displayWinner)}`}>
            <div>
              {match.status === 'FT' ? (
                `${match.home?.goals ?? '-'}-${match.away?.goals ?? '-'}`
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-field text-[11px] uppercase shadow-sm">
                  v
                </span>
              )}
            </div>
            {winnerPredictionSide(match, displayWinner) === 'draw' && (
              <WinnerPredictionMeta match={match} side="draw" modelProbability={winnerModelPct} winner={displayWinner} />
            )}
          </div>
          <div className={`flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-md border px-2.5 py-2 text-left ${winnerPredictionCardClass(match, 'away', displayWinner)}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge src={teamLogo(match, 'away')} name={match.away?.name} />
                <div className="min-w-0 whitespace-normal break-words text-base font-semibold leading-snug text-ink">{match.away?.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TeamFavoriteButton teamName={match.away?.name} favoriteTeams={favoriteTeams} onToggleFavoriteTeam={onToggleFavoriteTeam} />
              </div>
            </div>
            <WinnerPredictionMeta match={match} side="away" modelProbability={winnerModelPct} winner={displayWinner} />
          </div>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 ${compactPick ? marketPillClass(compactPick.market?.result) : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-slate-500">Suggested pick</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {compactPick?.market?.result && (
                  <span className={`inline-flex items-center gap-1 rounded-md py-0.5 text-[11px] font-semibold leading-none ${visibleResultLabel(compactPick.market.result) ? 'px-1.5' : 'px-1'} ${resultBadgeClass(compactPick.market.result)}`}>
                    {resultIcon(compactPick.market.result)}
                    {visibleResultLabel(compactPick.market.result) && <span>{visibleResultLabel(compactPick.market.result)}</span>}
                  </span>
                )}
                {compactPick && edgeBadgeFor(compactPick.comparison) && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
                    {edgeBadgeFor(compactPick.comparison)}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`text-base font-semibold leading-6 ${compactPick ? 'text-ink' : 'text-slate-400'}`}>{compactPick ? `${compactPick.label} ${formatMarketDetail(compactPick.market)}` : 'No suggested pick'}</span>
              {compactPick && fmtPct(compactPick.modelProbability) && <span className="text-xs font-semibold text-slate-600">Model {fmtPct(compactPick.modelProbability)}</span>}
            </div>
          </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <MarketPill label="BTTS" market={displayBtts} edgeBadge={edgeBadgeFor(bttsComparison)} />
          <MarketPill label="Goals" market={predictions.ou_goals} edgeBadge={edgeBadgeFor(goalsComparison)} />
          <MarketPill label="Cards" market={displayCards} edgeBadge={edgeBadgeFor(cardsComparison)} />
          <MarketPill label="Corners" market={cornerMarket} edgeBadge={edgeBadgeFor(cornersComparison)} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-field p-2 text-center sm:mt-4 sm:gap-2">
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

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <ConfidenceBadge confidence={confidence} />
          <QualityBadges quality={confidence.quality} compact />
        </div>

        {match.status === 'FT' && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
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
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.10)] backdrop-blur sm:hidden" aria-label="Mobile app navigation">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {navItems.map(({ key, label, icon: Icon, onClick }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={onClick}
              aria-pressed={selected}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-semibold transition ${
                selected ? 'bg-ink text-white' : 'text-slate-600 hover:bg-field hover:text-ink'
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

function LeagueSection({ group, onSelectMatch, bookmakerId, allMatches, isFavorite = false, onToggleFavorite, favoriteTeams = [], onToggleFavoriteTeam, sectionRef = null, hiddenOnMobile = false }) {
  const isFavoriteTeamGroup = Boolean(group.isFavoriteTeamGroup);
  const finished = group.matches.filter((match) => match.status === 'FT').length;
  const upcoming = group.matches.length - finished;

  return (
    <section ref={sectionRef} className={`overflow-hidden rounded-lg border border-line bg-white scroll-mt-4 ${hiddenOnMobile ? 'hidden sm:block' : ''}`}>
      <div className="flex flex-col gap-2 border-b border-line bg-ink px-3 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {isFavoriteTeamGroup ? (
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/15 text-amber-200">
              <Star className="h-4 w-4 fill-amber-300" aria-hidden="true" />
            </span>
          ) : (
            <LeagueBadge src={group.logo} name={group.league} />
          )}
          <h2 className="truncate text-base font-semibold sm:text-lg">{group.league}</h2>
          {!isFavoriteTeamGroup && (
            <button
              type="button"
              onClick={() => onToggleFavorite(group.league)}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition ${
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
          <span className="rounded-full bg-white/12 px-2.5 py-1">{group.matches.length} matches</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{upcoming} upcoming</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{finished} finished</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 bg-field p-2 sm:gap-4 sm:p-4 lg:grid-cols-2">
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
  const [selectedDate, setSelectedDate] = useState('');
  const [query, setQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [bookmakerId, setBookmakerId] = useState('sportsbet');
  const [favoriteLeagues, setFavoriteLeagues] = useState([]);
  const [favoriteTeams, setFavoriteTeams] = useState([]);
  const [allTeamOptions, setAllTeamOptions] = useState([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [mobileNavActive, setMobileNavActive] = useState('dashboard');

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
    try {
      const saved = JSON.parse(window.localStorage.getItem(FAVORITE_LEAGUES_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        setFavoriteLeagues(saved.filter((item) => typeof item === 'string' && item.trim()));
      }
    } catch {
      setFavoriteLeagues([]);
    }
  }, []);

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

  const handleBookmakerChange = useCallback((nextBookmakerId) => {
    const safeBookmakerId = DIRECT_MATCH_BOOKMAKERS.has(nextBookmakerId) ? nextBookmakerId : 'sportsbet';
    setBookmakerId(safeBookmakerId);
    window.localStorage.setItem('preferredBookmaker', safeBookmakerId);
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
  const selectToday = useCallback(() => {
    if (todayDateIndex === -1) return;
    const nextDirection = selectedDateIndex === -1 ? 0 : todayDateIndex > selectedDateIndex ? 1 : todayDateIndex < selectedDateIndex ? -1 : 0;
    setSlideDir(nextDirection);
    setSelectedDate(todayDate);
  }, [selectedDateIndex, todayDate, todayDateIndex]);

  const moveDate = useCallback(
    (direction) => {
      if (!dateOptions.length) return;
      setSlideDir(direction > 0 ? 1 : -1);

      if (selectedDateIndex === -1) {
        setSelectedDate(direction > 0 ? dateOptions[0] : dateOptions[dateOptions.length - 1]);
        return;
      }

      const nextIndex = Math.min(Math.max(selectedDateIndex + direction, 0), dateOptions.length - 1);
      setSelectedDate(dateOptions[nextIndex]);
    },
    [dateOptions, selectedDateIndex],
  );

  const handleReviewFilterChange = useCallback((nextFilter) => {
    const safeFilter = nextFilter || 'all';
    setReviewFilter(safeFilter);
    if (safeFilter !== 'all') {
      setStatus('FT');
      setSlideDir(0);
    }
  }, []);

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
      .filter((match) => matchHasReviewFilter(match, reviewFilter, matches))
      .filter((match) => {
        if (!normalized) return true;
        return `${match.home?.name || ''} ${match.away?.name || ''} ${match.league}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }, [league, matches, query, reviewFilter, selectedDate, status]);
  const groupedMatches = useMemo(() => groupMatchesForDisplay(filtered, favoriteLeagues, favoriteTeams), [favoriteLeagues, favoriteTeams, filtered]);

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

  const scrollToMobileSection = useCallback((ref, activeKey) => {
    setMobileNavActive(activeKey);
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const openMobileDashboard = useCallback(() => scrollToMobileSection(dashboardRef, 'dashboard'), [scrollToMobileSection]);
  const openMobileMatches = useCallback(() => scrollToMobileSection(matchesRef, 'matches'), [scrollToMobileSection]);
  const openMobileWatchlist = useCallback(() => {
    scrollToMobileSection(watchlistRef.current ? watchlistRef : matchesRef, 'watchlist');
  }, [scrollToMobileSection]);
  const openMobileSettings = useCallback(() => {
    setMobileNavActive('settings');
    openSettings();
  }, [openSettings]);

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
        onMatchImported={refreshMatchData}
      />
    );
  }

  if (isSettingsView) {
    return (
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
    );
  }

  return (
    <main className="min-h-screen bg-field pb-24 sm:pb-0">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 sm:py-4 lg:px-8">
          <div className="flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_42%,#e8f5ff_100%)] px-2 py-2 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-white/80 sm:justify-between sm:px-5 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start">
              <div className="flex w-full shrink items-center justify-center sm:w-auto sm:shrink-0">
                <img
                  src="/LVR-LOGO.png"
                  alt="LVRstats.com"
                  className="h-24 w-full object-cover object-center sm:h-16 sm:w-auto sm:max-w-xs sm:object-contain"
                />
              </div>
              <div className="hidden min-w-0 sm:block">
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Smarter football picks</div>
                <div className="mt-0.5 text-base font-semibold text-ink">Model-backed edges, odds and match signals in one view</div>
              </div>
            </div>
            <button
              type="button"
              onClick={openSettings}
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/90 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_20px_rgba(15,23,42,0.10)] hover:bg-white sm:inline-flex"
              aria-label="Open settings"
              title="Settings"
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section ref={dashboardRef} className="mx-auto max-w-7xl scroll-mt-4 px-2 py-3 sm:px-6 sm:py-5 lg:px-8">
        <div className={`${mobileNavActive === 'dashboard' ? 'block' : 'hidden'} overflow-hidden rounded-lg border border-line bg-white sm:block`}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2 sm:hidden">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">All-time overview</span>
            <span className="text-xs font-semibold text-slate-400">{stats.finished} settled</span>
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
                  <span className="text-sm font-semibold text-slate-400">v</span>
                  <span className="text-miss">{formatOddsTotal(stats.oddsTotals?.loss)}</span>
                </span>
              }
            />
            <Stat icon={CheckCircle2} label="Finished" value={stats.finished} tone="text-signal" sublabel="All time" />
            <Stat icon={Clock3} label="Upcoming" value={stats.upcoming} tone="text-blue-700" sublabel="All time" />
            <Stat icon={Activity} label="Matches" value={stats.total} sublabel="All time" className="col-span-2 sm:col-span-1" />
          </div>
        </div>

        <div ref={resultsRef} className={`${mobileNavActive === 'dashboard' || mobileNavActive === 'results' ? 'block' : 'hidden'} scroll-mt-4 sm:block`}>
          <ResultsReview
            matches={matches}
            selectedDate={selectedDate}
            reviewSummary={data?.allTimeSummary?.review}
            activeReviewFilter={reviewFilter}
            onReviewFilterChange={handleReviewFilterChange}
          />
        </div>

        <div className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'block' : 'hidden'} mt-3 rounded-lg border border-line bg-white p-3 sm:hidden`}>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => moveDate(-1)}
              disabled={!dateOptions.length || selectedDateIndex === 0}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous match date"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={selectToday}
              className="inline-flex flex-1 items-center justify-center text-base font-semibold text-ink"
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next match date"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 overflow-x-auto sm:justify-start">
            {[
              { value: 'all', label: 'All' },
              { value: 'FT', label: 'Finished' },
              { value: 'upcoming', label: 'Upcoming' },
            ].map(({ value, label }) => {
              const active = status === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatus(value)}
                  aria-pressed={active}
                  className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition ${active ? 'border border-ink bg-ink text-white' : 'border border-line bg-white text-slate-700'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div ref={matchesRef} className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'grid' : 'hidden'} mt-3 scroll-mt-4 gap-2 rounded-lg border border-line bg-white p-3 sm:mt-5 sm:grid sm:grid-cols-[12rem_10rem_minmax(18rem,1fr)_minmax(16rem,1fr)] sm:items-center sm:gap-3`}>
          <select
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-center text-sm sm:h-10 sm:text-left"
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
            className="hidden h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm sm:block sm:h-10"
            aria-label="Status"
          >
            <option value="upcoming">Upcoming</option>
            <option value="FT">Finished</option>
            <option value="all">All statuses</option>
          </select>
          <div className="hidden min-w-0 flex-nowrap items-center gap-1.5 rounded-md border border-line bg-field p-1 sm:flex">
            <button
              type="button"
              onClick={selectToday}
              disabled={selectedDate === todayDate}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Show today's matches"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => moveDate(-1)}
              disabled={!dateOptions.length || selectedDateIndex === 0}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous match date"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <select
              value={selectedDate || 'all'}
              onChange={(event) => { setSlideDir(0); setSelectedDate(event.target.value); }}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-center text-sm sm:text-left"
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next match date"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams or league"
            className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-center text-sm placeholder:text-center sm:h-10 sm:text-left sm:placeholder:text-left"
          />
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-miss/20 bg-miss/10 p-4 text-sm text-miss">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div
          className={`${mobileNavActive === 'matches' || mobileNavActive === 'watchlist' ? 'block' : 'hidden'} date-slide-frame mt-3 sm:mt-5 sm:block${dragActive ? ' date-slide-grabbing' : ''}`}
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
          {groupedMatches.map((group) => (
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
              sectionRef={group.isFavoriteTeamGroup ? watchlistRef : null}
              hiddenOnMobile={mobileNavActive === 'watchlist' && !group.isFavoriteTeamGroup}
            />
          ))}

          {!error && filtered.length === 0 && mobileNavActive !== 'watchlist' && (
            <div className="rounded-lg border border-line bg-white p-8 text-center text-sm text-slate-500">
              No matches found for the selected filters.
            </div>
          )}
          {!error && mobileNavActive === 'watchlist' && !groupedMatches.some((group) => group.isFavoriteTeamGroup) && (
            <div className="rounded-lg border border-line bg-white p-8 text-center text-sm text-slate-500 sm:hidden">
              No favourite-team matches for these filters.
            </div>
          )}
          </div>
        </div>

      </section>
      <MobileBottomNav
        active={mobileNavActive}
        onDashboard={openMobileDashboard}
        onMatches={openMobileMatches}
        onWatchlist={openMobileWatchlist}
        onSettings={openMobileSettings}
      />
    </main>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <Suspense fallback={<main className="min-h-screen bg-field" />}>
        <HomeInner />
      </Suspense>
    </AuthGate>
  );
}
