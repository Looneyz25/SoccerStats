import './globals.css';
import { IBM_Plex_Sans } from 'next/font/google';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata = {
  title: 'Looneyz Predictions',
  description: 'Fixture, odds, and prediction dashboard for selected football leagues.',
  manifest: '/manifest.webmanifest',
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
      <body>{children}</body>
    </html>
  );
}
