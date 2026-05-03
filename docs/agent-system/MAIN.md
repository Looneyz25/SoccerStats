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
| "improve model", "better predictions" | Prediction Modeler, Team Form Analyst, Streak and Trends Analyst, Results Settler | Value Betting Analyst |
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
| 7 | Display and Automation | Dashboard Product Agent, Automation Operator | Published dashboard and run logs |

Phase specs:

- [Phase 1 Fixture Collection](PHASE_1_FIXTURES.md) — Flashscore-keyless fixtures, optional API-Football
- [Phase 2 Odds Collection](PHASE_2_ODDS.md) — Sportsbet AU WDW via smart-mimic session
- [Phase 3 Team Context](PHASE_3_TEAM_CONTEXT.md) — SofaScore form, streaks, recent H2H
- [Phase 4 Prediction](PHASE_4_PREDICTION.md) — Poisson grid + fair odds + edge vs market
- [Phase 5 Value & Risk](PHASE_5_VALUE_RISK.md) — fractional Kelly, per-bet + portfolio caps
- [Phase 6 Settlement](PHASE_6_SETTLEMENT.md) — Flashscore-driven settlement + persistent history
- [Phase 7 Display & Automation](PHASE_7_DISPLAY_AUTOMATION.md) — orchestrator + daily summary

Run the full pipeline with `python scripts/soccer_phases_routine.py`. Each phase writes its own Excel workbook + CSV + Markdown to `docs/agent-system/outputs/`.

Phase 1 must produce `docs/agent-system/outputs/Phase1_Fixture_Slate.xlsx` with these sheets: `Fixtures`, `Ready For Phase 2`, `Needs Settlement`, `Blocked Or Invalid`, `League Summary`, `Source Health`, and `Run Notes`.

## Decision Rules

- Prefer current local `match_data.json` for the app state, then dated `predictions_YYYY-MM-DD.json` snapshots for history.
- Use API-Football as the primary fixture/status/source-of-truth for Phase 1.
- Use Sportsbet as the only Phase 2 odds source until a second odds provider is deliberately added.
- Treat TheSportsDB and Flashscore as fallback score sources, not primary model inputs.
- Treat Understat xG as high-value enrichment when matched, but do not block analysis if unavailable.
- Never claim certainty. Use probability, fair odds, market odds, edge, and confidence.
- Separate model picks from value picks. A likely winner is not automatically a bet.

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
- [Dashboard Product Agent](agents/dashboard-product-agent.md)
- [Automation Operator](agents/automation-operator.md)
- [Compliance Reviewer](agents/compliance-reviewer.md)

## Skill Definition Files

- [Phase 1 Fixture Collection](PHASE_1_FIXTURES.md)
- [Endpoint Health Skill](skills/endpoint-health.md)
- [Fixture Normalization Skill](skills/fixture-normalization.md)
- [Odds Matching Skill](skills/odds-matching.md)
- [Prediction Calibration Skill](skills/prediction-calibration.md)
- [Value Detection Skill](skills/value-detection.md)
- [Bankroll Risk Skill](skills/bankroll-risk.md)
- [Settlement Audit Skill](skills/settlement-audit.md)
- [Dashboard QA Skill](skills/dashboard-qa.md)
