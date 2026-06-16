import './globals.css';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import FirebaseAnalytics from './firebase-analytics';

const SITE_URL = 'https://lvrstats.com';
const SITE_NAME = 'LVRstats.com';
const SITE_DESCRIPTION = 'Football stats, odds, predictions, and model review dashboard for selected leagues.';
const SOCIAL_IMAGE = '/LVR-LOGO.png';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  keywords: [
    'LVRstats',
    'football stats',
    'soccer stats',
    'football predictions',
    'soccer predictions',
    'odds dashboard',
    'model review',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  category: 'sports',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/lvr-icon.svg',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'en_AU',
    type: 'website',
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 2172,
        height: 724,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
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
    <html lang="en" className={`dark ${plexSans.className} ${plexMono.variable}`}>
      <body>
        <FirebaseAnalytics />
        {children}
      </body>
    </html>
  );
}
