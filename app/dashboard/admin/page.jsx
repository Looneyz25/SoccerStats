'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthGate from '../../auth-gate';
import { getAllUsers, getUserProfile, updateUserManualAccess, updateUserStripeInheritance } from '../../firestore-data';
import { getFirebaseAuth } from '../../firebase';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
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

function AdminDashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyUid, setBusyUid] = useState('');
  const [query, setQuery] = useState('');
  const router = useRouter();

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

      const usersList = await getAllUsers();
      setUsers(usersList);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => {
      return [
        user.displayName,
        user.email,
        user.uid,
        user.stripeCustomerId,
        user.stripeSubscriptionId,
        user.subscriptionStatus,
        user.accessSource,
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [query, users]);

  const stats = useMemo(() => {
    return users.reduce((acc, user) => {
      if (user.hasAccess || user.isPlatformOwner) acc.active += 1;
      if (user.manualAccess) acc.manual += 1;
      if (user.stripeCustomerId) acc.stripe += 1;
      if (user.subscriptionStatus === 'past_due' || user.subscriptionStatus === 'unpaid') acc.paymentIssues += 1;
      return acc;
    }, { active: 0, manual: 0, stripe: 0, paymentIssues: 0 });
  }, [users]);

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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-field px-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold text-ink shadow-panel">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
          Loading admin dashboard...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-field px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard" className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Back to Dashboard
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
              <ShieldCheck className="h-6 w-6 text-signal" />
              Admin Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review members, subscription state, and manual access overrides.
            </p>
          </div>

          <button
            type="button"
            onClick={loadUsers}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-field"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-white p-3 shadow-panel">
            <div className="text-xs font-semibold uppercase text-slate-500">Users</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{users.length}</div>
          </div>
          <div className="rounded-lg border border-line bg-white p-3 shadow-panel">
            <div className="text-xs font-semibold uppercase text-slate-500">Dashboard Access</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{stats.active}</div>
          </div>
          <div className="rounded-lg border border-line bg-white p-3 shadow-panel">
            <div className="text-xs font-semibold uppercase text-slate-500">Stripe Customers</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{stats.stripe}</div>
          </div>
          <div className="rounded-lg border border-line bg-white p-3 shadow-panel">
            <div className="text-xs font-semibold uppercase text-slate-500">Manual Overrides</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{stats.manual}</div>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-white p-3 shadow-panel sm:flex-row sm:items-center sm:justify-between">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 focus-within:border-slate-400">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none"
              placeholder="Search users, emails, Stripe IDs, or status"
            />
          </label>
          {stats.paymentIssues > 0 && (
            <span className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700">
              <Clock3 className="h-4 w-4" />
              {stats.paymentIssues} payment issue{stats.paymentIssues === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
          <div className="overflow-x-auto">
            <table className="min-w-[1280px] divide-y divide-line">
              <thead className="bg-field">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Member</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Access</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Stripe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Subscription</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Dates</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Access Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {filteredUsers.map((user) => {
                  const access = accessState(user);
                  const hasEffectiveAccess = Boolean(user.hasAccess || user.isPlatformOwner);
                  const isBusy = busyUid === user.uid;
                  const inheritsStripe = user.inheritStripeStatus !== false;

                  return (
                    <tr key={user.uid} className="align-top">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-ink">{user.displayName || 'No name'}</div>
                        <div className="mt-0.5 text-sm text-slate-600">{user.email || '-'}</div>
                        <div className="mt-1 max-w-[260px] truncate font-mono text-xs text-slate-400">{user.uid}</div>
                        {user.isPlatformOwner && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-signal/10 px-2 py-0.5 text-xs font-semibold text-signal">
                            <ShieldCheck className="h-3 w-3" /> Owner
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${access.tone}`}>
                            {hasEffectiveAccess ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {access.label}
                          </span>
                          <div className="text-xs text-slate-500">
                            Source: <span className="font-semibold text-slate-700">{user.accessSource || (user.hasAccess ? 'legacy' : 'none')}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Manual: <span className="font-semibold text-slate-700">{user.manualAccess ? 'on' : 'off'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {user.stripeCustomerId ? (
                          <div className="space-y-1">
                            <div className="font-mono text-xs text-slate-700">{user.stripeCustomerId}</div>
                            <div className="max-w-[230px] truncate font-mono text-xs text-slate-400">
                              {user.stripeSubscriptionId || 'No subscription ID'}
                            </div>
                            <div className="font-mono text-xs text-slate-400">{user.stripePriceId || '-'}</div>
                          </div>
                        ) : (
                          <span className="text-sm italic text-slate-400">No Stripe customer</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-2">
                          <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${stripeStatusClass(user.subscriptionStatus)}`}>
                            {normalizeStatus(user.subscriptionStatus)}
                          </span>
                          <div className="text-xs text-slate-500">
                            Stripe access: <span className="font-semibold text-slate-700">{user.subscriptionHasAccess ? 'yes' : 'no'}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Inherits Stripe: <span className="font-semibold text-slate-700">{inheritsStripe ? 'yes' : 'no'}</span>
                          </div>
                          {user.subscriptionCancelAtPeriodEnd && (
                            <div className="text-xs font-semibold text-orange-700">Cancels at period end</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        <div>Joined: <span className="font-medium text-ink">{formatDate(user.createdAt)}</span></div>
                        <div className="mt-1">Renews: <span className="font-medium text-ink">{formatDate(user.subscriptionCurrentPeriodEnd)}</span></div>
                        <div className="mt-1">Sub update: <span className="font-medium text-ink">{formatDateTime(user.subscriptionUpdatedAt)}</span></div>
                        <div className="mt-1">Manual update: <span className="font-medium text-ink">{formatDateTime(user.manualAccessUpdatedAt)}</span></div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {user.isPlatformOwner ? (
                          <span className="text-sm font-semibold text-slate-400">Protected</span>
                        ) : (
                          <div className="flex flex-col items-end gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleStripeInheritance(user, !inheritsStripe)}
                              className={`inline-flex h-9 min-w-[150px] items-center justify-between gap-3 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-70 ${
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
                            <div className="inline-flex rounded-md border border-line bg-white p-1">
                              <button
                                type="button"
                                disabled={isBusy || user.manualAccess}
                                onClick={() => handleManualOverride(user, true)}
                                className="inline-flex h-9 items-center gap-2 rounded px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:opacity-60"
                              >
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
                                Allow
                              </button>
                              <button
                                type="button"
                                disabled={isBusy || !user.manualAccess}
                                onClick={() => handleManualOverride(user, false)}
                                className="inline-flex h-9 items-center gap-2 rounded px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-6 py-10 text-center text-sm text-slate-500">
                      No users match the current search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
