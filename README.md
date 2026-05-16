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

- Product: `prod_UWtFiyWb2LoEy0`
- Price: `price_1TXpTJBbsFy1wAkF64nFdG26`

Subscription signup uses Stripe Checkout with the hardcoded price in `functions/index.js`. New subscriptions start with a 7-day free trial and no upfront payment required. Existing customers can manage billing through Stripe Customer Portal.

Create a Stripe webhook endpoint pointing to:

`https://lvrstats.com/api/stripe/webhook`

Listen for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Then add both Stripe secrets to Firebase and deploy:

```powershell
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY --project sports-predictions-f91fd
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET --project sports-predictions-f91fd
npm.cmd run deploy:firebase
```

The webhook updates `users/{uid}` with `hasAccess`, `accessSource`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, and renewal metadata. Active or trialing subscriptions unlock the dashboard automatically.

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

Fixture source order:

1. API-Football when `API_FOOTBALL_KEY` or `APISPORTS_KEY` is set
2. Flashscore keyless feed
3. TheSportsDB v1 free API using `THESPORTSDB_KEY`, `THESPORTSDB_API_KEY`, or the documented free key `123`
4. Local `match_data.json` fallback

## Legacy Files

- `Soccer_Stats_Dashboard.xlsx` - source workbook
- `PL_Matchday_*.xlsx` - matchday fixtures
- `PL_Round*_Preview_*.xlsx` - matchday previews
- `PL_Round*_Cards_*.xlsx` - match cards
- `PL_Predictions_vs_Outcomes.xlsx` - prediction accuracy tracker
- `Match_Card_Template.xlsx` - blank match card template
