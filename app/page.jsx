import Link from 'next/link';
import LandingAuthRedirect from './landing-auth-redirect';

const featureRows = [
  ['Model picks', 'Winner, BTTS, goals, cards, and corners in one scan.'],
  ['Bookmaker check', 'Compare model confidence against market prices before you click out.'],
  ['Result review', 'See what hit, what missed, and where the model is improving.'],
];

const marketRows = [
  ['Arsenal v Burnley', 'Suggested pick', 'Arsenal win'],
  ['Inter Miami v Portland', 'Goals', 'Over 2.5'],
  ['Nashville v LAFC', 'BTTS', 'Yes'],
];

export const metadata = {
  title: 'LVRstats | Football prediction dashboard',
  description: 'Football predictions, bookmaker checks, H2H trends, and model review before you sign up.',
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f9fb] text-slate-950">
      <LandingAuthRedirect />
      <section className="relative min-h-[92vh] overflow-hidden bg-white">
        <div className="absolute inset-x-0 top-0 h-1 bg-emerald-600" aria-hidden="true" />
        <div className="relative mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-4">
            <img src="/LVR-LOGO.png" alt="LVRstats.com" className="h-12 w-auto object-contain sm:h-14" />
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 shadow-sm transition hover:border-slate-400"
            >
              Sign in
            </Link>
          </header>

          <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)]">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Football predictions with market context</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.02] tracking-normal text-slate-950 sm:text-6xl lg:text-7xl">
                Know the pick before you open the bookmaker.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
                LVRstats brings form, H2H, odds, confidence, and result review into one match card so you can decide faster.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard?auth=create"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-slate-950 px-6 text-sm font-semibold text-white shadow-panel transition hover:bg-slate-800"
                >
                  Start free trial
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-950 shadow-panel transition hover:border-slate-400"
                >
                  View login
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                <span className="rounded-full border border-slate-300 bg-white px-3 py-2">7-day trial</span>
                <span className="rounded-full border border-slate-300 bg-white px-3 py-2">A$19.99/month</span>
                <span className="rounded-full border border-slate-300 bg-white px-3 py-2">Responsible gambling only</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white/95 p-4 shadow-panel">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Today</div>
                  <div className="mt-1 text-lg font-bold text-slate-950">Prediction slate</div>
                </div>
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">Live</div>
              </div>
              <div className="mt-4 space-y-3">
                {marketRows.map(([match, market, pick]) => (
                  <div key={match} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-bold text-slate-950">{match}</div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{market}</span>
                      <span className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-bold text-white">{pick}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-10 sm:px-8 md:grid-cols-3 lg:px-10">
          {featureRows.map(([title, body]) => (
            <article key={title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
