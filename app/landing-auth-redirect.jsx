'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from './firebase';

export default function LandingAuthRedirect() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const fallback = window.setTimeout(() => setChecking(false), 2500);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      window.clearTimeout(fallback);
      if (user) {
        window.location.replace('/dashboard/');
        return;
      }
      setChecking(false);
    });

    return () => {
      window.clearTimeout(fallback);
      unsubscribe();
    };
  }, []);

  if (!checking) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-field px-4">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold text-ink shadow-panel">
        <Loader2 className="h-5 w-5 animate-spin text-signal" aria-hidden="true" />
        Checking session...
      </div>
    </div>
  );
}
