'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Goal,
  MapPin,
  RefreshCcw,
  Shield,
  Trophy,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';

const DATA_URL = 'data/match_data.json';

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
  if (result === 'hit') return 'border-emerald-200 bg-emerald-50';
  if (result === 'miss') return 'border-red-200 bg-red-50';
  return 'border-line bg-field';
}

function marketValueClass(result) {
  if (result === 'hit') return 'text-emerald-700';
  if (result === 'miss') return 'text-red-700';
  return 'text-ink';
}

function streakCardClass(result) {
  if (result === 'hit') return 'border-emerald-200 bg-emerald-50';
  if (result === 'miss') return 'border-red-200 bg-red-50';
  return 'border-line bg-field';
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

function formatOdds(value) {
  return value ? Number(value).toFixed(2) : '-';
}

function formatMarketDetail(market) {
  if (!market) return '-';
  return market.line ? `${market.pick} ${market.line}` : market.pick || '-';
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
    <div className={`flex min-h-10 items-center justify-between gap-2 rounded-md border px-2.5 py-2 sm:px-3 ${marketPillClass(market.result)}`}>
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
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value ?? '-'}</div>
    </div>
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

function StreakList({ title, streaks }) {
  if (!streaks?.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {streaks.map((streak, index) => (
          <div key={`${title}-${streak.team}-${streak.label}-${index}`} className="rounded-md border border-line bg-field px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink">{streak.label}</span>
              <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{streak.team}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-600">
              <span>{streak.value}</span>
              <span>Odds {formatOdds(streak.odds)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchDetails({ match, onClose }) {
  const predictions = match.predictions || {};
  const odds = match.sportsbet_odds || match.odds || {};
  const actuals = match.actuals || {};

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-ink/55 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-details-title"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white shadow-2xl sm:mx-auto sm:max-w-3xl sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-white px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <span>{match.league}</span>
                <span>{match.date}</span>
                <span>{match.time}</span>
                <span className={`rounded-full px-2 py-1 ring-1 ${statusClass(match.status)}`}>{match.status}</span>
              </div>
              <h2 id="match-details-title" className="mt-2 text-lg font-semibold text-ink sm:text-xl">
                {match.home?.name} vs {match.away?.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-600 hover:bg-field"
              aria-label="Close match details"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div className="min-w-0 rounded-md bg-field px-3 py-3 text-left">
              <div className="truncate text-base font-semibold text-ink">{match.home?.name}</div>
              <div className="mt-1 text-xs text-slate-500">Rank {match.home?.rank ?? '-'} · {match.home?.pts ?? '-'} pts</div>
            </div>
            <div className="rounded-md bg-ink px-3 py-3 text-center text-base font-semibold text-white">
              {match.status === 'FT' ? `${match.home?.goals ?? '-'}-${match.away?.goals ?? '-'}` : 'vs'}
            </div>
            <div className="min-w-0 rounded-md bg-field px-3 py-3 text-right">
              <div className="truncate text-base font-semibold text-ink">{match.away?.name}</div>
              <div className="mt-1 text-xs text-slate-500">Rank {match.away?.rank ?? '-'} · {match.away?.pts ?? '-'} pts</div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <DetailStat label="Home odds" value={formatOdds(odds.home)} />
            <DetailStat label="Draw odds" value={formatOdds(odds.draw)} />
            <DetailStat label="Away odds" value={formatOdds(odds.away)} />
          </div>

          {(match.venue || match.referee) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {match.venue && (
                <div className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700">
                  <MapPin className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0 truncate">{match.venue}</span>
                </div>
              )}
              {match.referee && (
                <div className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700">
                  <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {match.referee.name} · YC {match.referee.avg_yellow ?? '-'} · RC {match.referee.avg_red ?? '-'}
                  </span>
                </div>
              )}
            </div>
          )}

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
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <DetailStat label="Corners" value={actuals.corners_total} />
                <DetailStat label="Fouls" value={actuals.fouls_total} />
                <DetailStat label="Shots on target" value={`${actuals.home_sot ?? '-'}-${actuals.away_sot ?? '-'}`} />
                <DetailStat label="Half time" value={`${actuals.ht_home ?? '-'}-${actuals.ht_away ?? '-'}`} />
              </div>
            </div>
          )}

          <StreakList title="Team streaks" streaks={match.team_streaks} />
          <StreakList title="Head to head streaks" streaks={match.h2h_streaks} />
        </div>
      </div>
    </div>
  );
}

function MatchCard({ match, onSelect }) {
  const predictions = match.predictions || {};
  const odds = match.sportsbet_odds || match.odds || {};
  const actuals = match.actuals || {};

  return (
    <article className="rounded-lg border border-line bg-white shadow-panel transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <button
        type="button"
        onClick={() => onSelect(match)}
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        aria-label={`View details for ${match.home?.name} vs ${match.away?.name}`}
      >
      <div className="border-b border-line px-3 py-3 sm:px-4">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-sm text-slate-600">
          <span className="flex min-w-0 items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="truncate">{match.date}</span>
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="truncate">{match.time}</span>
          </span>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(match.status)}`}>
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

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
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

function LeagueSection({ group, onSelectMatch }) {
  const finished = group.matches.filter((match) => match.status === 'FT').length;
  const upcoming = group.matches.length - finished;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line bg-ink px-3 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Trophy className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h2 className="truncate text-base font-semibold sm:text-lg">{group.league}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-white/12 px-2.5 py-1">{group.matches.length} matches</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{upcoming} upcoming</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1">{finished} finished</span>
        </div>
      </div>
      <div className="grid gap-3 bg-field p-2 sm:gap-4 sm:p-4 lg:grid-cols-2">
        {group.matches.map((match) => (
          <MatchCard key={`${match.league}-${match.id}`} match={match} onSelect={onSelectMatch} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [league, setLeague] = useState('all');
  const [status, setStatus] = useState('upcoming');
  const [selectedDate, setSelectedDate] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedMatch, setSelectedMatch] = useState(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
        return response.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const matches = useMemo(() => flattenMatches(data), [data]);
  const leagues = useMemo(() => [...new Set(matches.map((match) => match.league))], [matches]);
  const dates = useMemo(
    () => [...new Set(matches.map((match) => match.date).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [matches],
  );
  const stats = useMemo(() => summarize(matches), [matches]);
  const selectedDateIndex = dates.indexOf(selectedDate);

  function moveDate(direction) {
    if (!dates.length) return;

    if (selectedDateIndex === -1) {
      setSelectedDate(direction > 0 ? dates[0] : dates[dates.length - 1]);
      return;
    }

    const nextIndex = Math.min(Math.max(selectedDateIndex + direction, 0), dates.length - 1);
    setSelectedDate(dates[nextIndex]);
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return matches
      .filter((match) => (league === 'all' ? true : match.league === league))
      .filter((match) => (selectedDate === 'all' ? true : match.date === selectedDate))
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

  return (
    <main className="min-h-screen bg-field">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink sm:text-2xl">Soccer Stats</h1>
              <p className="mt-1 text-sm text-slate-500">
                Captured {data?.captured_at || '-'} | Source {data?.source || 'static data'}
              </p>
            </div>
            <a
              href={DATA_URL}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-field sm:w-auto"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Data JSON
            </a>
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

        <div className="mt-3 grid gap-3 rounded-lg border border-line bg-white p-3 sm:mt-5 sm:grid-cols-[auto_12rem_10rem_16rem_minmax(0,1fr)] sm:items-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filters
          </div>
          <select
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="h-10 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm"
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
            className="h-10 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm"
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous match date"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <select
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm"
              aria-label="Match date"
            >
              <option value="all">All dates</option>
              {dates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => moveDate(1)}
              disabled={!dates.length || selectedDateIndex === dates.length - 1}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next match date"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams or league"
            className="h-10 min-w-0 rounded-md border border-line bg-white px-3 text-sm"
          />
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-miss/20 bg-miss/10 p-4 text-sm text-miss">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="mt-3 space-y-4 sm:mt-5 sm:space-y-5">
          {groupedMatches.map((group) => (
            <LeagueSection key={group.leagueId || group.league} group={group} onSelectMatch={setSelectedMatch} />
          ))}
        </div>

        {!error && filtered.length === 0 && (
          <div className="mt-5 rounded-lg border border-line bg-white p-8 text-center text-sm text-slate-500">
            No matches found for the selected filters.
          </div>
        )}
      </section>

      {selectedMatch && <MatchDetails match={selectedMatch} onClose={() => setSelectedMatch(null)} />}
    </main>
  );
}
