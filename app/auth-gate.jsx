'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { CreditCard, Loader2, LockKeyhole, LogIn, Mail, ShieldCheck, Clock } from 'lucide-react';
import { getFirebaseAuth, googleProvider } from './firebase';
import { getUserProfile, createUserProfile } from './firestore-data';

const AUTH_RETURN_PATH_KEY = 'looneyz-auth-return-path';
const AUTH_GOOGLE_PENDING_KEY = 'looneyz-google-sign-in-pending';

function currentReturnPath() {
  if (typeof window === 'undefined') return '/dashboard';
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || '/dashboard';
}

function rememberReturnPath() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, currentReturnPath());
}

function restoreReturnPath() {
  if (typeof window === 'undefined') return;
  const fallbackPath = '/dashboard';
  const savedPath = window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  if (!savedPath) return;
  const safePath = savedPath.startsWith('/') ? savedPath : fallbackPath;
  const current = currentReturnPath();

  const normalize = (p) => p.replace(/\/(\?|#|$)/, '$1');
  if (normalize(current).startsWith('/dashboard/') && normalize(safePath) === fallbackPath) return;
  if (normalize(safePath) !== normalize(current)) {
    window.location.replace(safePath);
  }
}

function authErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
    return 'Email or password is not right.';
  }
  if (code.includes('auth/user-not-found')) return 'No account found for that email.';
  if (code.includes('auth/email-already-in-use')) return 'That email already has an account.';
  if (code.includes('auth/weak-password')) return 'Use at least 6 characters for the password.';
  if (code.includes('auth/popup-closed-by-user')) return 'Google sign-in was closed before it finished.';
  if (code.includes('auth/popup-blocked')) return 'Popup was blocked. Redirecting to Google sign-in instead.';
  if (code.includes('auth/popup-redirect-cancelled')) return 'Google sign-in was interrupted. Try again.';
  if (code.includes('auth/operation-not-allowed')) {
    return 'This sign-in method is not enabled in Firebase Authentication yet.';
  }
  if (code.includes('auth/unauthorized-domain')) {
    return 'This domain is not authorized in Firebase Authentication.';
  }
  if (code.includes('auth/web-storage-unsupported')) {
    return 'This browser is blocking the storage Firebase needs for Google sign-in.';
  }
  if (code.includes('auth/network-request-failed')) {
    return 'Firebase Auth could not be reached from this browser.';
  }
  return error?.message || 'Sign-in failed. Try again.';
}

export default function AuthGate({ children }) {
  const auth = useMemo(() => getFirebaseAuth(), []);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let resolved = false;
    const fallback = window.setTimeout(() => {
      if (resolved) return;
      const currentUser = auth.currentUser;
      setUser(currentUser);
      if (!currentUser) {
        setReady(true);
        setMessage('Sign in to continue.');
      }
    }, 3500);

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      resolved = true;
      window.clearTimeout(fallback);
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setReady(true);
        setMessage('');
        setError('');
        setBusy(null);
      }
    });

    return () => {
      resolved = true;
      window.clearTimeout(fallback);
      unsubscribe();
    };
  }, [auth]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadProfile() {
      setCheckingAccess(true);
      try {
        let p = await getUserProfile(user.uid);
        if (!p) p = await createUserProfile(user);
        if (active) setProfile(p);
      } catch (e) {
        console.error('Profile load error:', e);
        if (active) setError(e.message || 'Failed to load profile.');
      } finally {
        if (active) {
          setCheckingAccess(false);
          setReady(true);
          restoreReturnPath();
        }
      }
    }
    loadProfile();
    return () => { active = false; };
  }, [user]);



  async function handleSubmit(event) {
    event.preventDefault();
    setBusy('email');
    setError('');
    setMessage('');
    rememberReturnPath();
    try {
      let credential;
      if (mode === 'create') {
        credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      setUser(credential.user);
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogleSignIn() {
    setBusy('google');
    setError('');
    setMessage('Opening Google sign-in...');
    rememberReturnPath();
    window.sessionStorage.setItem(AUTH_GOOGLE_PENDING_KEY, '1');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      window.sessionStorage.removeItem(AUTH_GOOGLE_PENDING_KEY);
      setUser(result.user);
    } catch (googleError) {
      window.sessionStorage.removeItem(AUTH_GOOGLE_PENDING_KEY);
      setError(authErrorMessage(googleError));
      setMessage('');
      setBusy(null);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError('Enter your email first, then reset the password.');
      return;
    }
    setBusy('reset');
    setError('');
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent.');
    } catch (resetError) {
      setError(authErrorMessage(resetError));
    } finally {
      setBusy(null);
    }
  }

  async function openStripeSession(endpoint, busyKey) {
    setBusy(busyKey);
    setError('');
    setMessage('Opening Stripe portal...');
    try {
      const token = await user.getIdToken();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Stripe session could not be created.');
      }
      window.location.assign(payload.url);
    } catch (stripeError) {
      setError(stripeError.message || 'Stripe could not be reached.');
      setMessage('');
      setBusy(null);
    }
  }

  if (!ready || checkingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-field px-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold text-ink shadow-panel">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
          {checkingAccess ? 'Verifying access...' : 'Checking session...'}
        </div>
      </main>
    );
  }

  if (!user) {
    const isCreateMode = mode === 'create';
    return (
      <main className="min-h-screen bg-field px-4 py-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
          <div className="mb-5">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-signal shadow-panel">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Lonny&apos;s Predictions</h1>
            <p className="mt-1 text-sm text-slate-600">
              Sign in to view the prediction dashboard and model review data.
            </p>
          </div>

          <section className="rounded-lg border border-line bg-white p-4 shadow-panel sm:p-5">
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-md bg-field p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('sign-in');
                  setError('');
                  setMessage('');
                }}
                className={`h-10 rounded-md text-sm font-semibold transition ${
                  !isCreateMode ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setError('');
                  setMessage('');
                }}
                className={`h-10 rounded-md text-sm font-semibold transition ${
                  isCreateMode ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'
                }`}
              >
                Create account
              </button>
            </div>

            <form className="space-y-3" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span>
                <span className="flex h-11 items-center gap-2 rounded-md border border-line bg-white px-3 focus-within:border-slate-400">
                  <Mail className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none"
                    placeholder="you@example.com"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</span>
                <span className="flex h-11 items-center gap-2 rounded-md border border-line bg-white px-3 focus-within:border-slate-400">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isCreateMode ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none"
                    placeholder="At least 6 characters"
                  />
                </span>
              </label>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={!!busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-panel transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
              >
                {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {isCreateMode ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={!!busy}
                className="inline-flex h-10 gap-2 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-field disabled:cursor-wait disabled:opacity-70"
              >
                {busy === 'google' && <Loader2 className="h-4 w-4 animate-spin" />}
                Continue with Google
              </button>
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={!!busy}
                className="inline-flex h-10 gap-2 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-field disabled:cursor-wait disabled:opacity-70"
              >
                {busy === 'reset' && <Loader2 className="h-4 w-4 animate-spin" />}
                Reset password
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const hasAccess = profile?.hasAccess || profile?.manualAccess || profile?.subscriptionHasAccess || profile?.isPlatformOwner;

  if (user && !hasAccess) {
    const subscriptionStatus = profile?.subscriptionStatus;
    const subscriptionNotice = subscriptionStatus && subscriptionStatus !== 'active'
      ? `Subscription status: ${subscriptionStatus}. Update payment to unlock the dashboard.`
      : 'Subscribe to Soccer Stats Pro to unlock the dashboard.';

    return (
      <main className="min-h-screen bg-field px-4 py-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
          <div className="mb-5 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600">
              <Clock className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Unlock Soccer Stats Pro</h1>
            <p className="mt-2 text-sm text-slate-600">
              {subscriptionNotice}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-white p-6 shadow-panel text-center">
            <p className="text-sm font-medium text-ink mb-4">
              Signed in as <span className="font-semibold text-signal">{user.email}</span>
            </p>
            <div className="mb-4 rounded-md border border-line bg-field px-3 py-3 text-left">
              <div className="text-sm font-semibold text-ink">A$19.99 / month</div>
              <div className="mt-1 text-xs text-slate-600">
                Full predictions, odds, H2H trends, saved access, and member-only dashboard data.
              </div>
            </div>
            {error && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-miss">
                {error}
              </div>
            )}
            {message && (
              <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-signal">
                {message}
              </div>
            )}
            <button
              type="button"
              onClick={() => openStripeSession('/api/stripe/create-portal', 'portal')}
              disabled={!!busy}
              className="mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-panel transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
            >
              {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Subscribe to Pro
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-field transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="min-w-0 truncate">
            Signed in as <span className="font-semibold text-ink">{user.email || user.displayName || 'user'}</span>
            {profile?.isPlatformOwner && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-signal/10 px-2 py-0.5 text-xs font-semibold text-signal">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-field"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
      {children}
    </>
  );
}
