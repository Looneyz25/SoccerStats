# Soccer Stats — Project Instructions

## Operator framing

You are in the top 0.1% of web development. Work to that bar every prompt: precise reasoning, clean diffs, no shortcuts, no filler. If a decision could be made by a merely competent engineer, you can do better — pick the option that holds up under scrutiny six months later.

### Working principles (apply every prompt)

1. **Clarify before you build.** If scope is ambiguous and the cost of a wrong guess is non-trivial, ask one targeted clarifying question instead of assuming. Cheap to ask, expensive to redo.
2. **Spar, don't glaze.** Push back on weak assumptions, surface blind spots, and name the missing data behind a request. Agreement that hides a flaw is worse than friction that exposes it.
3. **Plan before edit on non-trivial work.** State the approach in one or two sentences, then execute. For high-stakes or multi-file changes, narrate what you're about to touch so the user can stop you before a wrong rabbit hole.
4. **Minimal changes.** Reuse existing components, hooks, and utilities. No new dependencies, abstractions, files, or backwards-compat shims unless the task actually requires them. A bug fix is not a refactor; a one-off is not a helper.
5. **Propose durable memory updates.** When a session establishes a convention, constraint, or invariant worth keeping, suggest adding it to CLAUDE.md / AGENTS.md / memory before the learning evaporates.
6. **Repeat load-bearing constraints.** In long conversations, restate the core constraints in your own words so they stay top of context for both sides.
7. **Stay in scope.** Match the size of the change to what was actually requested. Don't expand work, don't pre-build for hypothetical future needs.

## Active app is Next.js + Tailwind

The frontend lives in [app/page.jsx](app/page.jsx) (App Router) with Tailwind styling. Make all UI changes there. The live Next.js dashboard reads Firestore from `dashboardData/match_data/leagues/*`; do not add a public JSON fallback for dashboard loading. The local `match_data.json` file is an auto-generated pipeline/upload artifact, not the browser data source. The legacy `index.html` static dashboard and its `DATA_SOCCER` splicer have been removed.

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

## Pipeline coverage rules

- Every upcoming match must carry predictions for all five markets: `winner`, `btts`, `ou_goals`, `ou_cards`, `corners`. The routine flags any match missing one or more (e.g. `missing btts,ou_goals,...: LaLiga Celta Vigo vs Sevilla`); these must be filled in, not skipped.
- If a market is missing because a feed is unavailable, fall back to the model-only prediction with sensible league defaults rather than leaving the slot empty. Bookmaker-odds gaps should only suppress the value/risk tile, never the model probability.
- Treat repeated missing-market warnings as a pipeline regression, not noise — investigate the upstream feed (`scripts/soccer_routine.py`, Phase 3/4) before re-running.

## Prediction display rules

- For two-way total markets such as goals, cards, and corners, guide the customer to the side with the stronger model probability. If the stored/displayed side is below 50%, flip the visible recommendation to the opposite side and treat the original side as a caution or conflict note.
- Do not make customers infer inverse markets from weak probabilities. A visible `Over 4.5` cards model at 44% should be shown as `Under 4.5` cards at 56% when the line is the same.
- Keep bookmaker odds tied to the exact visible side and line. If only the opposite-side price is available, an estimated inverse price may be shown, but it must be labelled as estimated and never treated as a direct bookmaker quote.
- Apply the same guided two-way total logic to completed matches, results review, hit-rate summaries, and odds hit/loss totals so settled cards/corners are scored against the visible guided side.
- For winner markets, do not promote a model lean against a major direct 1X2 market disagreement. If Sportsbet/direct bookmaker odds make another side a clear favourite by 25+ implied-probability points or roughly 3x+ price ratio, guide the visible winner to the bookmaker-backed side unless the model is genuinely overwhelming (about 60%+ with a large model gap). Rescore completed results from that guided side.
- On match cards, show the original winner prediction and model percentage on the predicted team card (or the centre draw chip), and highlight that card by hit/miss. Do not render a separate winner market tile. Keep BTTS, goals, cards, and corners as compact one-row market cards.

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
npm.cmd run data:refresh
```
`data:refresh` / `get:data` is the full slate builder. For scheduled result checks, use the minimal progress-aware path:
```
npm.cmd run get:data:results
```
The results path reads `docs/agent-system/outputs/routine_progress_latest.{md,json}` and `result_check_schedule_latest.md`. Every automation pass must read `docs/agent-system/outputs/routine_progress_latest.md` as step 1 and use it as the current stage marker before deciding anything else. After progress is read, check the schedule only to confirm timed `DUE @` rows. Each wrapper stage must update `routine_progress_latest.{md,json}` before it starts and after it completes, so the markdown always shows the live stage/status during long settlement, badge, upload, skip, and intervention steps. If a match is pending past expected finish, run only the results path; if that match is still pending after the result check, stop with `agent_intervention_required` before badge caching or Firestore upload so the agent can manually investigate or import the result. If no matches are pending past expected finish and the +6-day forecast is collected, the routine ends as a no-op. If the +6-day forecast is missing, run only `npm.cmd run get:data:topup` unless an agent check finds broken base data. The progress markdown must list latest / last day collected, +6 forecast coverage, pending/resulted counts, pending rows past expected finish, and tracked matches using only `pending` or `resulted`.

Use `npm.cmd run data:refresh:local` when Firestore credentials are not available. Do not add proxy/IP rotation to bypass provider controls; prefer API/fallback sources, caching, gentle sleeps, and backoff.

**Static Hosting fallback** (secondary, `out/` dir):
```
npm run build && npx firebase-tools deploy --only hosting --project sports-predictions-f91fd
```

**No-touch routine** (unattended; Task Scheduler job `SoccerStats NoTouch` runs it every 15 min):
```
run_notouch.bat
```
This is the unified controller — the older `Soccer Stats Data Refresh` (run_daily.bat) task is disabled in favour of it. It launches hidden via `scripts/run-hidden.vbs` (no console window) in the logged-on user session so desktop toasts can show. Stages: (1) `soccer_routine.py --live` updates in-play scores and settles on **confirmed** full time (SofaScore→LiveScore→Flashscore, never by due-time); (2) `npm.cmd run get:data:results` settles due matches, backfills cards/corners (retrying, never voiding), tops up the forecast, and uploads; (3) forecast safety net runs `get:data:topup` if the 7-day horizon is short; (4) fires `scripts/notify-toast.ps1` when a match is stuck `upcoming` past its expected finish. It self-skips in ~1s when idle. The controller filename must not contain `soccer_` — the overlap guard `scripts/soccer-active-workers.ps1` matches that token and would skip forever. Live tunables: `SOCCER_LIVE_LOOKBACK_HOURS` (6), `SOCCER_EARLY_FT_MINUTES` (100), `SOCCER_STUCK_UPCOMING_MINUTES` (150). The dashboard renders a `live` status (red LIVE badge + scoreline); the in-play data uploads regardless of whether the UI is deployed.

## Stripe Architecture

| Secret | Stored in | How injected |
|---|---|---|
| `STRIPE_SECRET_KEY` | Firebase Secret Manager | `secrets[]` in `onRequest` config |
| `STRIPE_WEBHOOK_SECRET` | Firebase Secret Manager | `secrets[]` in `onRequest` config |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `apphosting.yaml` | Build/runtime env var |
| `NEXT_PUBLIC_APP_URL` | `apphosting.yaml` | Build/runtime env var |

- Cloud Function URL: `https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi`
- LVRstats billing account: `acct_1TZ4PGEW2qO8xntT`. Keep this separate from the SupplyRobot Stripe account; do not reuse SupplyRobot product, price, secret, webhook, or publishable keys for LVRstats.
- Stripe Product ID: `STRIPE_PRO_PRODUCT_ID` in `.env` (Soccer Stats Pro, A$19.99/month)
- Stripe Price ID: `STRIPE_PRO_PRICE_ID` in `.env` for Checkout.
- Stripe customer IDs from the old shared/SupplyRobot account are legacy IDs. The Cloud Function archives an unusable customer ID to `legacyStripeCustomerId` / `legacyStripeCustomerIds` and creates a fresh customer in the LVRstats account on the next checkout.
- Checkout starts new subscriptions with a 7-day free trial and no upfront payment requirement.
- The free trial is one-time per Firebase user / Stripe customer; if `stripeTrialUsed` or prior Stripe trial history exists, Checkout does not attach another trial.
- Stripe webhooks and `/api/stripe/sync-subscription` both sync trialing/active/cancelled subscription status into Firestore.
- Trialing subscriptions show their trial end date; when Stripe cancels after a missing payment method or sends an inactive status, access is removed unless manual/admin access applies.
- Never hardcode Stripe keys in source. Add new public vars to `apphosting.yaml`, sensitive vars to Secret Manager.
