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
} from 'lucide-react';

const metrics = [
  { label: 'Leagues tracked', value: '10' },
  { label: 'Review rows', value: '1,255' },
  { label: 'Learning checks', value: 'Daily' },
];

const GAMBLING_HELP_URL = 'https://www.gamblinghelponline.org.au/';
const BETSTOP_URL = 'https://www.betstop.gov.au/';

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
    <div className="relative mt-8 h-[20rem] overflow-hidden sm:h-[24rem] xl:pointer-events-none xl:absolute xl:inset-y-16 xl:left-auto xl:right-0 xl:mt-0 xl:h-auto xl:w-[58%]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(15,118,110,0.14),transparent_32%)]" />
      <div className="absolute bottom-[-2.5rem] left-3 right-3 rotate-[-2deg] rounded-lg border border-line bg-white/95 shadow-panel sm:left-auto sm:right-[-2rem] sm:w-[36rem] xl:bottom-[-5rem] xl:right-[-5rem] xl:w-[44rem] xl:max-w-[115vw] xl:rotate-[-3deg]">
        <div className="border-b border-line px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live model desk</div>
              <div className="mt-1 text-lg font-semibold text-ink sm:text-xl">Prediction slate</div>
            </div>
            <div className="shrink-0 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">Today</div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            <div key={`${row[0]}-${row[1]}`} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md border border-line bg-white px-3 py-3 text-sm sm:grid-cols-[7rem_1fr_1fr_5rem_4rem]">
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{row[0]}</span>
              <span className="hidden truncate font-semibold text-ink sm:block">{row[1]}</span>
              <span className="hidden truncate font-semibold text-ink sm:block">{row[2]}</span>
              <span className="hidden rounded bg-field px-2 py-1 text-center text-xs font-semibold text-signal sm:block">{row[3]}</span>
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
      <section className="relative overflow-hidden border-b border-line bg-white xl:min-h-[92vh]">
        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-end px-4 py-5 lg:px-8">
          <Link
            href="/dashboard/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel hover:bg-field"
          >
            <LockKeyhole className="h-4 w-4" />
            Sign in
          </Link>
        </header>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-4 pb-10 pt-8 sm:pt-16 lg:px-8 lg:pb-16 lg:pt-20 xl:block xl:pb-24 xl:pt-24">
          <div className="max-w-2xl xl:pb-24">
            <div className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-line bg-field px-3 py-2 text-sm font-semibold leading-5 text-signal">
              <Activity className="h-4 w-4 shrink-0" />
              <span className="min-w-0">Stats-led football picks across Europe&apos;s top leagues</span>
            </div>
            <h1 className="sr-only">Lonny&apos;s Predictions</h1>
            <img
              src="/LVR-LOGO.png"
              alt="LVRstats.com"
              className="mt-6 h-auto w-full max-w-[34rem] object-contain"
            />
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
          <ProductPreview />
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
        <div className="mx-auto max-w-7xl px-4 pb-8 lg:px-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <div className="font-semibold">Prediction information only. 18+</div>
            <p className="mt-1">
              Lonny&apos;s Predictions does not take bets, process wagering payments, or have bookmaker affiliation. External bookmaker links are handoffs only. Gamble responsibly.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <a href={GAMBLING_HELP_URL} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                Gambling Help Online
              </a>
              <span>1800 858 858</span>
              <a href={BETSTOP_URL} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                BetStop
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
