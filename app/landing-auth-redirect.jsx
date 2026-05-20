'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from './firebase';

export default function LandingAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    const auth = getFirebaseAuth();

    if (auth.currentUser) {
      router.replace('/dashboard');
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace('/dashboard');
      }
    });

    return () => unsubscribe();
  }, [router]);

  return null;
}

