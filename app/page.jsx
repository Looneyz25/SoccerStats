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
    <main
      className="min-h-screen text-slate-100"
      style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(52,214,200,0.08) 0%, transparent 70%), linear-gradient(180deg, #0d111a 0%, #0f1319 100%)',
      }}
    >
      <LandingAuthRedirect />

      {/* Hero */}
      <section className="relative min-h-[92vh] overflow-hidden">
        {/* top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#34d6c8]/60 to-transparent" aria-hidden="true" />

        <div className="relative mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-4">
            {/* Brand mark */}
            <span className="text-2xl font-black tracking-tight sm:text-3xl">
              <span className="text-white">LVR</span>
              <span className="text-[#34d6c8]">stats</span>
              <span className="text-slate-500 text-lg font-semibold">.com</span>
            </span>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 shadow-sm backdrop-blur transition hover:border-white/30 hover:bg-white/10"
            >
              Sign in
            </Link>
          </header>

          <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)]">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#34d6c8]">
                Football predictions with market context
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-7xl">
                Know the pick before you open the bookmaker.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
                LVRstats brings form, H2H, odds, confidence, and result review into one match card so you can decide faster.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard?auth=create"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-[#34d6c8] px-6 text-sm font-bold text-[#0d111a] shadow-lg shadow-[#34d6c8]/20 transition hover:bg-[#2bc4b8]"
                >
                  Start free trial
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/15 bg-white/5 px-6 text-sm font-semibold text-slate-200 backdrop-blur transition hover:border-white/30 hover:bg-white/10"
                >
                  View login
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">7-day trial</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">A$19.99/month</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Responsible gambling only</span>
              </div>
            </div>

            {/* Preview card */}
            <div
              className="rounded-xl border border-white/10 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
              style={{ background: 'linear-gradient(135deg, #1b1f26 0%, #15181d 100%)' }}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Today</div>
                  <div className="mt-1 text-lg font-bold text-white">Prediction slate</div>
                </div>
                <div className="rounded-md bg-[#34d6c8]/15 px-3 py-2 text-sm font-bold text-[#34d6c8]">Live</div>
              </div>
              <div className="mt-4 space-y-3">
                {marketRows.map(([match, market, pick]) => (
                  <div key={match} className="rounded-lg border border-white/8 bg-white/5 p-3">
                    <div className="text-sm font-bold text-white">{match}</div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{market}</span>
                      <span className="rounded-md bg-[#34d6c8] px-3 py-1.5 text-sm font-bold text-[#0d111a]">{pick}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/8">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-10 sm:px-8 md:grid-cols-3 lg:px-10">
          {featureRows.map(([title, body]) => (
            <article
              key={title}
              className="rounded-xl border border-white/10 p-5"
              style={{ background: 'linear-gradient(135deg, #1b1f26 0%, #15181d 100%)' }}
            >
              <h2 className="text-base font-bold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
