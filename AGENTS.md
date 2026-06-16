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

## Read order

Read [docs/agent-function-dependency-map.md](C:/Betting/Soccer%20Stats/docs/agent-function-dependency-map.md) first on every prompt. Use it as the dependency index for routine scripts, artifacts, Firestore paths, and dashboard data flow before going deeper into the codebase.

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
| Data pipeline / settlement / forecasts | [scripts/soccer_routine.py](scripts/soccer_routine.py), [scripts/verify_market_settlement.mjs](scripts/verify_market_settlement.mjs) |
| Match data source of truth | Firestore `dashboardData/match_data/leagues/*`; [match_data.json](match_data.json) is the local generated upload artifact |
| PWA assets | [public/](public/) (manifest, icons) |
| App Hosting env vars (public) | [apphosting.yaml](apphosting.yaml) |

## Prediction display rules

- Hard truth rule: once a match is resulted, do not amend its prediction pick, probabilities, factors, or model snapshot. Settlement may only add final scores, actuals, and hit/miss fields to predictions that already existed before the result. Retro/post-result predictions must not count toward hit-rate summaries.
- New leagues are first-class as soon as they are added to the fixture/league config. Do not leave them as fixture-only rows or dashboard shells. Run the exact normal routine: fetch fixtures, fetch/match odds, resolve team context with generic fallbacks, produce winner/BTTS/goals/cards/corners predictions, compute suggested pick/value/risk display fields, settle results, and upload the precomputed Firestore data. If league-specific history or calibration is thin, mark `Data weak` / caution notes, but still predict with the standard model defaults unless a source is genuinely blocked.
- Official hit-rate tracking starts from `2026-04-22`. Earlier resulted data was dev-mode calibration history and must stay out of public/model hit-rate baselines.
- For two-way total markets such as goals, cards, and corners, guide the customer to the side with the stronger model probability. If the stored/displayed side is below 50%, flip the visible recommendation to the opposite side and treat the original side as a caution or conflict note.
- Do not make customers infer inverse markets from weak probabilities. A visible `Over 4.5` cards model at 44% should be shown as `Under 4.5` cards at 56% when the line is the same.
- Corners are inherently noisy. Do not show normal pre-match corner totals as extreme-certainty picks. Generated and dashboard-visible corner model probabilities must be capped at `72%` unless we deliberately replace the corner model with a proven calibrated market-specific model. Internal recent-average context is not bookmaker-backed confidence.
- Keep bookmaker odds tied to the exact visible side and line. If only the opposite-side price is available, an estimated inverse price may be shown, but it must be labelled as estimated and never treated as a direct bookmaker quote.
- Apply the same guided two-way total logic to completed matches, results review, hit-rate summaries, and odds hit/loss totals so settled cards/corners are scored against the visible guided side.
- For winner markets, do not promote a model lean against a major direct 1X2 market disagreement. Only guide the visible winner to the bookmaker-backed side when the bookmaker side is a heavy favourite at 65%+ implied probability and the model is not genuinely overwhelming (about 60%+ with a large model gap). A 51% bookmaker favourite is not enough to override a raw model lean. Apply this before kickoff only; never rescore completed results from new guided-side logic.
- Future predictions should use the internal predictive profile before relying on external StatsHub/bet365 context. The profile is built from already stored FT rows: recent goals, shots on target, recent points, home/away venue split, rest days, corners, fouls, and cards. It may only adjust upcoming/future predictions; it must not rewrite `FT` or `prediction_locked` rows.
- League goal-profile dampening is allowed for future/upcoming rows when the result review shows a persistent league trend. Current low-goal profiles include J1 League and CONMEBOL Libertadores. These profiles may reduce BTTS Yes and Over 2.5 confidence, but must not rewrite settled predictions.
- On match cards, show the original winner prediction and model percentage on the predicted team card (or the centre draw chip), and highlight that card by hit/miss. Do not render a separate winner market tile. Keep BTTS, goals, cards, and corners as compact one-row market cards.
- Team logo badges are mandatory. Every match card must render a visible badge for both home and away teams on mobile and desktop; if a verified logo URL is missing or fails, keep the same badge shape and show the team initials fallback instead of removing the badge. Provider badge URLs are source inputs only: cache them into Firebase Storage before upload and store Firebase-owned badge fields in Firestore. Never synthesize a badge URL by mixing provider IDs. SofaScore, Sportsbet, API-Football, and StatsHub/bet365 team IDs are not interchangeable; wrong crests must be stripped before upload.
- Match cards must always render five market cards below the teams on mobile and desktop: one Suggested pick card, then BTTS, Goals, Cards, and Corners. If a market is missing, keep its card visible with `No pick` instead of hiding the card. This applies to every league, including Serie A.
- Hit result rows must use the global `.result-hit-row` treatment, which is `bg-emerald-200` with an emerald border. Do not introduce softer one-off hit row backgrounds like `bg-emerald-50` or `bg-emerald-100`; reserve those lighter greens for neutral success messages, selected controls, or small badges only.

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

`get:data` is the full slate builder and intentionally pulls the 7-day fixture window. For scheduled result checks, use the smaller progress-aware path:
```
npm.cmd run get:data:results
```
The results path writes and reads `docs/agent-system/outputs/routine_progress_latest.{md,json}` plus the result checklist in `docs/agent-system/outputs/result_check_schedule_latest.md`. It must do the minimal required work:
- Step 1 is always to read `docs/agent-system/outputs/routine_progress_latest.md` and use it as the stage marker before deciding anything else. It tells the agent whether the routine is waiting on pending results, already covered through +6 days, or needs only a light top-up.
- All Soccer Stats routine artifacts and Agent Review Gates must identify the routine agent as `codex 5.3`. Do not stamp routine progress/log output with `5.4` or any other model label unless the user explicitly changes this rule.
- At every Agent Review Gate, treat local horizon coverage as provisional until Firestore confirms it. If the agent is using `latestCollectedDate`, `requiredLatestDate`, or `hasSevenDayForecast` to claim coverage through Adelaide `today + 6`, it must verify that Firestore `dashboardData/match_data` plus the relevant league/date docs also contain the target horizon rows. Do not treat local `match_data.json` or progress artifacts alone as proof that +6 coverage is complete.
- After reading progress, compile the day's match queue from the current ledger/schedule before deciding due work. The queue should include every tracked match for the Adelaide day with league, teams, match date, kickoff/start time, SofaScore match id when available, current status, and derived score-check time. Only after this list exists should the routine filter to matches whose score-check time has passed.
- Only after reading progress should the routine inspect `docs/agent-system/outputs/result_check_schedule_latest.md` to confirm timed `DUE @` rows.
- Every wrapper stage must update `routine_progress_latest.{md,json}` before it starts and after it completes, including decision, settlement, review/calibration, badge caching, upload, skip, and intervention gates. The progress markdown must show the current stage label/status while a long stage is running.
- Every tracked match must include a match date, kickoff/start time, and score-check time derived as kickoff/start + 3 hours. Use that derived score-check time as the canonical expected finish / `DUE @` gate for score updates. If kickoff/start exists but the check time is missing, derive it before deciding whether results are due; if kickoff/start is missing or unreadable, stop and report agent intervention instead of guessing.
- Always update `routine_progress_latest.{md,json}` before and after every routine step, including repeated result attempts, artifact rereads, skip decisions, upload recovery, and intervention gates.
- If the progress ledger or schedule has pending matches past expected finish, run only the results path: apply manual imports, settle/backfill due results, run review/calibration, then reread progress/schedule. Repeat the results path for that day's due matches until they are updated to `resulted`, or stop with explicit `agent_intervention_required` rows when the source is blocked/unavailable. Publish only if the post-check progress ledger has no pending match still past expected finish.
- For due-result evidence, use SofaScore as primary and Sportsbet as the preferred fallback when SofaScore is blocked, stale, or missing a due result. Sportsbet has been reliable for result confirmation, but keep provider IDs isolated: use Sportsbet only as result evidence/fallback context and do not mix Sportsbet event IDs with SofaScore team or event IDs.
- If SofaScore/Sportsbet/Flashscore/LiveScore show a due fixture as postponed, cancelled, canceled, or abandoned, update the match to `postponed_or_cancelled`, lock the prediction snapshot, void unsettled prediction-market results, and treat the tracked row as no longer pending. A terminal void state must not block badge caching or Firestore upload.
- If a match remains pending past expected finish after `get:data:results`, the wrapper must stop with `agent_intervention_required` before badge caching or Firestore upload. The agent must manually investigate or import/fetch that result; do not let the routine silently publish over the unresolved row.
- Before any Firestore-uploading path reaches badge caching/upload, run the market settlement verification gate: `node scripts/verify_market_settlement.mjs`. This gate must check Adelaide today's `FT` matches, repair score-derived markets (`winner`, `BTTS`, `goals`) and stat-derived markets (`cards`, `corners`) when stored actual totals are present, then write `docs/agent-system/outputs/market_settlement_verification_latest.{md,json}`. If any required `FT` market still lacks `hit`, `miss`, `pass`, or `void`, stop before Firestore upload, update `routine_progress_latest.{md,json}` with `agent_intervention_required`, and carry forward the match, market, provider/source status, reason, and next action. Missing cards/corners actuals require provider actuals or a manual result import; do not invent stats.
- After any Firestore upload attempt, run a Firestore verification gate before reporting success. Verify that `dashboardData/match_data` and the relevant league/date docs contain the just-settled due matches with `status: FT`, final scores, and locked predictions. If the local `match_data.json` has a due result but Firestore still shows it as upcoming or missing, report upload verification failed and recover from the upload stage before calling the routine complete.
- The Firestore verification gate must also verify market settlement for the day in Firestore. For every `FT` match in the Adelaide day date doc, required visible markets (`winner`, `BTTS`, `goals`, `cards`, `corners`, plus present suggested/DNB/double-chance markets) must have a settled result of `hit`, `miss`, `pass`, or `void`. If Firestore still contains an unsettled market after upload, report upload verification failed and recover from the settlement/upload stage before calling the routine complete.
- The same Firestore gate applies to forecast completeness. Before any stage says the slate is collected through Adelaide `today + 6`, verify Firestore also contains the target-horizon rows for that day. If Firestore has not been checked yet, mark forecast coverage as `pending_firestore_verification` in progress and do not use local-only coverage to justify a clean skip.
- If the progress ledger shows the +6-day forecast is collected, still inspect `result_check_schedule_latest.md` and recompute due matches before skipping. Complete forecast coverage only skips top-up/full refresh; the routine ends as a no-op only after confirming there are no pending matches past expected finish and no `DUE @` / score-check rows due now.
- If there are no overdue pending matches but the +6-day forecast is not collected, run only the light top-up path, not full `get:data`, unless an agent check finds broken base data.
- The progress markdown must show the latest / last day of data collected, whether +6 forecast coverage is present, the Firestore verification status for that +6 claim, pending/resulted counts, pending rows past expected finish, and the tracked match list with only `pending` or `resulted` statuses.

Use the explicit top-up path when you want the light prediction horizon refresh without running the full phase pipeline:
```
npm.cmd run get:data:topup
```

Use source-specific enrichment paths when only one provider lane needs updating after the core slate exists:
```
npm.cmd run get:data:sportsbet
npm.cmd run get:data:bet365
```
`get:data:sportsbet` refreshes Sportsbet 1X2/deep markets, visible prediction odds, badges, and Firestore upload without rebuilding the full fixture slate. `get:data:bet365` is intentionally cache-first: it merges a local `docs/agent-system/inputs/bet365_context.json` or `statshub_context.json` into future unlocked matches, then caches badges and uploads. Do not turn bet365 into a high-frequency scraper; use it as conservative context/fallback data.

Use `npm.cmd run data:refresh:local` when Firestore credentials are not available. Do not add proxy/IP rotation to bypass provider controls; prefer API/fallback sources, caching, gentle sleeps, and backoff.

**Prompt shortcut** — when the user says `get data`, `update data`, `refresh data`, `get latest data`, or similar, treat it as a request to run the full Firestore publish path from `C:\Betting\Soccer Stats`:
```
npm.cmd run get:data
```
Then report whether Firestore upload succeeded. Do not stage, commit, push, or deploy for a data-only refresh unless the user explicitly asks. If credentials are missing, tell the user to place the service account at `.secrets/firebase-service-account.json` and run again; do not ask customers or browser clients to write Firestore data.

**Result-run failure handling** — after `get:data:results`, do not trust a stale `get_data_latest.md` if the wrapper timed out. Re-read `result_check_schedule_latest.md`, inspect live processes matching `soccer_routine|soccer_|get-data-with-log|upload_match_data|cache_badges|run-python.js`, and check whether `match_data.json` was updated. If settlement/review finished but Firestore upload stalls in `upload_match_data_to_firestore.mjs`, stop only the stuck routine/upload processes, then rerun `node scripts/upload_match_data_to_firestore.mjs`. The uploader must use REST-backed small batch commits with retry; avoid returning to BulkWriter/gRPC for this path unless it has been proven stable again. After fallback upload, report that the generated result data was published and note the original wrapper timeout.

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
- LVRstats billing account: `acct_1TZ4PGEW2qO8xntT`. Keep this separate from the SupplyRobot Stripe account; do not reuse SupplyRobot product, price, secret, webhook, or publishable keys for LVRstats.
- Stripe Product ID: `STRIPE_PRO_PRODUCT_ID` in `.env` (Soccer Stats Pro, A$19.99/month)
- Stripe Price ID: `STRIPE_PRO_PRICE_ID` is used by the Firebase Cloud Function for Checkout line items. Do not put it in `apphosting.yaml`, do not add it as an App Hosting console override, and do not expose it to the browser. The frontend must call the API/Cloud Function and redirect to the returned Stripe Checkout URL.
- Stripe customer IDs from the old shared/SupplyRobot account are legacy IDs. The Cloud Function archives an unusable customer ID to `legacyStripeCustomerId` / `legacyStripeCustomerIds` and creates a fresh customer in the LVRstats account on the next checkout.
- App Hosting environment name should stay simple and stable, normally `prod`. Keep public frontend values in `apphosting.yaml`; use manual App Hosting console environment variable overrides only for a temporary emergency override that will be copied back into source afterward.
- Checkout starts new subscriptions with a 7-day free trial and no upfront payment requirement.
- The free trial is one-time per Firebase user / Stripe customer; if `stripeTrialUsed` or prior Stripe trial history exists, Checkout does not attach another trial.
- Stripe webhooks and `/api/stripe/sync-subscription` both sync trialing/active/cancelled subscription status into Firestore.
- Trialing subscriptions show their trial end date; when Stripe cancels after a missing payment method or sends an inactive status, access is removed unless manual/admin access applies.
- Never hardcode Stripe keys in source. Add new public vars to `apphosting.yaml`, sensitive vars to Secret Manager.
