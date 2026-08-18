'use client';

import Link from 'next/link';
import { Component, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import AuthGate from '../../auth-gate';
import { loadQuickBetsFromFirestore, readQuickBetsCache } from '../../firestore-data';
import { AlertTriangle, ArrowLeft, Loader2, ListFilter } from 'lucide-react';
import { quickBetMatchState } from './quick-bets-utils.mjs';

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

function marketSelections(match, filter) {
  return filter.marketKeys.flatMap((marketKey) => {
    const selections = Array.isArray(match?.markets?.[marketKey]) ? match.markets[marketKey] : [];
    if (filter.line == null) return selections.map((selection) => ({ ...selection, marketKey }));
    return selections
      .filter((selection) => Number(selection.line) === filter.line)
      .map((selection) => ({ ...selection, marketKey }));
  });
}

// Every priced selection on a match, across all markets — used for the 'all' row
// set and the mobile card stack.
function allSelections(match) {
  return MARKET_COLUMNS.flatMap((filter) => marketSelections(match, filter));
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
  return stats.hits / stats.settled >= 0.5 ? 'text-[#34d399]' : 'text-[#f2545b]';
}

// AIOS qb-odds-badge tones (color-mix ~45% border / ~8% fill of blue/green/red).
function badgeClasses(tone) {
  if (tone === 'hit') return 'border-[#34d399]/45 bg-[#34d399]/[0.08] text-[#34d399]';
  if (tone === 'miss') return 'border-[#f2545b]/45 bg-[#f2545b]/[0.08] text-[#f2545b]';
  if (tone === 'void') return 'border-[#48484f] bg-transparent text-[#8c8c96]';
  // pending + live both read blue in AIOS.
  return 'border-[#5aa2f0]/45 bg-[#5aa2f0]/[0.08] text-[#5aa2f0]';
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

function OddsBadge({ match, selection }) {
  const href = safeSportsbetUrl(match.eventUrl);
  const tone = selectionTone(selection, match);
  const text = `${badgeText(selection)} @${formatOdds(selection.odds)}`;
  const cls = `inline-flex items-center rounded-none border px-1.5 py-0.5 text-[12px] font-medium tabular-nums ${badgeClasses(tone)}`;
  if (!href) {
    return <span className={`${cls} cursor-default`}>{text}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${cls} no-underline transition hover:brightness-125 active:translate-y-px`}
      title="Open this match on Sportsbet"
    >
      {text}
    </a>
  );
}

// A single market column cell: all qualifying selections, or the em-dash placeholder.
function PriceCell({ match, filter }) {
  const selections = marketSelections(match, filter);
  return (
    <td className="border-b border-white/[0.035] px-1.5 py-2 text-center align-middle">
      {selections.length ? (
        <span className="flex flex-wrap justify-center gap-0.5">
          {selections.map((selection, index) => (
            <OddsBadge key={selectionRowKey(selection, index)} match={match} selection={selection} />
          ))}
        </span>
      ) : (
        <span className="text-[#8c8c96]">—</span>
      )}
    </td>
  );
}

// Mobile card — retains the existing stacked layout; shows the active market's
// selections (or every market when the 'all' column is selected).
function MatchCard({ match, selections }) {
  return (
    <article className="rounded-md border border-[#38383d] bg-[#171717] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-normal uppercase tracking-wide text-[#8c8c96]">{match.league || 'Soccer'}</div>
          <div className="mt-1 text-sm font-normal text-white">
            <span>{match.home}</span>
            <b className="px-2 font-mono font-normal text-[#8c8c96]">{quickBetMatchState(match)}</b>
            <span>{match.away}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {selections.map((selection, index) => (
            <OddsBadge key={selectionRowKey(selection, index)} match={match} selection={selection} />
          ))}
        </div>
      </div>
    </article>
  );
}

function QuickBetsInner() {
  const [data, setData] = useState(() => readQuickBetsCache());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!readQuickBetsCache());
  const [activeMarket, setActiveMarket] = useState('all');
  const [activeLifecycle, setActiveLifecycle] = useState('upcoming');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadQuickBetsFromFirestore()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError('');
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load Firestore quick bets. Try refreshing in a moment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFilter = MARKET_FILTERS.find((filter) => filter.key === activeMarket) || MARKET_FILTERS[0];
  const isAll = selectedFilter.key === 'all';
  const matches = Array.isArray(data?.matches) ? data.matches : [];

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
    if (isAll) {
      return inState
        .filter((match) => allSelections(match).length)
        .sort((a, b) => byDateThen(a, b, () => 0));
    }
    return inState
      .map((match) => {
        const selections = marketSelections(match, selectedFilter);
        if (!selections.length) return null;
        const minOdds = Math.min(...selections.map((selection) => Number(selection.odds)).filter(Number.isFinite));
        return { match, minOdds };
      })
      .filter(Boolean)
      .sort((a, b) => byDateThen(a.match, b.match, () => a.minOdds - b.minOdds))
      .map(({ match }) => match);
  }, [matches, activeLifecycle, selectedFilter, isAll]);

  const selectionTotal = visibleMatches.reduce((total, match) => total + (isAll
    ? allSelections(match).length
    : marketSelections(match, selectedFilter).length), 0);

  // Per-market hit stats over the active lifecycle, for the column headers.
  const statsByMarket = useMemo(() => Object.fromEntries(MARKET_COLUMNS.map((filter) => {
    const rows = matches
      .filter((match) => match.lifecycle === activeLifecycle)
      .map((match) => ({ match, selections: marketSelections(match, filter) }))
      .filter(({ selections }) => selections.length);
    return [filter.key, outcomeStats(rows)];
  })), [matches, activeLifecycle]);

  const lifecycleCounts = data?.counts || {};
  const capturedAt = data?.captured_at || data?.capturedAt || '';
  const refreshStatus = data?.refresh_status || data?.refreshStatus || '';

  const toggleMarket = (key) => setActiveMarket((current) => (current === key ? 'all' : key));

  const sortSummary = isAll ? '' : activeLifecycle === 'result' ? ' · newest dates · lowest odds' : ' · today first · lowest odds';

  // The page header is sticky at top:0; the table column headers stick directly
  // beneath it. Measure the header's live height (it reflows with viewport width)
  // so the sticky offset stays exact instead of a brittle magic number.
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

  return (
    <main className="min-h-dvh bg-[#111111] font-mono text-[#fafafa]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[112rem] flex-col px-3 py-4 sm:px-5 lg:px-8">
        <header ref={headerRef} className="sticky top-0 z-20 border-b border-[#38383d] bg-[#111111]/95 pb-3 pt-1 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-[13px] font-normal text-[#a8a8b2] transition hover:text-white">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Dashboard
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="text-lg font-normal uppercase tracking-wide text-white sm:text-xl">Quick Bets</h1>
              </div>
              <p className="mt-2 text-[13px] font-medium text-[#8c8c96]">
                {visibleMatches.length} match{visibleMatches.length === 1 ? '' : 'es'} · {selectionTotal} selection{selectionTotal === 1 ? '' : 's'}{isAll ? '' : ` · ${selectedFilter.label}`}{sortSummary}
              </p>
            </div>
            {capturedAt ? (
              <p className="text-[12px] font-medium text-[#8c8c96]">
                captured {capturedAt}{refreshStatus && refreshStatus !== 'complete' ? ` · ${refreshStatus}` : ''}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {LIFECYCLE_FILTERS.map((filter) => {
              const selected = activeLifecycle === filter.key;
              const count = filter.key === 'result' ? lifecycleCounts.results : lifecycleCounts[filter.key];
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => { setActiveLifecycle(filter.key); setActiveMarket('all'); }}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-none border px-3 text-[13px] font-normal uppercase tracking-wide transition ${
                    selected ? 'border-[#5aa2f0]/45 bg-[#5aa2f0]/[0.08] text-[#5aa2f0]' : 'border-[#38383d] bg-transparent text-[#a8a8b2] hover:border-[#5aa2f0]/45 hover:text-[#5aa2f0]'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="text-[12px]">{count ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Mobile market filter chips (desktop filters live in the table headers). */}
          <div className="mt-2 grid grid-cols-4 gap-2 lg:hidden">
            {MARKET_FILTERS.map((filter) => {
              const selected = activeMarket === filter.key;
              const stat = filter.key === 'all' ? null : statsByMarket[filter.key];
              const statText = stat ? headerStatText(stat) : '';
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => toggleMarket(filter.key)}
                  aria-pressed={selected}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-none border px-2 text-center transition ${
                    selected ? 'border-[#5aa2f0]/45 bg-[#5aa2f0]/[0.08] text-[#5aa2f0]' : 'border-[#38383d] bg-transparent text-[#a8a8b2] hover:border-[#5aa2f0]/45 hover:text-[#5aa2f0]'
                  }`}
                >
                  <span className="text-[12px] font-normal uppercase tracking-wide">{filter.shortLabel}</span>
                  {statText ? <span className={`text-[11px] ${headerStatTone(stat)}`}>{statText}</span> : null}
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex-1 pt-4">
          {loading && !data ? (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-[#38383d] bg-[#171717] text-sm font-normal text-[#a8a8b2]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Loading quick bets
            </div>
          ) : null}

          {error ? (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-[#f2545b]/50 bg-[#f2545b]/10 p-4 text-center text-sm font-normal text-[#f2545b]">
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
              {error}
            </div>
          ) : null}

          {/* Mobile empty state. On desktop the message lives inside the table so the
              column-header filters stay visible (an empty market must not trap the user). */}
          {!loading && !error && visibleMatches.length === 0 ? (
            <div className="rounded-md border border-[#38383d] bg-[#171717] p-8 text-center text-sm font-normal text-[#8c8c96] lg:hidden">
              <ListFilter className="mx-auto mb-3 h-5 w-5" aria-hidden="true" />
              {isAll ? 'No Quick Bets for this state.' : `No matches with ${selectedFilter.label} odds.`}
            </div>
          ) : null}

          {/* Mobile: stacked cards grouped by date band. */}
          {!error && visibleMatches.length ? (
            <div className="space-y-2 lg:hidden">
              {visibleMatches.map((match, index) => {
                const band = dayBand(match.date);
                const prev = visibleMatches[index - 1];
                const showDate = !prev || prev.date !== match.date;
                const selections = isAll ? allSelections(match) : marketSelections(match, selectedFilter);
                return (
                  <div key={matchRowKey(match, index)} className="space-y-2">
                    {showDate ? (
                      <div className="pt-2 text-[13px] font-normal text-white">
                        {band ? `${band} · ` : ''}{fmtDMY(match.date)}
                      </div>
                    ) : null}
                    <MatchCard match={match} selections={selections} />
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Desktop: single AIOS-style market grid. The table (and its column-header
              filters) renders whenever any data is loaded, even if the active market is
              empty — otherwise there is no control to filter back out of an empty market. */}
          {!error && !loading && matches.length ? (
            <div className="hidden lg:block">
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
                      const statText = stat ? headerStatText(stat) : '';
                      return (
                        <th
                          key={filter.key}
                          scope="col"
                          style={{ top: headerHeight }}
                          className={`sticky z-10 border-b border-[#48484f] bg-[#111111] ${isIdentity ? 'text-left' : 'text-center'} align-bottom`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleMarket(filter.key)}
                            aria-pressed={active}
                            className={`flex w-full flex-col ${isIdentity ? 'items-start' : 'items-center'} gap-0.5 border border-transparent px-1.5 py-2 text-[12px] font-medium uppercase tracking-[0.08em] transition hover:border-[#5aa2f0]/45 hover:bg-[#5aa2f0]/[0.08] hover:text-[#5aa2f0] ${
                              active && !isIdentity ? 'text-[#5aa2f0]' : 'text-[#8c8c96]'
                            }`}
                          >
                            <span>{filter.label}</span>
                            {statText ? <span className={`text-[12px] font-normal tabular-nums tracking-normal ${headerStatTone(stat)}`}>{statText}</span> : null}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleMatches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2.5 py-10 text-center text-[13px] text-[#8c8c96]">
                        {isAll ? 'No Quick Bets for this state.' : `No matches with ${selectedFilter.label} odds — pick another column or Match.`}
                      </td>
                    </tr>
                  ) : null}
                  {visibleMatches.map((match, index) => {
                    const prev = visibleMatches[index - 1];
                    const showDate = !prev || prev.date !== match.date;
                    const showLeague = isAll && (showDate || (prev && prev.league !== match.league));
                    const band = dayBand(match.date);
                    return (
                      <Fragment key={matchRowKey(match, index)}>
                        {showDate ? (
                          <tr key={`${matchRowKey(match, index)}-date`} className="bg-[#5aa2f0]/[0.09]">
                            <td colSpan={7} className="border-y border-[#5aa2f0]/25 px-2.5 py-2.5 text-[13px] font-normal tracking-[0.05em] text-white shadow-[inset_2px_0_0_#5aa2f0]">
                              {band ? `${band} · ` : ''}{fmtDMY(match.date)}
                            </td>
                          </tr>
                        ) : null}
                        {showLeague ? (
                          <tr key={`${matchRowKey(match, index)}-league`}>
                            <td colSpan={7} className="border-b border-white/[0.04] px-2.5 pb-1 pl-6 pt-2.5 text-[12px] uppercase tracking-[0.1em] text-[#a8a8b2]">
                              {match.league || 'Other'}
                            </td>
                          </tr>
                        ) : null}
                        <tr key={matchRowKey(match, index)} className="transition hover:bg-white/[0.022]">
                          <td className={`border-b border-white/[0.035] py-2 pr-2 align-middle text-[14px] ${isAll ? 'pl-10' : 'pl-2.5'}`}>
                            {!isAll ? (
                              <span className="mb-0.5 block text-[10px] uppercase tracking-[0.06em] text-[#8c8c96]">{match.league || 'Other'}</span>
                            ) : null}
                            <span className="block break-words">
                              {match.home}
                              <b className="px-1.5 font-normal text-[#8c8c96]">{quickBetMatchState(match)}</b>
                              {match.away}
                            </span>
                          </td>
                          {MARKET_COLUMNS.map((filter) => (
                            <PriceCell key={filter.key} match={match} filter={filter} />
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
        <main className="flex min-h-dvh items-center justify-center bg-[#111111] p-4 text-slate-100">
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-5 text-sm font-normal text-red-200">
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
