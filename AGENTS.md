# Soccer Stats — Project Instructions

## Active app is Next.js + Tailwind

The frontend lives in [app/page.jsx](app/page.jsx) (App Router) with Tailwind styling. Make all UI changes there. The live Next.js dashboard reads Firestore from `dashboardData/match_data/leagues/*`; do not add a public JSON fallback for dashboard loading. The local `match_data.json` file is an auto-generated pipeline/upload artifact, not the browser data source. The legacy `index.html` static dashboard and its `DATA_SOCCER` splicer have been removed.

## Local dev verification

After every app/UI edit, refresh or verify the local dev loop before handing work back:
```
npm.cmd run dev:clean
npm.cmd run dev
npm.cmd run dev:health
```

If the dev server is already intentionally running and hot reload is enough, still run:
```
npm.cmd run dev:health
```

Port `3001` is the expected local dashboard port. If startup fails with `EADDRINUSE`, identify the process on port `3001`; if it is the stale Soccer Stats Next.js server, clear it with `npm.cmd run dev:clean` and then restart dev.

## Where to make changes

| Task | File / area |
|---|---|
| UI / layout / styles | [app/page.jsx](app/page.jsx), [app/globals.css](app/globals.css), [app/layout.jsx](app/layout.jsx) |
| Auth / subscription gate | [app/auth-gate.jsx](app/auth-gate.jsx) |
| Stripe backend logic | [functions/index.js](functions/index.js) |
| Stripe API proxy routes | [app/api/stripe/](app/api/stripe/) |
| Data pipeline / settlement / forecasts | [scripts/soccer_routine.py](scripts/soccer_routine.py) |
| Match data source of truth | Firestore `dashboardData/match_data/leagues/*`; [match_data.json](match_data.json) is the local generated upload artifact |
| PWA assets | [public/](public/) (manifest, icons) |
| App Hosting env vars (public) | [apphosting.yaml](apphosting.yaml) |

## Prediction display rules

- Hard truth rule: once a match is resulted, do not amend its prediction pick, probabilities, factors, or model snapshot. Settlement may only add final scores, actuals, and hit/miss fields to predictions that already existed before the result. Retro/post-result predictions must not count toward hit-rate summaries.
- Official hit-rate tracking starts from `2026-04-22`. Earlier resulted data was dev-mode calibration history and must stay out of public/model hit-rate baselines.
- For two-way total markets such as goals, cards, and corners, guide the customer to the side with the stronger model probability. If the stored/displayed side is below 50%, flip the visible recommendation to the opposite side and treat the original side as a caution or conflict note.
- Do not make customers infer inverse markets from weak probabilities. A visible `Over 4.5` cards model at 44% should be shown as `Under 4.5` cards at 56% when the line is the same.
- Keep bookmaker odds tied to the exact visible side and line. If only the opposite-side price is available, an estimated inverse price may be shown, but it must be labelled as estimated and never treated as a direct bookmaker quote.
- Apply the same guided two-way total logic to completed matches, results review, hit-rate summaries, and odds hit/loss totals so settled cards/corners are scored against the visible guided side.
- For winner markets, do not promote a model lean against a major direct 1X2 market disagreement. If Sportsbet/direct bookmaker odds make another side a clear favourite by 25+ implied-probability points or roughly 3x+ price ratio, guide the visible winner to the bookmaker-backed side unless the model is genuinely overwhelming (about 60%+ with a large model gap). Apply this before kickoff only; never rescore completed results from new guided-side logic.
- On match cards, show the original winner prediction and model percentage on the predicted team card (or the centre draw chip), and highlight that card by hit/miss. Do not render a separate winner market tile. Keep BTTS, goals, cards, and corners as compact one-row market cards.
- Match cards must always render five market cards below the teams on mobile and desktop: one Suggested pick card, then BTTS, Goals, Cards, and Corners. If a market is missing, keep its card visible with `No pick` instead of hiding the card. This applies to every league, including Serie A.

## Deploy

**Live site uses Firebase App Hosting** — deploys automatically on `git push origin main`.
- `apphosting.yaml` injects `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` at build/runtime.
- The Next.js API routes under `app/api/stripe/` proxy to the Cloud Function.
- Do NOT use `firebase deploy --only hosting` for the primary site (that targets static Hosting, not App Hosting).

**Cloud Functions** — deploy manually when `functions/index.js` changes:
```
npx firebase-tools deploy --only functions --project sports-predictions-f91fd
```

**Match data refresh** — run the routine and upload `match_data.json` to Firestore:
```
npm.cmd run get:data
```
This is a data-only operation. It must not commit, push, run a production build, or deploy; live customers receive the new data because the app reads Firestore only.

`get:data` is the full slate builder and intentionally pulls the 7-day fixture window. For scheduled result checks, use the smaller time-aware path:
```
npm.cmd run get:data:results
```
The results path keeps a shrinking result checklist in `docs/agent-system/outputs/result_check_schedule_latest.md`, checks only unresolved matches whose kickoff time plus the completion buffer has passed, settles/backfills finished matches, prunes stale unresolved matches outside the result lookback window, runs result review/calibration, and uploads Firestore. When today/overdue matches remaining reaches zero, it seeds day+1 once instead of pulling the full 7-day window again.

Use `npm.cmd run data:refresh:local` when Firestore credentials are not available. Do not add proxy/IP rotation to bypass provider controls; prefer API/fallback sources, caching, gentle sleeps, and backoff.

**Prompt shortcut** — when the user says `get data`, `update data`, `refresh data`, `get latest data`, or similar, treat it as a request to run the full Firestore publish path from `C:\Betting\Soccer Stats`:
```
npm.cmd run get:data
```
Then report whether Firestore upload succeeded. Do not stage, commit, push, or deploy for a data-only refresh unless the user explicitly asks. If credentials are missing, tell the user to place the service account at `.secrets/firebase-service-account.json` and run again; do not ask customers or browser clients to write Firestore data.

**Static Hosting fallback** (secondary, `out/` dir):
```
npm run build && npx firebase-tools deploy --only hosting --project sports-predictions-f91fd
```

## Stripe Architecture

| Secret | Stored in | How injected |
|---|---|---|
| `STRIPE_SECRET_KEY` | Firebase Secret Manager | `secrets[]` in `onRequest` config |
| `STRIPE_WEBHOOK_SECRET` | Firebase Secret Manager | `secrets[]` in `onRequest` config |
| `STRIPE_PRO_PRICE_ID` | Firebase Secret Manager | `secrets[]` in `onRequest` config |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `apphosting.yaml` | Build/runtime env var |
| `NEXT_PUBLIC_APP_URL` | `apphosting.yaml` | Build/runtime env var |

- Cloud Function URL: `https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi`
- Stripe Product ID: `STRIPE_PRO_PRODUCT_ID` in `.env` (Soccer Stats Pro, A$19.99/month)
- Stripe Price ID: `STRIPE_PRO_PRICE_ID` is used by the Firebase Cloud Function for Checkout line items. Do not put it in `apphosting.yaml`, do not add it as an App Hosting console override, and do not expose it to the browser. The frontend must call the API/Cloud Function and redirect to the returned Stripe Checkout URL.
- App Hosting environment name should stay simple and stable, normally `prod`. Keep public frontend values in `apphosting.yaml`; use manual App Hosting console environment variable overrides only for a temporary emergency override that will be copied back into source afterward.
- Checkout starts new subscriptions with a 7-day free trial and no upfront payment requirement.
- The free trial is one-time per Firebase user / Stripe customer; if `stripeTrialUsed` or prior Stripe trial history exists, Checkout does not attach another trial.
- Stripe webhooks and `/api/stripe/sync-subscription` both sync trialing/active/cancelled subscription status into Firestore.
- Trialing subscriptions show their trial end date; when Stripe cancels after a missing payment method or sends an inactive status, access is removed unless manual/admin access applies.
- Never hardcode Stripe keys in source. Add new public vars to `apphosting.yaml`, sensitive vars to Secret Manager.
