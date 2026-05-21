'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthGate from '../../auth-gate';
import {
  getAllUsers,
  getUserProfile,
  loadMatchDataFromFirestore,
  updateUserManualAccess,
  updateUserStripeInheritance,
} from '../../firestore-data';
import { getFirebaseAuth } from '../../firebase';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';

function formatDate(value) {
  if (!value) return '-';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeStatus(status) {
  return (status || 'none').replaceAll('_', ' ');
}

function displayNameForUser(user) {
  return user?.displayName || user?.nickname || 'No name';
}

function daysUntil(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function stripeStatusClass(status) {
  if (status === 'active' || status === 'trialing') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'bg-orange-50 text-orange-700 ring-orange-200';
  if (status === 'canceled' || status === 'incomplete_expired') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function accessState(user) {
  const inheritsStripe = user.inheritStripeStatus !== false;
  if (user.isPlatformOwner) return { label: 'Owner', tone: 'bg-signal/10 text-signal ring-signal/20' };
  if (user.manualAccess) return { label: 'Manual', tone: 'bg-blue-50 text-blue-700 ring-blue-200' };
  if (inheritsStripe && (user.subscriptionHasAccess || user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing')) {
    return { label: 'Stripe', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  }
  if (user.hasAccess) return { label: 'Granted', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  return { label: 'Locked', tone: 'bg-orange-50 text-orange-700 ring-orange-200' };
}

function StatCard({ label, value, sublabel = '' }) {
  return (
    <div className="rounded-md border border-line bg-white px-4 py-3 shadow-panel">
      <div className="text-sm font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-none text-ink">{value}</div>
      {sublabel && <div className="mt-1 text-base text-slate-500">{sublabel}</div>}
    </div>
  );
}

function InfoLine({ label, value, valueClassName = 'text-ink' }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-base">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 truncate text-right font-semibold ${valueClassName}`}>{value || '-'}</span>
    </div>
  );
}

function flattenAdminMatches(matchData) {
  return (matchData?.leagues || []).flatMap((league) => (
    (league.matches || []).map((match) => ({
      ...match,
      league: match.league || league.name,
      leagueLogo: match.leagueLogo || league.logo,
    }))
  ));
}

function marketResultValue(market) {
  return market?.result || market?.status || null;
}

function confidenceLabel(match) {
  const confidence = match?.display_summary?.confidence;
  if (typeof confidence === 'string') return confidence;
  if (confidence?.label) return confidence.label;
  return '';
}

function isPaymentIssue(user) {
  return ['past_due', 'unpaid', 'incomplete'].includes(user?.subscriptionStatus);
}

function OverviewPanel({ title, description, children }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-base text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-md border border-line bg-field px-4 py-6 text-center text-base font-semibold text-slate-500">
      {children}
    </div>
  );
}

function AdminDashboard() {
  const GROUP_STORAGE_KEY = 'soccer_stats_admin_groups_v1';
  const UNASSIGNED_GROUP_FILTER = '__unassigned__';
  const ADMIN_MODULES = [
    { id: 'users', label: 'Users', icon: ShieldCheck },
    { id: 'data', label: 'Data Ops', icon: Database },
    { id: 'qa', label: 'Model QA', icon: BarChart3 },
    { id: 'health', label: 'Health', icon: Activity },
  ];
  const [users, setUsers] = useState([]);
  const [matchData, setMatchData] = useState(null);
  const [matchDataLoading, setMatchDataLoading] = useState(false);
  const [matchDataError, setMatchDataError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeModule, setActiveModule] = useState('users');
  const [busyUid, setBusyUid] = useState('');
  const [syncingStripe, setSyncingStripe] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedUid, setSelectedUid] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupAssignments, setGroupAssignments] = useState({});
  const [groupDraft, setGroupDraft] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const router = useRouter();

  async function syncStripeUser(uid) {
    const auth = getFirebaseAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sign in again before syncing Stripe.');

    const response = await fetch('/api/stripe/sync-user', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uid }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Stripe sync failed.');
    }
    return payload;
  }

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        router.push('/dashboard');
        return;
      }

      const profile = await getUserProfile(currentUser.uid);
      if (!profile?.isPlatformOwner) {
        router.push('/dashboard');
        return;
      }

      setMatchDataLoading(true);
      setMatchDataError('');
      let usersList = await getAllUsers();
      const stripeUsers = usersList.filter((user) => user.stripeCustomerId);
      if (stripeUsers.length) {
        setSyncingStripe(true);
        await Promise.all(stripeUsers.map((user) => syncStripeUser(user.uid)));
        usersList = await getAllUsers();
      }
      setUsers(usersList);
      if (!selectedUid && usersList.length) {
        setSelectedUid(usersList[0].uid);
      }
      try {
        setMatchData(await loadMatchDataFromFirestore());
      } catch (matchErr) {
        console.error(matchErr);
        setMatchDataError(matchErr?.message || 'Failed to load dashboard data.');
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to load users.');
    } finally {
      setSyncingStripe(false);
      setMatchDataLoading(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GROUP_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setGroups(Array.isArray(parsed?.groups) ? parsed.groups : []);
      setGroupAssignments(parsed?.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {});
    } catch {
      // ignore malformed local storage payload
    }
  }, []);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const groupsForUser = groupAssignments[user.uid] || [];
      const matchesGroup =
        groupFilter === 'all'
        || (groupFilter === UNASSIGNED_GROUP_FILTER ? groupsForUser.length === 0 : groupsForUser.includes(groupFilter));
      if (!matchesGroup) return false;
      if (!needle) return true;
      return [
        user.displayName,
        user.nickname,
        user.email,
        user.uid,
        user.stripeCustomerId,
        user.stripeSubscriptionId,
        user.subscriptionStatus,
        user.accessSource,
        ...groupsForUser,
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [UNASSIGNED_GROUP_FILTER, groupAssignments, groupFilter, query, users]);

  const selectedUser = useMemo(
    () => filteredUsers.find((user) => user.uid === selectedUid) || filteredUsers[0] || null,
    [filteredUsers, selectedUid]
  );

  useEffect(() => {
    if (!filteredUsers.length) {
      if (selectedUid) setSelectedUid('');
      return;
    }
    if (!filteredUsers.some((user) => user.uid === selectedUid)) {
      setSelectedUid(filteredUsers[0].uid);
    }
  }, [filteredUsers, selectedUid]);

  async function persistGroups(nextGroups, nextAssignments) {
    const payload = {
      groups: nextGroups,
      assignments: nextAssignments,
    };
    window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(payload));
  }

  async function handleCreateGroup(event) {
    event.preventDefault();
    const cleanName = groupDraft.trim();
    if (!cleanName) return;
    if (groups.includes(cleanName)) {
      setGroupDraft('');
      return;
    }
    const nextGroups = [...groups, cleanName];
    try {
      await persistGroups(nextGroups, groupAssignments);
      setGroups(nextGroups);
      setGroupDraft('');
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to create group.');
    }
  }

  async function handleToggleUserGroup(uid, groupName) {
    const current = groupAssignments[uid] || [];
    const hasGroup = current.includes(groupName);
    const nextUserGroups = hasGroup ? current.filter((name) => name !== groupName) : [...current, groupName];
    const nextAssignments = { ...groupAssignments, [uid]: nextUserGroups };
    try {
      await persistGroups(groups, nextAssignments);
      setGroupAssignments(nextAssignments);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to update group assignment.');
    }
  }

  async function handleDeleteGroup(groupName) {
    const nextGroups = groups.filter((name) => name !== groupName);
    const nextAssignments = Object.fromEntries(
      Object.entries(groupAssignments).map(([uid, groupList]) => [uid, (groupList || []).filter((name) => name !== groupName)])
    );
    try {
      await persistGroups(nextGroups, nextAssignments);
      setGroups(nextGroups);
      setGroupAssignments(nextAssignments);
      if (groupFilter === groupName) setGroupFilter('all');
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to remove group.');
    }
  }

  const stats = useMemo(() => {
    return users.reduce((acc, user) => {
      if (user.hasAccess || user.isPlatformOwner) acc.active += 1;
      if (user.manualAccess) acc.manual += 1;
      if (user.stripeCustomerId) acc.stripe += 1;
      if (user.subscriptionStatus === 'past_due' || user.subscriptionStatus === 'unpaid') acc.paymentIssues += 1;
      return acc;
    }, { active: 0, manual: 0, stripe: 0, paymentIssues: 0 });
  }, [users]);

  const billingSummary = useMemo(() => {
    const stripeUsers = users.filter((user) => user.stripeCustomerId);
    const paymentIssues = users.filter(isPaymentIssue);
    return { stripeUsers, paymentIssues };
  }, [users]);

  const matches = useMemo(() => flattenAdminMatches(matchData), [matchData]);

  const dataSummary = useMemo(() => {
    const finished = matches.filter((match) => match.status === 'FT').length;
    const upcoming = matches.filter((match) => match.status !== 'FT').length;
    const dates = matchData?.availableDates || [];
    const leagues = matchData?.leagues || [];
    const dueRows = matches.filter((match) => match.due_for_check || String(match.result_queue || '').toLowerCase().includes('due @'));
    const unresolvedFinished = matches.filter((match) => match.status === 'FT' && !match.actuals);
    return { finished, upcoming, dates, leagues, dueRows, unresolvedFinished };
  }, [matchData, matches]);

  const qaSummary = useMemo(() => {
    const markets = ['winner', 'btts', 'ou_goals', 'ou_cards', 'ou_corners'];
    const totals = markets.reduce((acc, key) => ({ ...acc, [key]: { hit: 0, miss: 0, pending: 0 } }), {});
    matches.forEach((match) => {
      markets.forEach((key) => {
        const displayKey = key === 'ou_goals' ? 'goals' : key === 'ou_cards' ? 'cards' : key === 'ou_corners' ? 'corners' : key;
        const result = marketResultValue(match.display_markets?.[displayKey]?.market || match.predictions?.[key]);
        if (result === 'hit') totals[key].hit += 1;
        else if (result === 'miss') totals[key].miss += 1;
        else totals[key].pending += 1;
      });
    });
    const weakMatches = matches.filter((match) => {
      const confidence = confidenceLabel(match).toLowerCase();
      return confidence.includes('weak') || confidence.includes('avoid');
    }).slice(0, 8);
    return { totals, weakMatches };
  }, [matches]);

  const healthSummary = useMemo(() => {
    const capturedAt = matchData?.captured_at || matchData?.capturedAt || '';
    const capturedDate = capturedAt ? new Date(capturedAt) : null;
    const hoursOld = capturedDate && !Number.isNaN(capturedDate.getTime())
      ? Math.max(0, Math.round((Date.now() - capturedDate.getTime()) / 36e5))
      : null;
    return {
      capturedAt,
      hoursOld,
      source: matchData?.source || '-',
      fireStoreStatus: matchDataError ? 'error' : matchDataLoading ? 'loading' : matchData ? 'ok' : 'unknown',
    };
  }, [matchData, matchDataError, matchDataLoading]);

  const groupCounts = useMemo(() => {
    const counts = {};
    groups.forEach((groupName) => {
      counts[groupName] = 0;
    });
    users.forEach((user) => {
      const userGroups = groupAssignments[user.uid] || [];
      userGroups.forEach((groupName) => {
        if (counts[groupName] == null) counts[groupName] = 0;
        counts[groupName] += 1;
      });
    });
    return counts;
  }, [groupAssignments, groups, users]);

  const unassignedCount = useMemo(
    () => users.filter((user) => (groupAssignments[user.uid] || []).length === 0).length,
    [groupAssignments, users]
  );

  async function handleManualOverride(user, manualAccess) {
    setBusyUid(user.uid);
    setError('');
    try {
      await updateUserManualAccess(user.uid, manualAccess);
      setUsers((current) => current.map((item) => {
        if (item.uid !== user.uid) return item;
        const inheritsActiveStripe = item.inheritStripeStatus !== false && item.subscriptionHasAccess;
        const nextHasAccess = Boolean(manualAccess || inheritsActiveStripe || item.isPlatformOwner);
        return {
          ...item,
          manualAccess,
          hasAccess: nextHasAccess,
          accessSource: manualAccess ? 'manual' : inheritsActiveStripe ? 'stripe' : 'none',
          manualAccessUpdatedAt: new Date().toISOString(),
        };
      }));
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to update manual access.');
    } finally {
      setBusyUid('');
    }
  }

  async function handleStripeInheritance(user, inheritStripeStatus) {
    setBusyUid(user.uid);
    setError('');
    try {
      await updateUserStripeInheritance(user.uid, inheritStripeStatus);
      setUsers((current) => current.map((item) => {
        if (item.uid !== user.uid) return item;
        const inheritsActiveStripe = inheritStripeStatus && item.subscriptionHasAccess;
        const nextHasAccess = Boolean(item.manualAccess || inheritsActiveStripe || item.isPlatformOwner);
        return {
          ...item,
          inheritStripeStatus,
          hasAccess: nextHasAccess,
          accessSource: item.manualAccess ? 'manual' : inheritsActiveStripe ? 'stripe' : 'none',
          stripeInheritanceUpdatedAt: new Date().toISOString(),
        };
      }));
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to update Stripe inheritance.');
    } finally {
      setBusyUid('');
    }
  }

  async function handleSyncStripeUser(user) {
    setBusyUid(user.uid);
    setError('');
    try {
      await syncStripeUser(user.uid);
      const usersList = await getAllUsers();
      setUsers(usersList);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to sync Stripe subscription.');
    } finally {
      setBusyUid('');
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-field px-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-base font-semibold text-ink shadow-panel">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
          Loading admin dashboard...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-field px-3 py-4 sm:px-4 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard" className="mb-2 inline-flex items-center gap-2 text-base font-medium text-slate-500 transition hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Back to Dashboard
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
              <ShieldCheck className="h-6 w-6 text-signal" />
              Admin Dashboard
            </h1>
            <p className="mt-1 text-base text-slate-600">
              Review members, subscription state, and manual access overrides.
            </p>
          </div>

          <button
            type="button"
            onClick={loadUsers}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-base font-semibold text-ink shadow-sm transition hover:bg-field"
          >
            <RefreshCw className="h-4 w-4" />
            {syncingStripe ? 'Syncing Stripe...' : 'Refresh'}
          </button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Users" value={users.length} />
          <StatCard label="Dashboard access" value={stats.active} />
          <StatCard label="Stripe customers" value={stats.stripe} />
          <StatCard label="Manual overrides" value={stats.manual} />
        </div>

        <div className="mb-4 grid gap-2 rounded-lg border border-line bg-white p-2 shadow-panel sm:grid-cols-4">
          {ADMIN_MODULES.map((module) => {
            const Icon = module.icon;
            const active = activeModule === module.id;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => setActiveModule(module.id)}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-base font-semibold transition ${
                  active ? 'bg-ink text-white shadow-sm' : 'text-slate-600 hover:bg-field hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" />
                {module.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-base font-semibold text-red-700">
            {error}
          </div>
        )}

        {activeModule === 'users' && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-white p-3 shadow-panel sm:flex-row sm:items-center sm:justify-between">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 focus-within:border-slate-400">
              <Search className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none"
                placeholder="Search users, emails, Stripe IDs, or status"
              />
            </label>
            {stats.paymentIssues > 0 && (
              <span className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-base font-semibold text-orange-700">
                <Clock3 className="h-4 w-4" />
                {stats.paymentIssues} payment issue{stats.paymentIssues === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {activeModule === 'users' && (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(21rem,0.8fr)_minmax(28rem,1.2fr)]">
          <section className="order-2 rounded-lg border border-line bg-white shadow-panel lg:order-1">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-ink">Users</h2>
              <p className="text-base text-slate-500">{filteredUsers.length} shown of {users.length}</p>
            </div>

            <div className="space-y-3 border-b border-line p-3">
              <form onSubmit={handleCreateGroup} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={groupDraft}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line px-3 text-base text-ink outline-none focus:border-slate-400"
                  placeholder="Create group (e.g. VIP, Trial, Support)"
                />
                <button type="submit" className="h-10 rounded-md border border-line bg-field px-3 text-base font-semibold text-ink hover:bg-slate-100 sm:shrink-0">
                  Add group
                </button>
              </form>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-base text-ink outline-none focus:border-slate-400"
                >
                  <option value="all">All ({users.length})</option>
                  <option value={UNASSIGNED_GROUP_FILTER}>Not assigned ({unassignedCount})</option>
                  {groups.map((groupName) => (
                    <option key={groupName} value={groupName}>
                      {groupName} ({groupCounts[groupName] || 0})
                    </option>
                  ))}
                </select>
                {groupFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteGroup(groupFilter)}
                    className="h-10 rounded-md border border-line bg-white px-3 text-base font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[40vh] divide-y divide-line overflow-auto sm:max-h-[52vh] lg:max-h-[68vh]">
              {filteredUsers.map((user) => {
                const access = accessState(user);
                const isSelected = selectedUser?.uid === user.uid;
                const memberName = user.displayName || user.nickname || 'No name';
                const groupsForUser = groupAssignments[user.uid] || [];
                return (
                  <button
                    type="button"
                    key={user.uid}
                    onClick={() => setSelectedUid(user.uid)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${isSelected ? 'bg-slate-50/80' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-ink">{memberName}</h3>
                        <p className="truncate text-base text-slate-600">{user.email || '-'}</p>
                      </div>
                      <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold ring-1 ${access.tone}`}>
                        {access.label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {groupsForUser.length ? groupsForUser.map((group) => (
                        <span key={group} className="rounded-full border border-line bg-field px-2 py-0.5 text-sm text-slate-600">{group}</span>
                      )) : <span className="text-sm text-slate-400">No groups</span>}
                    </div>
                  </button>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="px-6 py-10 text-center text-base text-slate-500">No users match the current search.</div>
              )}
            </div>
          </section>

          <section className="order-1 rounded-lg border border-line bg-white p-3 shadow-panel sm:p-4 lg:order-2">
            {!selectedUser ? (
              <div className="py-20 text-center text-base text-slate-500">Select a user to view details.</div>
            ) : (() => {
              const user = selectedUser;
              const access = accessState(user);
              const hasEffectiveAccess = Boolean(user.hasAccess || user.isPlatformOwner);
              const isBusy = busyUid === user.uid;
              const inheritsStripe = user.inheritStripeStatus !== false;
              const trialDaysLeft = daysUntil(user.subscriptionTrialEnd);
              const memberName = user.displayName || user.nickname || 'No name';
              const statusText = normalizeStatus(user.subscriptionStatus);
              const renewLabel = user.subscriptionStatus === 'trialing' ? 'Trial ends' : 'Renews';
              const renewValue = user.subscriptionStatus === 'trialing'
                ? formatDate(user.subscriptionTrialEnd || user.subscriptionCurrentPeriodEnd)
                : formatDate(user.subscriptionCurrentPeriodEnd);
              const userGroups = groupAssignments[user.uid] || [];

              return (
                <div className="space-y-4">
                  <div className="border-b border-line pb-3">
                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-ink">{memberName}</h2>
                        <div className="break-all text-base text-slate-600">{user.email || '-'}</div>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-base font-semibold ring-1 ${access.tone}`}>
                        {hasEffectiveAccess ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {access.label}
                      </span>
                    </div>
                    <div className="mt-2 truncate rounded bg-slate-50 px-2 py-1 font-mono text-sm text-slate-400">{user.uid}</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-base font-semibold uppercase text-slate-500">Groups</div>
                    <div className="flex flex-wrap gap-2">
                      {groups.map((groupName) => {
                        const active = userGroups.includes(groupName);
                        return (
                          <button
                            key={groupName}
                            type="button"
                            onClick={() => handleToggleUserGroup(user.uid, groupName)}
                            className={`rounded-full border px-2.5 py-1 text-base font-semibold ${active ? 'border-signal/40 bg-signal/10 text-signal' : 'border-line bg-white text-slate-600 hover:bg-field'}`}
                          >
                            {groupName}
                          </button>
                        );
                      })}
                      {!groups.length && <span className="text-base text-slate-400">No groups created yet.</span>}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <section className="space-y-2">
                      <div className="text-base font-semibold uppercase text-slate-500">Access</div>
                      <InfoLine label="Source" value={user.accessSource || (user.hasAccess ? 'legacy' : 'none')} />
                      <InfoLine label="Manual" value={user.manualAccess ? 'on' : 'off'} />
                      <InfoLine label="Inherit Stripe" value={inheritsStripe ? 'yes' : 'no'} />
                    </section>
                    <section className="space-y-2">
                      <div className="text-base font-semibold uppercase text-slate-500">Dates</div>
                      <InfoLine label="Joined" value={formatDate(user.createdAt)} />
                      <InfoLine label={renewLabel} value={renewValue} />
                      <InfoLine label="Sub update" value={formatDateTime(user.subscriptionUpdatedAt)} />
                      <InfoLine label="Manual update" value={formatDateTime(user.manualAccessUpdatedAt)} />
                    </section>
                  </div>

                  <section className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-base font-semibold capitalize ring-1 ${stripeStatusClass(user.subscriptionStatus)}`}>
                        {statusText}
                      </span>
                      {user.subscriptionStatus === 'trialing' && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-base font-semibold text-emerald-700">
                          {trialDaysLeft != null ? `${trialDaysLeft}d trial` : 'trial'}
                        </span>
                      )}
                      {user.subscriptionCancelAtPeriodEnd && (
                        <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-base font-semibold text-orange-700">Cancels</span>
                      )}
                    </div>
                    <InfoLine label="Stripe access" value={user.subscriptionHasAccess ? 'yes' : 'no'} />
                    <InfoLine label="Trial used" value={user.stripeTrialUsed || user.subscriptionTrialStart ? 'yes' : 'no'} />
                    {user.stripeCustomerId ? (
                      <div className="space-y-1 rounded-md bg-slate-50 p-2">
                        <div className="truncate font-mono text-base text-slate-700">{user.stripeCustomerId}</div>
                        <div className="truncate font-mono text-sm text-slate-400">{user.stripeSubscriptionId || 'No subscription ID'}</div>
                        <div className="truncate font-mono text-sm text-slate-400">{user.stripePriceId || '-'}</div>
                      </div>
                    ) : (
                      <span className="text-base italic text-slate-400">No Stripe customer</span>
                    )}
                  </section>

                  <section className="space-y-2 border-t border-line pt-3">
                    {user.isPlatformOwner ? (
                      <span className="inline-flex rounded-md border border-line bg-field px-3 py-2 text-base font-semibold text-slate-400">Protected</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleStripeInheritance(user, !inheritsStripe)}
                          className={`inline-flex h-10 w-full items-center justify-between gap-3 rounded-md border px-3 text-base font-semibold transition disabled:cursor-wait disabled:opacity-70 ${
                            inheritsStripe
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-field'
                          }`}
                        >
                          <span>{isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Inherit Stripe'}</span>
                          <span className={`h-5 w-9 rounded-full p-0.5 transition ${inheritsStripe ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                            <span className={`block h-4 w-4 rounded-full bg-white transition ${inheritsStripe ? 'translate-x-4' : 'translate-x-0'}`} />
                          </span>
                        </button>
                        <div className="grid w-full grid-cols-3 gap-1 rounded-md border border-line bg-white p-1 sm:gap-0">
                          <button
                            type="button"
                            disabled={isBusy || !user.stripeCustomerId}
                            onClick={() => handleSyncStripeUser(user)}
                            className="inline-flex h-10 items-center justify-center gap-1 rounded px-1.5 text-sm font-semibold text-slate-700 transition hover:bg-field disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:px-2 sm:text-base"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Sync
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || user.manualAccess}
                            onClick={() => handleManualOverride(user, true)}
                            className="inline-flex h-10 items-center justify-center gap-1 rounded px-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:opacity-60 sm:px-2 sm:text-base"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
                            Allow
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || !user.manualAccess}
                            onClick={() => handleManualOverride(user, false)}
                            className="inline-flex h-10 items-center justify-center rounded px-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:px-2 sm:text-base"
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              );
            })()}
          </section>
        </div>
        )}

        {activeModule === 'data' && (
          <OverviewPanel title="Data Operations" description="Current Firestore slate shape, source freshness, and result queue signals from the dashboard data.">
            {matchDataError && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-700">{matchDataError}</div>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Leagues" value={dataSummary.leagues.length} />
              <StatCard label="Matches" value={matches.length} />
              <StatCard label="Finished" value={dataSummary.finished} />
              <StatCard label="Upcoming" value={dataSummary.upcoming} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <section className="rounded-md border border-line bg-field p-3 lg:col-span-2">
                <h3 className="text-base font-semibold text-ink">Result queue</h3>
                <div className="mt-3 space-y-2">
                  {dataSummary.dueRows.slice(0, 8).map((match) => (
                    <div key={`${match.id}-${match.home?.name}-${match.away?.name}`} className="rounded-md border border-line bg-white px-3 py-2 text-base">
                      <div className="font-semibold text-ink">{match.home?.name || 'Home'} vs {match.away?.name || 'Away'}</div>
                      <div className="mt-1 text-base text-slate-500">{match.league || '-'} · {match.date || '-'} {match.time || ''} · {match.result_queue || 'Queued'}</div>
                    </div>
                  ))}
                  {!dataSummary.dueRows.length && <EmptyState>No due result rows are exposed in the current dashboard payload.</EmptyState>}
                </div>
              </section>
              <section className="rounded-md border border-line bg-field p-3">
                <h3 className="text-base font-semibold text-ink">Data source</h3>
                <div className="mt-3 space-y-2 rounded-md border border-line bg-white p-3">
                  <InfoLine label="Source" value={matchData?.source || '-'} />
                  <InfoLine label="Captured" value={formatDateTime(matchData?.captured_at)} />
                  <InfoLine label="Date docs" value={dataSummary.dates.length} />
                  <InfoLine label="Status" value={matchDataLoading ? 'loading' : matchData ? 'ready' : 'not loaded'} />
                </div>
              </section>
            </div>
          </OverviewPanel>
        )}

        {activeModule === 'qa' && (
          <OverviewPanel title="Predictions QA" description="Settled market outcomes and weak cards that should be checked before trusting the slate.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['winner', 'Winner'],
                ['btts', 'BTTS'],
                ['ou_goals', 'Goals'],
                ['ou_cards', 'Cards'],
                ['ou_corners', 'Corners'],
              ].map(([key, label]) => {
                const row = qaSummary.totals[key];
                const settled = row.hit + row.miss;
                const rate = settled ? Math.round((row.hit / settled) * 100) : 0;
                return <StatCard key={key} label={label} value={settled ? `${rate}%` : '-'} sublabel={`${row.hit} hit / ${row.miss} miss`} />;
              })}
            </div>
            <div className="mt-4 rounded-md border border-line bg-field p-3">
              <h3 className="text-base font-semibold text-ink">Weak or cautious cards</h3>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {qaSummary.weakMatches.map((match) => (
                  <div key={`${match.id}-${match.home?.name}-${match.away?.name}`} className="rounded-md border border-line bg-white px-3 py-2 text-base">
                    <div className="font-semibold text-ink">{match.home?.name || 'Home'} vs {match.away?.name || 'Away'}</div>
                    <div className="mt-1 text-base text-slate-500">{match.league || '-'} · {match.date || '-'} · {confidenceLabel(match) || 'Caution'}</div>
                  </div>
                ))}
                {!qaSummary.weakMatches.length && <EmptyState>No weak cards found in the current loaded slate.</EmptyState>}
              </div>
            </div>
          </OverviewPanel>
        )}

        {activeModule === 'health' && (
          <OverviewPanel title="System Health" description="Operational snapshot for the admin console, dashboard Firestore payload, and admin-only sync surfaces.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Firestore data" value={healthSummary.fireStoreStatus} />
              <StatCard label="Source" value={healthSummary.source} />
              <StatCard label="Data age" value={healthSummary.hoursOld === null ? '-' : `${healthSummary.hoursOld}h`} />
              <StatCard label="Users loaded" value={users.length} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <section className="rounded-md border border-line bg-field p-3">
                <div className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Database className="h-4 w-4 text-signal" />
                  Dashboard payload
                </div>
                <div className="mt-3 rounded-md border border-line bg-white p-3">
                  <InfoLine label="Captured" value={formatDateTime(healthSummary.capturedAt)} />
                  <InfoLine label="Leagues" value={dataSummary.leagues.length} />
                  <InfoLine label="Dates" value={dataSummary.dates.length} />
                </div>
              </section>
              <section className="rounded-md border border-line bg-field p-3">
                <div className="flex items-center gap-2 text-base font-semibold text-ink">
                  <CreditCard className="h-4 w-4 text-signal" />
                  Stripe surface
                </div>
                <div className="mt-3 rounded-md border border-line bg-white p-3">
                  <InfoLine label="Customers" value={billingSummary.stripeUsers.length} />
                  <InfoLine label="Issues" value={billingSummary.paymentIssues.length} />
                  <InfoLine label="Syncing" value={syncingStripe ? 'yes' : 'no'} />
                </div>
              </section>
              <section className="rounded-md border border-line bg-field p-3">
                <div className="flex items-center gap-2 text-base font-semibold text-ink">
                  <CalendarClock className="h-4 w-4 text-signal" />
                  Next checks
                </div>
                <div className="mt-3 space-y-2">
                  {dataSummary.dueRows.slice(0, 3).map((match) => (
                    <div key={`${match.id}-${match.result_queue}`} className="rounded-md border border-line bg-white px-3 py-2 text-base font-semibold text-slate-600">
                      {match.result_queue || 'Queued'} · {match.home?.name || 'Home'} vs {match.away?.name || 'Away'}
                    </div>
                  ))}
                  {!dataSummary.dueRows.length && <EmptyState>No due checks in loaded payload.</EmptyState>}
                </div>
              </section>
            </div>
          </OverviewPanel>
        )}
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AdminDashboard />
    </AuthGate>
  );
}

