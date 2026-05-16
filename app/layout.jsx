import './globals.css';
import { IBM_Plex_Sans } from 'next/font/google';
import FirebaseAnalytics from './firebase-analytics';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata = {
  title: 'Looneyz Predictions',
  description: 'Fixture, odds, and prediction dashboard for selected football leagues.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Looneyz',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111827',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={plexSans.className}>
      <body>
        <FirebaseAnalytics />
        {children}
      </body>
    </html>
  );
}
