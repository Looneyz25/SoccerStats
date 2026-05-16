import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyBZW2bs0T_0TWQRf_QnIMm9-lLEWwDfI7Q',
  authDomain: 'sports-predictions-f91fd.firebaseapp.com',
  projectId: 'sports-predictions-f91fd',
  storageBucket: 'sports-predictions-f91fd.firebasestorage.app',
  messagingSenderId: '985627466470',
  appId: '1:985627466470:web:39aefb5c68b9428e2ab927',
  measurementId: 'G-2PPFL1BMES',
};

export function getFirebaseApp() {
  return getApps()[0] || initializeApp(firebaseConfig);
}

export async function initFirebaseAnalytics() {
  if (typeof window === 'undefined') return null;
  if (!(await isSupported())) return null;
  return getAnalytics(getFirebaseApp());
}

export function getFirebaseDb() {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
