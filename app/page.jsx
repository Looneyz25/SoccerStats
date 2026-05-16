import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  LineChart,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';

const metrics = [
  { label: 'Leagues tracked', value: '10' },
  { label: 'Review rows', value: '1,255' },
  { label: 'Learning checks', value: 'Daily' },
];

const features = [
  {
    icon: RefreshCw,
    title: 'Fresh match slate',
    copy: 'Fixtures, odds, predictions, and settlement files are refreshed by the daily routine.',
  },
  {
    icon: LineChart,
    title: 'Result review agent',
    copy: 'Finished matches feed back into review summaries so weak markets are visible fast.',
  },
  {
    icon: Database,
    title: 'Firebase data path',
    copy: 'The app reads Firestore first and keeps generated JSON as a static fallback.',
  },
  {
    icon: ShieldCheck,
    title: 'Private dashboard',
    copy: 'Firebase Authentication keeps the working prediction dashboard behind login.',
  },
];

function ProductPreview() {
  const rows = [
    ['Premier League', 'Arsenal', 'Chelsea', 'Home', '62%'],
    ['LaLiga', 'Real Madrid', 'Valencia', 'Over 2.5', '58%'],
    ['Bundesliga', 'Dortmund', 'Freiburg', 'BTTS', '61%'],
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] overflow-hidden sm:h-[70%] lg:inset-y-16 lg:left-auto lg:right-0 lg:h-auto lg:w-[58%]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(15,118,110,0.14),transparent_32%)]" />
      <div className="absolute bottom-[-5rem] right-[-5rem] w-[44rem] max-w-[115vw] rotate-[-3deg] rounded-lg border border-line bg-white/95 shadow-panel">
        <div className="border-b border-line px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live model desk</div>
              <div className="mt-1 text-xl font-semibold text-ink">Prediction slate</div>
            </div>
            <div className="rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">Today</div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-md border border-line bg-field px-3 py-2">
                <div className="text-xs text-slate-500">{metric.label}</div>
                <div className="mt-1 text-lg font-semibold text-ink">{metric.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 p-3">
          {rows.map((row) => (
            <div key={`${row[0]}-${row[1]}`} className="grid grid-cols-[7rem_1fr_1fr_5rem_4rem] items-center gap-2 rounded-md border border-line bg-white px-3 py-3 text-sm">
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{row[0]}</span>
              <span className="truncate font-semibold text-ink">{row[1]}</span>
              <span className="truncate font-semibold text-ink">{row[2]}</span>
              <span className="rounded bg-field px-2 py-1 text-center text-xs font-semibold text-signal">{row[3]}</span>
              <span className="text-right font-semibold text-ink">{row[4]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-field text-ink">
      <section className="relative min-h-[92vh] overflow-hidden border-b border-line bg-white">
        <ProductPreview />
        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white text-signal shadow-panel">
              <Target className="h-5 w-5" />
            </div>
            <span className="text-base font-semibold text-ink">Lonny&apos;s Predictions</span>
          </div>
          <Link
            href="/dashboard/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
          >
            <LockKeyhole className="h-4 w-4" />
            Sign in
          </Link>
        </header>

        <div className="relative z-10 mx-auto flex max-w-7xl px-4 pb-24 pt-14 sm:pt-24 lg:px-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-line bg-field px-3 py-2 text-sm font-semibold text-signal">
              <Activity className="h-4 w-4" />
              Stats-led football picks across Europe&apos;s top leagues
            </div>
            <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-tight text-ink sm:text-5xl lg:text-6xl">
              Lonny&apos;s Predictions
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              A private match dashboard for fixtures, odds, model picks, result review, and conservative learning from prediction outcomes.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard/"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-panel hover:bg-slate-800"
              >
                Open dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#system"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-5 text-sm font-semibold text-ink shadow-panel hover:bg-field"
              >
                View system
                <BarChart3 className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="system" className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-line bg-white p-4 shadow-panel">
            <feature.icon className="h-5 w-5 text-signal" />
            <h2 className="mt-4 text-base font-semibold text-ink">{feature.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{feature.copy}</p>
          </article>
        ))}
      </section>

      <section className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <h2 className="text-xl font-semibold text-ink">Ready for the current slate?</h2>
            <p className="mt-1 text-sm text-slate-600">Sign in to see matches, odds, reviews, and model calibration data.</p>
          </div>
          <Link
            href="/dashboard/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-panel hover:bg-slate-800"
          >
            Continue
            <CheckCircle2 className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
