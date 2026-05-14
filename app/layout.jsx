import './globals.css';

export const metadata = {
  title: 'Soccer Stats',
  description: 'Fixture, odds, and prediction dashboard for selected football leagues.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
