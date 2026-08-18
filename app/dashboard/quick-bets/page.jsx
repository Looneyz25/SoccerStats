'use client';

import Link from 'next/link';
import { Component, useEffect, useMemo, useState } from 'react';
import AuthGate from '../../auth-gate';
import { loadQuickBetsFromFirestore, readQuickBetsCache } from '../../firestore-data';
import { AlertTriangle, ArrowLeft, Clock3, Loader2, ListFilter } from 'lucide-react';

const MARKET_FILTERS = [
  { key: 'winner', label: 'Winner', shortLabel: 'Winner', marketKeys: ['winner'] },
  { key: 'btts', label: 'BTTS', shortLabel: 'BTTS', marketKeys: ['btts'] },
  { key: 'goals05', label: 'GLS 0.5', shortLabel: '0.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 0.5 },
  { key: 'goals15', label: 'GLS 1.5', shortLabel: '1.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 1.5 },
  { key: 'goals25', label: 'GLS 2.5', shortLabel: '2.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 2.5 },
  { key: 'goals35', label: 'GLS 3.5', shortLabel: '3.5', marketKeys: ['goalsOver', 'goalsUnder'], line: 3.5 },
];

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

function selectionLabel(selection) {
  if (selection.side === 'over' || selection.side === 'under') {
    const side = selection.side === 'over' ? 'Over' : 'Under';
    return `${side} ${Number(selection.line).toString()}`;
  }
  return selection.label || selection.key || 'Pick';
}

function formatOdds(value) {
  const odds = Number(value);
  return Number.isFinite(odds) ? odds.toFixed(2) : '-';
}

function selectionTone(selection, match) {
  return selection.result || selection.liveLock || (match.lifecycle === 'live' ? 'live' : 'pending');
}

function badgeClasses(tone) {
  if (tone === 'hit') return 'border-emerald-500/70 bg-emerald-500/12 text-emerald-300';
  if (tone === 'miss') return 'border-red-500/70 bg-red-500/12 text-red-300';
  if (tone === 'void') return 'border-slate-500/60 bg-slate-700/35 text-slate-300';
  if (tone === 'live') return 'border-sky-500/70 bg-sky-500/12 text-sky-300';
  return 'border-cyan-500/55 bg-cyan-500/10 text-cyan-300';
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

function dateLabel(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function groupByDate(matches) {
  return matches.reduce((groups, row) => {
    const date = row.match?.date || 'unknown';
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(row);
    return groups;
  }, new Map());
}

function MatchName({ match }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{match.league || 'Soccer'}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-white sm:text-[15px]">
        <span className="truncate">{match.home}</span>
        {match.score ? <span className="shrink-0 font-mono text-sm text-slate-400">{match.score}</span> : null}
        <span className="shrink-0 text-slate-600">v</span>
        <span className="truncate">{match.away}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{match.time || 'Time TBC'}</span>
        {match.minute ? <span>{match.minute}</span> : null}
      </div>
    </div>
  );
}

function MarketBadge({ match, selection }) {
  const href = safeSportsbetUrl(match.eventUrl);
  const tone = selectionTone(selection, match);
  const content = (
    <>
      <span>{selectionLabel(selection)}</span>
      <span className="inline-flex items-center gap-1 font-mono">
        {formatOdds(selection.odds)}
      </span>
    </>
  );

  if (!href) {
    return (
      <span className={`inline-flex min-h-8 items-center gap-1.5 rounded border px-2.5 py-1 text-[13px] font-semibold ${badgeClasses(tone)}`}>
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-8 items-center gap-1.5 rounded border px-2.5 py-1 text-[13px] font-semibold transition hover:brightness-125 active:scale-[0.98] ${badgeClasses(tone)}`}
      title="Open this match on Sportsbet"
    >
      {content}
    </a>
  );
}

function MatchCard({ match, selections }) {
  return (
    <article className="rounded-md border border-slate-800 bg-[#171717] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <MatchName match={match} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {selections.map((selection) => (
            <MarketBadge key={`${selection.marketKey}-${selection.key}-${selection.line ?? ''}`} match={match} selection={selection} />
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
  const [activeMarket, setActiveMarket] = useState('goals15');
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

  const selectedFilter = MARKET_FILTERS.find((filter) => filter.key === activeMarket) || MARKET_FILTERS[3];
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const filteredMatches = useMemo(() => matches
    .map((match) => ({ match, selections: marketSelections(match, selectedFilter) }))
    .filter(({ match, selections }) => match.lifecycle === activeLifecycle && selections.length)
    .sort((a, b) => {
      const aOdds = Math.min(...a.selections.map((selection) => Number(selection.odds)).filter(Number.isFinite));
      const bOdds = Math.min(...b.selections.map((selection) => Number(selection.odds)).filter(Number.isFinite));
      return (aOdds - bOdds)
        || String(a.match.date).localeCompare(String(b.match.date))
        || String(a.match.time || '99:99').localeCompare(String(b.match.time || '99:99'))
        || String(a.match.league || '').localeCompare(String(b.match.league || ''))
        || String(a.match.home || '').localeCompare(String(b.match.home || ''));
    }), [activeLifecycle, matches, selectedFilter]);
  const grouped = useMemo(() => groupByDate(filteredMatches), [filteredMatches]);
  const selectionTotal = filteredMatches.reduce((total, row) => total + row.selections.length, 0);
  const countsByMarket = useMemo(() => Object.fromEntries(MARKET_FILTERS.map((filter) => [
    filter.key,
    matches.filter((match) => match.lifecycle === activeLifecycle && marketSelections(match, filter).length).length,
  ])), [activeLifecycle, matches]);
  const lifecycleCounts = data?.counts || {};

  return (
    <main className="min-h-dvh bg-[#111111] text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-[112rem] flex-col px-3 py-4 sm:px-5 lg:px-8">
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#111111]/95 pb-3 pt-1 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-400 transition hover:text-white">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Dashboard
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="text-lg font-black uppercase tracking-wide text-white sm:text-xl">Quick Bets</h1>
              </div>
              <p className="mt-2 text-[13px] font-medium text-slate-500">
                {filteredMatches.length} matches - {selectionTotal} selections - {selectedFilter.label} - lowest first
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {LIFECYCLE_FILTERS.map((filter) => {
              const selected = activeLifecycle === filter.key;
              const count = filter.key === 'result' ? lifecycleCounts.results : lifecycleCounts[filter.key];
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveLifecycle(filter.key)}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded border px-3 text-[13px] font-bold uppercase tracking-wide transition ${
                    selected ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-800 bg-[#171717] text-slate-400 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="font-mono text-[12px]">{count ?? 0}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {MARKET_FILTERS.map((filter) => {
              const selected = activeMarket === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveMarket(filter.key)}
                  aria-pressed={selected}
                  className={`flex min-h-11 flex-col items-center justify-center rounded border px-2 text-center transition ${
                    selected ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-800 bg-[#171717] text-slate-400 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <span className="text-[13px] font-black uppercase tracking-wide">{filter.shortLabel}</span>
                  <span className="font-mono text-[11px]">{countsByMarket[filter.key] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex-1 pt-4">
          {loading && !data ? (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-slate-800 bg-[#171717] text-sm font-semibold text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Loading quick bets
            </div>
          ) : null}

          {error ? (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-red-500/50 bg-red-500/10 p-4 text-center text-sm font-semibold text-red-200">
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
              {error}
            </div>
          ) : null}

          {!loading && !error && filteredMatches.length === 0 ? (
            <div className="rounded-md border border-slate-800 bg-[#171717] p-8 text-center text-sm font-semibold text-slate-500">
              <ListFilter className="mx-auto mb-3 h-5 w-5" aria-hidden="true" />
              No Quick Bets for this selected market.
            </div>
          ) : null}

          {!error && filteredMatches.length ? (
            <div className="space-y-5">
              {[...grouped.entries()].map(([date, rows]) => (
                <section key={date} className="border-l-2 border-sky-500/80 pl-3">
                  <div className="sticky top-[183px] z-10 mb-2 bg-[#111111]/95 py-2 backdrop-blur sm:top-[169px]">
                    <h2 className="font-mono text-base font-black text-white">{dateLabel(date)}</h2>
                    <p className="text-[12px] font-semibold text-slate-500">{rows.length} matches</p>
                  </div>

                  <div className="space-y-2 lg:hidden">
                    {rows.map(({ match, selections }) => (
                      <MatchCard key={`${match.eventId}-${match.lifecycle}`} match={match} selections={selections} />
                    ))}
                  </div>

                  <div className="hidden overflow-hidden rounded-md border border-slate-800 lg:block">
                    <table className="w-full table-fixed border-collapse bg-[#151515]">
                      <colgroup>
                        <col className="w-[64%]" />
                        <col className="w-[36%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-slate-700 bg-[#1d1d1f] text-[12px] font-black uppercase tracking-wide text-white">
                          <th className="px-4 py-3 text-left">Match</th>
                          <th className="border-l border-slate-700 px-4 py-3 text-left">{selectedFilter.label}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ match, selections }) => (
                          <tr key={`${match.eventId}-${match.lifecycle}`} className="border-b border-slate-800 last:border-b-0 odd:bg-[#171717] even:bg-[#1b1b1b]">
                            <td className="px-4 py-3 align-top">
                              <MatchName match={match} />
                            </td>
                            <td className="border-l border-slate-800 px-4 py-3 align-top">
                              <div className="flex flex-wrap justify-end gap-2">
                                {selections.map((selection) => (
                                  <MarketBadge key={`${selection.marketKey}-${selection.key}-${selection.line ?? ''}`} match={match} selection={selection} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
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
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-5 text-sm font-semibold text-red-200">
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
