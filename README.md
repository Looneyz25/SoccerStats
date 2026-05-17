# SoccerStats

Soccer stats, fixture, odds, and prediction dashboard.

## Live Site

The dashboard is configured for Firebase Hosting under project:

`sports-predictions-f91fd`

Firebase Hosting serves the static Next.js export from `out/`. Stripe subscription endpoints run through Firebase Functions and are exposed behind `/api/stripe/*` by the Hosting rewrites.

## Frontend

- `app/` - Next.js dashboard
- `public/data/` - generated static JSON data, created during build
- `next.config.js` - static export config
- `firebase.json` - Firebase Hosting, Firestore rules, and Functions rewrite config
- `firestore.rules` - public read rules for dashboard data
- `.firebaserc` - Firebase project mapping
- `app/firebase.js` / `app/firebase-analytics.jsx` / `app/auth-gate.jsx` - Firebase app, Analytics, and Auth gate
- `functions/index.js` - Stripe Checkout, billing portal, and webhook listener

Build locally:

```powershell
npm.cmd install --cache .\.npm-cache
npm.cmd run build --cache .\.npm-cache
```

Refresh live match data and publish it to Firestore:

```powershell
npm.cmd run data:refresh
```

This runs `scripts/soccer_routine.py`, runs the phase pipeline for fixtures, odds, team context/stats, predictions, settlement, and calibration, refreshes the static JSON fallback in `public/data/`, then uploads `match_data.json` to Firestore at `dashboardData/match_data`.

To collect locally without Firestore credentials:

```powershell
npm.cmd run data:refresh:local
```

Firestore upload requires one credential source in the shell:

- `FIREBASE_SERVICE_ACCOUNT_JSON` containing the service account JSON string
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON file
- or a local service-account file at `.secrets/firebase-service-account.json`

Firestore writes are admin-only. Browser users can read subscribed dashboard data, but Firestore rules keep `dashboardData` writes disabled for all client users.

Do not use proxy/IP rotation to bypass provider controls. The local routines prefer API/fallback sources, cache existing data, and use gentle sleeps/backoff. You can slow Sportsbet collection further with `SOCCER_PHASE2_SLEEP` and cap odds enrichment with `SOCCER_ODDS_BUDGET`.

Deploy to Firebase Hosting, Firestore rules, and Functions:

```powershell
npm.cmd run deploy:firebase
```

This app is a static Next.js export served by classic Firebase Hosting from `out/`. Stripe uses Firebase Functions rather than Next.js API routes so the static export remains deployable.

Preview locally with Firebase Hosting emulator:

```powershell
npm.cmd run firebase:serve
```

## Authentication

The dashboard is protected by Firebase Authentication. The login page supports email/password accounts, password reset, and Google sign-in.

Enable providers in Firebase Console before testing sign-in:

1. Open Authentication > Sign-in method.
2. Enable Email/Password.
3. Enable Google if you want the Google button active.
4. Confirm authorized domains include `localhost` and `sports-predictions-f91fd.web.app`.

## Stripe Subscription

The single paid tier is `Soccer Stats Pro` at `A$19.99/month`.

Stripe objects created for this app:

- Product: `STRIPE_PRO_PRODUCT_ID` in `.env`
- Price: `STRIPE_PRO_PRICE_ID` in `.env`

Subscription signup uses Stripe Checkout with `STRIPE_PRO_PRICE_ID`. Each Stripe customer/Firebase user gets only one 7-day free trial with no upfront payment required. If a user cancels and subscribes again after using a trial, Checkout starts a normal paid subscription without another trial. Existing customers can manage billing through Stripe Customer Portal. When the trial ends, Stripe charges the saved payment method; if no payment method is attached, the subscription is cancelled and webhook sync removes dashboard access.

Create a Stripe webhook endpoint pointing to:

`https://lvrstats.com/api/stripe/webhook`

Listen for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

The app also calls `/api/stripe/sync-subscription` after Checkout returns with `?checkout=success`, so trial access updates immediately even if the webhook is still processing.

Then add both Stripe secrets to Firebase and deploy:

```powershell
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY --project sports-predictions-f91fd
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET --project sports-predictions-f91fd
npm.cmd run deploy:firebase
```

The webhook updates `users/{uid}` with `hasAccess`, `accessSource`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, trial dates, and renewal metadata. Active or trialing subscriptions unlock the dashboard automatically.

## Data Pipeline

- `scripts/soccer_phase1_fixtures.py` - Phase 1 fixture slate and Excel handoff
- `scripts/soccer_routine.py` - daily data routine
- `scripts/soccer_result_review_agent.py` - daily resulted-match review for model feedback
- `scripts/soccer_model_calibration_agent.py` - turns review feedback into conservative automatic-learning controls
- `scripts/upload_match_data_to_firestore.mjs` - uploads dashboard data into Firestore chunks
- `scripts/soccer_prepare_next_data.py` - copies JSON into `public/data/` for the static frontend
- `match_data.json` - local generated fallback data
- `predictions_*.json` - dated snapshots

The live app reads Firestore first from `dashboardData/match_data`, then falls back to generated JSON files when Firestore is unavailable.

Scheduled daily runs use `run_daily.bat`, which runs the routine, uploads to Firestore, and then commits/pushes data changes.

Fixture source order:

1. API-Football when `API_FOOTBALL_KEY` or `APISPORTS_KEY` is set
2. Flashscore keyless feed
3. TheSportsDB v1 free API using `THESPORTSDB_KEY`, `THESPORTSDB_API_KEY`, or the documented free key `123`
4. Local `match_data.json` fallback

## Prediction Display Rules

- For two-way totals such as goals, cards, and corners, show the side with the stronger model probability.
- If a displayed total side is below 50%, flip the visible recommendation to the opposite side on the same line. Example: `Over 4.5 cards` at 44% should display as `Under 4.5 cards` at 56%.
- Only show bookmaker odds as direct prices when they belong to the exact visible side and line. If the UI derives an inverse price from the opposite side, label it as estimated.
- Completed-match summaries and hit-rate reviews must score two-way totals against the guided visible side, not the weaker raw side.
- The dashboard headline hit rate is the settled market hit rate across all visible guided markets, not winner-only accuracy.
- Winner picks use a market guard: when a model winner is below 50% or only narrowly ahead and the bookmaker favourite is clearly stronger with supporting context, the visible pick should switch to the bookmaker-backed side and completed results should be scored from that guided winner.
- Match cards show the original winner prediction and model percentage directly on the predicted team card, or on the centre draw chip for draw picks. The highlighted card reflects the winner prediction hit/miss; BTTS, goals, cards, and corners stay as compact one-row market cards.

## Legacy Files

- `Soccer_Stats_Dashboard.xlsx` - source workbook
- `PL_Matchday_*.xlsx` - matchday fixtures
- `PL_Round*_Preview_*.xlsx` - matchday previews
- `PL_Round*_Cards_*.xlsx` - match cards
- `PL_Predictions_vs_Outcomes.xlsx` - prediction accuracy tracker
- `Match_Card_Template.xlsx` - blank match card template
