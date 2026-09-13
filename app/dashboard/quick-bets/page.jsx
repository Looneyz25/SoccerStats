'use client';

import Link from 'next/link';
import { Component, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import AuthGate from '../../auth-gate';
import { loadQuickBetsFromFirestore, readQuickBetsCache } from '../../firestore-data';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, ListFilter } from 'lucide-react';
import {
  marketSelections, quickBetMatchState, quickBetLeagueKey, resolveQuickBetDate,
  quickBetRecordedLeagueSuccessLabel, quickBetStarDecisionLabel,
  quickBetSelectionSuccessLabel, quickBetStarredSelections, quickBetStarStatText, quickBetDailyStats,
} from './quick-bets-utils.mjs';

// Column set mirrors the AIOS Quick Bets table (web-legacy QUICK_BET_FILTERS): a
// leading "Match" identity column followed by one column per market. 'all' shows
// every match with league band rows; a specific market filters + sorts by odds.
const MARKET_FILTERS = [
  { key: 'all', label: 'Match', shortLabel: 'Match', marketKeys: [] },
  { key: 'winner', label: 'Winner', shortLabel: 'Winner', marketKeys: ['winner'] },
  { key: 'btts', label: 'BTTS', shortLabel: 'BTTS', marketKeys: ['btts'] },
  { key: 'goals05', label: 'GLS 0.5', shortLabel: '0.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 0.5 },
  { key: 'goals15', label: 'GLS 1.5', shortLabel: '1.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 1.5 },
  { key: 'goals25', label: 'GLS 2.5', shortLabel: '2.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 2.5 },
  { key: 'goals35', label: 'GLS 3.5', shortLabel: '3.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 3.5 },
];
// The market columns rendered in the body (everything except the identity column).
const MARKET_COLUMNS = MARKET_FILTERS.filter((filter) => filter.key !== 'all');

const LIFECYCLE_FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'live', label: 'Live' },
  { key: 'result', label: 'Results' },
];

function displayedSelections(match, filters, starredOnly, successByLeague) {
  return starredOnly ? quickBetStarredSelections(match, filters, successByLeague)
    : filters.flatMap((filter) => marketSelections(match, filter));
}

// Badge text mirrors AIOS: goal columns show the side only (the line is the column),
// winner/BTTS show the named pick.
function badgeText(selection) {
  if (selection.marketKey === 'goalsOver') return 'Over';
  if (selection.marketKey === 'goalsUnder') return 'Under';
  if (selection.side === 'over' || selection.side === 'under') {
    return selection.side === 'over' ? 'Over' : 'Under';
  }
  return selection.label || selection.key || 'Pick';
}

function matchRowKey(match, index) {
  return [
    match?.eventId || match?.id || 'match',
    match?.date || 'date',
    match?.time || 'time',
    match?.league || 'league',
    match?.home || 'home',
    match?.away || 'away',
    match?.lifecycle || 'state',
    index,
  ].join('|');
}

function selectionRowKey(selection, index) {
  return [
    selection?.marketKey || 'market',
    selection?.key || selection?.label || selection?.side || 'pick',
    selection?.line ?? 'line',
    selection?.odds ?? 'odds',
    index,
  ].join('|');
}

function formatOdds(value) {
  const odds = Number(value);
  return Number.isFinite(odds) ? odds.toFixed(2) : '-';
}

function selectionTone(selection, match) {
  return selection.result || selection.liveLock || (match.lifecycle === 'live' ? 'live' : 'pending');
}

function selectionOutcome(selection, match) {
  if (selection.result === 'hit' || selection.result === 'miss' || selection.result === 'void') return selection.result;
  if (match.lifecycle === 'live' && (selection.liveLock === 'hit' || selection.liveLock === 'miss')) return selection.liveLock;
  return '';
}

function outcomeStats(rows) {
  const stats = { hits: 0, misses: 0, voids: 0 };
  rows.forEach(({ match, selections }) => {
    selections.forEach((selection) => {
      const outcome = selectionOutcome(selection, match);
      if (outcome === 'hit') stats.hits += 1;
      else if (outcome === 'miss') stats.misses += 1;
      else if (outcome === 'void') stats.voids += 1;
    });
  });
  const settled = stats.hits + stats.misses;
  return { ...stats, settled, rate: settled ? Math.round((stats.hits / settled) * 100) : null };
}

// AIOS header stat format: "8 / 0 · 100%" (· void N when present).
function headerStatText(stats) {
  if (!stats?.settled && !stats?.voids) return '';
  const parts = [`${stats.hits} / ${stats.misses}`];
  if (stats.rate != null) parts.push(`${stats.rate}%`);
  if (stats.voids) parts.push(`void ${stats.voids}`);
  return parts.join(' · ');
}

function headerStatTone(stats) {
  if (!stats?.settled) return '';
  return stats.hits / stats.settled >= 0.5 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
}

function HeaderStat({ stats }) {
  if (!headerStatText(stats)) return null;
  return (
    <span className={`flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-[11px] font-normal tabular-nums tracking-normal ${headerStatTone(stats)}`} aria-hidden="true">
      <span className="font-semibold">{stats.hits} / {stats.misses}</span>
      {stats.rate != null ? <><span className="font-normal text-faint">{' · '}</span><span className="rounded border border-line bg-field px-1 py-px text-[10px] font-semibold">{stats.rate}%</span></> : null}
      {stats.voids ? <><span className="font-normal text-faint">{' · '}</span><span className="text-[10px] font-medium text-muted">void {stats.voids}</span></> : null}
    </span>
  );
}

// Outcome colours follow the dashboard; pending prices use the shared accent.
function badgeClasses(tone) {
  if (tone === 'hit') return 'result-hit-row text-emerald-800 dark:text-emerald-300';
  if (tone === 'miss') return 'border-red-400 bg-red-100 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300';
  if (tone === 'void') return 'border-line bg-transparent text-muted';
  return 'border-accent/30 bg-accent-soft text-accent';
}

function safeSportsbetUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'sportsbet.com.au' && !host.endsWith('.sportsbet.com.au'))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function dateRank(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  return match ? Number(`${match[1]}${match[2]}${match[3]}`) : -Infinity;
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDaysISO(iso, n) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!parts) return iso;
  const dt = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// AIOS fmtDMY: dd/mm/yy.
function fmtDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(iso || '');
}

function dayBand(date) {
  const today = todayISO();
  if (date === today) return 'Today';
  if (date === addDaysISO(today, 1)) return 'Tomorrow';
  return '';
}

function StarIcon() {
  return (
    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z" />
    </svg>
  );
}

function SuccessStar({ label }) {
  if (!label) return null;
  return (
    <span className="qb-success-star ml-1 inline-flex shrink-0 items-center align-[-0.1em] text-[12px] text-amber-800 dark:text-[var(--quick-bet-success)]" role="img" title={label} aria-label={label}>
      <StarIcon />
    </span>
  );
}

function StarCounter({ stats }) {
  const text = quickBetStarStatText(stats);
  if (!text) return null;
  return <span className="mt-0.5 inline-flex w-full items-center justify-center gap-1 border-t border-line pt-1 text-[11px] font-medium tabular-nums tracking-normal text-amber-800 dark:text-[var(--quick-bet-success)]" aria-hidden="true"><StarIcon />{text}</span>;
}

function DailyStarStats({ stats, label }) {
  if (!stats) return null;
  return (
    <span className="qb-day-stat inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-normal tabular-nums tracking-normal text-amber-800 dark:text-[var(--quick-bet-success)]" role="img" aria-label={`${label}: ${stats.hits} starred hits from ${stats.settled} settled predictions`}>
      <StarIcon /><span className="qb-day-stat-value" aria-hidden="true">{stats.hits} / {stats.settled}</span>
    </span>
  );
}

function DailyTotal({ stats }) {
  if (!stats) return null;
  return <span className="qb-day-total whitespace-nowrap text-[12px] font-normal tabular-nums tracking-normal text-muted" role="img" aria-label={`${stats.hits} hits from ${stats.settled} settled bets`}><span aria-hidden="true">Total {stats.hits} / {stats.settled}</span></span>;
}

function marketFilterAriaLabel(filter, stats, starStats) {
  const labels = [filter.label];
  if (stats?.settled || stats?.voids) labels.push(`${stats.hits} hits, ${stats.misses} misses${stats.voids ? `, ${stats.voids} void` : ''}`);
  if (starStats?.settled) labels.push(`${starStats.hits} hits from ${starStats.settled} settled starred predictions`);
  return labels.join(', ');
}

function OddsBadge({ match, selection, leagueStats }) {
  const href = safeSportsbetUrl(match.eventUrl);
  const tone = selectionTone(selection, match);
  const text = `${badgeText(selection)} @${formatOdds(selection.odds)}`;
  const historyLabel = quickBetSelectionSuccessLabel(match, selection, leagueStats);
  const decisionLabel = quickBetStarDecisionLabel(selection);
  const ariaLabel = `${text}; ${decisionLabel}`;
  const cls = `inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${badgeClasses(tone)}`;
  if (!href) {
    return <span className={`${cls} cursor-default`} title={decisionLabel} aria-label={ariaLabel}>{text}<SuccessStar label={historyLabel} /></span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${cls} no-underline transition hover:brightness-110 active:translate-y-px`}
      title={`${decisionLabel}. Open this match on Sportsbet`}
      aria-label={ariaLabel}
    >
      {text}
      <SuccessStar label={historyLabel} />
    </a>
  );
}

// A single market column cell: all qualifying selections, or the em-dash placeholder.
function quickBetEmptyMarketLabel(match, filter, starredOnly = false) {
  if (starredOnly) return 'No starred selection for this market';
  const status = match.marketCoverage?.[filter.line == null ? filter.key : `goals:${filter.line}`];
  return ({
    no_selection: 'Checked: no price below 1.50',
    no_price: 'Market offered, price unavailable',
    not_offered: 'Market not offered at last check',
    fetch_failed: 'Market check failed; awaiting retry',
    stale: 'Market check expired; awaiting refresh',
    not_checked: 'Market not checked yet',
  })[status] || (match.lifecycle === 'upcoming' ? 'Market coverage not confirmed' : 'No captured selection');
}

function PriceCell({ match, filter, successByLeague, starredOnly }) {
  const leagueStats = successByLeague.get(quickBetLeagueKey(match.league));
  const selections = displayedSelections(match, [filter], starredOnly, successByLeague);
  return (
    <td className="border-b border-line px-1.5 py-2 text-center align-middle">
      {selections.length ? (
        <span className="flex flex-wrap justify-center gap-0.5">
          {selections.map((selection, index) => (
            <OddsBadge key={selectionRowKey(selection, index)} match={match} selection={selection} leagueStats={leagueStats} />
          ))}
        </span>
      ) : (
        <span className="text-muted" title={quickBetEmptyMarketLabel(match, filter, starredOnly)} aria-label={quickBetEmptyMarketLabel(match, filter, starredOnly)}>—</span>
      )}
    </td>
  );
}

// Mobile card — retains the existing stacked layout; shows the active market's
// selections (or every market when the 'all' column is selected).
function MatchCard({ match, selections, leagueStats, leagueSuccessLabel }) {
  return (
    <article className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-muted">{match.league || 'Soccer'}<SuccessStar label={leagueSuccessLabel} /></div>
          <div className="mt-1 text-sm font-normal text-ink">
            <span>{match.home}</span>
            <b className="px-2 font-mono font-normal text-muted">{quickBetMatchState(match)}</b>
            <span>{match.away}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {selections.map((selection, index) => (
            <OddsBadge key={selectionRowKey(selection, index)} match={match} selection={selection} leagueStats={leagueStats} />
          ))}
        </div>
      </div>
    </article>
  );
}

function QuickBetsInner() {
  const [data, setData] = useState(() => readQuickBetsCache());
  const [error, setError] = useState('');
  const [dayError, setDayError] = useState('');
  const [loading, setLoading] = useState(!readQuickBetsCache());
  const [activeMarket, setActiveMarket] = useState('all');
  const [activeLifecycle, setActiveLifecycle] = useState('upcoming');
  const [starredOnly, setStarredOnly] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileFiltersHidden, setMobileFiltersHidden] = useState(true);
  const [mobileSelectedDate, setMobileSelectedDate] = useState('');
  const quickBetRequest = useRef(0);
  const selectQuickBetDate = (date) => {
    quickBetRequest.current += 1;
    setMobileSelectedDate(date);
  };

  useEffect(() => {
    let cancelled = false;
    const requestId = ++quickBetRequest.current;
    setLoading(!readQuickBetsCache());
    loadQuickBetsFromFirestore('', activeLifecycle)
      .then((payload) => {
        if (cancelled || requestId !== quickBetRequest.current) return;
        setData(payload);
        setMobileSelectedDate(payload.selectedDate || '');
        setError('');
      })
      .catch(() => {
        if (cancelled || requestId !== quickBetRequest.current) return;
        setError('Could not load Firestore quick bets. Try refreshing in a moment.');
      })
      .finally(() => {
        if (!cancelled && requestId === quickBetRequest.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLifecycle]);

  const selectedFilter = MARKET_FILTERS.find((filter) => filter.key === activeMarket) || MARKET_FILTERS[0];
  const isAll = selectedFilter.key === 'all';
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const summary = data?.summary?.version === 1 ? data.summary : null;
  const successByLeague = useMemo(() => new Map(), []);
  const starStatsByMarket = useMemo(() => new Map(Object.entries(summary?.starredMarkets || {})), [summary]);

  // Rows for the active lifecycle. 'all' keeps every match carrying any priced
  // selection (date asc/desc, then time); a market keeps only matches with that
  // market, sorted by lowest odds — mirroring AIOS compareQuickBetLifecycleDate.
  const visibleMatches = useMemo(() => {
    const dateDir = activeLifecycle === 'result' ? -1 : 1;
    const byDateThen = (a, b, tiebreak) => (dateDir * (dateRank(a.date) - dateRank(b.date)))
      || (dateDir * String(a.date || '').localeCompare(String(b.date || '')))
      || tiebreak(a, b)
      || String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
      || String(a.league || '').localeCompare(String(b.league || ''))
      || String(a.home || '').localeCompare(String(b.home || ''));

    const inState = matches.filter((match) => match.lifecycle === activeLifecycle);
    const selectionFilters = isAll ? MARKET_COLUMNS : [selectedFilter];
    const selectionsFor = (match) => displayedSelections(match, selectionFilters, starredOnly, successByLeague);
    if (isAll) {
      return inState
        .filter((match) => selectionsFor(match).length)
        .sort((a, b) => byDateThen(a, b, () => 0));
    }
    return inState
      .map((match) => {
        const selections = selectionsFor(match);
        if (!selections.length) return null;
        const minOdds = Math.min(...selections.map((selection) => Number(selection.odds)).filter(Number.isFinite));
        return { match, minOdds };
      })
      .filter(Boolean)
      .sort((a, b) => byDateThen(a.match, b.match, () => a.minOdds - b.minOdds))
      .map(({ match }) => match);
  }, [matches, activeLifecycle, selectedFilter, isAll, starredOnly, successByLeague]);

  const selectionFilters = isAll ? MARKET_COLUMNS : [selectedFilter];
  const dailyStats = useMemo(() => activeLifecycle === 'result'
    ? quickBetDailyStats(matches.filter((match) => match.lifecycle === activeLifecycle), MARKET_COLUMNS, successByLeague) : new Map(),
  [matches, successByLeague, activeLifecycle]);
  const mobileTodayDate = todayISO();
  const mobileDates = useMemo(() => {
    const dates = summary?.datesByLifecycle?.[activeLifecycle] || data?.availableDates || [];
    return [...new Set(dates.filter(Boolean))]
      .sort((a, b) => dateRank(a) - dateRank(b) || String(a).localeCompare(String(b)));
  }, [summary, data?.availableDates, activeLifecycle]);
  const preferredMobileDate = resolveQuickBetDate(data, '', activeLifecycle, mobileTodayDate);
  const mobileCurrentDate = mobileDates.includes(mobileSelectedDate) || mobileSelectedDate === mobileTodayDate
    ? mobileSelectedDate : preferredMobileDate;
  const hasMobileResultsDay = activeLifecycle === 'result' && Boolean(mobileCurrentDate);
  const hasMobileSelectedDay = Boolean(mobileCurrentDate);
  const selectedDayLoaded = data?.selectedDate === mobileCurrentDate;
  const mobileTimelineDates = useMemo(() => [...new Set([...mobileDates, mobileCurrentDate].filter(Boolean))]
    .sort((a, b) => dateRank(a) - dateRank(b) || String(a).localeCompare(String(b))),
  [mobileDates, mobileCurrentDate]);
  const mobileCurrentDateIndex = mobileTimelineDates.indexOf(mobileCurrentDate);
  const mobileMatches = mobileCurrentDate ? visibleMatches.filter((match) => match.date === mobileCurrentDate) : [];
  const dayMatches = matches.filter((match) => match.lifecycle === activeLifecycle && match.date === mobileCurrentDate);
  const dayOffers = new Map(MARKET_COLUMNS.map((filter) => [filter.key, {
    total: dayMatches.reduce((total, match) => total + marketSelections(match, filter).length, 0),
    starred: dayMatches.reduce((total, match) => total + quickBetStarredSelections(match, [filter], successByLeague).length, 0),
    regular: outcomeStats(dayMatches.map((match) => ({ match, selections: marketSelections(match, filter) }))),
  }]));
  const offeredMarkets = [...dayOffers.values()].reduce((total, offers) => total + offers.total, 0);
  const starredMarkets = [...dayOffers.values()].reduce((total, offers) => total + offers.starred, 0);
  const selectionTotal = mobileMatches.reduce((total, match) => total
    + displayedSelections(match, selectionFilters, starredOnly, successByLeague).length, 0);

  const statsByMarket = summary?.statsByLifecycle?.[activeLifecycle] || {};
  const unrecordedStars = activeLifecycle === 'result' ? summary?.unrecordedStars || 0 : 0;
  const starHistorySummary = unrecordedStars ? ` · star history incomplete (${unrecordedStars} unrecorded)` : '';
  const lifecycleCounts = data?.counts || {};
  const capturedAt = data?.captured_at || data?.capturedAt || '';
  const refreshStatus = data?.refresh_status || data?.refreshStatus || '';

  const toggleMarket = (key) => setActiveMarket((current) => (current === key ? 'all' : key));

  const sortSummary = isAll ? '' : ' · lowest odds';
  const emptyMessage = starredOnly
    ? isAll ? 'No starred markets for this state.' : `No starred ${selectedFilter.label} odds for this state.`
    : isAll ? 'No Quick Bets for this state.' : `No matches with ${selectedFilter.label} odds.`;

  // Sticky offsets preserve the page's 1rem top inset and 1rem table gap.
  // The header height is measured because its content reflows with viewport width.
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return undefined;
    const measure = () => setHeaderHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      setIsMobileViewport(media.matches);
      if (!media.matches) setMobileFiltersHidden(false);
    };

    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (mobileSelectedDate && mobileSelectedDate !== mobileCurrentDate) setMobileSelectedDate(mobileCurrentDate);
  }, [mobileSelectedDate, mobileCurrentDate]);

  useEffect(() => {
    if (!data || !mobileCurrentDate) return undefined;
    if (data.selectedDate === mobileCurrentDate) { setLoading(false); setDayError(''); return undefined; }
    let cancelled = false;
    const requestId = ++quickBetRequest.current;
    const cached = readQuickBetsCache(mobileCurrentDate);
    if (cached) setData(cached);
    setLoading(!cached);
    setDayError('');
    loadQuickBetsFromFirestore(mobileCurrentDate, activeLifecycle)
      .then((payload) => { if (!cancelled && requestId === quickBetRequest.current) setData(payload); })
      .catch(() => { if (!cancelled && requestId === quickBetRequest.current) setDayError('Could not load this day. Select another day or refresh to retry.'); })
      .finally(() => { if (!cancelled && requestId === quickBetRequest.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [mobileCurrentDate, Boolean(data), activeLifecycle]);

  const mobileFilterNavStyle = isMobileViewport ? {
    maxHeight: mobileFiltersHidden ? 0 : '21rem',
    opacity: mobileFiltersHidden ? 0 : 1,
    transform: `translateY(${mobileFiltersHidden ? '-0.5rem' : '0'})`,
  } : undefined;

  return (
    <main className="min-h-dvh bg-field text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-[112rem] flex-col px-3 py-4 sm:px-5 lg:px-8">
        <header ref={headerRef} className="sticky top-4 z-20 rounded-xl border border-line bg-surface px-3 py-3 shadow-[0_-1rem_0_var(--surface-2),0_1rem_0_var(--surface-2)] sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/dashboard"
                  aria-label="Back to dashboard"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-[13px] text-muted transition hover:border-accent/40 hover:text-ink active:translate-y-px lg:h-auto lg:w-auto lg:justify-start lg:border-0 lg:px-0"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="lg:hidden">Back</span>
                  <span className="hidden lg:inline">Dashboard</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileFiltersHidden((current) => !current)}
                  aria-label={mobileFiltersHidden ? 'Show filters' : 'Hide filters'}
                  aria-expanded={!mobileFiltersHidden}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition hover:border-accent/40 hover:text-ink active:translate-y-px lg:hidden"
                >
                  {mobileFiltersHidden ? (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="mt-3 hidden flex-wrap items-center gap-3 lg:flex">
                <h1 className="text-lg font-semibold text-ink sm:text-xl">Quick Bets</h1>
              </div>
              <p className="mt-2 hidden text-[13px] font-medium text-muted lg:block">
                {selectedDayLoaded ? mobileMatches.length : '—'} match{mobileMatches.length === 1 ? '' : 'es'} · {selectedDayLoaded ? selectionTotal : '—'} selection{selectionTotal === 1 ? '' : 's'}{isAll ? '' : ` · ${selectedFilter.label}`}{starredOnly ? ' · Starred' : ''}{sortSummary}{starHistorySummary}
              </p>
            </div>
            {capturedAt ? (
              <p className="hidden text-[12px] font-medium text-muted lg:block">
                captured {capturedAt}{refreshStatus && refreshStatus !== 'complete' ? ` · ${refreshStatus}` : ''}
              </p>
            ) : null}
          </div>

          {data && !summary ? <p className="mt-2 text-[12px] text-muted" role="status">Global statistics are unavailable until the Quick Bets summary is refreshed.</p> : null}
          {unrecordedStars > 0 ? <p className="mt-2 text-[12px] text-muted lg:hidden" role="status">Star history incomplete ({unrecordedStars} unrecorded)</p> : null}

          {!error && hasMobileSelectedDay ? (
            <div className="mt-3 space-y-2 lg:hidden">
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_2.25rem] items-center gap-2 text-[13px] font-normal text-ink">
                <button
                  type="button"
                  onClick={() => selectQuickBetDate(mobileTimelineDates[mobileCurrentDateIndex - 1])}
                  disabled={mobileCurrentDateIndex <= 0}
                  aria-label="Previous day"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
                  <span>{dayBand(mobileCurrentDate) ? `${dayBand(mobileCurrentDate)} · ` : ''}{fmtDMY(mobileCurrentDate)}</span>
                  <DailyTotal stats={dailyStats.get(mobileCurrentDate)?.total} />
                </div>
                <button
                  type="button"
                  onClick={() => selectQuickBetDate(mobileTodayDate)}
                  disabled={mobileCurrentDate === mobileTodayDate}
                  aria-label="Jump to today"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-line px-2.5 text-[12px] font-semibold text-muted transition hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => selectQuickBetDate(mobileTimelineDates[mobileCurrentDateIndex + 1])}
                  disabled={mobileCurrentDateIndex < 0 || mobileCurrentDateIndex >= mobileTimelineDates.length - 1}
                  aria-label="Next day"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {dailyStats.has(mobileCurrentDate) ? (
                <div className="grid grid-cols-3 gap-1 border-y border-line bg-field py-2">
                  {MARKET_COLUMNS.map((filter) => (
                    <div key={filter.key} className="text-center">
                      <span className="mb-1 block text-[12px] text-muted" aria-hidden="true">{filter.label}</span>
                      <DailyStarStats stats={dailyStats.get(mobileCurrentDate).markets.get(filter.key)} label={filter.label} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            data-mobile-filter-state={mobileFiltersHidden && isMobileViewport ? 'hidden' : 'visible'}
            aria-hidden={mobileFiltersHidden && isMobileViewport}
            inert={mobileFiltersHidden && isMobileViewport ? true : undefined}
            className={`origin-top transition-[max-height,opacity,transform] duration-200 ease-out lg:max-h-none lg:translate-y-0 lg:overflow-visible lg:opacity-100 ${
              mobileFiltersHidden && isMobileViewport ? 'overflow-hidden pointer-events-none' : 'overflow-x-hidden overflow-y-auto'
            }`}
            style={mobileFilterNavStyle}
          >
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:mt-4">
              {LIFECYCLE_FILTERS.map((filter) => {
                const selected = activeLifecycle === filter.key;
                const count = filter.key === 'result' ? lifecycleCounts.results : lifecycleCounts[filter.key];
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => { if (filter.key !== activeLifecycle) { quickBetRequest.current += 1; setMobileSelectedDate(''); } setActiveLifecycle(filter.key); setActiveMarket('all'); }}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition ${
                      selected ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line bg-transparent text-muted hover:border-accent/40 hover:text-accent'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className="text-[12px]">{count ?? 0}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setStarredOnly((current) => !current)}
                aria-pressed={starredOnly}
                aria-label="Show starred markets only"
                className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition ${starredOnly
                  ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'border-line bg-transparent text-muted hover:border-amber-500/40 hover:text-amber-600 dark:hover:text-amber-300'}`}
              >
                <StarIcon />
                <span>Starred</span>
              </button>
            </div>

            {/* Mobile market filter chips (desktop filters live in the table headers). */}
            <div className="mt-2 grid grid-cols-4 gap-2 lg:hidden">
              {MARKET_FILTERS.map((filter) => {
                const selected = activeMarket === filter.key;
                const stat = filter.key === 'all' ? null : statsByMarket[filter.key];
                const starStat = filter.key === 'all' ? null : starStatsByMarket.get(filter.key);
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => toggleMarket(filter.key)}
                    aria-pressed={selected}
                    aria-label={marketFilterAriaLabel(filter, stat, starStat)}
                    className={`qb-stat-card flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-center transition ${
                      selected ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-accent/40 hover:text-accent'
                    }`}
                  >
                    <span className="text-[12px] font-semibold uppercase tracking-wide">{filter.shortLabel}</span>
                    <HeaderStat stats={stat} />
                    <StarCounter stats={starStat} />
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <section className="flex-1 pt-4">
          {loading && !data ? (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-line bg-surface text-sm font-normal text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Loading quick bets
            </div>
          ) : null}

          {error ? (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-red-400 dark:border-red-500/40 bg-red-100 dark:bg-red-500/15 p-4 text-center text-sm font-normal text-red-700 dark:text-red-300">
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
              {error}
            </div>
          ) : null}

          {loading && data ? <p className="py-3 text-center text-sm text-muted" role="status">Loading this day…</p> : null}
          {dayError ? <p className="py-3 text-center text-sm text-red-700 dark:text-red-300" role="alert">{dayError}</p> : null}

          {/* Mobile empty state. On desktop the message lives inside the table so the
              column-header filters stay visible (an empty market must not trap the user). */}
          {!loading && !error && visibleMatches.length === 0 && !hasMobileSelectedDay ? (
            <div className="rounded-md border border-line bg-surface p-8 text-center text-sm font-normal text-muted lg:hidden">
              <ListFilter className="mx-auto mb-3 h-5 w-5" aria-hidden="true" />
              {emptyMessage}
            </div>
          ) : null}

          {/* Both layouts show the selected day. */}
          {!error && hasMobileSelectedDay ? (
            <div className="space-y-2 lg:hidden">
              {selectedDayLoaded && !loading && !dayError && mobileMatches.length === 0 ? (
                <div className="rounded-md border border-line bg-surface p-8 text-center text-sm font-normal text-muted">
                  <ListFilter className="mx-auto mb-3 h-5 w-5" aria-hidden="true" />
                  No matches for this day with the selected filters.
                </div>
              ) : null}
              {mobileMatches.map((match, index) => {
                const selections = displayedSelections(match, selectionFilters, starredOnly, successByLeague);
                return (
                  <div key={matchRowKey(match, index)} className="space-y-2">
                    <MatchCard match={match} selections={selections}
                      leagueStats={successByLeague.get(quickBetLeagueKey(match.league))}
                      leagueSuccessLabel={quickBetRecordedLeagueSuccessLabel(match, selectionFilters)} />
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Desktop: market grid with column-header filters. The table (and its column-header
              filters) renders whenever any data is loaded, even if the active market is
              empty — otherwise there is no control to filter back out of an empty market. */}
          {!error && data ? (
            <div className="hidden rounded-xl border border-line bg-surface lg:block">
              <table className="w-full table-fixed border-collapse text-[13px]">
                <caption className="sr-only">Captured Sportsbet prices below 1.50 for Quick Bet {activeLifecycle} matches</caption>
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr>
                    {MARKET_FILTERS.map((filter) => {
                      const isIdentity = filter.key === 'all';
                      const active = activeMarket === filter.key;
                      const stat = isIdentity ? null : statsByMarket[filter.key];
                      const starStat = isIdentity ? null : starStatsByMarket.get(filter.key);
                      return (
                        <th
                          key={filter.key}
                          scope="col"
                          style={{ top: `calc(${headerHeight}px + 2rem + 1px)` }}
                          className={`sticky z-10 h-px border-b border-line bg-surface px-1 py-2 first:pl-2 last:pr-2 ${isIdentity ? 'text-left' : 'text-center'} align-top`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleMarket(filter.key)}
                            aria-pressed={active}
                            aria-label={marketFilterAriaLabel(filter, stat, starStat)}
                            className={`qb-stat-card flex h-full min-h-[72px] w-full flex-col justify-center ${isIdentity ? 'items-start' : 'items-center'} gap-1 rounded-md border px-2 py-2 text-[12px] font-semibold transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent ${
                              active ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line bg-surface text-muted'
                            }`}
                          >
                            <span className="font-semibold">{filter.label}</span>
                            <HeaderStat stats={stat} />
                            <StarCounter stats={starStat} />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {hasMobileSelectedDay ? (
                    <tr className="qb-day-row bg-field">
                      <td className="border-y border-line px-2.5 py-2.5 shadow-[inset_2px_0_0_var(--accent)]">
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label="Previous day" disabled={mobileCurrentDateIndex <= 0}
                            onClick={() => selectQuickBetDate(mobileTimelineDates[mobileCurrentDateIndex - 1])}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
                            <span className="text-[13px] font-semibold">{new Date(`${mobileCurrentDate}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' })} · {fmtDMY(mobileCurrentDate)}</span>
                            <button type="button" aria-label="Jump to today" disabled={mobileCurrentDate === mobileTodayDate}
                              onClick={() => selectQuickBetDate(mobileTodayDate)}
                              className="rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">Today</button>
                            <span className="flex w-full flex-wrap items-center justify-center gap-1 text-[12px] font-normal text-muted">
                              {selectedDayLoaded ? <>{offeredMarkets} markets · <span className="inline-flex items-center gap-1 text-amber-800 dark:text-[var(--quick-bet-success)]"><StarIcon />{starredMarkets} starred</span></> : dayError ? 'Unavailable' : 'Loading…'}
                            </span>
                            <DailyTotal stats={dailyStats.get(mobileCurrentDate)?.total} />
                          </div>
                          <button type="button" aria-label="Next day" disabled={mobileCurrentDateIndex < 0 || mobileCurrentDateIndex >= mobileTimelineDates.length - 1}
                            onClick={() => selectQuickBetDate(mobileTimelineDates[mobileCurrentDateIndex + 1])}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                      {MARKET_COLUMNS.map((filter) => {
                        if (!selectedDayLoaded) return <td key={filter.key} className="border-y border-line px-1.5 py-2.5 text-center text-muted" aria-label={dayError ? 'Day unavailable' : 'Loading day'}>—</td>;
                        const offers = dayOffers.get(filter.key);
                        return (
                          <td key={filter.key} className="border-y border-line px-1.5 py-2.5 text-center">
                            <span className="mb-1 block text-[12px] font-normal text-muted" aria-label={activeLifecycle === 'result'
                              ? `${filter.label}: ${offers.regular.hits} hits from ${offers.regular.settled} settled predictions, all selections`
                              : `${filter.label}: ${offers.total} markets on offer, all selections`}>
                              All {activeLifecycle === 'result' ? `${offers.regular.hits} / ${offers.regular.settled}` : offers.total}
                            </span>
                            {activeLifecycle === 'result' ? (
                              <DailyStarStats stats={dailyStats.get(mobileCurrentDate)?.markets.get(filter.key) || { hits: 0, settled: 0 }} label={filter.label} />
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[12px] font-normal text-amber-800 dark:text-[var(--quick-bet-success)]" aria-label={`${filter.label}: ${offers.starred} starred markets on offer`}><StarIcon />{offers.starred}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ) : null}
                  {selectedDayLoaded && !loading && !dayError && mobileMatches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2.5 py-10 text-center text-[13px] text-muted">
                        No matches for this day with the selected filters.
                      </td>
                    </tr>
                  ) : null}
                  {mobileMatches.map((match, index) => {
                    const prev = mobileMatches[index - 1];
                    const showDate = !prev || prev.date !== match.date;
                    const showLeague = isAll && (showDate || (prev && prev.league !== match.league));
                    const leagueStats = successByLeague.get(quickBetLeagueKey(match.league));
                    const leagueSuccessLabel = quickBetRecordedLeagueSuccessLabel(showLeague
                      ? mobileMatches.filter((row) => row.date === match.date && row.league === match.league)
                      : match, selectionFilters);
                    return (
                      <Fragment key={matchRowKey(match, index)}>
                        {showLeague ? (
                          <tr key={`${matchRowKey(match, index)}-league`}>
                            <td colSpan={7} className="border-b border-line px-2.5 pb-1 pl-6 pt-2.5 text-[12px] font-semibold text-muted">
                              {match.league || 'Other'}
                              <SuccessStar label={leagueSuccessLabel} />
                            </td>
                          </tr>
                        ) : null}
                        <tr key={matchRowKey(match, index)} className="transition hover:bg-field">
                          <td className={`border-b border-line py-2 pr-2 align-middle text-[14px] ${isAll ? 'pl-10' : 'pl-2.5'}`}>
                            {!isAll ? (
                              <span className="mb-0.5 block text-[10px] uppercase tracking-[0.06em] text-muted">{match.league || 'Other'}<SuccessStar label={leagueSuccessLabel} /></span>
                            ) : null}
                            <span className="block break-words">
                              {match.home}
                              <b className="px-1.5 font-normal text-muted">{quickBetMatchState(match)}</b>
                              {match.away}
                            </span>
                          </td>
                          {MARKET_COLUMNS.map((filter) => (
                            <PriceCell key={filter.key} match={match} filter={filter} successByLeague={successByLeague} starredOnly={starredOnly} />
                          ))}
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

class QuickBetsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-field p-4 text-ink">
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-5 text-sm font-normal text-red-700 dark:text-red-300">
            Quick Bets could not render. Refresh the page and try again.
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function QuickBetsPage() {
  return (
    <AuthGate>
      <QuickBetsErrorBoundary>
        <QuickBetsInner />
      </QuickBetsErrorBoundary>
    </AuthGate>
  );
}
