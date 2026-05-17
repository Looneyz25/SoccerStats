# Betting Analysis Agent System

Read this file first when a user asks for betting analysis, data collection, model improvement, dashboard work, or automation. Use it to decide which agents and skills are required for the prompt.

## Routing Workflow

1. Identify the prompt type.
2. Select the minimum set of agents from the routing matrix.
3. Give each agent only the files and decision needed for its role.
4. Combine outputs into one recommendation with confidence, evidence, and risk notes.
5. Do not present betting picks without data freshness, odds source, and uncertainty.

## Core Agent Roster

| Agent | Use When | Main Output |
| --- | --- | --- |
| Data Source Analyst | Endpoints, coverage, API failures, data gaps | Endpoint health and source priority |
| Fixture Collector | Upcoming fixtures, match status, schedule windows | Clean fixture list |
| Odds Collector | Sportsbet odds, market prices, line movement | Odds table and unmatched markets |
| Team Form Analyst | Recent form, injuries if available, standings, H2H | Team strength summary |
| Streak and Trends Analyst | Goals, cards, corners, BTTS, clean sheets | Trend signals with sample sizes |
| Prediction Modeler | Poisson/model logic, probabilities, calibration | Model probabilities and fair odds |
| Value Betting Analyst | Compare model probability to bookmaker odds | Value picks and edge estimate |
| Risk Manager | Bankroll, staking, correlation, exposure | Stake plan and risk flags |
| Results Settler | Final scores, actuals, hit/miss tracking | Settled results and accuracy update |
| Result Review Agent | Resulted matches, model learning, calibration review | Market/league feedback and model-review action |
| Model Calibration Agent | Automatic learning controls from result review | `model_calibration.json` trust and edge adjustments |
| Dashboard Product Agent | HTML/dashboard UX and data presentation | UI changes and display rules |
| Automation Operator | Daily batch, Git push, scheduled jobs, logs | Run status and failure handling |
| Compliance and Responsible Betting Reviewer | User-facing betting language and safety | Responsible betting review |

## Prompt Routing Matrix

| Prompt Contains | Required Agents | Optional Agents |
| --- | --- | --- |
| "run daily", "update data", "refresh" | Automation Operator, Data Source Analyst | Results Settler |
| "find endpoints", "why missing data", "API" | Data Source Analyst | Fixture Collector, Odds Collector |
| "today's picks", "best bets", "value" | Fixture Collector, Odds Collector, Team Form Analyst, Prediction Modeler, Value Betting Analyst, Risk Manager, Compliance Reviewer | Streak and Trends Analyst |
| "settle results", "accuracy", "what hit" | Results Settler, Data Source Analyst | Dashboard Product Agent |
| "improve model", "better predictions" | Prediction Modeler, Result Review Agent, Model Calibration Agent, Team Form Analyst, Streak and Trends Analyst, Results Settler | Value Betting Analyst |
| "review results", "resulted matches", "model feedback" | Result Review Agent, Model Calibration Agent, Results Settler, Prediction Modeler | Value Betting Analyst |
| "odds not matching", "Sportsbet", "markets" | Odds Collector, Data Source Analyst | Value Betting Analyst |
| "dashboard", "UI", "cards", "filters" | Dashboard Product Agent | Data Source Analyst |
| "schedule automation", "push to git" | Automation Operator | Data Source Analyst |

## Standard Analysis Pipeline

For betting picks, use this sequence:

1. Phase 1: Fixture collection. Data Source Analyst checks fixture endpoints, then Fixture Collector gathers listed-league fixtures and validates Adelaide-local dates.
2. Data Source Analyst confirms source freshness and missing fields.
3. Odds Collector gathers available prices and flags unmatched markets.
4. Team Form Analyst and Streak and Trends Analyst produce football context.
5. Prediction Modeler converts evidence into probabilities and fair odds.
6. Value Betting Analyst compares fair odds to market odds.
7. Risk Manager sizes stakes and removes correlated or low-confidence picks.
8. Compliance Reviewer checks wording and uncertainty.

## Phase Plan

| Phase | Name | Lead Agents | Output |
| --- | --- | --- | --- |
| 1 | Fixture Collection | Data Source Analyst, Fixture Collector | Validated fixture slate for listed leagues |
| 2 | Odds Collection | Odds Collector, Data Source Analyst | Matched market odds with source confidence |
| 3 | Team Context | Team Form Analyst, Streak and Trends Analyst | Form, standings, H2H, trend evidence |
| 4 | Prediction | Prediction Modeler | Probabilities and fair odds |
| 5 | Value and Risk | Value Betting Analyst, Risk Manager | Bet/lean/pass decisions and staking |
| 6 | Settlement | Results Settler, Data Source Analyst | Scores, actuals, hit/miss tracking |
| 7 | Result Review | Result Review Agent, Prediction Modeler | Model-feedback summary from settled matches |
| 8 | Model Calibration | Model Calibration Agent, Prediction Modeler | Conservative automatic-learning controls |
| 9 | Display and Automation | Dashboard Product Agent, Automation Operator | Published dashboard and run logs |

Phase specs:

- [Phase 1 Fixture Collection](PHASE_1_FIXTURES.md) — Flashscore-keyless fixtures, optional API-Football
- [Phase 2 Odds Collection](PHASE_2_ODDS.md) — Sportsbet AU WDW via smart-mimic session
- [Phase 3 Team Context](PHASE_3_TEAM_CONTEXT.md) — SofaScore form, streaks, recent H2H
- [Phase 4 Prediction](PHASE_4_PREDICTION.md) — Poisson grid + fair odds + edge vs market
- [Phase 5 Value & Risk](PHASE_5_VALUE_RISK.md) — fractional Kelly, per-bet + portfolio caps
- [Phase 6 Settlement](PHASE_6_SETTLEMENT.md) — Flashscore-driven settlement + persistent history
- Phase 7 Result Review — `scripts/soccer_result_review_agent.py` writes market/league model-feedback outputs
- Phase 8 Model Calibration — `scripts/soccer_model_calibration_agent.py` writes `model_calibration.json`
- [Phase 9 Display & Automation](PHASE_7_DISPLAY_AUTOMATION.md) — orchestrator + daily summary

Run the full pipeline with `python scripts/soccer_phases_routine.py`. Each phase writes its review outputs to `docs/agent-system/outputs/`; the result review agent writes CSV, Markdown, and summary JSON for the daily report.

Phase 1 must produce `docs/agent-system/outputs/Phase1_Fixture_Slate.xlsx` with these sheets: `Fixtures`, `Ready For Phase 2`, `Needs Settlement`, `Blocked Or Invalid`, `League Summary`, `Source Health`, and `Run Notes`.

## Decision Rules

- Prefer current local `match_data.json` for the app state, then dated `predictions_YYYY-MM-DD.json` snapshots for history.
- Hard truth rule: once a match is resulted, never amend its prediction pick, probabilities, factors, or model logic snapshot. Settlement may only add final scores, actuals, and hit/miss fields. Retro/post-result predictions must be excluded from hit-rate summaries.
- Official hit-rate tracking starts from `2026-04-24`; earlier resulted rows are dev-mode calibration history and should not drive public/model baseline rates.
- Use API-Football as the primary fixture/status/source-of-truth for Phase 1.
- Daily fixture collection should cover today plus the next 6 Adelaide-local days by default.
- Use Sportsbet as the only Phase 2 odds source until a second odds provider is deliberately added.
- Treat TheSportsDB and Flashscore as fallback score sources, not primary model inputs.
- Treat Understat xG as high-value enrichment when matched, but do not block analysis if unavailable.
- Never claim certainty. Use probability, fair odds, market odds, edge, and confidence.
- Separate model picks from value picks. A likely winner is not automatically a bet.
- The target model-review hit rate is 60% overall across the visible markets. Calibration should penalize markets, sides, or leagues below 60% once sample sizes are meaningful.
- For Winner, treat bookmaker odds as a model factor. When full home/draw/away prices are available, use no-vig bookmaker probabilities as a 40% blend with the internal model and store the blend weight/factors for later review.
- Draws need a separate decision lane. They do not need to be the highest raw probability if the match is tight: `p_draw >= 0.28`, home/away gap <= 0.15, and favourite-vs-draw gap <= 0.15.
- For two-way totals such as goals, cards, and corners, display the side with the stronger model probability. If the current side is below 50%, flip the recommendation to the opposite side on the same line and keep the weaker side as a caution signal. If only the opposite bookmaker price exists, label any inverse price as estimated. Completed-match hit rates and odds totals must use this same guided side.
- For Cards, recent resulted data showed Over 4.5 was over-picked. Require strong evidence for Over 4.5 (`over_probability >= 0.68`) and otherwise prefer Under 4.5 until calibration recovers.
- The dashboard headline hit rate should summarize stored settled prediction markets from `2026-04-24` onward, before later display-only guidance rewrites. Use the original prediction snapshot for public model performance.
- For winner markets, apply a conservative market guard: do not keep a model side when direct 1X2 bookmaker odds are heavily against it. A 25+ implied-probability-point disagreement or roughly 3x+ price ratio should guide the visible pick to the bookmaker favourite unless model support is overwhelming. Display and settle the guided winner side.
- Match-card display should place the original winner prediction and model percentage on the predicted team card, or on the centre draw chip for draw picks, and highlight that card by hit/miss. BTTS, goals, cards, and corners should remain compact one-row cards.

## Agent Definition Files

- [Data Source Analyst](agents/data-source-analyst.md)
- [Fixture Collector](agents/fixture-collector.md)
- [Odds Collector](agents/odds-collector.md)
- [Team Form Analyst](agents/team-form-analyst.md)
- [Streak and Trends Analyst](agents/streak-trends-analyst.md)
- [Prediction Modeler](agents/prediction-modeler.md)
- [Value Betting Analyst](agents/value-betting-analyst.md)
- [Risk Manager](agents/risk-manager.md)
- [Results Settler](agents/results-settler.md)
- [Result Review Agent](agents/result-review-agent.md)
- [Model Calibration Agent](agents/model-calibration-agent.md)
- [Dashboard Product Agent](agents/dashboard-product-agent.md)
- [Automation Operator](agents/automation-operator.md)
- [Compliance Reviewer](agents/compliance-reviewer.md)

## Skill Definition Files

- [Phase 1 Fixture Collection](PHASE_1_FIXTURES.md)
- [Endpoint Health Skill](skills/endpoint-health.md)
- [Fixture Normalization Skill](skills/fixture-normalization.md)
- [Odds Matching Skill](skills/odds-matching.md)
- [Prediction Calibration Skill](skills/prediction-calibration.md)
- [Result Review Calibration Skill](skills/result-review-calibration.md)
- [Model Auto Learning Skill](skills/model-auto-learning.md)
- [Value Detection Skill](skills/value-detection.md)
- [Bankroll Risk Skill](skills/bankroll-risk.md)
- [Settlement Audit Skill](skills/settlement-audit.md)
- [Dashboard QA Skill](skills/dashboard-qa.md)
