'use client';

import { useEffect } from 'react';
import { initFirebaseAnalytics } from './firebase';

export default function FirebaseAnalytics() {
  useEffect(() => {
    initFirebaseAnalytics().catch(() => {
      // Analytics should never block the dashboard.
    });
  }, []);

  return null;
}
