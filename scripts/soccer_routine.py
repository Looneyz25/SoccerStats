#!/usr/bin/env python3
"""Master orchestrator for the Soccer Stats daily routine.

Runs the full pipeline against a fixed 10-tournament whitelist:
- Phase 0:   strict tournament-ID validation + Adelaide-local re-date + dedupe + prune
- Phase A:   settle pending matches (only if SofaScore confirms `status.type == "finished"`)
- Phase A.5: backfill finished-but-untracked matches + enrich every FT record
             (odds + h2h_streaks + team_streaks + actuals)
- Phase A.6: lock resulted matches so newer model logic cannot rewrite them
- Phase B:   forecast new upcoming matches over the fixture horizon
- Phase B.5: attach sportsbet.com.au Win-Draw-Win odds (90-min regular)
- Phase B.6: attach SofaScore market odds to each streak entry
- Phase B.7: attach odds to each prediction (sportsbet first, SofaScore fallback)
- Phase C:   write match_data.json, dated predictions snapshot + markdown report

DOES NOT touch git. Commits and pushes are manual — there is no auto-push job.

Usage:
    python3 scripts/soccer_routine.py
    python3 scripts/soccer_routine.py --results-only
"""
import argparse
import csv
import difflib
import json, math, random, re, subprocess, sys, time, unicodedata
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# --- Anti-throttle helpers ---
# Rotate impersonation profiles + jittered sleeps so we look like organic
# traffic instead of a single bot pattern. Helps avoid Cloudflare IP blocks.
_PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]
def _profile():
    return random.choice(_PROFILES)
def _gentle_sleep(base=0.5, jitter=0.5):
    time.sleep(base + random.random() * jitter)

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        # Windows ships no IANA data; fall back to fixed ACST offset.
        # User can pip install tzdata for DST-aware behaviour.
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

import random
from curl_cffi import requests
from team_aliases import NATIONAL_TEAM_ALIASES

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

# ----------------------------------------------------------------------------
ROOT  = Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"
ELO_STORE = ROOT / "team_elo.json"
SCRIPTS = ROOT / "scripts"
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
MODEL_CALIBRATION = ROOT / "docs" / "agent-system" / "outputs" / "model_calibration.json"
PHASE1_FIXTURE_SLATE = OUT_DIR / "phase1_fixture_slate_current.csv"
PHASE2_ODDS_SLATE = OUT_DIR / "phase2_odds_slate_current.csv"
PHASE_FIXTURE_FALLBACK_LEAGUES = {"Allsvenskan", "Eliteserien", "International Friendly Games"}
YOUTH_TEAM_RE = re.compile(r"\b(?:u|under\s*)(?:17|18|19|20|21|23)\b", re.I)
BOOKMAKER_MATCH_ID_PREFIXES = ("sportsbet:", "ladbrokes:", "neds:", "tab:", "bet365:")

# --- Model tuning constants ---------------------------------------------------
# Dixon-Coles (1997) low-score correction. Negative rho lifts 0-0 and 1-1
# probabilities while reducing 1-0 / 0-1, matching the empirical excess of
# draws in low-scoring fixtures. Published fits on European football typically
# land between -0.18 and -0.05; -0.10 is the canonical default used in most
# tutorials (Dashee, Opisthokonta, penaltyblog) and falls in the middle of
# the empirical range.
DIXON_COLES_RHO = -0.10

# Football Elo. K=20 matches the eloratings.net "ordinary match" weight and
# the Opisthokonta tuning study (best K ~= 19.5). HOME_ADV=50 is at the
# conservative end of the 50-100 range published for club football and lines
# up with the +0.20 home lambda boost already in the predictor (we don't want
# to double-count home advantage by piling a 100-point Elo gap on top of it).
ELO_INIT = 1500.0
ELO_K = 20.0
ELO_HOME_ADV = 50.0
# 400 Elo points ~= 1 goal of lambda swing. Capped at +/-0.4 to match the
# previous rank/pts table_adj magnitude so behaviour stays in the same range.
ELO_LAMBDA_SCALE = 400.0
ELO_LAMBDA_CAP = 0.4
BTTS_YES_THRESHOLD = 0.56
WINNER_BOOKMAKER_BLEND = 0.40
DRAW_MIN_PROBABILITY = 0.28
DRAW_MAX_HOME_AWAY_GAP = 0.15
DRAW_MAX_FAVOURITE_GAP = 0.15
CARDS_OVER_THRESHOLD = 0.68
DEFAULT_PREMATCH_TEAM_GOALS = 1.35
DEFAULT_PREMATCH_CORNERS_TOTAL = 10.2
CORNER_MODEL_PROBABILITY_CAP = 0.72
NO_SPORTSBET_CORNER_PROBABILITY_CAP = 0.55
BOOKMAKER_CONTEXT_LAMBDA_CAP = 0.25
BOOKMAKER_CONTEXT_BTTS_WEIGHT = 0.20
BOOKMAKER_CONTEXT_CARDS_WEIGHT = 0.25
INTERNAL_PROFILE_LAMBDA_CAP = 0.18
LEAGUE_GOAL_PROFILES = {
    "J1 League": {
        "over25_scale": 0.82,
        "over25_cap": 0.68,
        "btts_yes_scale": 0.88,
        "btts_yes_cap": 0.64,
        "reason": "J1 League low-goal profile: recent review showed over-goals confidence running too hot.",
    },
    "CONMEBOL Libertadores": {
        "over25_scale": 0.78,
        "over25_cap": 0.62,
        "btts_yes_scale": 0.75,
        "btts_yes_cap": 0.58,
        "reason": "CONMEBOL Libertadores low-goal profile: recent settled matches strongly favour Under 2.5 and BTTS No.",
    },
}
TODAY     = datetime.now(ADL).date()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW  = TODAY + timedelta(days=1)
FIXTURE_LOOKAHEAD_DAYS = max(1, int(os.environ.get("SOCCER_FIXTURE_DAYS", "7")))
RESULT_CHECK_BUFFER_MINUTES = max(180, int(os.environ.get("SOCCER_RESULT_BUFFER_MINUTES", "180")))
RESULT_LOOKBACK_DAYS = max(1, int(os.environ.get("SOCCER_RESULT_LOOKBACK_DAYS", "3")))
TOP_UP_TARGETED = os.environ.get("SOCCER_TOP_UP_TARGETED") == "1"


def fixture_target_dates():
    configured = [
        item.strip()
        for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(",")
        if item.strip()
    ]
    if configured:
        valid = []
        for item in configured:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
                valid.append(item)
        return sorted(set(valid))
    return [(TODAY + timedelta(days=i)).isoformat() for i in range(FIXTURE_LOOKAHEAD_DAYS)]


def fixture_target_date_range():
    dates = fixture_target_dates()
    if not dates:
        start = TODAY
        return start, start, 1
    start = date.fromisoformat(dates[0])
    end = date.fromisoformat(dates[-1])
    return start, end, max(1, (end - start).days + 1)

TOURNAMENTS = {
    7:   "UEFA Champions League",
    679: "UEFA Europa League",
    17:  "Premier League",
    8:   "LaLiga",
    35:  "Bundesliga",
    23:  "Serie A",
    34:  "Ligue 1",
    17015: "UEFA Conference League",
    325: "Brasileirão Betano",
    384: "CONMEBOL Libertadores",
    136: "A-League Men",
    16:  "FIFA World Cup",
    10:  "International Friendly Games",
    851: "International Friendly Games",
    37:  "Eredivisie",
    238: "Primeira Liga",
    242: "MLS",
    36:  "Scottish Premiership",
    196: "J1 League",
    18:  "Championship",
    24:  "League One",
    25:  "League Two",
    40:  "Allsvenskan",
    20:  "Eliteserien",
}
ORDER = ["UEFA Champions League","UEFA Europa League","Premier League","LaLiga",
         "Bundesliga","Serie A","Ligue 1","UEFA Conference League",
         "Brasileirão Betano","CONMEBOL Libertadores","A-League Men","FIFA World Cup",
         "International Friendly Games","Eredivisie","Primeira Liga","MLS",
         "Scottish Premiership","J1 League","Championship","League One","League Two",
         "Allsvenskan","Eliteserien"]


def load_model_calibration():
    if not MODEL_CALIBRATION.exists():
        return {}
    try:
        return json.loads(MODEL_CALIBRATION.read_text(encoding="utf-8"))
    except Exception:
        return {}


_MODEL_CALIBRATION = load_model_calibration()


def calibration_adjustment(league, market_key):
    if not _MODEL_CALIBRATION:
        return {"trust_factor": 1.0, "min_edge_delta": 0.0, "sources": []}
    sources = []
    trust = 1.0
    edge_delta = 0.0
    market = (_MODEL_CALIBRATION.get("market_adjustments") or {}).get(market_key)
    if market:
        trust *= float(market.get("trust_factor") or 1.0)
        edge_delta = max(edge_delta, float(market.get("min_edge_delta") or 0.0))
        sources.append(market.get("reason") or f"{market_key} market adjustment")
    league_market = (_MODEL_CALIBRATION.get("league_market_adjustments") or {}).get(f"{league}|{market_key}")
    if league_market:
        trust *= float(league_market.get("trust_factor") or 1.0)
        edge_delta = max(edge_delta, float(league_market.get("min_edge_delta") or 0.0))
        sources.append(league_market.get("reason") or f"{league} {market_key} adjustment")
    return {
        "trust_factor": round(max(0.65, min(1.0, trust)), 4),
        "min_edge_delta": round(edge_delta, 4),
        "sources": sources,
    }


def shrink_probability(probability, trust_factor, neutral):
    return neutral + ((probability - neutral) * trust_factor)


def league_goal_profile_adjustment(league, p_over_25, p_btts_yes):
    profile = LEAGUE_GOAL_PROFILES.get(league)
    if not profile:
        return p_over_25, p_btts_yes, None
    adjusted_over = p_over_25
    adjusted_btts = p_btts_yes
    if adjusted_over is not None:
        adjusted_over = max(0.0, min(1.0, adjusted_over * profile.get("over25_scale", 1.0)))
        adjusted_over = min(adjusted_over, profile.get("over25_cap", 1.0))
    if adjusted_btts is not None:
        adjusted_btts = max(0.0, min(1.0, adjusted_btts * profile.get("btts_yes_scale", 1.0)))
        adjusted_btts = min(adjusted_btts, profile.get("btts_yes_cap", 1.0))
    return adjusted_over, adjusted_btts, {
        "league": league,
        "over25_scale": profile.get("over25_scale", 1.0),
        "over25_cap": profile.get("over25_cap", 1.0),
        "btts_yes_scale": profile.get("btts_yes_scale", 1.0),
        "btts_yes_cap": profile.get("btts_yes_cap", 1.0),
        "reason": profile.get("reason", "League goal profile adjustment."),
    }


def normalize_three_way(home, draw, away):
    total = home + draw + away
    if total <= 0:
        return 1 / 3, 1 / 3, 1 / 3
    return home / total, draw / total, away / total


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def bookmaker_three_way_probabilities(odds):
    """Return no-vig 1X2 probabilities from decimal odds when available."""
    if not odds:
        return None
    home = to_float(odds.get("home"))
    draw = to_float(odds.get("draw"))
    away = to_float(odds.get("away"))
    if not (home and draw and away) or min(home, draw, away) <= 1.01:
        return None
    raw_home, raw_draw, raw_away = 1 / home, 1 / draw, 1 / away
    home_p, draw_p, away_p = normalize_three_way(raw_home, raw_draw, raw_away)
    return {"home": home_p, "draw": draw_p, "away": away_p}


def blend_three_way_with_bookmaker(model_probs, odds, weight=WINNER_BOOKMAKER_BLEND):
    market = bookmaker_three_way_probabilities(odds)
    if not market:
        return model_probs, None
    blended = {
        side: (model_probs[side] * (1 - weight)) + (market[side] * weight)
        for side in ("home", "draw", "away")
    }
    home, draw, away = normalize_three_way(blended["home"], blended["draw"], blended["away"])
    return {"home": home, "draw": draw, "away": away}, market


def choose_winner_side(probabilities):
    home = probabilities["home"]
    draw = probabilities["draw"]
    away = probabilities["away"]
    favourite = max(home, away)
    if (
        draw >= DRAW_MIN_PROBABILITY
        and abs(home - away) <= DRAW_MAX_HOME_AWAY_GAP
        and favourite - draw <= DRAW_MAX_FAVOURITE_GAP
    ):
        return "draw"
    if home >= max(draw, away):
        return "home"
    if away >= draw:
        return "away"
    return "draw"


# ----------------------------------------------------------------------------
def fetch(path, retries=2):
    last = None
    for i in range(retries + 1):
        try:
            r = requests.get(f"https://api.sofascore.com{path}", impersonate=_profile(), timeout=15)
            if r.status_code in (403, 404): return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e; time.sleep(1.5 * (i + 1))
    return None


def adl_date(ts): return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ADL).strftime("%Y-%m-%d")
def adl_time(ts): return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ADL).strftime("%H:%M")


def parse_match_date(value):
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except Exception:
        return None


def match_kickoff_datetime(match):
    d = parse_match_date(match.get("date"))
    t = str(match.get("time") or "")
    if not d or not re.match(r"^\d{2}:\d{2}$", t):
        return None
    hour, minute = [int(part) for part in t.split(":")]
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=ADL)


def result_due_datetime(match):
    kickoff = match_kickoff_datetime(match)
    if not kickoff:
        return None
    return kickoff + timedelta(minutes=RESULT_CHECK_BUFFER_MINUTES)


def result_due_label(due_at):
    if not due_at:
        return "DUE @ unknown"
    return f"DUE @ {due_at.strftime('%H:%M')}"


def match_closed_for_result_check(match):
    return str(match.get("status") or "").lower() in {
        "ft",
        "postponed_or_cancelled",
        "postponed",
        "cancelled",
        "canceled",
        "abandoned",
        "suspended",
    }


def match_due_for_result_check(match, now=None):
    if match_closed_for_result_check(match):
        return False
    due_at = result_due_datetime(match)
    if not due_at:
        return False
    now = now or datetime.now(ADL)
    return now > due_at


def due_result_targets(store, now=None):
    now = now or datetime.now(ADL)
    targets = []
    for league in store.get("leagues", []):
        for match in league.get("matches", []):
            event_id = match.get("id")
            if not event_id:
                continue
            if match_due_for_result_check(match, now):
                targets.append({"league": league, "match": match, "event_id": event_id})
    return targets


def is_sofascore_event_id(event_id):
    return isinstance(event_id, int) or (isinstance(event_id, str) and event_id.isdigit())


def is_espn_event_id(event_id):
    return isinstance(event_id, str) and event_id.lower().startswith("espn:")


def is_bookmaker_fixture_id(event_id):
    return isinstance(event_id, str) and event_id.lower().startswith(BOOKMAKER_MATCH_ID_PREFIXES)


def result_backfill_dates():
    start = TODAY - timedelta(days=RESULT_LOOKBACK_DAYS)
    return [(start + timedelta(days=i)).isoformat() for i in range(RESULT_LOOKBACK_DAYS + 1)]


def ft_recent_enough_for_results_mode(match):
    if match.get("settled_at") == TODAY.isoformat():
        return True
    d = parse_match_date(match.get("date"))
    return bool(d and d >= TODAY - timedelta(days=RESULT_LOOKBACK_DAYS))


def result_schedule_rows(store):
    now = datetime.now(ADL)
    rows = []
    for league in store.get("leagues", []):
        for match in league.get("matches", []):
            if match_closed_for_result_check(match):
                continue
            kickoff = match_kickoff_datetime(match)
            due_at = result_due_datetime(match)
            match_date = parse_match_date(match.get("date"))
            due = match_due_for_result_check(match, now)
            if match_date and match_date < TODAY:
                scope = "overdue"
            elif match_date == TODAY:
                scope = "today"
            elif match_date == TOMORROW:
                scope = "tomorrow"
            else:
                scope = "future"
            include = due or scope in {"overdue", "today", "tomorrow"}
            if not include:
                continue
            rows.append({
                "scope": scope,
                "league": league.get("name"),
                "date": match.get("date"),
                "time": match.get("time"),
                "home": (match.get("home") or {}).get("name"),
                "away": (match.get("away") or {}).get("name"),
                "status": match.get("status"),
                "kickoff_at": kickoff.isoformat() if kickoff else None,
                "due_at": due_at.isoformat() if due_at else None,
                "check_after": due_at.isoformat() if due_at else None,
                "result_queue": result_due_label(due_at),
                "due_for_check": due,
                "event_id": match.get("id"),
            })
    rows.sort(key=lambda row: (row.get("date") or "", row.get("time") or "", row.get("league") or ""))
    return rows


def write_result_schedule_log(store, phase_summary):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(ADL).strftime("%Y%m%dT%H%M%S%z")
    rows = result_schedule_rows(store)
    payload = {
        "generated_at": datetime.now(ADL).isoformat(),
        "result_check_buffer_minutes": RESULT_CHECK_BUFFER_MINUTES,
        "result_lookback_days": RESULT_LOOKBACK_DAYS,
        "due_count": sum(1 for row in rows if row["due_for_check"]),
        "remaining_count": sum(1 for row in rows if row["scope"] in {"overdue", "today"}),
        "tomorrow_count": sum(1 for row in rows if row["scope"] == "tomorrow"),
        "phase_summary": phase_summary,
        "matches": rows,
    }
    json_path = OUT_DIR / f"result_check_schedule_{run_id}.json"
    latest_json_path = OUT_DIR / "result_check_schedule_latest.json"
    md_path = OUT_DIR / f"result_check_schedule_{run_id}.md"
    latest_md_path = OUT_DIR / "result_check_schedule_latest.md"
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    json_path.write_text(text + "\n", encoding="utf-8")
    latest_json_path.write_text(text + "\n", encoding="utf-8")

    lines = [
        "# Result Check Schedule",
        "",
        f"Generated: {payload['generated_at']}",
        f"Completion buffer: {RESULT_CHECK_BUFFER_MINUTES} minutes after kickoff",
        f"Due now: {payload['due_count']}",
        f"Remaining today/overdue: {payload['remaining_count']}",
        f"Tomorrow visible: {payload['tomorrow_count']}",
        "",
        "## This Run",
        "",
        f"- Settled: {len(phase_summary.get('settled', []))}",
        f"- Flashscore settled: {phase_summary.get('flashscore_settled', 0)}",
        f"- LiveScore settled: {phase_summary.get('livescore_settled', 0)}",
        f"- Closed / voided: {phase_summary.get('closed', 0)}",
        f"- Due skipped / awaiting source: {phase_summary.get('skipped', 0)}",
        f"- Not due yet: {phase_summary.get('not_due', 0)}",
        f"- Backfilled finished: {phase_summary.get('backfilled', 0)}",
        f"- Enriched FT: {phase_summary.get('enriched', 0)}",
        f"- Pruned stale unresolved: {len(phase_summary.get('pruned', []))}",
        "",
        "## Match Checks",
        "",
        "| Scope | Queue | Date | Kickoff | Due time | League | Match | Result queue |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        due = "yes" if row["due_for_check"] else "no"
        due_time = row.get("due_at") or row.get("check_after") or "-"
        if due_time != "-":
            due_time = due_time[11:16]
        lines.append(
            f"| {row.get('scope') or ''} | {due} | {row.get('date') or ''} | {row.get('time') or ''} | {due_time} | "
            f"{row.get('league') or ''} | {row.get('home') or ''} vs {row.get('away') or ''} | {row.get('result_queue') or ''} |"
        )
    md = "\n".join(lines) + "\n"
    md_path.write_text(md, encoding="utf-8")
    latest_md_path.write_text(md, encoding="utf-8")
    return {"json": str(json_path.relative_to(ROOT)), "markdown": str(md_path.relative_to(ROOT))}


def short(name):
    if not name: return ""
    parts = name.split()
    if len(parts) > 1:
        return parts[0] if len(parts[0]) >= 4 else " ".join(parts[:2])
    return name


TEAM_LOGO_OVERRIDES = {
    "asroma": "https://media.api-sports.io/football/teams/497.png",
    "atalanta": "https://media.api-sports.io/football/teams/499.png",
    "bologna": "https://media.api-sports.io/football/teams/500.png",
    "cagliari": "https://media.api-sports.io/football/teams/490.png",
    "como": "https://media.api-sports.io/football/teams/895.png",
    "cremonese": "https://media.api-sports.io/football/teams/520.png",
    "fiorentina": "https://media.api-sports.io/football/teams/502.png",
    "genoa": "https://media.api-sports.io/football/teams/495.png",
    "hellasverona": "https://media.api-sports.io/football/teams/504.png",
    "inter": "https://media.api-sports.io/football/teams/505.png",
    "intermilan": "https://media.api-sports.io/football/teams/505.png",
    "juventus": "https://media.api-sports.io/football/teams/496.png",
    "lazio": "https://media.api-sports.io/football/teams/487.png",
    "lecce": "https://media.api-sports.io/football/teams/867.png",
    "milan": "https://media.api-sports.io/football/teams/489.png",
    "acmilan": "https://media.api-sports.io/football/teams/489.png",
    "napoli": "https://media.api-sports.io/football/teams/492.png",
    "parma": "https://media.api-sports.io/football/teams/523.png",
    "pisa": "https://media.api-sports.io/football/teams/517.png",
    "sassuolo": "https://media.api-sports.io/football/teams/488.png",
    "sscnapoli": "https://media.api-sports.io/football/teams/492.png",
    "torino": "https://media.api-sports.io/football/teams/503.png",
    "udinese": "https://media.api-sports.io/football/teams/494.png",
    "hull": "https://media.api-sports.io/football/teams/64.png",
    "hullcity": "https://media.api-sports.io/football/teams/64.png",
    "middlesbrough": "https://media.api-sports.io/football/teams/70.png",
    "middlesbroughfc": "https://media.api-sports.io/football/teams/70.png",
    "southampton": "https://media.api-sports.io/football/teams/41.png",
    "southamptonfc": "https://media.api-sports.io/football/teams/41.png",
}

LEAGUE_LOGO_OVERRIDES = {
    "Premier League": "https://media.api-sports.io/football/leagues/39.png",
    "Championship": "https://media.api-sports.io/football/leagues/40.png",
    "Championship, Promotion Playoffs": "https://media.api-sports.io/football/leagues/40.png",
    "League One": "https://media.api-sports.io/football/leagues/41.png",
    "League Two": "https://media.api-sports.io/football/leagues/42.png",
    "LaLiga": "https://media.api-sports.io/football/leagues/140.png",
    "Serie A": "https://media.api-sports.io/football/leagues/135.png",
    "Bundesliga": "https://media.api-sports.io/football/leagues/78.png",
    "Ligue 1": "https://media.api-sports.io/football/leagues/61.png",
    "Eredivisie": "https://media.api-sports.io/football/leagues/88.png",
    "Primeira Liga": "https://media.api-sports.io/football/leagues/94.png",
    "UEFA Champions League": "https://media.api-sports.io/football/leagues/2.png",
    "UEFA Europa League": "https://media.api-sports.io/football/leagues/3.png",
    "UEFA Conference League": "https://media.api-sports.io/football/leagues/848.png",
    "MLS": "https://media.api-sports.io/football/leagues/253.png",
    "A-League Men": "https://media.api-sports.io/football/leagues/188.png",
    "Scottish Premiership": "https://media.api-sports.io/football/leagues/179.png",
    "J1 League": "https://media.api-sports.io/football/leagues/98.png",
    "Brasileirão Betano": "https://media.api-sports.io/football/leagues/71.png",
    "CONMEBOL Libertadores": "https://media.api-sports.io/football/leagues/13.png",
    "FIFA World Cup": "https://media.api-sports.io/football/leagues/1.png",
    "International Friendly Games": "https://media.api-sports.io/football/leagues/10.png",
    "Allsvenskan": "https://media.api-sports.io/football/leagues/113.png",
    "Eliteserien": "https://media.api-sports.io/football/leagues/103.png",
}


def logo_key(name):
    plain = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def stable_league_logo(league_name, unique_tournament_id=None):
    override = LEAGUE_LOGO_OVERRIDES.get(league_name or "")
    if override:
        return override
    return f"https://img.sofascore.com/api/v1/unique-tournament/{unique_tournament_id}/image" if unique_tournament_id else ""


def verified_team_logo(team_name=None, existing_logo=None, badge_source=None):
    """Return a verified team badge URL.

    Provider IDs are not interchangeable. In particular, a SofaScore numeric
    team ID must never be turned into a media.api-sports.io URL unless a
    curated team-name override verifies that mapping. When no verified image is
    available, return empty and let the dashboard render its initials badge.
    """
    override = TEAM_LOGO_OVERRIDES.get(logo_key(team_name))
    if override:
        return override
    logo = existing_logo if isinstance(existing_logo, str) else ""
    source = (badge_source or "").lower()
    if "api.sofascore.app/api/v1/team/" in logo:
        return ""
    if "media.api-sports.io/football/teams/" in logo and source != "api-football":
        return ""
    return logo.strip()


def sofascore_team_logo(team_id, team_name=None):
    return verified_team_logo(team_name)


def sofascore_league_logo(unique_tournament_id):
    return f"https://img.sofascore.com/api/v1/unique-tournament/{unique_tournament_id}/image" if unique_tournament_id else ""


def team_payload(team, score=None):
    payload = {
        "name": team.get("name", ""),
        "short": short(team.get("shortName") or team.get("name", "")),
        "team_id": team.get("id"),
        "logo": verified_team_logo(team.get("name", "")),
    }
    if score is not None:
        payload["goals"] = score
    return payload


def normalize_team_logo_payload(team):
    if not isinstance(team, dict):
        return
    if isinstance(team.get("logo"), str) and "firebasestorage.googleapis.com" in team.get("logo", ""):
        return
    stable_logo = verified_team_logo(
        team.get("name") or team.get("short"),
        team.get("logo") or team.get("logo_url"),
        team.get("badge_source"),
    )
    if stable_logo:
        team["logo"] = stable_logo
    elif isinstance(team.get("logo"), str) and (
        "api.sofascore.app/api/v1/team/" in team.get("logo", "")
        or "media.api-sports.io/football/teams/" in team.get("logo", "")
    ):
        team["logo"] = ""


def is_youth_or_reserve_team_name(name):
    lower = (name or "").strip().lower()
    if not lower:
        return False
    return bool(YOUTH_TEAM_RE.search(lower)) or any(
        token in lower for token in ("youth", "academy", "reserve", "reserves")
    )


def is_excluded_fixture_for_league(league_name, home_name, away_name):
    if league_name != "International Friendly Games":
        return False
    return (
        is_youth_or_reserve_team_name(home_name)
        or is_youth_or_reserve_team_name(away_name)
    )


def load_store():
    if STORE.exists():
        return json.loads(STORE.read_text(encoding="utf-8"))
    return {"captured_at": TODAY.isoformat(), "source": "sofascore.com + sportsbet.com.au", "leagues": []}


def prune_bookmaker_fixture_matches(store):
    removed = 0
    for league in store.get("leagues", []):
        keep = []
        for match in league.get("matches", []):
            if is_bookmaker_fixture_id(match.get("id")):
                removed += 1
                continue
            keep.append(match)
        league["matches"] = keep
    return removed


def save_store(store):
    store["captured_at"] = TODAY.isoformat()
    STORE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / f"predictions_{TODAY.isoformat()}.json").write_text(
        json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


# ----------------------------------------------------------------------------
def phase_0_validate(store):
    """Dedupe + strict tournament-ID validation + Adelaide-local re-date."""
    drops_bookmaker = prune_bookmaker_fixture_matches(store)
    seen = {}
    drops_dupe = 0
    for L in store["leagues"]:
        keep = []
        for m in L["matches"]:
            eid = m.get("id")
            if eid and eid in seen:
                drops_dupe += 1; continue
            if eid: seen[eid] = True
            keep.append(m)
        L["matches"] = keep

    for L in store["leagues"]:
        for m in L.get("matches", []):
            normalize_team_logo_payload(m.get("home"))
            normalize_team_logo_payload(m.get("away"))

    by_name = {info: L for info in TOURNAMENTS.values() for L in store["leagues"] if L["name"] == info}
    # ensure all canonical leagues exist
    for canon in TOURNAMENTS.values():
        if canon not in by_name:
            league_id = next(k for k, v in TOURNAMENTS.items() if v == canon)
            new_lg = {"id": league_id, "name": canon, "season": "2025/26", "round": None, "logo": stable_league_logo(canon, league_id), "matches": []}
            store["leagues"].append(new_lg)
            by_name[canon] = new_lg

    # drop non-whitelisted league entries
    store["leagues"] = [L for L in store["leagues"] if L["name"] in TOURNAMENTS.values()]
    by_name = {L["name"]: L for L in store["leagues"]}

    # Per-match validation + re-date. Cache the event fetch for later phases.
    # Parallelized to fit within tight runtime budgets.
    drops_no_id = 0; drops_foreign = 0; drops_excluded = 0; moved = 0; re_dated = 0
    cache = {}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    all_eids = []
    for L in store["leagues"]:
        for m in L["matches"]:
            eid = m.get("id")
            if eid and eid not in cache:
                all_eids.append(eid)
    if all_eids:
        with ThreadPoolExecutor(max_workers=30) as ex:
            futs = {ex.submit(fetch, f"/api/v1/event/{eid}"): eid for eid in all_eids}
            for f in as_completed(futs):
                eid = futs[f]
                try:
                    ev = f.result()
                except Exception:
                    ev = None
                if ev is not None:
                    cache[eid] = ev
    for L in list(store["leagues"]):
        keep = []
        for m in L["matches"]:
            home_name = (m.get("home") or {}).get("name") or ""
            away_name = (m.get("away") or {}).get("name") or ""
            if is_excluded_fixture_for_league(L.get("name"), home_name, away_name):
                drops_excluded += 1
                continue
            eid = m.get("id")
            if not eid:
                drops_no_id += 1; continue
            if not is_sofascore_event_id(eid):
                # ESPN is a primary fixture source; ESPN-id matches have no SofaScore
                # event to validate against, so keep them instead of dropping as
                # "foreign". Dropping them here then re-promoting from the phase slate
                # silently wiped predictions off ESPN matches that had already
                # finished (re-promotion brings finished matches back as bare shells).
                if is_espn_event_id(eid):
                    keep.append(m); continue
                drops_foreign += 1; continue
            ev = cache.get(eid)
            if ev is None:
                # network blip — keep the match, will be re-validated on next run
                keep.append(m); continue
            e = ev.get("event") or ev
            utid = ((e.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS:
                drops_foreign += 1; continue
            correct = TOURNAMENTS[utid]
            target_league = by_name.get(correct)
            if target_league is not None:
                target_league["id"] = utid
                target_league["logo"] = stable_league_logo(correct, utid)
            ts = e.get("startTimestamp")
            if ts:
                new_d = adl_date(ts); new_t = "FT" if m.get("status") == "FT" else adl_time(ts)
                if m.get("date") != new_d or m.get("time") != new_t:
                    m["date"] = new_d; m["time"] = new_t; re_dated += 1
            h = e.get("homeTeam") or {}
            a = e.get("awayTeam") or {}
            home_logo = verified_team_logo(h.get("name"), m.get("home", {}).get("logo"))
            away_logo = verified_team_logo(a.get("name"), m.get("away", {}).get("logo"))
            if home_logo:
                m.setdefault("home", {})["logo"] = home_logo
            if away_logo:
                m.setdefault("away", {})["logo"] = away_logo
            if correct != L["name"]:
                by_name[correct]["matches"].append(m); moved += 1
            else:
                keep.append(m)
        L["matches"] = keep

    return {"dedupe": drops_dupe, "no_id": drops_no_id, "foreign": drops_foreign,
            "bookmaker": drops_bookmaker,
            "excluded": drops_excluded,
            "moved": moved, "re_dated": re_dated, "cache": cache}


# ----------------------------------------------------------------------------
def settle(m, e):
    hs = (e.get("homeScore") or {}).get("current")
    as_ = (e.get("awayScore") or {}).get("current")
    if hs is None or as_ is None: return False
    m["status"] = "FT"; m["time"] = "FT"
    m.setdefault("home", {})["goals"] = hs
    m.setdefault("away", {})["goals"] = as_
    m["settled_at"] = TODAY.isoformat()
    m["prediction_locked"] = True
    m["prediction_locked_at"] = datetime.now(ADL).isoformat()
    pred = m.get("predictions") or {}
    actual = "home" if hs > as_ else ("away" if as_ > hs else "draw")
    if pred.get("winner"):
        pred["winner"]["result"] = "hit" if pred["winner"].get("type") == actual else "miss"
        pred["winner"].pop("picked", None)
    abtts = (hs > 0 and as_ > 0)
    if pred.get("btts"):
        pred["btts"]["actual_btts"] = abtts
        btts_pick = str(pred["btts"].get("pick", "")).lower()
        pred["btts"]["result"] = "hit" if (btts_pick == "yes") == abtts else "miss"
    if pred.get("ou_goals"):
        line = float(pred["ou_goals"].get("line", 2.5)); tot = hs + as_
        pred["ou_goals"]["actual"] = tot
        pred["ou_goals"]["result"] = ("hit" if (pred["ou_goals"].get("pick") == "Over" and tot > line) or
                                      (pred["ou_goals"].get("pick") == "Under" and tot < line) else "miss")
    return True


FLASH_LEAGUE_ALIASES = {
    "Premier League": ("england", {"premier league", "epl"}),
    "Championship": ("england", {"championship"}),
    "League One": ("england", {"league one"}),
    "League Two": ("england", {"league two"}),
    "LaLiga": ("spain", {"laliga"}),
    "Bundesliga": ("germany", {"bundesliga"}),
    "Serie A": ("italy", {"serie a"}),
    "Ligue 1": ("france", {"ligue 1"}),
    "Eredivisie": ("netherlands", {"eredivisie"}),
    "Primeira Liga": ("portugal", {"liga portugal", "liga portugal betclic", "primeira liga"}),
    "A-League Men": ("australia", {"a-league men", "a-league"}),
    "Scottish Premiership": ("scotland", {"premiership", "scottish premiership"}),
    "J1 League": ("japan", {"j1 league"}),
    "UEFA Champions League": ("europe", {"champions league"}),
    "UEFA Europa League": ("europe", {"europa league"}),
    "UEFA Conference League": ("europe", {"conference league", "europa conference league"}),
    "MLS": ("usa", {"mls", "major league soccer"}),
    "Brasileirão Betano": ("brazil", {"brasileirao betano", "brasileirão betano", "serie a betano", "serie a"}),
    "CONMEBOL Libertadores": ("south america", {"conmebol libertadores", "copa libertadores", "libertadores"}),
    "FIFA World Cup": ("world", {"world cup", "world championship", "men's world cup", "mens world cup"}),
    "International Friendly Games": ("", {"international friendlies", "friendly international", "friendlies", "friendly games"}),
    "Allsvenskan": ("sweden", {"allsvenskan"}),
    "Eliteserien": ("norway", {"eliteserien"}),
}

TEAM_ALIASES = {
    "manutd": "manchesterunited",
    "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "atletico": "atleticomadrid",
    "athletic": "athleticbilbao",
    "psg": "parissaintgermain",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "wolves": "wolverhampton",
    "forest": "nottinghamforest",
    "rennais": "rennes",
}
# National-team synonyms that span data providers live in one shared map (also used
# by the Sportsbet/bookmaker odds matchers), so a new country alias is added once.
TEAM_ALIASES.update(NATIONAL_TEAM_ALIASES)

TEAM_NAME_STOPWORDS = {
    "afc",
    "cf",
    "club",
    "de",
    "del",
    "fc",
    "fk",
    "sc",
    "stade",
    "the",
}

TEAM_WORD_ALIASES = {
    "rennais": "rennes",
    "st": "saint",
    "ste": "sainte",
    "utd": "united",
}


def team_norm(value):
    plain = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]", "", plain.lower())
    return text.replace("fc", "").replace("utd", "united")


def team_words(value):
    plain = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    words = []
    for word in re.findall(r"[a-z0-9]+", plain.lower()):
        word = TEAM_WORD_ALIASES.get(word, word)
        if word and word not in TEAM_NAME_STOPWORDS:
            words.append(word)
    return words


def team_word_similarity(a, b):
    a_words = team_words(a)
    b_words = team_words(b)
    if not a_words or not b_words:
        return 0.0
    shorter, longer = (a_words, b_words) if len(a_words) <= len(b_words) else (b_words, a_words)
    scores = []
    for word in shorter:
        scores.append(max(difflib.SequenceMatcher(None, word, other).ratio() for other in longer))
    return sum(scores) / len(scores)


def team_names_match(a, b):
    a_norm = team_norm(a)
    b_norm = team_norm(b)
    if not a_norm or not b_norm:
        return False
    if a_norm == b_norm or a_norm in b_norm or b_norm in a_norm:
        return True
    for token, expanded in TEAM_ALIASES.items():
        if token in a_norm and expanded in b_norm:
            return True
        if token in b_norm and expanded in a_norm:
            return True
    if team_word_similarity(a, b) >= 0.82:
        return True
    return False


def flashscore_league_matches(canonical, event):
    expected_country, accepted = FLASH_LEAGUE_ALIASES.get(canonical, ("", set()))
    country = (event.get("country") or "").lower()
    league = (event.get("league") or "").lower()
    bare = league.split(":", 1)[1].strip() if ":" in league else league
    if expected_country and expected_country not in country:
        return False
    return bare in accepted


def load_flashscore_finished_events():
    try:
        import soccer_phase1_fixtures as flashsource
        raw = flashsource.fetch_flashscore_feed()
        events = flashsource.parse_flashscore_feed(raw)
        return [
            event for event in events
            if flashsource.flashscore_status(event.get("status")) == "FT"
            and event.get("home_score") not in ("", None)
            and event.get("away_score") not in ("", None)
        ], getattr(flashsource, "LAST_FLASHSCORE_FEED_URL", "")
    except Exception as exc:
        print(f"  flashscore_fallback_error={exc}")
        return [], ""


def load_flashscore_result_events():
    try:
        import soccer_phase1_fixtures as flashsource
        raw = flashsource.fetch_flashscore_feed()
        events = flashsource.parse_flashscore_feed(raw)
        result_events = []
        for event in events:
            status_text = flashsource.flashscore_status(event.get("status"))
            has_score = event.get("home_score") not in ("", None) and event.get("away_score") not in ("", None)
            if status_text == "FT" and has_score:
                result_events.append(event)
            elif status_text == "postponed_or_cancelled" or (status_text == "FT" and not has_score):
                event = dict(event)
                event["status_text"] = "postponed_or_cancelled"
                result_events.append(event)
        return result_events, getattr(flashsource, "LAST_FLASHSCORE_FEED_URL", "")
    except Exception as exc:
        print(f"  flashscore_fallback_error={exc}")
        return [], ""


def flashscore_result_for_match(events, league_name, match):
    match_date = str(match.get("date") or "")
    home_name = (match.get("home") or {}).get("name", "")
    away_name = (match.get("away") or {}).get("name", "")
    for event in events:
        ts = event.get("ts")
        if not ts:
            continue
        try:
            event_date = adl_date(int(ts))
        except Exception:
            continue
        if event_date != match_date:
            continue
        if not flashscore_league_matches(league_name, event):
            continue
        if not team_names_match(home_name, event.get("home")):
            continue
        if not team_names_match(away_name, event.get("away")):
            continue
        if event.get("status_text") == "postponed_or_cancelled":
            return {
                "event": event,
                "home_score": None,
                "away_score": None,
                "status": "postponed_or_cancelled",
            }
        try:
            home_score = int(event.get("home_score"))
            away_score = int(event.get("away_score"))
        except (TypeError, ValueError):
            continue
        return {
            "event": event,
            "home_score": home_score,
            "away_score": away_score,
        }
    return None


def settle_from_flashscore(match, result):
    event = result["event"]
    fake_event = {
        "homeScore": {"current": result["home_score"]},
        "awayScore": {"current": result["away_score"]},
    }
    if not settle(match, fake_event):
        return False
    match["flashscore_score"] = {
        "home": result["home_score"],
        "away": result["away_score"],
        "status": "FT",
        "source_match_id": event.get("id"),
        "fetched_at": TODAY.isoformat(),
    }
    match["settled_source"] = "Flashscore"
    return True


def close_from_flashscore(match, result):
    event = result["event"]
    match["status"] = "postponed_or_cancelled"
    match["time"] = "Cancelled"
    match["settled_at"] = TODAY.isoformat()
    match["prediction_locked"] = True
    match["prediction_locked_at"] = datetime.now(ADL).isoformat()
    match["settled_source"] = "Flashscore"
    match["void_reason"] = "Fixture postponed/cancelled by source before result settlement."
    match["flashscore_score"] = {
        "home": None,
        "away": None,
        "status": "postponed_or_cancelled",
        "source_match_id": event.get("id"),
        "fetched_at": TODAY.isoformat(),
    }
    for market in (match.get("predictions") or {}).values():
        if isinstance(market, dict) and market.get("result") not in ("hit", "miss"):
            market["result"] = "void"
    return True


def sportsbet_event_id_for_match(match):
    odds = match.get("sportsbet_odds") or {}
    event_id = odds.get("event_id") or odds.get("id")
    if event_id:
        return str(event_id).replace("sportsbet:", "")
    match_id = match.get("id")
    if isinstance(match_id, str) and match_id.startswith("sportsbet:"):
        return match_id.split(":", 1)[1]
    return None


def sportsbet_result_for_match(league_name, match):
    odds = match.get("sportsbet_odds") or {}
    event_url = odds.get("event_url") or odds.get("url")
    event_id = sportsbet_event_id_for_match(match)
    home_name = (match.get("home") or {}).get("name")
    away_name = (match.get("away") or {}).get("name")
    try:
        import soccer_fetch_sportsbet as sportsbet
    except Exception:
        return None

    status = None
    explicit_status = (
        odds.get("status")
        or odds.get("status_text")
        or odds.get("display_status")
        or odds.get("event_status")
    )
    if explicit_status:
        status = sportsbet.event_terminal_status({"status": explicit_status})
    if not status:
        status = sportsbet.fetch_event_status(
            event_url=event_url,
            event_id=event_id,
            league_slug=sportsbet.LEAGUE_PAGES.get(league_name),
            home=home_name,
            away=away_name,
        )
    if not status:
        return None

    return {
        "event": status.get("event") or {"id": event_id},
        "status": "postponed_or_cancelled",
        "state": status.get("status"),
        "status_text": status.get("status_text") or status.get("status") or "postponed/cancelled",
        "source_match_id": status.get("event_id") or event_id,
    }


def close_from_sportsbet(match, result):
    status_text = str(result.get("status_text") or "postponed/cancelled")
    display_state = "Postponed" if "postpon" in status_text.lower() else "Cancelled"
    match["status"] = "postponed_or_cancelled"
    match["time"] = display_state
    match["settled_at"] = TODAY.isoformat()
    match["prediction_locked"] = True
    match["prediction_locked_at"] = datetime.now(ADL).isoformat()
    match["settled_source"] = "Sportsbet"
    match["void_reason"] = "Fixture postponed/cancelled by Sportsbet before result settlement."
    match["sportsbet_score"] = {
        "home": None,
        "away": None,
        "status": "postponed_or_cancelled",
        "state": result.get("state"),
        "status_text": status_text,
        "source_match_id": result.get("source_match_id"),
        "fetched_at": TODAY.isoformat(),
    }
    for market in (match.get("predictions") or {}).values():
        if isinstance(market, dict) and market.get("result") not in ("hit", "miss"):
            market["result"] = "void"
    return True


def cards_count(eid):
    s = fetch(f"/api/v1/event/{eid}/statistics"); time.sleep(0.6)
    if not s: return None
    yc = rc = 0; found = False
    for per in s.get("statistics", []):
        if per.get("period") != "ALL": continue
        for grp in per.get("groups", []):
            for it in grp.get("statisticsItems", []):
                nm = (it.get("name") or "").lower()
                try:
                    h = int(it.get("homeValue") or it.get("home") or 0)
                    a = int(it.get("awayValue") or it.get("away") or 0)
                except: continue
                if "yellow card" in nm and "second" not in nm: yc = h + a; found = True
                elif "red card" in nm: rc = h + a; found = True
    return (yc + rc) if found else None


def phase_a_settle(store, cache, due_only=False):
    settled = []; skipped = 0; not_due = 0; flashscore_settled = 0; livescore_settled = 0; closed = 0
    flashscore_events = None
    flashscore_source = ""
    now = datetime.now(ADL)
    for L in store["leagues"]:
        for m in L["matches"]:
            if match_closed_for_result_check(m): continue
            eid = m.get("id")
            if not eid: continue
            due_for_check = match_due_for_result_check(m, now)
            if due_only and not due_for_check:
                not_due += 1
                continue
            settled_this = False
            source_note = ""

            # ESPN first: primary results source, independent of the (often blocked) SofaScore API.
            es = espn_state_for_match(L.get("name", ""), m)
            if es and es[0] == "ft" and settle(m, {"homeScore": {"current": es[1]}, "awayScore": {"current": es[2]}}):
                m["settled_source"] = "ESPN"
                settled_this = True
                source_note = " [ESPN]"

            ev = (cache.get(eid) or fetch(f"/api/v1/event/{eid}")) if not settled_this else None
            e = (ev.get("event") or ev) if ev else None
            is_finished = bool(e and (e.get("status") or {}).get("type") == "finished")

            if not settled_this and e and (is_finished or due_for_check):
                if settle(m, e):
                    settled_this = True
                    if not is_finished:
                        m["settled_source"] = "SofaScoreDueTime"
                        m["settled_by_due_time"] = True
                        source_note = " [SofaScore due time]"

            if not settled_this:
                result = sportsbet_result_for_match(L.get("name", ""), m)
                if result and close_from_sportsbet(m, result):
                    settled_this = True
                    closed += 1
                    source_note = f" [Sportsbet {result.get('state') or 'closed'}]"

            if not settled_this:
                if flashscore_events is None:
                    flashscore_events, flashscore_source = load_flashscore_result_events()
                    if flashscore_source:
                        print(f"  flashscore_fallback_source={flashscore_source}")
                result = flashscore_result_for_match(flashscore_events, L.get("name", ""), m)
                if result and settle_from_flashscore(m, result):
                    settled_this = True
                    flashscore_settled += 1
                    source_note = " [Flashscore]"
                elif result and result.get("status") == "postponed_or_cancelled" and close_from_flashscore(m, result):
                    settled_this = True
                    closed += 1
                    source_note = " [Flashscore cancelled]"

            if not settled_this and due_for_check:
                result = livescore_result_for_match(L.get("name", ""), m)
                if result and settle_from_livescore(m, result):
                    settled_this = True
                    livescore_settled += 1
                    source_note = " [LiveScore due time]"

            if not settled_this:
                skipped += 1
                continue

            if is_sofascore_event_id(eid):
                act = actuals_for(eid, L.get("name", ""), m)
                if act:
                    m["actuals"] = {**(m.get("actuals") or {}), **act}
                settle_stat_markets(m)
            if m.get("status") == "postponed_or_cancelled":
                settled.append(f"{L['name']}: {m['home']['name']} vs {m['away']['name']} cancelled{source_note}")
            else:
                settled.append(f"{L['name']}: {m['home']['name']} {m['home']['goals']}-{m['away']['goals']} {m['away']['name']}{source_note}")
    return {
        "settled": settled,
        "skipped": skipped,
        "not_due": not_due,
        "flashscore_settled": flashscore_settled,
        "livescore_settled": livescore_settled,
        "closed": closed,
    }


def settle_due_matches_by_sofascore_id(targets):
    """Settle only the currently due match cards by direct SofaScore event id."""
    settled = []
    skipped = 0
    flashscore_settled = 0
    livescore_settled = 0
    closed = 0
    flashscore_events = None
    flashscore_source = ""

    for target in targets:
        L = target["league"]
        m = target["match"]
        eid = target["event_id"]
        sofa_event_id = is_sofascore_event_id(eid)

        settled_this = False
        source_note = ""

        # ESPN first: primary results source, independent of the (often blocked) SofaScore API.
        es = espn_state_for_match(L.get("name", ""), m)
        if es and es[0] == "ft" and settle(m, {"homeScore": {"current": es[1]}, "awayScore": {"current": es[2]}}):
            m["settled_source"] = "ESPN"
            settled_this = True
            source_note = " [ESPN]"

        if not settled_this and not sofa_event_id:
            m["result_check_note"] = f"Non-SofaScore event id {eid}; skipped SofaScore quick fetch."
        ev = fetch(f"/api/v1/event/{eid}") if (sofa_event_id and not settled_this) else None
        e = (ev.get("event") or ev) if ev else None
        is_finished = bool(e and (e.get("status") or {}).get("type") == "finished")

        if not settled_this and e and settle(m, e):
            settled_this = True
            if not is_finished:
                m["settled_source"] = "SofaScoreDueTime"
                m["settled_by_due_time"] = True
                source_note = " [SofaScore due time]"
            else:
                m["settled_source"] = "SofaScore"

        if not settled_this:
            result = sportsbet_result_for_match(L.get("name", ""), m)
            if result and close_from_sportsbet(m, result):
                settled_this = True
                closed += 1
                source_note = f" [Sportsbet {result.get('state') or 'closed'}]"

        if not settled_this:
            if flashscore_events is None:
                flashscore_events, flashscore_source = load_flashscore_result_events()
                if flashscore_source:
                    print(f"  flashscore_fallback_source={flashscore_source}")
            result = flashscore_result_for_match(flashscore_events, L.get("name", ""), m)
            if result and settle_from_flashscore(m, result):
                settled_this = True
                flashscore_settled += 1
                source_note = " [Flashscore]"
            elif result and result.get("status") == "postponed_or_cancelled" and close_from_flashscore(m, result):
                settled_this = True
                closed += 1
                source_note = " [Flashscore cancelled]"

        if not settled_this:
            result = livescore_result_for_match(L.get("name", ""), m)
            if result and settle_from_livescore(m, result):
                settled_this = True
                livescore_settled += 1
                source_note = " [LiveScore due time]"

        if not settled_this:
            skipped += 1
            continue

        if sofa_event_id:
            act = actuals_for(eid, L.get("name", ""), m)
            if act:
                m["actuals"] = {**(m.get("actuals") or {}), **act}
            settle_stat_markets(m)
        if m.get("status") == "postponed_or_cancelled":
            settled.append(f"{L['name']}: {m['home']['name']} vs {m['away']['name']} cancelled{source_note}")
        else:
            settled.append(f"{L['name']}: {m['home']['name']} {m['home']['goals']}-{m['away']['goals']} {m['away']['name']}{source_note}")

    return {
        "settled": settled,
        "skipped": skipped,
        "not_due": 0,
        "flashscore_settled": flashscore_settled,
        "livescore_settled": livescore_settled,
        "closed": closed,
    }


# ----------------------------------------------------------------------------
def parse_streaks_payload(sp):
    h2h = []; tstr = []
    for s in (sp.get("head2head") or []):
        h2h.append({"team": s.get("team") or s.get("teamSide", "both"),
                    "label": s.get("name") or s.get("label", ""),
                    "value": str(s.get("count") or s.get("value", ""))})
    for s in (sp.get("general") or []):
        tstr.append({"team": s.get("team") or s.get("teamSide", "both"),
                     "label": s.get("name") or s.get("label", ""),
                     "value": str(s.get("count") or s.get("value", ""))})
    for side in ("home", "away"):
        for s in (sp.get(side) or []):
            tstr.append({"team": side,
                         "label": s.get("name") or s.get("label", ""),
                         "value": str(s.get("count") or s.get("value", ""))})
    return h2h, tstr


def parse_full_time_odds(payload):
    if not payload: return None
    for mk in (payload.get("markets") or []):
        if mk.get("marketId") == 1 or "full time" in (mk.get("marketName") or "").lower():
            out = {}
            for ch in (mk.get("choices") or []):
                v = ch.get("fractionalValue") or ch.get("value")
                if v is None: continue
                try:
                    if isinstance(v, str) and "/" in v:
                        n, d = v.split("/"); v = float(n)/float(d) + 1
                    else:
                        v = float(v)
                except: continue
                # Sentinel: SofaScore returns "0/1" (→ 1.0) when a market is not
                # yet posted. Reject anything that isn't a real bookmaker price.
                if v <= 1.01: continue
                k = ch.get("name", "")
                if k == "1": out["home"] = round(v, 2)
                elif k == "X": out["draw"] = round(v, 2)
                elif k == "2": out["away"] = round(v, 2)
            if len(out) == 3: return out
    return None


_LIVESCORE_DAY_CACHE = {}
LIVESCORE_BASE = "https://www.livescore.com"
LIVESCORE_API_BASE = "https://prod-cdn-mev-api.livescore.com"


def slugify_path(value):
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


def livescore_tz_offset_for(match):
    kickoff = match_kickoff_datetime(match)
    if kickoff and kickoff.utcoffset():
        return kickoff.utcoffset().total_seconds() / 3600
    return 9.5


def livescore_date_payload(match_date, tz_offset):
    key = (match_date, tz_offset)
    if key in _LIVESCORE_DAY_CACHE:
        return _LIVESCORE_DAY_CACHE[key]
    compact_date = (match_date or "").replace("-", "")
    if not compact_date:
        return None
    url = (
        f"{LIVESCORE_API_BASE}/v1/api/app/date/soccer/{compact_date}/{tz_offset:g}"
        "?countryCode=AU&locale=en"
    )
    try:
        resp = requests.get(url, impersonate=_profile(), timeout=20, headers={"Accept": "application/json"})
        if resp.status_code != 200:
            # Do not cache a transient failure: a single flaky fetch would otherwise
            # poison every later match lookup in this run (LiveScore is the main result
            # source while SofaScore is blocked).
            return None
        payload = resp.json()
    except Exception:
        return None
    _LIVESCORE_DAY_CACHE[key] = payload
    return payload


def stage_matches_league(stage, league_name):
    country = (stage.get("Cnm") or stage.get("Ccd") or "").lower()
    league = (stage.get("CompN") or stage.get("Snm") or "").lower()
    pseudo_event = {"country": country, "league": league}
    return flashscore_league_matches(league_name, pseudo_event) or team_norm(league_name) == team_norm(league)


def find_livescore_event(league_name, match):
    payload = livescore_date_payload(match.get("date"), livescore_tz_offset_for(match))
    if not payload:
        return None
    # When the match was settled via LiveScore we stored its event id. Resolve by that id
    # first — it is exact and survives team/league name drift (e.g. "Bosnia & Herzegovina"
    # vs "Bosnia and Herzegovina", or a "World Cup 2026 Group B" stage label) that defeats
    # the name-based matcher below, so old FT matches can still backfill their stats.
    stored_id = str((match.get("livescore_score") or {}).get("source_match_id") or "")
    if stored_id:
        for stage in payload.get("Stages") or []:
            for event in stage.get("Events") or []:
                if str(event.get("Eid")) == stored_id:
                    return stage, event
    home_name = (match.get("home") or {}).get("name", "")
    away_name = (match.get("away") or {}).get("name", "")
    cross_league_matches = []
    for stage in payload.get("Stages") or []:
        for event in stage.get("Events") or []:
            home = ((event.get("T1") or [{}])[0] or {}).get("Nm", "")
            away = ((event.get("T2") or [{}])[0] or {}).get("Nm", "")
            if not (team_names_match(home_name, home) and team_names_match(away_name, away)):
                continue
            if stage_matches_league(stage, league_name):
                return stage, event
            cross_league_matches.append((stage, event))
    # A unique team-name match under a different competition label is almost certainly the
    # same fixture (LiveScore labels World Cup games "World Cup 2026 / Group G", which our
    # "FIFA World Cup" alias does not match). Accept it when the match is due for a result
    # check, or already closed (FT) — the latter only feeds stat backfill, never settlement,
    # since closed matches are never re-settled.
    if (match_due_for_result_check(match) or match_closed_for_result_check(match)) and len(cross_league_matches) == 1:
        return cross_league_matches[0]
    return None


def livescore_result_for_match(league_name, match):
    found = find_livescore_event(league_name, match)
    if not found:
        return None
    stage, event = found
    try:
        home_score = int(event.get("Tr1"))
        away_score = int(event.get("Tr2"))
    except (TypeError, ValueError):
        return None
    return {
        "stage": stage,
        "event": event,
        "home_score": home_score,
        "away_score": away_score,
        "status": event.get("Eps"),
    }


def settle_from_livescore(match, result):
    event = result["event"]
    fake_event = {
        "homeScore": {"current": result["home_score"]},
        "awayScore": {"current": result["away_score"]},
    }
    if not settle(match, fake_event):
        return False
    match["livescore_score"] = {
        "home": result["home_score"],
        "away": result["away_score"],
        "status": result.get("status"),
        "source_match_id": event.get("Eid"),
        "fetched_at": TODAY.isoformat(),
    }
    match["settled_source"] = "LiveScore"
    return True


def livescore_event_page(stage, event, suffix=""):
    country_slug = slugify_path(stage.get("Ccd") or stage.get("Cnm") or "")
    competition_slug = slugify_path(stage.get("CompUrlName") or stage.get("CompN") or stage.get("Snm") or "")
    home = ((event.get("T1") or [{}])[0] or {}).get("Nm", "")
    away = ((event.get("T2") or [{}])[0] or {}).get("Nm", "")
    match_slug = f"{slugify_path(home)}-vs-{slugify_path(away)}"
    event_id = event.get("Eid")
    if not (country_slug and competition_slug and match_slug and event_id):
        return None
    return f"{LIVESCORE_BASE}/en/football/{country_slug}/{competition_slug}/{match_slug}/{event_id}/{suffix}"


def livescore_page_event(url):
    if not url:
        return None
    try:
        resp = requests.get(url, impersonate=_profile(), timeout=20, headers={"Accept": "text/html"})
        if resp.status_code != 200:
            return None
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', resp.text, re.S)
        if not match:
            return None
        data = json.loads(match.group(1))
        return (((data.get("props") or {}).get("pageProps") or {}).get("initialEventData") or {}).get("event")
    except Exception:
        return None


def first_goal_from_livescore_incidents(event):
    goals = []
    for period in ((event or {}).get("incidents") or {}).get("incs", {}).values():
        for minute, groups in period.items():
            try:
                minute_number = int(str(minute).split("+", 1)[0])
            except Exception:
                minute_number = 999
            for group in groups or []:
                for side_key, side in (("HOME", "home"), ("AWAY", "away")):
                    for incident in group.get(side_key) or []:
                        if incident.get("type") == "FootballGoal":
                            goals.append((minute_number, side, incident))
    if not goals:
        return {}
    _, side, incident = sorted(goals, key=lambda item: item[0])[0]
    return {
        "first_to_score": side,
        "first_scorer": incident.get("name") or incident.get("shortName"),
    }


def livescore_actuals_for_match(league_name, match):
    found = find_livescore_event(league_name, match)
    if not found:
        return None
    stage, event = found
    stats_event = livescore_page_event(livescore_event_page(stage, event, "stats/"))
    summary_event = livescore_page_event(livescore_event_page(stage, event, ""))
    stats = (stats_event or {}).get("statistics") or {}
    if not stats and not summary_event:
        return None
    out = {"source": "LiveScore"}
    corners = stats.get("corners")
    if isinstance(corners, list) and len(corners) >= 2:
        out.update(home_corners=int(corners[0] or 0), away_corners=int(corners[1] or 0))
        out["corners_total"] = out["home_corners"] + out["away_corners"]
    fouls = stats.get("fouls")
    if isinstance(fouls, list) and len(fouls) >= 2:
        out.update(home_fouls=int(fouls[0] or 0), away_fouls=int(fouls[1] or 0))
        out["fouls_total"] = out["home_fouls"] + out["away_fouls"]
    shots = stats.get("shotsOnTarget")
    if isinstance(shots, list) and len(shots) >= 2:
        out.update(home_sot=int(shots[0] or 0), away_sot=int(shots[1] or 0))
    yellow = stats.get("yellowCards") if isinstance(stats.get("yellowCards"), list) else [0, 0]
    red = stats.get("redCards") if isinstance(stats.get("redCards"), list) else [0, 0]
    if len(yellow) >= 2 and len(red) >= 2:
        out.update(
            home_cards=int(yellow[0] or 0) + int(red[0] or 0),
            away_cards=int(yellow[1] or 0) + int(red[1] or 0),
        )
        out["cards_total"] = out["home_cards"] + out["away_cards"]
    out.update(first_goal_from_livescore_incidents(summary_event))
    if event.get("Trh1") not in ("", None) and event.get("Trh2") not in ("", None):
        out["ht_home"] = int(event.get("Trh1") or 0)
        out["ht_away"] = int(event.get("Trh2") or 0)
        out["ht_winner"] = "home" if out["ht_home"] > out["ht_away"] else ("away" if out["ht_away"] > out["ht_home"] else "draw")
    return out if len(out) > 1 else None


def settle_total_market(market, actual):
    if not market or actual is None:
        return
    try:
        line = float(market.get("line"))
    except (TypeError, ValueError):
        return
    pick = market.get("pick")
    market["actual"] = actual
    if pick == "Over":
        market["result"] = "hit" if actual > line else "miss"
    elif pick == "Under":
        market["result"] = "hit" if actual < line else "miss"


def settle_stat_markets(match):
    actuals = match.get("actuals") or {}
    predictions = match.get("predictions") or {}
    settle_total_market(predictions.get("ou_cards"), actuals.get("cards_total"))
    settle_total_market(predictions.get("ou_corners"), actuals.get("corners_total"))


# Stat (cards/corners) markets settle from match["actuals"], which routinely lags the
# final score: a match often settles via Flashscore/LiveScore before SofaScore publishes
# statistics. Re-attempt capture for recently finished matches on every results pass so
# cards/corners settle automatically once any source (SofaScore, LiveScore, Flashscore)
# publishes them. Markets are never voided — they stay pending and keep retrying until a
# real actual is captured and settled.
STAT_MARKET_SPECS = (
    ("ou_cards", "cards_total", "cards"),
    ("ou_corners", "corners_total", "corners"),
)
SETTLED_MARKET_RESULTS = {"hit", "miss", "pass", "void"}


def stat_markets_pending(match):
    """Stat market specs whose prediction exists but is not yet settled (hit/miss/pass/void)."""
    predictions = match.get("predictions") or {}
    pending = []
    for spec in STAT_MARKET_SPECS:
        market = predictions.get(spec[0])
        if not market:
            continue
        if str(market.get("result") or "").lower() in SETTLED_MARKET_RESULTS:
            continue
        pending.append(spec)
    return pending


def espn_stats_actuals(match):
    """Derive cards/corners totals from the ESPN boxscore already stored on the match
    (match['espn_stats']), without a network refetch.

    ESPN is an approved settlement source, and every ESPN-id fixture carries its full
    final boxscore once collected. SofaScore-keyed `actuals_for` is skipped for ESPN ids
    and Flashscore can miss the fixture, so this promotes the stored boxscore into actuals
    rather than leaving cards/corners pending. Counts each card (yellow + red), matching
    `actuals_for` / `espn_actuals_for_match`."""
    es = match.get("espn_stats") or {}
    home = es.get("home") or {}
    away = es.get("away") or {}
    out = {}
    try:
        hc = int(home.get("corners"))
        ac = int(away.get("corners"))
        out.update(home_corners=hc, away_corners=ac, corners_total=hc + ac)
    except (TypeError, ValueError):
        pass
    try:
        home_cards = int(home.get("yellow_cards") or 0) + int(home.get("red_cards") or 0)
        away_cards = int(away.get("yellow_cards") or 0) + int(away.get("red_cards") or 0)
        out.update(home_cards=home_cards, away_cards=away_cards, cards_total=home_cards + away_cards)
    except (TypeError, ValueError):
        pass
    return out or None


def backfill_stat_actuals(store):
    """Re-fetch and settle cards/corners actuals for recently finished FT matches that are
    still missing them. Markets that still cannot be settled are left pending for the next
    pass — they are never voided."""
    now = datetime.now(ADL)
    attempted = 0
    refetched = 0
    settled = []
    still_pending_labels = []
    for L in store.get("leagues", []):
        for m in L.get("matches", []):
            if str(m.get("status") or "").lower() != "ft":
                continue
            if not ft_recent_enough_for_results_mode(m):
                continue
            # Backfill the full ESPN boxscore for the Stats tab once per match,
            # independent of whether cards/corners markets are still pending.
            if not m.get("espn_stats"):
                espn_actuals_for_match(L.get("name", ""), m)
            pending = stat_markets_pending(m)
            if not pending:
                continue
            attempted += 1
            label = (
                f"{L.get('name')}: {(m.get('home') or {}).get('name')} vs "
                f"{(m.get('away') or {}).get('name')}"
            )
            tracker = m.get("stat_backfill") or {}
            tracker["attempts"] = int(tracker.get("attempts") or 0) + 1
            tracker.setdefault("first_attempt_at", now.isoformat())
            tracker["last_attempt_at"] = now.isoformat()
            m["stat_backfill"] = tracker

            eid = m.get("id")
            act = actuals_for(eid, L.get("name", ""), m) if is_sofascore_event_id(eid) else None
            if not act or any(spec[1] not in act for spec in pending):
                flash_act = flashscore_actuals_for_match(L.get("name", ""), m)
                if flash_act:
                    act = {**flash_act, **(act or {})}
            if not act or any(spec[1] not in act for spec in pending):
                espn_act = espn_stats_actuals(m)
                if espn_act:
                    act = {**espn_act, **(act or {})}
            if act:
                merged = {**(m.get("actuals") or {}), **act}
                if merged != (m.get("actuals") or {}):
                    refetched += 1
                m["actuals"] = merged
            settle_stat_markets(m)

            still_pending = stat_markets_pending(m)
            still_pending_keys = {spec[0] for spec in still_pending}
            for market_key, _actual_key, market_label in pending:
                if market_key not in still_pending_keys:
                    settled.append(f"{label} {market_label}")
            for _market_key, _actual_key, market_label in still_pending:
                still_pending_labels.append(f"{label} {market_label} (attempt {tracker['attempts']})")
    return {
        "attempted": attempted,
        "refetched": refetched,
        "settled": settled,
        "still_pending": still_pending_labels,
    }


_FLASHSCORE_RESULT_EVENTS_CACHE = None


def get_flashscore_result_events():
    """Load and cache the Flashscore result-events feed once per process run."""
    global _FLASHSCORE_RESULT_EVENTS_CACHE
    if _FLASHSCORE_RESULT_EVENTS_CACHE is None:
        events, _source = load_flashscore_result_events()
        _FLASHSCORE_RESULT_EVENTS_CACHE = events or []
    return _FLASHSCORE_RESULT_EVENTS_CACHE


def flashscore_actuals_for_match(league_name, match):
    """Fetch full-match cards/corners actuals from Flashscore's statistics feed.

    Uses the Flashscore event id stored at settlement time when present, otherwise
    matches the fixture against the cached result-events feed to find it."""
    import soccer_phase1_fixtures as flashsource
    flash_id = (match.get("flashscore_score") or {}).get("source_match_id")
    if not flash_id:
        result = flashscore_result_for_match(get_flashscore_result_events(), league_name, match)
        if result:
            flash_id = (result.get("event") or {}).get("id")
    if not flash_id:
        return None
    stats = flashsource.fetch_flashscore_event_stats(flash_id)
    return stats or None


def actuals_for(eid, league_name="", match=None):
    out = {}
    s = fetch(f"/api/v1/event/{eid}/statistics"); time.sleep(0.6)
    if s:
        yellow_home = yellow_away = red_home = red_away = 0
        card_sides_found = False
        for per in s.get("statistics", []):
            if per.get("period") != "ALL": continue
            for grp in per.get("groups", []):
                for it in grp.get("statisticsItems", []):
                    k = it.get("key")
                    nm = (it.get("name") or "").lower()
                    try:
                        h = int(it.get("homeValue") or it.get("home") or 0)
                        a = int(it.get("awayValue") or it.get("away") or 0)
                    except: continue
                    if k == "cornerKicks": out.update(home_corners=h, away_corners=a, corners_total=h+a)
                    elif k == "fouls":      out.update(home_fouls=h,   away_fouls=a,   fouls_total=h+a)
                    elif k == "shotsOnGoal": out.update(home_sot=h,    away_sot=a)
                    elif (k == "yellowCards" or "yellow card" in nm) and "second" not in nm:
                        yellow_home += h
                        yellow_away += a
                        card_sides_found = True
                    elif k == "redCards" or "red card" in nm:
                        red_home += h
                        red_away += a
                        card_sides_found = True
        if card_sides_found:
            out.update(
                home_cards=yellow_home + red_home,
                away_cards=yellow_away + red_away,
            )
            out["cards_total"] = out["home_cards"] + out["away_cards"]
    inc = fetch(f"/api/v1/event/{eid}/incidents"); time.sleep(0.6)
    if inc:
        goals = [i for i in inc.get("incidents", []) if i.get("incidentType") == "goal"]
        if goals:
            first = min(goals, key=lambda g: g.get("time", 9999))
            out["first_to_score"] = "home" if first.get("isHome") else "away"
            out["first_scorer"]   = (first.get("player") or {}).get("name")
        ht = [i for i in inc.get("incidents", []) if i.get("incidentType") == "period" and i.get("text") == "HT"]
        if ht:
            out["ht_home"] = ht[0].get("homeScore", 0); out["ht_away"] = ht[0].get("awayScore", 0)
            out["ht_winner"] = "home" if out["ht_home"] > out["ht_away"] else ("away" if out["ht_away"] > out["ht_home"] else "draw")
    required_keys = ("corners_total", "fouls_total", "home_sot", "away_sot", "cards_total", "first_to_score")
    if match and not all(key in out for key in required_keys):
        fallback_actuals = livescore_actuals_for_match(league_name, match)
        if fallback_actuals:
            out = {**fallback_actuals, **out}
    if match and ("corners_total" not in out or "cards_total" not in out):
        flash_actuals = flashscore_actuals_for_match(league_name, match)
        if flash_actuals:
            out = {**flash_actuals, **out}
    if match and ("corners_total" not in out or "cards_total" not in out):
        espn_actuals = espn_actuals_for_match(league_name, match)
        if espn_actuals:
            out = {**espn_actuals, **out}
    return out


def swap_match_actual_sides(actuals):
    swapped = {}
    for key, value in (actuals or {}).items():
        if key.startswith("home_"):
            swapped["away_" + key[5:]] = value
        elif key.startswith("away_"):
            swapped["home_" + key[5:]] = value
        elif key == "first_to_score":
            swapped[key] = "away" if value == "home" else ("home" if value == "away" else value)
        elif key == "ht_winner":
            swapped[key] = "away" if value == "home" else ("home" if value == "away" else value)
        elif key == "ht_home":
            swapped["ht_away"] = value
        elif key == "ht_away":
            swapped["ht_home"] = value
        else:
            swapped[key] = value
    return swapped


def finished_result_matches_pending(pending, finished):
    if pending.get("status") == "FT" or finished.get("status") != "FT":
        return None
    now = datetime.now(ADL)
    if not match_due_for_result_check(pending, now):
        return None
    pending_date = parse_match_date(pending.get("date"))
    finished_date = parse_match_date(finished.get("date"))
    if not pending_date or not finished_date or abs((pending_date - finished_date).days) > 1:
        return None
    ph = (pending.get("home") or {}).get("name") or ""
    pa = (pending.get("away") or {}).get("name") or ""
    fh = (finished.get("home") or {}).get("name") or ""
    fa = (finished.get("away") or {}).get("name") or ""
    if team_names_match(ph, fh) and team_names_match(pa, fa):
        return "same"
    if team_names_match(ph, fa) and team_names_match(pa, fh):
        return "reversed"
    return None


def reconcile_finished_backfill_results(store):
    """Merge finished source rows into unresolved predicted fixtures.

    Some fallback/bookmaker fixture rows do not share a provider event id with
    SofaScore. If SofaScore later backfills the finished event as a separate FT
    row, keep the original predicted fixture and move only the final result into
    it so public hit-rate accounting uses the real pre-match card.
    """
    merged = []
    for league in store.get("leagues", []):
        matches = league.get("matches") or []
        remove_indexes = set()
        for pending_idx, pending in enumerate(matches):
            if pending.get("status") == "FT":
                continue
            for finished_idx, finished in enumerate(matches):
                if pending_idx == finished_idx or finished_idx in remove_indexes:
                    continue
                orientation = finished_result_matches_pending(pending, finished)
                if not orientation:
                    continue
                finished_home = finished.get("home") or {}
                finished_away = finished.get("away") or {}
                if orientation == "reversed":
                    home_goals = finished_away.get("goals")
                    away_goals = finished_home.get("goals")
                    actuals = swap_match_actual_sides(finished.get("actuals") or {})
                else:
                    home_goals = finished_home.get("goals")
                    away_goals = finished_away.get("goals")
                    actuals = finished.get("actuals") or {}
                if not isinstance(home_goals, (int, float)) or not isinstance(away_goals, (int, float)):
                    continue
                pending["status"] = "FT"
                pending["time"] = "FT"
                pending.setdefault("home", {})["goals"] = home_goals
                pending.setdefault("away", {})["goals"] = away_goals
                pending["settled_at"] = TODAY.isoformat()
                pending["prediction_locked"] = True
                pending["prediction_locked_at"] = datetime.now(ADL).isoformat()
                pending["settled_source"] = "SofaScoreBackfillMerge"
                pending["sofascore_result_id"] = finished.get("id")
                source_ids = [source_id for source_id in (pending.get("id"), finished.get("id")) if source_id]
                if len(source_ids) > 1:
                    pending["merged_source_ids"] = source_ids
                if actuals:
                    pending["actuals"] = {**(pending.get("actuals") or {}), **actuals}
                settle_generated_prediction_markets(pending)
                remove_indexes.add(finished_idx)
                merged.append(f"{league.get('name')}: {pending['home']['name']} {home_goals}-{away_goals} {pending['away']['name']}")
                break
        if remove_indexes:
            league["matches"] = [m for idx, m in enumerate(matches) if idx not in remove_indexes]
    return merged


def remove_backfill_duplicate_result_shells(store):
    removed = []
    for league in store.get("leagues", []):
        matches = league.get("matches") or []
        claimed_result_ids = {}
        for owner_idx, match in enumerate(matches):
            result_id = match.get("sofascore_result_id")
            if result_id:
                claimed_result_ids[str(result_id)] = owner_idx
            for result_id in match.get("merged_source_ids") or []:
                claimed_result_ids.setdefault(str(result_id), owner_idx)
        keep = []
        for idx, match in enumerate(matches):
            match_id = match.get("id")
            if (
                match.get("status") == "FT"
                and match_id is not None
                and str(match_id) in claimed_result_ids
                and claimed_result_ids[str(match_id)] != idx
            ):
                removed.append(f"{league.get('name')}: {(match.get('home') or {}).get('name')} vs {(match.get('away') or {}).get('name')}")
                continue
            keep.append(match)
        league["matches"] = keep
    return removed


def phase_a5_backfill_enrich(store, seen_ids, backfill_dates=None, recent_only=False):
    """Add finished-but-untracked + enrich every FT record."""
    by_name = {L["name"]: L for L in store["leagues"]}
    seen_ids = set(seen_ids or [])
    for league in store.get("leagues", []):
        for match in league.get("matches", []):
            if match.get("id"):
                seen_ids.add(match.get("id"))
                seen_ids.add(str(match.get("id")))
            if match.get("sofascore_result_id"):
                seen_ids.add(match.get("sofascore_result_id"))
                seen_ids.add(str(match.get("sofascore_result_id")))
            for merged_id in match.get("merged_source_ids") or []:
                seen_ids.add(merged_id)
                seen_ids.add(str(merged_id))
    added = 0; add_brk = {}
    for d in (backfill_dates or (YESTERDAY.isoformat(), TODAY.isoformat())):
        data = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); time.sleep(0.6)
        if not data: continue
        for ev in data.get("events", []):
            eid = ev.get("id")
            if not eid or eid in seen_ids or str(eid) in seen_ids: continue
            utid = ((ev.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS: continue
            if (ev.get("status") or {}).get("type") != "finished": continue
            ts = ev.get("startTimestamp")
            h = ev.get("homeTeam") or {}; a = ev.get("awayTeam") or {}
            league_name = TOURNAMENTS[utid]
            if is_excluded_fixture_for_league(league_name, h.get("name", ""), a.get("name", "")):
                continue
            rec = {
                "id": eid, "date": adl_date(ts) if ts else d, "time": "FT", "status": "FT",
                "home": team_payload(h, (ev.get("homeScore") or {}).get("current")),
                "away": team_payload(a, (ev.get("awayScore") or {}).get("current")),
                "settled_at": TODAY.isoformat(),
            }
            by_name[league_name]["matches"].append(rec)
            seen_ids.add(eid); added += 1
            add_brk[league_name] = add_brk.get(league_name, 0) + 1

    # Enrich every FT match (new or existing) with odds + streaks + actuals
    enriched = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") != "FT": continue
            if recent_only and not ft_recent_enough_for_results_mode(m): continue
            eid = m.get("id")
            if not eid: continue
            need_odds = not m.get("odds")
            need_h2h = not m.get("h2h_streaks")
            need_team = not m.get("team_streaks")
            need_streaks = need_h2h or need_team
            need_actuals = not m.get("actuals")
            if not (need_odds or need_streaks or need_actuals): continue
            if need_odds:
                op = fetch(f"/api/v1/event/{eid}/odds/1/all"); time.sleep(0.6)
                o = parse_full_time_odds(op)
                if o: m["odds"] = o
            if need_streaks:
                sp = fetch(f"/api/v1/event/{eid}/team-streaks"); time.sleep(0.6)
                if sp:
                    h2h, tstr = parse_streaks_payload(sp)
                    if h2h and need_h2h: m["h2h_streaks"] = h2h
                    if tstr and need_team: m["team_streaks"] = tstr
            if need_actuals:
                act = actuals_for(eid, L.get("name", ""), m)
                if act: m["actuals"] = {**(m.get("actuals") or {}), **act}
            actuals = m.get("actuals") or {}
            if not all(key in actuals for key in ("corners_total", "fouls_total", "home_sot", "away_sot", "cards_total", "first_to_score")):
                fallback_actuals = livescore_actuals_for_match(L.get("name", ""), m)
                if fallback_actuals:
                    m["actuals"] = {**actuals, **fallback_actuals}
            settle_stat_markets(m)
            enriched += 1
    merged = reconcile_finished_backfill_results(store)
    removed_shells = remove_backfill_duplicate_result_shells(store)
    return {"added": added, "add_brk": add_brk, "enriched": enriched, "merged": merged, "removed_result_shells": removed_shells}


# ----------------------------------------------------------------------------
def build_xg_index(store):
    """Walk the local store once and build a per-team list of recent xG samples.

    Returns: {team_id: [{"date": "YYYY-MM-DD", "time": "HH:MM",
                         "for": float, "against": float,
                         "event_id": int}, ...]} sorted oldest -> newest.

    Only FT matches that carry an `xg` block (attached by
    soccer_fetch_understat.py — PL, LaLiga, Serie A, Bundesliga, Ligue 1 are covered;
    other supported competitions are NOT covered by Understat) are included. Teams that play
    in non-Understat leagues will simply have no entries here, and the
    fetch_form() call will fall back to raw SofaScore goals.
    """
    idx = {}
    for L in store.get("leagues", []):
        for m in L.get("matches", []):
            if m.get("status") != "FT": continue
            xg = m.get("xg")
            if not xg: continue
            xh = xg.get("home"); xa = xg.get("away")
            if xh is None or xa is None: continue
            h_id = (m.get("home") or {}).get("team_id")
            a_id = (m.get("away") or {}).get("team_id")
            key = (m.get("date") or "", m.get("time") or "", m.get("id"))
            if h_id:
                idx.setdefault(h_id, []).append({"date": m.get("date"), "time": m.get("time"),
                                                  "for": float(xh), "against": float(xa),
                                                  "event_id": m.get("id")})
            if a_id:
                idx.setdefault(a_id, []).append({"date": m.get("date"), "time": m.get("time"),
                                                  "for": float(xa), "against": float(xh),
                                                  "event_id": m.get("id")})
    for tid in idx:
        idx[tid].sort(key=lambda r: ((r.get("date") or ""), (r.get("time") or "")))
    return idx


# Module-level cache so phase_b_forecast / phase_a6_retro can share one index.
_XG_INDEX = {}


def fetch_form(team_id, exclude_event_id=None, xg_index=None):
    """Return (attack, defence) form for a team over its last ~6 matches.

    Prefers xG over raw goals on a per-match basis: for each of the team's
    recent matches we use xG-for/xG-against if the local store has Understat
    xG attached to that match (PL / LaLiga / Bundesliga / Ligue 1). For any
    match without xG (any Eredivisie / MLS / Championship / League One /
    League Two fixture, or any FT match where Understat enrichment hadn't run
    yet) we fall back to the SofaScore raw goal scored / conceded for that
    same match. Final attack/defence is the mean across all 6 samples,
    regardless of which source each sample came from.
    """
    if xg_index is None:
        xg_index = _XG_INDEX
    if not team_id: return 1.40, 1.40
    d = fetch(f"/api/v1/team/{team_id}/events/last/0"); time.sleep(0.6)
    if not d: return 1.40, 1.40
    fin = [e for e in d.get("events", [])
           if (e.get("status") or {}).get("type") == "finished"
           and e.get("id") != exclude_event_id][-6:]
    if len(fin) < 3: return 1.40, 1.40
    # Per-event xG lookup (by event id) for fast match
    xg_by_event = {row.get("event_id"): row for row in (xg_index.get(team_id) or [])}
    att = []; df = []
    for e in fin:
        eid = e.get("id")
        row = xg_by_event.get(eid)
        if row is not None:
            # Use xG numbers from the local store (already from team's POV)
            att.append(float(row["for"])); df.append(float(row["against"]))
            continue
        # Fallback: raw goals from the SofaScore event payload
        is_home = (e.get("homeTeam") or {}).get("id") == team_id
        hs = (e.get("homeScore") or {}).get("current", 0); as_ = (e.get("awayScore") or {}).get("current", 0)
        if is_home: att.append(hs); df.append(as_)
        else:       att.append(as_); df.append(hs)
    return sum(att)/len(att), sum(df)/len(df)


def h2h_xg_for_event(event_id, current_home_id, current_away_id, xg_index=None):
    """Return xG for a H2H event from the current fixture perspective, if known."""
    if xg_index is None:
        xg_index = _XG_INDEX
    if not event_id or not current_home_id or not current_away_id:
        return None
    home_rows = {row.get("event_id"): row for row in (xg_index.get(current_home_id) or [])}
    row = home_rows.get(event_id)
    if row is None:
        return None
    return {
        "current_home": round(float(row["for"]), 2),
        "current_away": round(float(row["against"]), 2),
    }


def fetch_h2h(home_id, away_id, exclude_event_id=None, max_n=10, xg_index=None):
    """Past meetings between two specific teams. Returns rows from the current
    home-team's perspective. Empty if data unavailable.
    """
    if not home_id or not away_id:
        return []
    if xg_index is None:
        xg_index = _XG_INDEX
    # SofaScore exposes h2h on a known event between the two teams; we'll just walk
    # the home team's last 30 and filter to ones vs away_id.
    d = fetch(f"/api/v1/team/{home_id}/events/last/0?page=0"); time.sleep(0.6)
    if not d: return []
    out = []
    for e in d.get("events", []):
        if (e.get("status") or {}).get("type") != "finished": continue
        if e.get("id") == exclude_event_id: continue
        h_team = (e.get("homeTeam") or {}).get("id")
        a_team = (e.get("awayTeam") or {}).get("id")
        eid = e.get("id")
        xg = h2h_xg_for_event(eid, home_id, away_id, xg_index)
        if h_team == home_id and a_team == away_id:
            row = {"event_id": eid,
                        "date": adl_date(e.get("startTimestamp")) if e.get("startTimestamp") else None,
                        "home_name": (e.get("homeTeam") or {}).get("name"),
                        "away_name": (e.get("awayTeam") or {}).get("name"),
                        "home_score": (e.get("homeScore") or {}).get("current", 0),
                        "away_score": (e.get("awayScore") or {}).get("current", 0),
                        "current_home_scored": (e.get("homeScore") or {}).get("current", 0),
                        "current_away_scored": (e.get("awayScore") or {}).get("current", 0),
                        "h_scored": (e.get("homeScore") or {}).get("current", 0),
                        "a_scored": (e.get("awayScore") or {}).get("current", 0)}
            if xg:
                row["xg"] = {
                    "home": xg["current_home"],
                    "away": xg["current_away"],
                    "current_home": xg["current_home"],
                    "current_away": xg["current_away"],
                }
            out.append(row)
        elif a_team == home_id and h_team == away_id:
            row = {"event_id": eid,
                        "date": adl_date(e.get("startTimestamp")) if e.get("startTimestamp") else None,
                        "home_name": (e.get("homeTeam") or {}).get("name"),
                        "away_name": (e.get("awayTeam") or {}).get("name"),
                        "home_score": (e.get("homeScore") or {}).get("current", 0),
                        "away_score": (e.get("awayScore") or {}).get("current", 0),
                        "current_home_scored": (e.get("awayScore") or {}).get("current", 0),
                        "current_away_scored": (e.get("homeScore") or {}).get("current", 0),
                        "h_scored": (e.get("awayScore") or {}).get("current", 0),
                        "a_scored": (e.get("homeScore") or {}).get("current", 0)}
            if xg:
                row["xg"] = {
                    "home": xg["current_away"],
                    "away": xg["current_home"],
                    "current_home": xg["current_home"],
                    "current_away": xg["current_away"],
                }
            out.append(row)
    return out[:max_n]


def fetch_event_h2h_duel(event_id):
    """Return SofaScore's team duel summary for the event, if available."""
    if not event_id:
        return None
    d = fetch(f"/api/v1/event/{event_id}/h2h")
    time.sleep(0.6)
    duel = (d or {}).get("teamDuel")
    if not duel:
        return None
    return {
        "home_wins": duel.get("homeWins", 0),
        "away_wins": duel.get("awayWins", 0),
        "draws": duel.get("draws", 0),
    }


_STANDINGS_CACHE = {}
def fetch_standings(unique_tournament_id, season_id):
    """Returns dict {team_id: {"rank": int, "pts": int}} for that league season.
    Cached per process so we hit the API once per league per run.
    """
    if not unique_tournament_id or not season_id:
        return {}
    key = (unique_tournament_id, season_id)
    if key in _STANDINGS_CACHE:
        return _STANDINGS_CACHE[key]
    d = fetch(f"/api/v1/unique-tournament/{unique_tournament_id}/season/{season_id}/standings/total")
    time.sleep(0.6)
    out = {}
    if d:
        for st in d.get("standings", []):
            for row in st.get("rows", []):
                team = row.get("team") or {}
                tid = team.get("id")
                entry = {"rank": row.get("position"), "pts": row.get("points")}
                if tid:
                    out[tid] = entry
                # Also index by lowercased name so Phase 1 fixtures (ESPN/Flashscore
                # team IDs) can still look up standings via team name.
                tname = (team.get("name") or "").strip().lower()
                if tname:
                    out[tname] = entry
    _STANDINGS_CACHE[key] = out
    return out


# ----------------------------------------------------------------------------
# Team Elo --------------------------------------------------------------------
# Module-level cache populated by compute_team_elo() and consumed by the
# predictor. Maps SofaScore team_id -> Elo rating (float).
_TEAM_ELO = {}


def compute_team_elo(store):
    """Rebuild every team's Elo from scratch by walking all FT matches in
    chronological order. Deterministic, idempotent, and survives manual
    edits to match_data.json. Persists to team_elo.json and also updates
    the module-level _TEAM_ELO cache.

    Returns: {team_id: rating}.
    """
    finished = []
    for L in store.get("leagues", []):
        for m in L.get("matches", []):
            if m.get("status") != "FT": continue
            h = m.get("home") or {}; a = m.get("away") or {}
            h_id = h.get("team_id"); a_id = a.get("team_id")
            hg = h.get("goals"); ag = a.get("goals")
            if not h_id or not a_id or hg is None or ag is None: continue
            finished.append({
                "date": m.get("date") or "",
                "time": m.get("time") or "",
                "h_id": h_id, "a_id": a_id, "hg": int(hg), "ag": int(ag),
            })
    finished.sort(key=lambda x: (x["date"], x["time"]))

    elo = {}
    for fx in finished:
        rh = elo.get(fx["h_id"], ELO_INIT)
        ra = elo.get(fx["a_id"], ELO_INIT)
        # Expected score for home, including home-field advantage
        e_h = 1.0 / (1.0 + 10 ** ((ra - rh - ELO_HOME_ADV) / 400.0))
        e_a = 1.0 - e_h
        if fx["hg"] > fx["ag"]:
            s_h, s_a = 1.0, 0.0
        elif fx["hg"] < fx["ag"]:
            s_h, s_a = 0.0, 1.0
        else:
            s_h, s_a = 0.5, 0.5
        elo[fx["h_id"]] = rh + ELO_K * (s_h - e_h)
        elo[fx["a_id"]] = ra + ELO_K * (s_a - e_a)

    # Persist a sorted, human-readable snapshot. Keys are team_ids (str in JSON).
    snapshot = {
        "computed_at": TODAY.isoformat(),
        "n_matches": len(finished),
        "params": {"init": ELO_INIT, "K": ELO_K, "home_adv": ELO_HOME_ADV},
        "ratings": {str(tid): round(r, 2) for tid, r in sorted(elo.items(), key=lambda kv: -kv[1])},
    }
    ELO_STORE.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    _TEAM_ELO.clear(); _TEAM_ELO.update(elo)
    return elo


def predict_enhanced(h_att, h_def, a_att, a_def, h_name, a_name, streaks,
                     h2h=None, h_rank=None, h_pts=None, a_rank=None, a_pts=None,
                     h_team_id=None, a_team_id=None, league=None, market_odds=None,
                     market_context=None):
    """Poisson prediction enhanced with H2H, Elo, and Dixon-Coles correction.

    Lambda construction:
      base_h = (h_attack + a_defence) / 2
      base_a = (a_attack + h_defence) / 2

      H2H adjustment (weight 0.25): bias toward team that has historically scored
      more in this matchup, capped at +/-0.5 goals.

      Elo adjustment (replaces the rank/pts nudge): elo_diff = R_home - R_away,
      lambda_bump = clip(elo_diff / 400, +/-0.4). Applied symmetrically.

      Home advantage: +0.20 to home, -0.05 to away.

    All adjustments clipped, then floor at 0.20.

    Joint distribution: independent Poisson grid * Dixon-Coles tau on the
    four low-score cells, then renormalised to sum to 1.

    `h_rank` / `a_rank` are still threaded through to factors for the UI
    rationale ("league rank X vs Y") but no longer drive the lambdas.
    """
    base_h = (h_att + a_def) / 2
    base_a = (a_att + h_def) / 2

    # H2H: average goals each side scored when these two played
    h2h_h = h2h_a = 0.0
    h2h_home_wins = h2h_away_wins = h2h_draws = 0
    h2h_home_goals = h2h_away_goals = 0
    if h2h:
        h2h_home_goals = sum(m["h_scored"] for m in h2h)
        h2h_away_goals = sum(m["a_scored"] for m in h2h)
        h2h_home_wins = sum(1 for m in h2h if m["h_scored"] > m["a_scored"])
        h2h_away_wins = sum(1 for m in h2h if m["a_scored"] > m["h_scored"])
        h2h_draws = len(h2h) - h2h_home_wins - h2h_away_wins
        h2h_h = h2h_home_goals / len(h2h)
        h2h_a = h2h_away_goals / len(h2h)
        # Delta from current base — capped weighting
        h2h_delta_h = max(-0.5, min(0.5, (h2h_h - base_h) * 0.25))
        h2h_delta_a = max(-0.5, min(0.5, (h2h_a - base_a) * 0.25))
    else:
        h2h_delta_h = h2h_delta_a = 0.0

    # Elo differential. Missing teams (never appeared FT) default to ELO_INIT
    # so the bump cleanly collapses to zero.
    home_elo = _TEAM_ELO.get(h_team_id, ELO_INIT) if h_team_id else ELO_INIT
    away_elo = _TEAM_ELO.get(a_team_id, ELO_INIT) if a_team_id else ELO_INIT
    elo_diff = home_elo - away_elo
    elo_bump = max(-ELO_LAMBDA_CAP, min(ELO_LAMBDA_CAP, elo_diff / ELO_LAMBDA_SCALE))
    elo_adj_h = elo_bump
    elo_adj_a = -elo_bump
    context_adj = market_context_adjustment(market_context)

    # Final lambdas
    lh = max(0.20, base_h + 0.20 + h2h_delta_h + elo_adj_h + context_adj["home_lambda"])
    la = max(0.20, base_a - 0.05 + h2h_delta_a + elo_adj_a + context_adj["away_lambda"])

    pmf = lambda k, l: math.exp(-l) * (l ** k) / math.factorial(k)
    grid = [[pmf(i, lh) * pmf(j, la) for j in range(7)] for i in range(7)]

    # Dixon-Coles low-score correction. tau adjusts only (0,0), (1,0), (0,1),
    # (1,1); everything else has tau=1. Renormalise the 7x7 grid so the
    # truncated joint pmf still sums to 1.
    rho = DIXON_COLES_RHO
    grid[0][0] *= (1.0 - lh * la * rho)
    grid[1][0] *= (1.0 + la * rho)
    grid[0][1] *= (1.0 + lh * rho)
    grid[1][1] *= (1.0 - rho)
    total = sum(grid[i][j] for i in range(7) for j in range(7))
    if total > 0:
        grid = [[grid[i][j] / total for j in range(7)] for i in range(7)]

    p_h = sum(grid[i][j] for i in range(7) for j in range(7) if i > j)
    p_d = sum(grid[i][i] for i in range(7))
    p_a = sum(grid[i][j] for i in range(7) for j in range(7) if j > i)
    raw_p_h, raw_p_d, raw_p_a = normalize_three_way(p_h, p_d, p_a)
    winner_cal = calibration_adjustment(league, "winner")
    p_h = shrink_probability(raw_p_h, winner_cal["trust_factor"], 1 / 3)
    p_d = shrink_probability(raw_p_d, winner_cal["trust_factor"], 1 / 3)
    p_a = shrink_probability(raw_p_a, winner_cal["trust_factor"], 1 / 3)
    p_h, p_d, p_a = normalize_three_way(p_h, p_d, p_a)
    model_probabilities = {"home": p_h, "draw": p_d, "away": p_a}
    winner_probabilities, bookmaker_probabilities = blend_three_way_with_bookmaker(model_probabilities, market_odds)
    p_h, p_d, p_a = winner_probabilities["home"], winner_probabilities["draw"], winner_probabilities["away"]
    winner_side = choose_winner_side(winner_probabilities)
    if winner_side == "home":
        w = {"pick": h_name, "type": "home", "probability": round(p_h, 4), "raw_probability": round(raw_p_h, 4)}
    elif winner_side == "away":
        w = {"pick": a_name, "type": "away", "probability": round(p_a, 4), "raw_probability": round(raw_p_a, 4)}
    else:
        w = {"pick": "Draw", "type": "draw", "probability": round(p_d, 4), "raw_probability": round(raw_p_d, 4)}
    w["probabilities"] = {"home": round(p_h, 4), "draw": round(p_d, 4), "away": round(p_a, 4)}
    w["model_probabilities"] = {side: round(value, 4) for side, value in model_probabilities.items()}
    w["raw_probabilities"] = {"home": round(raw_p_h, 4), "draw": round(raw_p_d, 4), "away": round(raw_p_a, 4)}
    if bookmaker_probabilities:
        w["bookmaker_probabilities"] = {side: round(value, 4) for side, value in bookmaker_probabilities.items()}
        w["bookmaker_blend_weight"] = WINNER_BOOKMAKER_BLEND
    if winner_cal["sources"]:
        w["calibration"] = winner_cal

    # BTTS / OU goals are now derived from the Dixon-Coles-corrected grid so
    # the low-score adjustment flows through to all markets, not just 1X2.
    p_btts_yes = sum(grid[i][j] for i in range(7) for j in range(7) if i > 0 and j > 0)
    p_under_25 = sum(grid[i][j] for i in range(7) for j in range(7) if i + j < 3)
    p_over_25 = 1 - p_under_25
    if context_adj.get("btts_prior") is not None:
        p_btts_yes = (
            p_btts_yes * (1 - BOOKMAKER_CONTEXT_BTTS_WEIGHT)
            + context_adj["btts_prior"] * BOOKMAKER_CONTEXT_BTTS_WEIGHT
        )
    p_over_25, p_btts_yes, league_goal_profile = league_goal_profile_adjustment(league, p_over_25, p_btts_yes)
    btts_cal = calibration_adjustment(league, "btts")
    p_btts_yes_cal = shrink_probability(p_btts_yes, btts_cal["trust_factor"], 0.5)
    btts_pick = "Yes" if p_btts_yes_cal > BTTS_YES_THRESHOLD else "No"
    btts_probability = p_btts_yes_cal if btts_pick == "Yes" else 1 - p_btts_yes_cal
    btts_raw_probability = p_btts_yes if btts_pick == "Yes" else 1 - p_btts_yes
    btts = {
        "pick": btts_pick,
        "probability": round(btts_probability, 4),
        "raw_probability": round(btts_raw_probability, 4),
    }
    if btts_cal["sources"]:
        btts["calibration"] = btts_cal
    if league_goal_profile:
        btts["league_goal_profile"] = league_goal_profile

    goals_cal = calibration_adjustment(league, "ou_goals")
    p_over_25_cal = shrink_probability(p_over_25, goals_cal["trust_factor"], 0.5)
    goals_pick = "Over" if p_over_25_cal >= 0.55 else "Under"
    goals_probability = p_over_25_cal if goals_pick == "Over" else 1 - p_over_25_cal
    goals_raw_probability = p_over_25 if goals_pick == "Over" else 1 - p_over_25
    ou_goals = {
        "pick": goals_pick,
        "line": 2.5,
        "probability": round(goals_probability, 4),
        "raw_probability": round(goals_raw_probability, 4),
    }
    if goals_cal["sources"]:
        ou_goals["calibration"] = goals_cal
    if league_goal_profile:
        ou_goals["league_goal_profile"] = league_goal_profile

    over = sum(1 for s in (streaks or []) if "more than 4.5 cards" in (s.get("label") or "").lower())
    under = sum(1 for s in (streaks or []) if "less than 4.5 cards" in (s.get("label") or "").lower())
    card_raw_over_probability = (over + 1) / (over + under + 2)
    if context_adj.get("cards_over_prior") is not None:
        card_raw_over_probability = (
            card_raw_over_probability * (1 - BOOKMAKER_CONTEXT_CARDS_WEIGHT)
            + context_adj["cards_over_prior"] * BOOKMAKER_CONTEXT_CARDS_WEIGHT
        )
    cards_cal = calibration_adjustment(league, "ou_cards")
    card_over_probability = shrink_probability(card_raw_over_probability, cards_cal["trust_factor"], 0.5)
    cards_pick = "Over" if card_over_probability >= CARDS_OVER_THRESHOLD else "Under"
    cards_probability = card_over_probability if cards_pick == "Over" else 1 - card_over_probability
    cards_raw_probability = card_raw_over_probability if cards_pick == "Over" else 1 - card_raw_over_probability
    cards = {
        "pick": cards_pick,
        "line": 4.5,
        "probability": round(cards_probability, 4),
        "raw_probability": round(cards_raw_probability, 4),
        "over_probability": round(card_over_probability, 4),
        "raw_over_probability": round(card_raw_over_probability, 4),
        "over_threshold": CARDS_OVER_THRESHOLD,
    }
    if cards_cal["sources"]:
        cards["calibration"] = cards_cal
    factors = {
        "lambda_home": round(lh, 3),
        "lambda_away": round(la, 3),
        "h2h_n": len(h2h or []),
        "h2h_home_wins": h2h_home_wins,
        "h2h_away_wins": h2h_away_wins,
        "h2h_draws": h2h_draws,
        "h2h_home_goals": h2h_home_goals,
        "h2h_away_goals": h2h_away_goals,
        "h_rank": h_rank, "a_rank": a_rank,
        "home_elo": round(home_elo, 1),
        "away_elo": round(away_elo, 1),
        "dixon_coles_rho": DIXON_COLES_RHO,
        "winner_bookmaker_blend": WINNER_BOOKMAKER_BLEND if bookmaker_probabilities else 0,
        "draw_rule": {
            "min_probability": DRAW_MIN_PROBABILITY,
            "max_home_away_gap": DRAW_MAX_HOME_AWAY_GAP,
            "max_favourite_gap": DRAW_MAX_FAVOURITE_GAP,
        },
        "cards_over_threshold": CARDS_OVER_THRESHOLD,
        "cards_over_streaks": over,
        "cards_under_streaks": under,
        "bookmaker_context_source": context_adj.get("source") or "",
        "bookmaker_context_home_lambda": round(context_adj["home_lambda"], 3),
        "bookmaker_context_away_lambda": round(context_adj["away_lambda"], 3),
        "bookmaker_context_signals": context_adj.get("signals") or [],
        "league_goal_profile": league_goal_profile or {},
        "model_calibration": _MODEL_CALIBRATION.get("generated_at", "") if _MODEL_CALIBRATION else "",
    }
    return {"winner": w, "btts": btts, "ou_goals": ou_goals, "ou_cards": cards,
            "factors": factors}


# Backwards-compat shim — keeps phase_a6_retro working without an explicit
# context payload. Accepts optional team ids so Elo still applies in retro mode.
def predict_poisson(h_att, h_def, a_att, a_def, h_name, a_name, streaks,
                    h_team_id=None, a_team_id=None, league=None, market_odds=None):
    return predict_enhanced(h_att, h_def, a_att, a_def, h_name, a_name, streaks,
                            h_team_id=h_team_id, a_team_id=a_team_id, league=league,
                            market_odds=market_odds)


def has_real_three_way_odds(odds):
    return bool(bookmaker_three_way_probabilities(odds))


def market_odds_for_match(match, prefer_original=False):
    keys = ("odds", "sportsbet_odds") if prefer_original else ("sportsbet_odds", "odds")
    for key in keys:
        odds = match.get(key) or {}
        if has_real_three_way_odds(odds):
            return {side: float(odds[side]) for side in ("home", "draw", "away")}
    return None


def match_profile_datetime(match):
    kickoff = match_kickoff_datetime(match)
    if kickoff:
        return kickoff
    match_date = parse_match_date(match.get("date"))
    if not match_date:
        return None
    return datetime(match_date.year, match_date.month, match_date.day, tzinfo=ADL)


def mean(values):
    values = [float(value) for value in values if isinstance(value, (int, float))]
    return sum(values) / len(values) if values else None


def round_or_none(value, digits=3):
    return round(value, digits) if isinstance(value, (int, float)) else None


def team_recent_profile(all_matches, team_id, current_match_id=None, current_dt=None, venue=None, limit=6):
    if not team_id or not isinstance(all_matches, list):
        return {}
    team_key = str(team_id)
    rows = []
    for match in all_matches:
        if match.get("status") != "FT" or match.get("id") == current_match_id:
            continue
        home = match.get("home") or {}
        away = match.get("away") or {}
        is_home = str(home.get("team_id")) == team_key
        is_away = str(away.get("team_id")) == team_key
        if not is_home and not is_away:
            continue
        if venue == "home" and not is_home:
            continue
        if venue == "away" and not is_away:
            continue
        played_at = match_profile_datetime(match)
        if current_dt and played_at and played_at >= current_dt:
            continue
        home_goals = home.get("goals")
        away_goals = away.get("goals")
        if not isinstance(home_goals, (int, float)) or not isinstance(away_goals, (int, float)):
            continue
        actuals = match.get("actuals") or {}
        prefix = "home" if is_home else "away"
        opp_prefix = "away" if is_home else "home"
        goals_for = float(home_goals if is_home else away_goals)
        goals_against = float(away_goals if is_home else home_goals)
        points = 3 if goals_for > goals_against else 1 if goals_for == goals_against else 0
        rows.append({
            "date": match.get("date") or "",
            "time": match.get("time") or "",
            "played_at": played_at,
            "goals_for": goals_for,
            "goals_against": goals_against,
            "points": points,
            "sot_for": actuals.get(f"{prefix}_sot"),
            "sot_against": actuals.get(f"{opp_prefix}_sot"),
            "corners_for": actuals.get(f"{prefix}_corners"),
            "corners_against": actuals.get(f"{opp_prefix}_corners"),
            "fouls_for": actuals.get(f"{prefix}_fouls"),
            "fouls_against": actuals.get(f"{opp_prefix}_fouls"),
            "cards_for": actuals.get(f"{prefix}_cards"),
            "cards_against": actuals.get(f"{opp_prefix}_cards"),
        })
    rows.sort(key=lambda row: (row["date"], row["time"]), reverse=True)
    rows = rows[:limit]
    if not rows:
        return {}
    most_recent = next((row["played_at"] for row in rows if row.get("played_at")), None)
    rest_days = None
    if current_dt and most_recent:
        rest_days = max(0.0, (current_dt - most_recent).total_seconds() / 86400)
    profile = {
        "played": len(rows),
        "goals_for_pg": round_or_none(mean([row["goals_for"] for row in rows])),
        "goals_against_pg": round_or_none(mean([row["goals_against"] for row in rows])),
        "points_per_match": round_or_none(mean([row["points"] for row in rows])),
        "shots_on_target_for": round_or_none(mean([row["sot_for"] for row in rows])),
        "shots_on_target_against": round_or_none(mean([row["sot_against"] for row in rows])),
        "corners_for": round_or_none(mean([row["corners_for"] for row in rows])),
        "corners_against": round_or_none(mean([row["corners_against"] for row in rows])),
        "fouls_for": round_or_none(mean([row["fouls_for"] for row in rows])),
        "fouls_against": round_or_none(mean([row["fouls_against"] for row in rows])),
        "cards_for": round_or_none(mean([row["cards_for"] for row in rows])),
        "cards_against": round_or_none(mean([row["cards_against"] for row in rows])),
        "rest_days": round_or_none(rest_days, 1),
    }
    return {key: value for key, value in profile.items() if value is not None}


def internal_prediction_context(match, all_matches):
    if match.get("status") == "FT" or match.get("prediction_locked") or not all_matches:
        return None
    current_dt = match_profile_datetime(match)
    home = match.get("home") or {}
    away = match.get("away") or {}
    home_profile = team_recent_profile(all_matches, home.get("team_id"), match.get("id"), current_dt, limit=6)
    away_profile = team_recent_profile(all_matches, away.get("team_id"), match.get("id"), current_dt, limit=6)
    home_venue = team_recent_profile(all_matches, home.get("team_id"), match.get("id"), current_dt, venue="home", limit=4)
    away_venue = team_recent_profile(all_matches, away.get("team_id"), match.get("id"), current_dt, venue="away", limit=4)
    if home_venue.get("points_per_match") is not None:
        home_profile["venue_points_per_match"] = home_venue["points_per_match"]
    if away_venue.get("points_per_match") is not None:
        away_profile["venue_points_per_match"] = away_venue["points_per_match"]

    expected_corners = mean([
        home_profile.get("corners_for"),
        away_profile.get("corners_against"),
        away_profile.get("corners_for"),
        home_profile.get("corners_against"),
    ])
    expected_cards = mean([
        home_profile.get("cards_for"),
        away_profile.get("cards_against"),
        away_profile.get("cards_for"),
        home_profile.get("cards_against"),
    ])
    expected_fouls = mean([
        home_profile.get("fouls_for"),
        away_profile.get("fouls_against"),
        away_profile.get("fouls_for"),
        home_profile.get("fouls_against"),
    ])
    if not home_profile and not away_profile:
        return None
    context = {
        "source": "internal_predictive_profile",
        "home": home_profile,
        "away": away_profile,
    }
    if expected_corners is not None:
        context["corners_avg"] = round(expected_corners, 2)
    if expected_cards is not None:
        context["cards_avg"] = round(expected_cards, 2)
    if expected_fouls is not None:
        context["fouls_avg"] = round(expected_fouls, 2)
    return context


def merge_prediction_contexts(primary, secondary):
    if not primary:
        return secondary
    if not secondary:
        return primary
    merged = dict(primary)
    merged["source"] = f"{primary.get('source') or primary.get('provider') or 'external_context'}+internal_predictive_profile"
    for side in ("home", "away"):
        merged[side] = {**(secondary.get(side) or {}), **(primary.get(side) or {})}
    for key, value in secondary.items():
        if key in {"source", "home", "away"}:
            continue
        merged.setdefault(key, value)
    return merged


def prediction_context_for_match(match, all_matches=None):
    external = prediction_market_context(match)
    internal = internal_prediction_context(match, all_matches or [])
    return merge_prediction_contexts(external, internal)


def context_side(match, side):
    context = match.get("statshub_context") or match.get("bet365_context") or match.get("bookmaker_context") or {}
    side_context = context.get(side) or {}
    team = match.get(side) or {}
    merged = dict(side_context)
    for key, value in team.items():
        if key not in merged and value not in (None, "", [], {}):
            merged[key] = value
    return merged


def context_number(payload, *keys):
    for key in keys:
        value = to_float(payload.get(key))
        if value is not None:
            return value
    return None


def context_ratio(numerator, denominator):
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator


def bounded(value, limit):
    return max(-limit, min(limit, value))


def prediction_market_context(match):
    """Return future-only bookmaker/stat context for the predictor.

    Resulted rows are intentionally excluded so new context can never rewrite
    the historical pick ledger.
    """
    if match.get("status") == "FT" or match.get("prediction_locked"):
        return None
    context = match.get("statshub_context") or match.get("bet365_context") or match.get("bookmaker_context")
    home = context_side(match, "home")
    away = context_side(match, "away")
    if not context and not any(key in home or key in away for key in ("rank", "pts", "overall_form", "overall_form_score")):
        return None
    payload = {
        "source": (context or {}).get("source") or (context or {}).get("provider") or "bookmaker_context",
        "home": home,
        "away": away,
    }
    for key in ("cards_avg", "average_cards", "total_cards_avg", "corners_avg", "average_corners", "total_corners_avg"):
        if (context or {}).get(key) is not None:
            payload[key] = (context or {}).get(key)
    return payload


def market_context_adjustment(context):
    empty = {
        "source": "",
        "home_lambda": 0.0,
        "away_lambda": 0.0,
        "btts_prior": None,
        "cards_over_prior": None,
        "signals": [],
    }
    if not context:
        return empty

    home = context.get("home") or {}
    away = context.get("away") or {}
    signals = []
    home_delta = away_delta = 0.0

    home_form = context_number(home, "overall_form", "overall_form_score", "form_score")
    away_form = context_number(away, "overall_form", "overall_form_score", "form_score")
    if home_form is not None and away_form is not None:
        form_delta = bounded((home_form - away_form) / 100.0 * 0.30, BOOKMAKER_CONTEXT_LAMBDA_CAP)
        home_delta += form_delta
        away_delta -= form_delta
        signals.append("overall_form")

    home_rank = context_number(home, "rank", "league_position", "position")
    away_rank = context_number(away, "rank", "league_position", "position")
    if home_rank is not None and away_rank is not None and home_rank > 0 and away_rank > 0:
        rank_delta = bounded((away_rank - home_rank) * 0.025, 0.18)
        home_delta += rank_delta
        away_delta -= rank_delta
        signals.append("league_position")

    home_played = context_number(home, "played", "matches_played", "p")
    away_played = context_number(away, "played", "matches_played", "p")
    home_gf = context_number(home, "goals_for", "gf")
    away_gf = context_number(away, "goals_for", "gf")
    home_ga = context_number(home, "goals_against", "ga")
    away_ga = context_number(away, "goals_against", "ga")
    h_gf_pg = context_ratio(home_gf, home_played)
    a_gf_pg = context_ratio(away_gf, away_played)
    h_ga_pg = context_ratio(home_ga, home_played)
    a_ga_pg = context_ratio(away_ga, away_played)
    if h_gf_pg is not None and a_ga_pg is not None:
        home_delta += bounded(((h_gf_pg + a_ga_pg) / 2.0 - DEFAULT_PREMATCH_TEAM_GOALS) * 0.18, 0.16)
        signals.append("season_goals")
    if a_gf_pg is not None and h_ga_pg is not None:
        away_delta += bounded(((a_gf_pg + h_ga_pg) / 2.0 - DEFAULT_PREMATCH_TEAM_GOALS) * 0.18, 0.16)
        signals.append("season_goals")

    h_recent_gf = context_number(home, "goals_for_pg")
    h_recent_ga = context_number(home, "goals_against_pg")
    a_recent_gf = context_number(away, "goals_for_pg")
    a_recent_ga = context_number(away, "goals_against_pg")
    if h_recent_gf is not None and a_recent_ga is not None:
        home_delta += bounded(((h_recent_gf + a_recent_ga) / 2.0 - DEFAULT_PREMATCH_TEAM_GOALS) * 0.16, 0.14)
        signals.append("recent_goals")
    if a_recent_gf is not None and h_recent_ga is not None:
        away_delta += bounded(((a_recent_gf + h_recent_ga) / 2.0 - DEFAULT_PREMATCH_TEAM_GOALS) * 0.16, 0.14)
        signals.append("recent_goals")

    h_sot_for = context_number(home, "shots_on_target_for")
    h_sot_against = context_number(home, "shots_on_target_against")
    a_sot_for = context_number(away, "shots_on_target_for")
    a_sot_against = context_number(away, "shots_on_target_against")
    if h_sot_for is not None and a_sot_against is not None:
        home_delta += bounded(((h_sot_for + a_sot_against) / 2.0 - 4.2) * 0.045, 0.14)
        signals.append("shots_on_target")
    if a_sot_for is not None and h_sot_against is not None:
        away_delta += bounded(((a_sot_for + h_sot_against) / 2.0 - 4.2) * 0.045, 0.14)
        signals.append("shots_on_target")

    h_ppg = context_number(home, "points_per_match")
    a_ppg = context_number(away, "points_per_match")
    if h_ppg is not None and a_ppg is not None:
        form_delta = bounded((h_ppg - a_ppg) * 0.055, 0.12)
        home_delta += form_delta
        away_delta -= form_delta
        signals.append("recent_points")

    h_venue_ppg = context_number(home, "venue_points_per_match")
    a_venue_ppg = context_number(away, "venue_points_per_match")
    if h_venue_ppg is not None and a_venue_ppg is not None:
        venue_delta = bounded((h_venue_ppg - a_venue_ppg) * 0.035, 0.08)
        home_delta += venue_delta
        away_delta -= venue_delta
        signals.append("home_away_split")

    h_rest = context_number(home, "rest_days")
    a_rest = context_number(away, "rest_days")
    if h_rest is not None and a_rest is not None:
        if h_rest < 3:
            home_delta -= bounded((3 - h_rest) * 0.035, 0.10)
        if a_rest < 3:
            away_delta -= bounded((3 - a_rest) * 0.035, 0.10)
        if abs(h_rest - a_rest) >= 2:
            rest_delta = bounded((h_rest - a_rest) * 0.018, 0.08)
            home_delta += rest_delta
            away_delta -= rest_delta
        signals.append("rest_days")

    h_btts = context_number(home, "btts", "both_teams_to_score")
    a_btts = context_number(away, "btts", "both_teams_to_score")
    h_btts_rate = context_ratio(h_btts, home_played)
    a_btts_rate = context_ratio(a_btts, away_played)
    btts_prior = None
    if h_btts_rate is not None and a_btts_rate is not None:
        btts_prior = max(0.25, min(0.75, (h_btts_rate + a_btts_rate) / 2.0))
        signals.append("season_btts")

    cards_total = context_number(context, "cards_avg", "average_cards", "total_cards_avg")
    if cards_total is None:
        fouls_total = context_number(context, "fouls_avg", "average_fouls", "total_fouls_avg")
        if fouls_total is not None:
            cards_total = max(2.5, min(7.5, fouls_total * 0.19))
            signals.append("fouls_card_proxy")
    cards_over_prior = None
    if cards_total is not None:
        cards_over_prior = max(0.15, min(0.85, poisson_over_probability(cards_total, 4.5) or 0.5))
        signals.append("cards_average")

    return {
        "source": context.get("source") or "bookmaker_context",
        "home_lambda": bounded(home_delta, max(BOOKMAKER_CONTEXT_LAMBDA_CAP, INTERNAL_PROFILE_LAMBDA_CAP)),
        "away_lambda": bounded(away_delta, max(BOOKMAKER_CONTEXT_LAMBDA_CAP, INTERNAL_PROFILE_LAMBDA_CAP)),
        "btts_prior": btts_prior,
        "cards_over_prior": cards_over_prior,
        "signals": sorted(set(signals)),
    }


def league_goal_baseline(matches):
    totals = []
    for match in matches:
        if match.get("status") != "FT":
            continue
        home_goals = (match.get("home") or {}).get("goals")
        away_goals = (match.get("away") or {}).get("goals")
        if isinstance(home_goals, (int, float)) and isinstance(away_goals, (int, float)):
            totals.append(float(home_goals) + float(away_goals))
    if not totals:
        return DEFAULT_PREMATCH_TEAM_GOALS
    per_team = sum(totals) / (len(totals) * 2)
    return max(0.9, min(1.8, per_team))


def pre_prediction_form_inputs(match, league_matches, odds):
    base = league_goal_baseline(league_matches)
    market = bookmaker_three_way_probabilities(odds) or {}
    bias = max(-0.45, min(0.45, (market.get("home", 1 / 3) - market.get("away", 1 / 3)) * 1.2))
    home_boost = max(0.0, bias)
    away_boost = max(0.0, -bias)
    return (
        base + home_boost,
        base + away_boost * 0.5,
        base + away_boost,
        base + home_boost * 0.5,
    )


def poisson_over_probability(lam, line, max_goals=40):
    if not isinstance(lam, (int, float)) or lam <= 0:
        return None
    cutoff = int(math.floor(float(line)))
    under_or_equal = 0.0
    for k in range(min(cutoff, max_goals) + 1):
        under_or_equal += math.exp(-lam) * (lam ** k) / math.factorial(k)
    return max(0.0, min(1.0, 1.0 - under_or_equal))


def average_corners_for_scope(matches, fallback=DEFAULT_PREMATCH_CORNERS_TOTAL):
    values = []
    for match in matches:
        if match.get("status") != "FT":
            continue
        actual = (match.get("actuals") or {}).get("corners_total")
        if isinstance(actual, (int, float)):
            values.append(float(actual))
    if not values:
        return fallback
    return max(7.0, min(13.5, sum(values) / len(values)))


def context_corner_average(match, all_matches=None):
    context = prediction_context_for_match(match, all_matches)
    if not context:
        return None, None
    value = context_number(context, "corners_avg", "average_corners", "total_corners_avg")
    if value is None:
        return None, context
    return max(7.0, min(13.5, value)), context


def corner_odds_for_prediction(match, line, pick):
    odds_by_line = match.get("corner_odds") or {}
    prices = odds_by_line.get(str(line)) or odds_by_line.get(f"{float(line):.1f}") or {}
    value = prices.get(pick)
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value > 1.01 else None


def pre_corners_prediction(match, league_matches, all_matches):
    line = 10.5
    context_avg, context = context_corner_average(match, all_matches)
    league_avg = average_corners_for_scope(league_matches, None)
    avg = context_avg if context_avg is not None else (league_avg if league_avg is not None else average_corners_for_scope(all_matches))
    p_over = poisson_over_probability(avg, line)
    if p_over is None:
        p_over = 0.5
    pick = "Over" if p_over >= 0.53 else "Under"
    probability = p_over if pick == "Over" else 1 - p_over
    odds = corner_odds_for_prediction(match, line, pick)
    if odds:
        if probability > CORNER_MODEL_PROBABILITY_CAP:
            probability = CORNER_MODEL_PROBABILITY_CAP
    elif probability > NO_SPORTSBET_CORNER_PROBABILITY_CAP:
        probability = NO_SPORTSBET_CORNER_PROBABILITY_CAP
    context_source = (context or {}).get("source") or ""
    source_label = "Bookmaker context corners" if context_source and context_source != "internal_predictive_profile" else "Pre-match corners baseline"
    market = {
        "pick": pick,
        "line": line,
        "probability": round(probability, 4),
        "model_probability": round(probability, 4),
        "model_average_total": round(avg, 2),
        "sourceLabel": source_label,
        "sourceValue": f"{avg:.1f} avg",
        "team": "both",
        "model_probability_cap": CORNER_MODEL_PROBABILITY_CAP,
    }
    if odds:
        market["odds"] = odds
    else:
        market.update({
            "confidence_hidden": True,
            "confidence_reason": "No Sportsbet corner odds for this side/line.",
            "no_sportsbet_corner_odds": True,
            "no_odds_probability_cap": NO_SPORTSBET_CORNER_PROBABILITY_CAP,
        })
    return market


def probability_for_yes_or_over(market, positive_pick):
    if not market:
        return None
    raw = to_float(market.get("raw_probability"))
    chosen = to_float(market.get("probability"))
    if raw is None:
        raw = chosen
    if raw is None:
        return None
    return max(0.0, min(1.0, raw if market.get("pick") == positive_pick else 1 - raw))


def apply_league_goal_profile_to_existing_predictions(match, league_name):
    if league_name not in LEAGUE_GOAL_PROFILES:
        return False
    if match.get("status") == "FT" or match.get("prediction_locked"):
        return False

    predictions = match.get("predictions") or {}
    btts = predictions.get("btts")
    goals = predictions.get("ou_goals")
    if not isinstance(btts, dict) or not isinstance(goals, dict):
        return False
    if btts.get("league_goal_profile") or goals.get("league_goal_profile"):
        return False

    p_btts_yes = probability_for_yes_or_over(btts, "Yes")
    p_over_25 = probability_for_yes_or_over(goals, "Over")
    if p_btts_yes is None and p_over_25 is None:
        return False

    adjusted_over, adjusted_btts, profile = league_goal_profile_adjustment(league_name, p_over_25, p_btts_yes)
    if not profile:
        return False

    changed = False
    if adjusted_btts is not None:
        btts_pick = "Yes" if adjusted_btts > BTTS_YES_THRESHOLD else "No"
        btts_probability = adjusted_btts if btts_pick == "Yes" else 1 - adjusted_btts
        if btts.get("pick") != btts_pick or round(to_float(btts.get("probability")) or 0.0, 4) != round(btts_probability, 4):
            btts.update({
                "pick": btts_pick,
                "probability": round(btts_probability, 4),
                "raw_probability": round(adjusted_btts if btts_pick == "Yes" else 1 - adjusted_btts, 4),
                "league_goal_profile": profile,
            })
            changed = True

    if adjusted_over is not None:
        goals_pick = "Over" if adjusted_over >= 0.55 else "Under"
        goals_probability = adjusted_over if goals_pick == "Over" else 1 - adjusted_over
        if goals.get("pick") != goals_pick or round(to_float(goals.get("probability")) or 0.0, 4) != round(goals_probability, 4):
            goals.update({
                "pick": goals_pick,
                "line": goals.get("line", 2.5),
                "probability": round(goals_probability, 4),
                "raw_probability": round(adjusted_over if goals_pick == "Over" else 1 - adjusted_over, 4),
                "league_goal_profile": profile,
            })
            changed = True

    if changed:
        factors = predictions.setdefault("factors", {})
        factors["league_goal_profile"] = profile
    return changed


def apply_corner_probability_cap_to_existing_prediction(match):
    if match.get("status") == "FT" or match.get("prediction_locked"):
        return False
    predictions = match.get("predictions") or {}
    corners = predictions.get("ou_corners")
    if not isinstance(corners, dict):
        return False
    odds = corner_odds_for_prediction(match, corners.get("line", 10.5), corners.get("pick"))
    probability = to_float(corners.get("model_probability"))
    if probability is None:
        probability = to_float(corners.get("probability"))
    if probability is None:
        return False

    cap = CORNER_MODEL_PROBABILITY_CAP if odds else NO_SPORTSBET_CORNER_PROBABILITY_CAP
    changed = False
    if probability > cap:
        corners["probability"] = cap
        corners["model_probability"] = cap
        changed = True
    if odds:
        corners["model_probability_cap"] = CORNER_MODEL_PROBABILITY_CAP
        for key in ("confidence_hidden", "confidence_reason", "no_sportsbet_corner_odds", "no_odds_probability_cap"):
            if key in corners:
                corners.pop(key, None)
                changed = True
    else:
        corners["confidence_hidden"] = True
        corners["confidence_reason"] = "No Sportsbet corner odds for this side/line."
        corners["no_sportsbet_corner_odds"] = True
        corners["no_odds_probability_cap"] = NO_SPORTSBET_CORNER_PROBABILITY_CAP
        changed = True
    corners["model_probability_cap"] = cap
    return changed


def populate_pre_match_predictions(store, target_dates=None):
    """Fill missing pre-kickoff prediction objects before odds/display upload.

    This is intentionally only for non-FT matches. Resulted rows keep the hard
    truth rule: never create retro predictions after the score is known.
    """
    all_matches = [m for league in store.get("leagues", []) for m in league.get("matches", [])]
    created = 0
    corner_created = 0
    profiled = 0
    corner_capped = 0
    by_league = {}
    for league in store.get("leagues", []):
        league_name = league.get("name") or ""
        league_matches = league.get("matches", [])
        for match in league_matches:
            if target_dates and match.get("date") not in target_dates:
                continue
            if match.get("status") == "FT":
                continue
            predictions = match.setdefault("predictions", {})
            odds = market_odds_for_match(match)
            model_seed_odds = odds or {"home": 3.0, "draw": 3.2, "away": 3.0}
            h_name = (match.get("home") or {}).get("name") or "Home"
            a_name = (match.get("away") or {}).get("name") or "Away"
            before_keys = {key for key, value in predictions.items() if value}

            if not all(predictions.get(key) for key in ("winner", "btts", "ou_goals", "ou_cards")):
                h_att, h_def, a_att, a_def = pre_prediction_form_inputs(match, league_matches, model_seed_odds)
                market_context = prediction_context_for_match(match, all_matches)
                fallback = predict_enhanced(
                    h_att,
                    h_def,
                    a_att,
                    a_def,
                    h_name,
                    a_name,
                    match.get("team_streaks") or [],
                    h_team_id=(match.get("home") or {}).get("team_id"),
                    a_team_id=(match.get("away") or {}).get("team_id"),
                    league=league_name,
                    market_odds=model_seed_odds,
                    market_context=market_context,
                )
                fallback_factors = fallback.get("factors") or {}
                fallback_factors.update({
                    "source": "pre_match_prefill",
                    "source_note": (
                        "Generated before kickoff from available 1X2 odds plus bookmaker/internal context enrichment."
                        if odds and market_context else
                        "Generated before kickoff from available 1X2 odds plus league/global baselines because detailed team context was missing."
                        if odds else
                        "Generated before kickoff from model baselines because bookmaker 1X2 odds were unavailable."
                    ),
                    "data_quality": (
                        "Data usable"
                        if odds and market_context else
                        "Data weak"
                    ),
                    "bookmaker_odds_available": bool(odds),
                    "model_seed_odds": None if odds else model_seed_odds,
                })
                if not odds:
                    fallback_factors["caution"] = "Bookmaker market unavailable; use model-only predictions carefully."
                fallback["factors"] = {**fallback_factors, **(predictions.get("factors") or {})}
                for key in ("winner", "btts", "ou_goals", "ou_cards"):
                    if not predictions.get(key) and fallback.get(key):
                        predictions[key] = fallback[key]
                predictions["factors"] = fallback["factors"]

            if not predictions.get("ou_corners"):
                predictions["ou_corners"] = pre_corners_prediction(match, league_matches, all_matches)
                corner_created += 1
            if apply_league_goal_profile_to_existing_predictions(match, league_name):
                profiled += 1
            if apply_corner_probability_cap_to_existing_prediction(match):
                corner_capped += 1

            after_keys = {key for key, value in predictions.items() if value}
            delta = len(after_keys - before_keys)
            if delta:
                created += delta
                by_league[league_name] = by_league.get(league_name, 0) + delta

    if created or profiled or corner_capped:
        save_store(store)
    return {
        "created": created,
        "corner_created": corner_created,
        "profiled": profiled,
        "corner_capped": corner_capped,
        "by_league": by_league,
    }


def settle_generated_prediction_markets(match):
    home_goals = (match.get("home") or {}).get("goals")
    away_goals = (match.get("away") or {}).get("goals")
    if not isinstance(home_goals, (int, float)) or not isinstance(away_goals, (int, float)):
        return
    predictions = match.get("predictions") or {}
    actual_winner = "home" if home_goals > away_goals else ("away" if away_goals > home_goals else "draw")
    if predictions.get("winner"):
        predictions["winner"]["result"] = "hit" if predictions["winner"].get("type") == actual_winner else "miss"
        predictions["winner"].pop("picked", None)
    if predictions.get("btts"):
        actual_btts = home_goals > 0 and away_goals > 0
        predictions["btts"]["actual_btts"] = actual_btts
        predictions["btts"]["result"] = "hit" if (str(predictions["btts"].get("pick", "")).lower() == "yes") == actual_btts else "miss"
    if predictions.get("ou_goals"):
        total_goals = home_goals + away_goals
        line = float(predictions["ou_goals"].get("line", 2.5))
        predictions["ou_goals"]["actual"] = total_goals
        predictions["ou_goals"]["result"] = (
            "hit"
            if (predictions["ou_goals"].get("pick") == "Over" and total_goals > line)
            or (predictions["ou_goals"].get("pick") == "Under" and total_goals < line)
            else "miss"
        )
    settle_stat_markets(match)


def populate_today_new_league_calibration_predictions(store):
    """One-day exception for newly added leagues that need immediate calibration.

    Scope is deliberately narrow: only today's FT rows in the two newly added
    fallback leagues. This is not a general retro-prediction path.
    """
    today_iso = TODAY.isoformat()
    all_matches = [m for league in store.get("leagues", []) for m in league.get("matches", [])]
    created = 0
    settled = 0
    by_league = {}
    changed = 0
    for league in store.get("leagues", []):
        league_name = league.get("name") or ""
        if league_name not in PHASE_FIXTURE_FALLBACK_LEAGUES:
            continue
        league_matches = league.get("matches", [])
        for match in league_matches:
            if match.get("status") != "FT" or match.get("date") != today_iso:
                continue
            predictions = match.setdefault("predictions", {})
            before_payload = json.dumps(predictions, sort_keys=True, ensure_ascii=False)
            before_keys = {key for key, value in predictions.items() if value}
            odds = market_odds_for_match(match, prefer_original=True) or {"home": 3.0, "draw": 3.2, "away": 3.0}
            h_name = (match.get("home") or {}).get("name") or "Home"
            a_name = (match.get("away") or {}).get("name") or "Away"
            h_att, h_def, a_att, a_def = pre_prediction_form_inputs(match, league_matches, odds)
            fallback = predict_enhanced(
                h_att,
                h_def,
                a_att,
                a_def,
                h_name,
                a_name,
                match.get("team_streaks") or [],
                h_team_id=(match.get("home") or {}).get("team_id"),
                a_team_id=(match.get("away") or {}).get("team_id"),
                league=league_name,
                market_odds=odds,
            )
            fallback_factors = fallback.get("factors") or {}
            fallback_factors.update({
                "source": "today_new_league_calibration_exception",
                "source_note": f"One-day {today_iso} calibration exception for newly added leagues.",
                "data_quality": "Data weak",
                "calibration_exception_date": today_iso,
            })
            fallback["factors"] = {**fallback_factors, **(predictions.get("factors") or {})}
            can_replace_exception = (predictions.get("factors") or {}).get("source") == "today_new_league_calibration_exception"
            for key in ("winner", "btts", "ou_goals", "ou_cards"):
                if (can_replace_exception or not predictions.get(key)) and fallback.get(key):
                    predictions[key] = fallback[key]
            if can_replace_exception or not predictions.get("ou_corners"):
                predictions["ou_corners"] = pre_corners_prediction(match, league_matches, all_matches)
            predictions["factors"] = fallback["factors"]
            settle_generated_prediction_markets(match)
            after_keys = {key for key, value in predictions.items() if value}
            delta = len(after_keys - before_keys)
            after_payload = json.dumps(predictions, sort_keys=True, ensure_ascii=False)
            if after_payload != before_payload:
                changed += 1
            if delta:
                created += delta
                settled += 1
                by_league[league_name] = by_league.get(league_name, 0) + delta
    if changed:
        save_store(store)
    return {"created": created, "changed_matches": changed, "settled_matches": settled, "by_league": by_league}


def phase_a6_retro(store):
    done = 0
    factors_backfilled = 0
    protected = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") != "FT": continue
            # Hard rule: once a match is resulted, never create or reshape its
            # predictions with newer model logic. Only settlement may attach
            # actuals/results to predictions that already existed pre-result.
            m["prediction_locked"] = True
            protected += 1
    return {"retro": done, "factors_backfilled": factors_backfilled, "protected": protected}


def prune_stale_pending_matches(store):
    cutoff = TODAY - timedelta(days=RESULT_LOOKBACK_DAYS)
    pruned = []
    for league in store.get("leagues", []):
        keep = []
        for match in league.get("matches", []):
            match_date = parse_match_date(match.get("date"))
            if match.get("status") != "FT" and match_date and match_date < cutoff:
                pruned.append({
                    "league": league.get("name"),
                    "date": match.get("date"),
                    "time": match.get("time"),
                    "home": (match.get("home") or {}).get("name"),
                    "away": (match.get("away") or {}).get("name"),
                    "event_id": match.get("id"),
                })
                continue
            keep.append(match)
        league["matches"] = keep
    return pruned


# ----------------------------------------------------------------------------
def phase_b_forecast(store, seen_ids):
    by_name = {L["name"]: L for L in store["leagues"]}
    all_matches = [m for league in store.get("leagues", []) for m in league.get("matches", [])]
    added = 0; add_brk = {}
    forecast_days = fixture_target_dates()
    for d in forecast_days:
        data = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); time.sleep(0.6)
        if not data: continue
        for ev in data.get("events", []):
            eid = ev.get("id")
            if not eid or eid in seen_ids: continue
            if (ev.get("status") or {}).get("type") != "notstarted": continue
            utid = ((ev.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS: continue
            try:
                op = fetch(f"/api/v1/event/{eid}/odds/1/all"); time.sleep(0.6)
                odds = parse_full_time_odds(op)
                sp = fetch(f"/api/v1/event/{eid}/team-streaks"); time.sleep(0.6)
                h2h, tstr = parse_streaks_payload(sp) if sp else ([], [])
                h = ev.get("homeTeam") or {}; a = ev.get("awayTeam") or {}
                league_name = TOURNAMENTS[utid]
                if is_excluded_fixture_for_league(league_name, h.get("name", ""), a.get("name", "")):
                    continue
                h_att, h_def = fetch_form(h.get("id"))
                a_att, a_def = fetch_form(a.get("id"))
                # NEW: H2H + standings inputs for the enhanced predictor
                h2h_history = fetch_h2h(h.get("id"), a.get("id"), exclude_event_id=eid, xg_index=_XG_INDEX)
                h2h_duel = fetch_event_h2h_duel(eid)
                ut = (ev.get("tournament") or {}).get("uniqueTournament") or {}
                season = ev.get("season") or {}
                stand = fetch_standings(ut.get("id"), season.get("id"))
                hr = stand.get(h.get("id"), {})
                ar = stand.get(a.get("id"), {})
                ts = ev.get("startTimestamp")
                temp_match = {
                    "id": eid,
                    "date": adl_date(ts) if ts else d,
                    "time": adl_time(ts) if ts else "00:00",
                    "status": "upcoming",
                    "home": team_payload(h),
                    "away": team_payload(a),
                }
                if hr.get("rank") is not None:
                    temp_match["home"]["rank"] = hr["rank"]
                if hr.get("pts") is not None:
                    temp_match["home"]["pts"] = hr["pts"]
                if ar.get("rank") is not None:
                    temp_match["away"]["rank"] = ar["rank"]
                if ar.get("pts") is not None:
                    temp_match["away"]["pts"] = ar["pts"]
                if odds:
                    temp_match["odds"] = odds
                market_context = prediction_context_for_match(temp_match, all_matches)
                pred = predict_enhanced(h_att, h_def, a_att, a_def,
                                        h.get("name",""), a.get("name",""), tstr,
                                        h2h=h2h_history,
                                        h_rank=hr.get("rank"), h_pts=hr.get("pts"),
                                        a_rank=ar.get("rank"), a_pts=ar.get("pts"),
                                        h_team_id=h.get("id"), a_team_id=a.get("id"),
                                        league=league_name,
                                        market_odds=odds,
                                        market_context=market_context)
                rec = {
                    **temp_match,
                    "predictions": pred,
                }
                if odds: rec["odds"] = odds
                if h2h: rec["h2h_streaks"] = h2h
                if h2h_history: rec["h2h_history"] = h2h_history
                if h2h_duel: rec["h2h_duel"] = h2h_duel
                if tstr: rec["team_streaks"] = tstr
                by_name[league_name]["matches"].append(rec)
                seen_ids.add(eid); added += 1
                add_brk[league_name] = add_brk.get(league_name, 0) + 1
            except Exception:
                pass
    return {"added": added, "add_brk": add_brk}


# ----------------------------------------------------------------------------
_SEASON_CACHE = {}
def fetch_current_season(unique_tournament_id):
    """Return the current season id for a tournament. Cached per process."""
    if not unique_tournament_id:
        return None
    if unique_tournament_id in _SEASON_CACHE:
        return _SEASON_CACHE[unique_tournament_id]
    d = fetch(f"/api/v1/unique-tournament/{unique_tournament_id}/seasons")
    time.sleep(0.6)
    season_id = None
    if d:
        seasons = d.get("seasons") or []
        if seasons:
            season_id = seasons[0].get("id")
    _SEASON_CACHE[unique_tournament_id] = season_id
    return season_id


def compute_standings_from_matches(league):
    """Build a standings table from a competition's own finished matches when no
    external (SofaScore) standings exist — e.g. cups in the group stage. Teams are
    partitioned into connected components of the played-against graph (each component
    is a group during the group stage), and ranked within their component by
    points → goal difference → goals for. Only FT matches count; in-play and upcoming
    games do not move the table. Returns {team_id|name: {"rank", "pts"}}.
    """
    teams = {}

    # Key by normalised name, not team_id: the same national team can carry different
    # provider team_ids across sources (SofaScore vs TheSportsDB), which would otherwise
    # split one team into several nodes and fragment its group. Every team_id seen is
    # recorded so the table can still be looked up by id during attachment.
    def keyfor(team):
        return (team.get("name") or "").strip().lower()

    def ensure(team):
        k = keyfor(team)
        if k not in teams:
            teams[k] = {"name": k, "ids": set(), "pts": 0, "gd": 0, "gf": 0, "opps": set()}
        tid = team.get("team_id")
        if tid is not None and tid != "":
            teams[k]["ids"].add(tid)
        return k

    for m in league.get("matches", []):
        h = m.get("home") or {}
        a = m.get("away") or {}
        if not (h.get("name") and a.get("name")):
            continue
        kh, ka = ensure(h), ensure(a)
        # Group membership comes from every scheduled fixture (teams in a group all
        # play each other), so the table covers the full group before all games finish.
        teams[kh]["opps"].add(ka)
        teams[ka]["opps"].add(kh)
        # Points only accrue from finished matches.
        if str(m.get("status") or "").lower() != "ft":
            continue
        hg, ag = h.get("goals"), a.get("goals")
        if hg is None or ag is None:
            continue
        try:
            hg, ag = int(hg), int(ag)
        except (TypeError, ValueError):
            continue
        teams[kh]["gf"] += hg
        teams[ka]["gf"] += ag
        teams[kh]["gd"] += hg - ag
        teams[ka]["gd"] += ag - hg
        if hg > ag:
            teams[kh]["pts"] += 3
        elif ag > hg:
            teams[ka]["pts"] += 3
        else:
            teams[kh]["pts"] += 1
            teams[ka]["pts"] += 1

    out = {}
    seen = set()
    for start in list(teams.keys()):
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            x = stack.pop()
            comp.append(x)
            for y in teams[x]["opps"]:
                if y in teams and y not in seen:
                    seen.add(y)
                    stack.append(y)
        comp.sort(key=lambda k: (-teams[k]["pts"], -teams[k]["gd"], -teams[k]["gf"], teams[k]["name"]))
        for rank, k in enumerate(comp, start=1):
            entry = {"rank": rank, "pts": teams[k]["pts"]}
            if teams[k]["name"]:
                out[teams[k]["name"]] = entry
            for tid in teams[k]["ids"]:
                out[tid] = entry
    return out


def phase_b3_attach_standings(store):
    """Attach rank/pts to every match's home/away from the current league table.
    Prefers SofaScore standings (one fetch per league per run, cached); when a
    competition has no external standings (e.g. a cup group stage), falls back to a
    table computed from the slate's own finished matches. Safe to call repeatedly.
    """
    name_to_ut = {v: k for k, v in TOURNAMENTS.items()}
    attached = 0
    for L in store["leagues"]:
        ut_id = name_to_ut.get(L["name"])
        stand = {}
        if ut_id:
            season_id = fetch_current_season(ut_id)
            if season_id:
                stand = fetch_standings(ut_id, season_id) or {}
        # No external standings for this competition → compute a group/league table
        # from its own finished matches (cups, group stages, simulated slates).
        computed = compute_standings_from_matches(L) if not stand else {}
        if not stand and not computed:
            continue
        for m in L["matches"]:
            for side in ("home", "away"):
                team = m.get(side) or {}
                tid = team.get("team_id")
                tname = (team.get("name") or "").strip().lower()
                # Name-based fallback for Phase 1 fixtures whose team_id is an ESPN/
                # Flashscore ID and won't match SofaScore standings keys.
                row = stand.get(tid) or (stand.get(tname) if tname else None)
                if not row and computed:
                    row = computed.get(tid) or (computed.get(tname) if tname else None)
                if row and row.get("rank") is not None:
                    team["rank"] = row.get("rank")
                    team["pts"] = row.get("pts")
                    attached += 1
    return {"attached": attached}


# ----------------------------------------------------------------------------
def read_phase_csv(path):
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))
    except Exception:
        return []


def parse_decimal(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 1 else None


def parse_optional_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number


def phase_fixture_team(name, team_id=None, logo=None, source=None):
    payload = {
        "name": name or "",
        "short": name or "",
    }
    if team_id:
        payload["team_id"] = team_id
    if logo:
        payload["logo"] = logo
        payload["badge_source_url"] = logo
        source_lower = (source or "").lower()
        if source_lower == "api-football" or "media.api-sports.io/football/teams/" in str(logo):
            payload["badge_source"] = "api-football"
        elif "r2.thesportsdb.com" in str(logo):
            payload["badge_source"] = "thesportsdb"
    return payload


def phase_fixture_exists(league, row):
    event_id = row.get("event_id")
    row_key = (
        row.get("date") or "",
        row.get("time") or "",
        team_norm(row.get("home") or ""),
        team_norm(row.get("away") or ""),
    )
    for match in league.get("matches", []):
        if event_id and str(match.get("id")) == str(event_id):
            return True
        match_key = (
            match.get("date") or "",
            match.get("time") or "",
            team_norm((match.get("home") or {}).get("name") or ""),
            team_norm((match.get("away") or {}).get("name") or ""),
        )
        if row_key == match_key:
            return True
        if (
            match_key[0] == row_key[0]
            and match_key[1] == row_key[1]
            and team_names_match((match.get("home") or {}).get("name") or "", row.get("home") or "")
            and team_names_match((match.get("away") or {}).get("name") or "", row.get("away") or "")
        ):
            return True
    return False


def match_prediction_count(match):
    predictions = match.get("predictions") or {}
    return sum(
        1
        for key in ("winner", "btts", "ou_goals", "ou_cards", "ou_corners")
        if predictions.get(key)
    )


def match_quality_score(match):
    """Prefer the record that can actually drive the dashboard card."""
    score = 0
    if match.get("status") == "FT":
        score += 120
    if match.get("prediction_locked"):
        score += 20
    if has_real_three_way_odds(match.get("sportsbet_odds") or {}):
        score += 55
    if has_real_three_way_odds(match.get("odds") or {}):
        score += 45
    if match.get("sportsbet_markets"):
        score += 30
    score += match_prediction_count(match) * 25
    if (match.get("home") or {}).get("goals") is not None and (match.get("away") or {}).get("goals") is not None:
        score += 25
    if (match.get("home") or {}).get("logo"):
        score += 3
    if (match.get("away") or {}).get("logo"):
        score += 3
    if match.get("source") == "Sportsbet":
        score += 5
    if match.get("status") == "upcoming" and match.get("time") == "FT":
        score -= 60
    return score


def merge_missing_dict(target, source):
    changed = False
    if not isinstance(target, dict) or not isinstance(source, dict):
        return changed
    for key, value in source.items():
        if value in (None, "", [], {}):
            continue
        if key not in target or target.get(key) in (None, "", [], {}):
            target[key] = value
            changed = True
    return changed


def merge_duplicate_match(existing, incoming):
    winner, loser = (incoming, existing) if match_quality_score(incoming) > match_quality_score(existing) else (existing, incoming)
    merged = dict(winner)
    for key, value in loser.items():
        if key in ("home", "away", "predictions"):
            continue
        if value in (None, "", [], {}):
            continue
        if key not in merged or merged.get(key) in (None, "", [], {}):
            merged[key] = value
    merged["home"] = dict(merged.get("home") or {})
    merged["away"] = dict(merged.get("away") or {})
    merge_missing_dict(merged["home"], loser.get("home") or {})
    merge_missing_dict(merged["away"], loser.get("away") or {})
    merged["predictions"] = dict(merged.get("predictions") or {})
    for key, value in (loser.get("predictions") or {}).items():
        if value and not merged["predictions"].get(key):
            merged["predictions"][key] = value
    ids = []
    for source in (winner, loser):
        source_id = source.get("id")
        if source_id and source_id not in ids:
            ids.append(source_id)
    if len(ids) > 1:
        merged["merged_source_ids"] = ids
    if loser.get("status") == "FT" and merged.get("status") != "FT":
        merged["status"] = "FT"
        merged["time"] = "FT"
    return merged


def dedupe_phase_fixture_matches(store):
    removed = 0
    for league in store.get("leagues", []):
        keep = []
        for match in league.get("matches", []):
            duplicate_index = None
            for idx, existing in enumerate(keep):
                if match.get("id") and existing.get("id") and str(match.get("id")) == str(existing.get("id")):
                    duplicate_index = idx
                    break
                if (
                    match.get("date") == existing.get("date")
                    and match.get("time") == existing.get("time")
                    and team_names_match((match.get("home") or {}).get("name") or "", (existing.get("home") or {}).get("name") or "")
                    and team_names_match((match.get("away") or {}).get("name") or "", (existing.get("away") or {}).get("name") or "")
                ):
                    duplicate_index = idx
                    break
            if duplicate_index is not None:
                keep[duplicate_index] = merge_duplicate_match(keep[duplicate_index], match)
                removed += 1
                continue
            keep.append(match)
        league["matches"] = keep
    return removed


def phase_fixture_record(row):
    status = row.get("status") or "upcoming"
    home_goals = parse_optional_int(row.get("home_goals"))
    away_goals = parse_optional_int(row.get("away_goals"))
    record = {
        "id": row.get("event_id"),
        "date": row.get("date"),
        "time": "FT" if status == "FT" else row.get("time"),
        "status": "FT" if status == "FT" else "upcoming",
        "source": row.get("source") or "Phase pipeline",
        "source_status": row.get("source_health") or "",
        "phase_status": row.get("phase2_status") or row.get("phase1_status") or "fixture_only",
        "phase_notes": row.get("phase2_notes") or row.get("phase1_notes") or "",
        "home": phase_fixture_team(row.get("home"), row.get("home_team_id"), row.get("home_logo"), row.get("source")),
        "away": phase_fixture_team(row.get("away"), row.get("away_team_id"), row.get("away_logo"), row.get("source")),
        "predictions": {},
    }
    if status == "FT" and home_goals is not None and away_goals is not None:
        record["home"]["goals"] = home_goals
        record["away"]["goals"] = away_goals
        record["settled_at"] = TODAY.isoformat()
    record.update(phase_fixture_odds_payload(row))
    return record


def phase_fixture_odds_payload(row):
    odds = {
        "home": parse_decimal(row.get("home_odds")),
        "draw": parse_decimal(row.get("draw_odds")),
        "away": parse_decimal(row.get("away_odds")),
    }
    if not all(odds.values()):
        return {}
    source = row.get("odds_source") or "Sportsbet"
    payload = {
        "odds": odds,
        "bookmaker_odds_source": source,
    }
    if source.lower() == "sportsbet":
        payload["sportsbet_odds"] = {
            "matched": True,
            "source": source,
            "event_id": row.get("sportsbet_event_id") or "",
            "event_name": f"{row.get('sportsbet_home_name') or row.get('home')} vs {row.get('sportsbet_away_name') or row.get('away')}",
            **odds,
        }
    else:
        payload.setdefault("bookmaker_meta", {})[source.lower()] = {
            "matched": True,
            "source": "entain_event_request",
            "event_id": row.get("sportsbet_event_id") or "",
            "event_name": f"{row.get('sportsbet_home_name') or row.get('home')} vs {row.get('sportsbet_away_name') or row.get('away')}",
        }
    return payload


def backfill_phase_fixture_odds(league, row):
    payload = phase_fixture_odds_payload(row)
    if not payload:
        return False
    row_key = (
        row.get("date") or "",
        row.get("time") or "",
    )
    for match in league.get("matches", []):
        if (
            match.get("date") == row_key[0]
            and match.get("time") == row_key[1]
            and team_names_match((match.get("home") or {}).get("name") or "", row.get("home") or "")
            and team_names_match((match.get("away") or {}).get("name") or "", row.get("away") or "")
        ):
            if match.get("odds") and (match.get("sportsbet_odds") or payload.get("bookmaker_odds_source") != "Sportsbet"):
                return False
            match.update(payload)
            return True
    return False


def sportsbet_fixture_rows():
    try:
        import soccer_fetch_sportsbet as sportsbet
    except Exception:
        return []
    allowed_dates = set(fixture_target_dates())
    rows = []
    for league_name in PHASE_FIXTURE_FALLBACK_LEAGUES:
        slug = sportsbet.LEAGUE_PAGES.get(league_name)
        if not slug:
            continue
        data = sportsbet.fetch_page_data(slug)
        if not data:
            continue
        for event in sportsbet.extract_odds(data, slug).values():
            ts = event.get("start_ts")
            if not ts:
                continue
            local_date = adl_date(ts)
            if local_date not in allowed_dates:
                continue
            league_id = next(k for k, v in TOURNAMENTS.items() if v == league_name)
            rows.append({
                "run_timestamp": datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z"),
                "source": "Sportsbet",
                "source_health": "healthy",
                "league_id": league_id,
                "league": league_name,
                "event_id": f"sportsbet:{event.get('event_id')}",
                "date": local_date,
                "time": adl_time(ts),
                "timezone": "Australia/Adelaide",
                "home": event.get("home_name") or "",
                "away": event.get("away_name") or "",
                "home_team_id": f"sportsbet:{event.get('event_id')}:home",
                "away_team_id": f"sportsbet:{event.get('event_id')}:away",
                "phase1_status": "ready_for_phase_2",
                "phase2_status": "ready_for_phase_3",
                "phase1_notes": "Sportsbet league page fallback fixture.",
                "phase2_notes": "Sportsbet fixture and 1X2 odds fallback.",
                "odds_source": "Sportsbet",
                "sportsbet_event_id": event.get("event_id") or "",
                "sportsbet_home_name": event.get("home_name") or "",
                "sportsbet_away_name": event.get("away_name") or "",
                "home_odds": event.get("home"),
                "draw_odds": event.get("draw"),
                "away_odds": event.get("away"),
            })
    return rows


def entain_decimal(price):
    odds = (price or {}).get("odds") or {}
    try:
        numerator = float(odds.get("numerator"))
        denominator = float(odds.get("denominator"))
    except (TypeError, ValueError):
        return None
    if denominator <= 0:
        return None
    return round((numerator / denominator) + 1.0, 2)


def entain_price_for_entrant(prices, entrant_id):
    prefix = f"{entrant_id}:"
    for key, price in prices.items():
        if str(key).startswith(prefix):
            return entain_decimal(price)
    return None


def entain_fixture_rows():
    try:
        import soccer_fetch_bookmaker_links as bookmaker_links
    except Exception:
        return []
    allowed_dates = set(fixture_target_dates())
    league_hints = {
        "Premier League": ("premier league",),
        "LaLiga": ("spanish la liga",),
        "Bundesliga": ("german bundesliga", "german bundesliga men's"),
        "Ligue 1": ("french ligue 1",),
        "UEFA Champions League": ("uefa champions league",),
        "UEFA Europa League": ("uefa europa league",),
        "UEFA Conference League": ("uefa europa conference league", "uefa conference league"),
        "Serie A": ("italian serie a",),
        "Brasileirão Betano": ("brazilian serie a",),
        "CONMEBOL Libertadores": ("conmebol copa libertadores", "copa libertadores"),
        "FIFA World Cup": ("men's world cup", "mens world cup", "world cup"),
        "International Friendly Games": ("international friendlies", "friendly international", "international friendly games"),
        "Eredivisie": ("dutch eredivisie",),
        "Primeira Liga": ("portuguese primeira liga", "portugal primeira liga"),
        "MLS": ("us major league soccer",),
        "A-League Men": ("a-league men",),
        "Scottish Premiership": ("scotland premiership", "scottish premiership"),
        "J1 League": ("japanese j1 league",),
        "Championship": ("championship",),
        "League One": ("league one",),
        "League Two": ("league two",),
        "Allsvenskan": ("allsvenskan", "swedish allsvenskan"),
        "Eliteserien": ("eliteserien", "norwegian eliteserien"),
    }
    rows = []
    for bookmaker_id, config in bookmaker_links.ENTAIN_BOOKMAKERS.items():
        payload = bookmaker_links.fetch_json(config["api"], config["origin"])
        if not payload:
            continue
        events = (payload.get("events") or {}).values()
        markets = payload.get("markets") or {}
        entrants = payload.get("entrants") or {}
        prices = payload.get("prices") or {}
        for event in events:
            competition = ((event.get("competition") or {}).get("name") or "").lower()
            league_name = next(
                (name for name, hints in league_hints.items() if any(hint in competition for hint in hints)),
                "",
            )
            if not league_name:
                continue
            market = None
            for market_id in event.get("main_markets") or []:
                candidate = markets.get(market_id)
                if (candidate or {}).get("name") == "Match Result":
                    market = candidate
                    break
            if not market:
                continue
            try:
                start = datetime.fromisoformat(str(event.get("advertised_start") or event.get("actual_start")).replace("Z", "+00:00")).astimezone(ADL)
            except Exception:
                continue
            local_date = start.strftime("%Y-%m-%d")
            if local_date not in allowed_dates:
                continue
            home = draw = away = None
            home_name = away_name = ""
            for entrant_id in market.get("entrant_ids") or []:
                entrant = entrants.get(entrant_id) or {}
                price = entain_price_for_entrant(prices, entrant_id)
                if not price:
                    continue
                home_away = entrant.get("home_away")
                entrant_name = entrant.get("name") or ""
                if home_away == "HOME":
                    home = price
                    home_name = entrant_name
                elif home_away == "AWAY":
                    away = price
                    away_name = entrant_name
                elif entrant_name.lower() == "draw":
                    draw = price
            if not all((home, draw, away)):
                continue
            league_id = next(k for k, v in TOURNAMENTS.items() if v == league_name)
            rows.append({
                "run_timestamp": datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z"),
                "source": bookmaker_id.title(),
                "source_health": "healthy",
                "league_id": league_id,
                "league": league_name,
                "event_id": f"{bookmaker_id}:{event.get('id')}",
                "date": local_date,
                "time": start.strftime("%H:%M"),
                "timezone": "Australia/Adelaide",
                "home": home_name,
                "away": away_name,
                "home_team_id": f"{bookmaker_id}:{event.get('id')}:home",
                "away_team_id": f"{bookmaker_id}:{event.get('id')}:away",
                "phase1_status": "ready_for_phase_2",
                "phase2_status": "ready_for_phase_3",
                "odds_backfill_only": "yes",
                "phase1_notes": f"{bookmaker_id.title()} fallback fixture.",
                "phase2_notes": f"{bookmaker_id.title()} fallback 1X2 odds.",
                "odds_source": bookmaker_id.title(),
                "sportsbet_event_id": event.get("id") or "",
                "sportsbet_home_name": home_name,
                "sportsbet_away_name": away_name,
                "home_odds": home,
                "draw_odds": draw,
                "away_odds": away,
            })
    return rows


def promote_phase_fixtures_to_store(store=None):
    """Keep real Phase 1/2 fixtures visible even when later model phases block."""
    store = store or load_store()
    phase2_rows = read_phase_csv(PHASE2_ODDS_SLATE)
    phase1_rows = read_phase_csv(PHASE1_FIXTURE_SLATE)
    odds_by_event = {row.get("event_id"): row for row in phase2_rows if row.get("event_id")}
    phase2_event_ids = {row.get("event_id") for row in phase2_rows if row.get("event_id")}
    rows = list(phase2_rows)
    rows.extend(row for row in phase1_rows if row.get("event_id") not in phase2_event_ids)
    by_name = {league.get("name"): league for league in store.get("leagues", [])}
    added = 0
    odds_backfilled = 0
    for row in rows:
        league_name = row.get("league")
        if league_name not in TOURNAMENTS.values():
            continue
        if is_excluded_fixture_for_league(league_name, row.get("home") or "", row.get("away") or ""):
            continue
        if row.get("phase1_status") and row.get("phase1_status") != "ready_for_phase_2":
            continue
        if not (row.get("event_id") and row.get("date") and row.get("time") and row.get("home") and row.get("away")):
            continue
        row_date = parse_match_date(row.get("date"))
        if row_date and row_date < TODAY:
            continue
        league = by_name.get(league_name)
        if not league:
            league_id = next(k for k, v in TOURNAMENTS.items() if v == league_name)
            league = {"id": league_id, "name": league_name, "season": "2025/26", "round": None, "logo": stable_league_logo(league_name, league_id), "matches": []}
            store.setdefault("leagues", []).append(league)
            by_name[league_name] = league
        merged = {**row, **(odds_by_event.get(row.get("event_id")) or {})}
        if phase_fixture_exists(league, merged):
            if backfill_phase_fixture_odds(league, merged):
                odds_backfilled += 1
            continue
        if merged.get("odds_backfill_only") == "yes":
            continue
        league.setdefault("matches", []).append(phase_fixture_record(merged))
        added += 1
    removed = dedupe_phase_fixture_matches(store)
    if added or removed or odds_backfilled:
        sort_store(store)
        save_store(store)
    return {"added": added, "odds_backfilled": odds_backfilled, "removed_duplicates": removed}


# ----------------------------------------------------------------------------
def run_helper(name):
    """Invoke a helper script. Captures and prints its stdout."""
    p = subprocess.run([sys.executable, str(SCRIPTS / name)], capture_output=True, text=True)
    if p.stdout: print(p.stdout.rstrip())
    if p.returncode != 0 and p.stderr:
        print(f"  [{name}] stderr: {p.stderr.rstrip()}")


def run_targeted_collector(name, args=None):
    args = args or []
    env = os.environ.copy()
    env["SOCCER_FIXTURE_DATES"] = ",".join(fixture_target_dates())
    env["SOCCER_TOP_UP_TARGETED"] = "1"
    p = subprocess.run([sys.executable, str(SCRIPTS / name), *args], capture_output=True, text=True, env=env)
    if p.stdout:
        print(p.stdout.rstrip())
    if p.returncode != 0 and p.stderr:
        print(f"  [{name}] stderr: {p.stderr.rstrip()}")
    return p.returncode == 0


def run_targeted_fixture_collectors():
    start, _end, days = fixture_target_date_range()
    print("\n[Seed B.0] targeted fixture collectors")
    print(f"  target_dates={', '.join(fixture_target_dates())}")
    run_targeted_collector("soccer_phase1_fixtures.py", ["--start", start.isoformat(), "--days", str(days)])
    run_targeted_collector("soccer_phase2_odds.py")


def run_dashboard_enrichment_helpers():
    print("\n[Phase B.4] computed team streaks (PRIMARY) — derived from team match history")
    run_helper("soccer_compute_streaks.py")

    print("\n[Phase B.5] sportsbet odds")
    run_helper("soccer_fetch_sportsbet.py")

    print("\n[Phase B.5a] bookmaker direct links")
    run_helper("soccer_fetch_bookmaker_links.py")

    print("\n[Phase B.5b] pre-match prediction prefill")
    store = load_store()
    pre = populate_pre_match_predictions(store)
    print(
        f"  created={pre['created']}  corners={pre['corner_created']}  "
        f"profiled={pre.get('profiled', 0)}  corner_capped={pre.get('corner_capped', 0)}"
    )
    if pre["by_league"]:
        for league_name, count in sorted(pre["by_league"].items()):
            print(f"  + {league_name}: {count}")

    print("\n[Phase B.5c] today new-league calibration exception")
    store = load_store()
    cal = populate_today_new_league_calibration_predictions(store)
    print(f"  created={cal['created']}  settled_matches={cal['settled_matches']}")
    if cal["by_league"]:
        for league_name, count in sorted(cal["by_league"].items()):
            print(f"  + {league_name}: {count}")

    print("\n[Phase B.6] streak odds")
    run_helper("soccer_enrich_streak_odds.py")

    print("\n[Phase B.7] prediction odds")
    run_helper("soccer_fetch_pred_odds.py")

    print("\n[Phase B.8] TheSportsDB fallback (records score hint when SofaScore was 403)")
    run_helper("soccer_fetch_thesportsdb.py")

    print("\n[Phase B.9] Understat xG enrichment")
    run_helper("soccer_fetch_understat.py")


def run_targeted_top_up_helpers(store):
    target_dates = set(fixture_target_dates())
    print("\n[Seed C.6] targeted Sportsbet odds")
    run_targeted_collector("soccer_fetch_sportsbet.py")

    print("\n[Seed C.7] targeted bookmaker direct links")
    run_targeted_collector("soccer_fetch_bookmaker_links.py")
    store = load_store()

    print("\n[Seed D] targeted pre-match prediction fill")
    pre = populate_pre_match_predictions(store, target_dates=target_dates)
    print(
        f"  target_dates={', '.join(sorted(target_dates)) or 'n/a'}  "
        f"created={pre['created']}  corners={pre['corner_created']}  "
        f"profiled={pre.get('profiled', 0)}  corner_capped={pre.get('corner_capped', 0)}"
    )
    if pre["by_league"]:
        for league_name, count in sorted(pre["by_league"].items()):
            print(f"  + {league_name}: {count}")

    save_store(store)

    print("\n[Seed D.1] targeted prediction odds")
    run_targeted_collector("soccer_fetch_pred_odds.py")
    return load_store()


def sort_store(store):
    for L in store["leagues"]:
        L["matches"].sort(key=lambda m: (m.get("date", ""), m.get("time", "")))
    store["leagues"].sort(key=lambda L: ORDER.index(L["name"]) if L["name"] in ORDER else 99)


def print_final_tally(store):
    total = 0; ft = 0; up = 0
    hit = miss = pending = 0
    for L in store["leagues"]:
        total += len(L["matches"])
        for m in L["matches"]:
            if m.get("status") == "FT":
                ft += 1
            else:
                up += 1
            r = ((m.get("predictions", {}) or {}).get("winner", {}) or {}).get("result")
            if r == "hit":
                hit += 1
            elif r == "miss":
                miss += 1
            else:
                pending += 1
    print(f"\n=== TOTAL: {total}  FT: {ft}  upcoming: {up}  | winner hit: {hit}  miss: {miss}  pending: {pending} ===")


def check_store_integrity(store):
    """Post-build data-integrity audit for silent-failure classes that exit 0 but ship
    wrong data: duplicate matches, missing core fields, upcoming matches missing required
    markets, and leagues whose matches mostly belong to a foreign tournament-id scheme
    (the league-leak signature). Returns (violations, review): violations are unambiguous;
    review notes want a human eye. (League-leak prevention proper lives at the collector
    via the exact idLeague gate; this is the backstop.)"""
    required_markets = ("winner", "btts", "ou_goals", "ou_cards", "ou_corners")
    violations = []
    review = []
    seen_ids = {}
    for L in store.get("leagues", []):
        lname = L.get("name", "?")
        matches = L.get("matches", [])
        if not matches:
            review.append(f"empty league: {lname}")
            continue
        # Source-scheme outliers: a league whose matches are overwhelmingly one id scheme
        # (e.g. SofaScore numeric ids) with one or two foreign ones (e.g. thesportsdb:) is
        # the shape the USL fixture took when it leaked into EFL Championship.
        sofa = sum(1 for m in matches if is_sofascore_event_id(m.get("id")))
        foreign = [m for m in matches if not is_sofascore_event_id(m.get("id"))]
        if sofa >= 5 and 0 < len(foreign) <= 2:
            for m in foreign:
                review.append(
                    f"source-scheme outlier in {lname}: "
                    f"{(m.get('home') or {}).get('name')} vs {(m.get('away') or {}).get('name')} "
                    f"(id={m.get('id')}) — verify it belongs to this competition"
                )
        for m in matches:
            home = (m.get("home") or {}).get("name")
            away = (m.get("away") or {}).get("name")
            label = f"{lname}: {home} vs {away}"
            mid = m.get("id")
            if mid is not None:
                if mid in seen_ids:
                    violations.append(f"duplicate id {mid}: {label} | also {seen_ids[mid]}")
                else:
                    seen_ids[mid] = label
            if not home or not away:
                violations.append(f"missing team name: {label}")
            if not m.get("date"):
                violations.append(f"missing date: {label}")
            if str(m.get("status") or "").lower() == "upcoming":
                preds = m.get("predictions") or {}
                missing = [k for k in required_markets if not preds.get(k)]
                if missing:
                    violations.append(f"missing markets {','.join(missing)}: {label}")
    return violations, review


def run_integrity_audit(store, label="full refresh"):
    """Run the integrity audit, write a marker file, and log loudly. Returns the hard
    violation count (0 = clean). Does not stop the run — the marker surfaces problems
    that otherwise exit 0 with wrong data."""
    violations, review = check_store_integrity(store)
    lines = [
        "# Data integrity audit",
        f"stage: {label}",
        f"generated: {datetime.now(ADL).isoformat()}",
        f"violations: {len(violations)}",
        f"review notes: {len(review)}",
        "",
        "## Violations",
    ]
    lines += [f"- {v}" for v in violations] if violations else ["- none"]
    lines += ["", "## Review notes"]
    lines += [f"- {r}" for r in review] if review else ["- none"]
    try:
        (OUT_DIR / "data_integrity_latest.md").write_text("\n".join(lines), encoding="utf-8")
    except Exception:
        pass
    print(f"\n[Integrity] violations={len(violations)} review={len(review)} -> data_integrity_latest.md")
    for v in violations[:25]:
        print(f"  VIOLATION: {v}")
    for r in review[:10]:
        print(f"  review: {r}")
    return len(violations)


def run_full_refresh():
    print(f"=== soccer_routine.py — {TODAY.isoformat()} (Adelaide) ===")
    store = load_store()

    # Phase 0
    print("\n[Phase 0] validate + dedupe + re-date")
    p0 = phase_0_validate(store)
    print(
        f"  dedupe={p0['dedupe']}  no_id={p0['no_id']}  foreign={p0['foreign']}  "
        f"bookmaker={p0.get('bookmaker', 0)}  excluded={p0.get('excluded', 0)}  "
        f"moved={p0['moved']}  re_dated={p0['re_dated']}"
    )
    seen_ids = {m["id"] for L in store["leagues"] for m in L["matches"] if m.get("id")}

    # Phase A
    print("\n[Phase A] settle pending")
    pa = phase_a_settle(store, p0["cache"])
    print(f"  settled={len(pa['settled'])}  skipped={pa['skipped']}  flashscore_settled={pa.get('flashscore_settled', 0)}  livescore_settled={pa.get('livescore_settled', 0)}")

    # Phase A.5
    print("\n[Phase A.5] backfill finished + enrich")
    pa5 = phase_a5_backfill_enrich(store, seen_ids)
    print(f"  added={pa5['added']}  enriched={pa5['enriched']}  merged={len(pa5.get('merged', []))}  removed_shells={len(pa5.get('removed_result_shells', []))}")

    # Phase A.7 — rebuild team Elo from full FT history (deterministic).
    # Runs before retro + forecast so both phases consume up-to-date ratings.
    # Also rebuilds the xG-by-team index so fetch_form() can prefer xG over
    # raw goals where Understat data has been attached.
    print("\n[Phase A.7] compute team Elo + build xG index")
    elo = compute_team_elo(store)
    _XG_INDEX.clear(); _XG_INDEX.update(build_xg_index(store))
    n_teams_xg = sum(1 for tid, rows in _XG_INDEX.items() if rows)
    print(f"  teams_rated={len(elo)}  teams_with_xg={n_teams_xg}  elo_file={ELO_STORE.name}")

    # Phase A.6
    print("\n[Phase A.6] protect resulted predictions")
    pa6 = phase_a6_retro(store)
    print(f"  retro={pa6['retro']}  protected={pa6.get('protected', 0)}")

    # Phase B
    print(f"\n[Phase B] forecast new upcoming (+{FIXTURE_LOOKAHEAD_DAYS} days)")
    pb = phase_b_forecast(store, seen_ids)
    print(f"  added={pb['added']}")

    print("\n[Phase B.3a] promote phase fixture cards")
    pbf = promote_phase_fixtures_to_store(store)
    print(f"  added={pbf['added']}")

    # Phase B.3 — attach league-table rank/pts to every match's home/away.
    # Runs AFTER Phase B.3a so newly promoted Phase 1 fixtures are included.
    print("\n[Phase B.3] attach standings to home/away")
    pb3 = phase_b3_attach_standings(store)
    print(f"  attached={pb3['attached']}")

    # Sort matches inside each league
    sort_store(store)

    # Persist before invoking helpers (they read match_data.json)
    save_store(store)

    run_dashboard_enrichment_helpers()

    # Final tally — reload store after helpers (they mutate match_data.json)
    store = load_store()
    save_store(store)
    run_integrity_audit(store, "full refresh")
    print_final_tally(store)


# ----------------------------------------------------------------------------
# Live in-play + fast full-time confirmation.
#
# The 180-minute result-check buffer is deliberately late so we never settle a
# match by due-time before it is really finished. But it left finished matches
# showing "upcoming" for up to an hour, and the recurring "stuck upcoming" bug.
# The live pass closes that gap WITHOUT premature settlement: it reads the current
# state from SofaScore -> LiveScore -> Flashscore for any started match and either
# (a) shows the in-play score (status "live"), or (b) settles the moment a source
# CONFIRMS full time — never by due-time. Matches still upcoming long past their
# expected finish are recorded so the no-touch controller can raise a notification.
LIVE_LOOKBACK_HOURS = max(1, int(os.environ.get("SOCCER_LIVE_LOOKBACK_HOURS", "6")))
EARLY_FT_CONFIRM_MINUTES = max(95, int(os.environ.get("SOCCER_EARLY_FT_MINUTES", "100")))
STUCK_UPCOMING_MINUTES = max(EARLY_FT_CONFIRM_MINUTES, int(os.environ.get("SOCCER_STUCK_UPCOMING_MINUTES", "150")))
LIVE_STUCK_MARKER = OUT_DIR / "live_stuck_latest.json"


def minutes_since_kickoff(match, now=None):
    kickoff = match_kickoff_datetime(match)
    if not kickoff:
        return None
    now = now or datetime.now(ADL)
    return (now - kickoff).total_seconds() / 60.0


def sofascore_state(eid):
    """Return (kind, home, away, minute) from SofaScore for an event id, or None.
    kind is 'ft', 'live' or 'upcoming'."""
    if not is_sofascore_event_id(eid):
        return None
    ev = fetch(f"/api/v1/event/{eid}")
    e = (ev.get("event") or ev) if ev else None
    if not e:
        return None
    stype = (e.get("status") or {}).get("type")
    hs = (e.get("homeScore") or {}).get("current")
    as_ = (e.get("awayScore") or {}).get("current")
    minute = (e.get("status") or {}).get("description")
    if stype == "finished":
        return ("ft", hs, as_, None)
    if stype == "inprogress":
        return ("live", hs, as_, minute)
    return ("upcoming", hs, as_, None)


def livescore_state_for_match(league_name, match):
    """Return (kind, home, away, minute) from the LiveScore date payload, or None."""
    found = find_livescore_event(league_name, match)
    if not found:
        return None
    _stage, event = found
    try:
        h = int(event.get("Tr1"))
        a = int(event.get("Tr2"))
    except (TypeError, ValueError):
        return None
    eps = str(event.get("Eps") or "").strip()
    if eps.upper() in ("FT", "AET", "AP", "AET-P"):
        return ("ft", h, a, eps)
    return ("live", h, a, eps)


def apply_live_state(match, home, away, minute):
    if home is None or away is None:
        return False
    match["status"] = "live"
    # Keep the original kickoff time intact: overwriting it (e.g. with "LIVE") breaks
    # match_kickoff_datetime, dropping the match out of the live window on the next run.
    # The dashboard shows the live state from status + live_minute, not the time field.
    match.setdefault("home", {})["goals"] = home
    match.setdefault("away", {})["goals"] = away
    if minute:
        match["live_minute"] = str(minute)
    match["live_updated_at"] = datetime.now(ADL).isoformat()
    return True


def settle_confirmed_ft(match, league_name, home, away, source):
    """Settle a match whose full time has been confirmed by a real source."""
    if not settle(match, {"homeScore": {"current": home}, "awayScore": {"current": away}}):
        return False
    match["settled_source"] = match.get("settled_source") or source
    match.pop("live_minute", None)
    if is_sofascore_event_id(match.get("id")):
        act = actuals_for(match.get("id"), league_name, match)
        if act:
            match["actuals"] = {**(match.get("actuals") or {}), **act}
    settle_stat_markets(match)
    return True


_FLASHSCORE_LIVE_EVENTS_CACHE = None


def get_flashscore_live_events():
    """Load and cache in-play Flashscore events (live status codes with a score) once
    per process. SofaScore is the richest in-play source but is frequently blocked, so
    this is the resilient fallback for live scores."""
    global _FLASHSCORE_LIVE_EVENTS_CACHE
    if _FLASHSCORE_LIVE_EVENTS_CACHE is None:
        try:
            import soccer_phase1_fixtures as flashsource
            raw = flashsource.fetch_flashscore_feed()
            events = flashsource.parse_flashscore_feed(raw)
            _FLASHSCORE_LIVE_EVENTS_CACHE = [
                event for event in events
                if flashsource.flashscore_status(event.get("status")) == "live"
                and event.get("home_score") not in ("", None)
                and event.get("away_score") not in ("", None)
            ]
        except Exception as exc:
            print(f"  flashscore_live_error={exc}")
            _FLASHSCORE_LIVE_EVENTS_CACHE = []
    return _FLASHSCORE_LIVE_EVENTS_CACHE


def flashscore_live_state_for_match(league_name, match):
    """Return ('live', home, away, None) from the Flashscore in-play feed, or None."""
    res = flashscore_result_for_match(get_flashscore_live_events(), league_name, match)
    if res and res.get("home_score") is not None and res.get("away_score") is not None:
        return ("live", res["home_score"], res["away_score"], None)
    return None


_ESPN_SCOREBOARD_CACHE = {}
_ESPN_SUMMARY_CACHE = {}


def espn_scoreboard_events(league_name):
    """Cached ESPN scoreboard events for a tracked league (current window)."""
    import soccer_phase1_fixtures as espnsource
    slug = espnsource.ESPN_LEAGUE_SLUGS.get(league_name)
    if not slug:
        return []
    if slug not in _ESPN_SCOREBOARD_CACHE:
        _ESPN_SCOREBOARD_CACHE[slug] = espnsource.fetch_espn_scoreboard(slug)
    return _ESPN_SCOREBOARD_CACHE[slug]


def _fetch_espn_summary(slug, event_id):
    """Fetch and cache ESPN /summary for a specific event. Returns raw dict or None."""
    import urllib.request, json as _json
    cache_key = (slug, event_id)
    if cache_key in _ESPN_SUMMARY_CACHE:
        return _ESPN_SUMMARY_CACHE[cache_key]
    import soccer_phase1_fixtures as espnsource
    url = f"{espnsource.ESPN_BASE}/{slug}/summary?event={event_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = _json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception:
        result = None
    _ESPN_SUMMARY_CACHE[cache_key] = result
    return result


def _espn_date_close(ev_date, match_date):
    # ESPN dates are UTC; our match dates are Adelaide local, so allow a one-day slack.
    a = parse_match_date(ev_date)
    b = parse_match_date(match_date)
    if not a or not b:
        return True
    return abs((a - b).days) <= 1


def espn_event_for_match(league_name, match):
    # Fast path: use cached event_id to skip fuzzy matching on repeat calls.
    cached_id = match.get("espn_event_id")
    if cached_id:
        for ev in espn_scoreboard_events(league_name):
            if ev.get("event_id") == cached_id:
                return ev
        # Event has scrolled off the scoreboard window; return a minimal stub so
        # espn_actuals_for_match() can still call the /summary endpoint by event_id.
        return {"event_id": cached_id, "state": "post", "completed": True}

    home = (match.get("home") or {}).get("name", "")
    away = (match.get("away") or {}).get("name", "")
    for ev in espn_scoreboard_events(league_name):
        if not _espn_date_close(ev.get("date"), match.get("date")):
            continue
        if team_names_match(home, ev.get("home")) and team_names_match(away, ev.get("away")):
            # Cache event_id on the match so the next call skips scoreboard scan.
            match["espn_event_id"] = ev.get("event_id")
            return ev
    return None


def espn_state_for_match(league_name, match):
    """Return (kind, home, away, minute) from ESPN, or None. kind is 'ft'/'live'/'upcoming'."""
    ev = espn_event_for_match(league_name, match)
    if not ev:
        return None
    try:
        h = int(ev.get("home_score"))
        a = int(ev.get("away_score"))
    except (TypeError, ValueError):
        return None
    if ev.get("state") == "post" or ev.get("completed"):
        return ("ft", h, a, ev.get("detail"))
    if ev.get("state") == "in":
        return ("live", h, a, ev.get("detail"))
    return ("upcoming", h, a, None)


def espn_actuals_for_match(league_name, match):
    """Return corners and/or cards from ESPN, or None.
    Corners come from the scoreboard; cards come from /summary (yellowCards + redCards).
    Also populates match['espn_stats'] with full boxscore for live and completed matches
    so the Stats tab can read directly from Firestore without a runtime API call."""
    import soccer_phase1_fixtures as espnsource
    ev = espn_event_for_match(league_name, match)
    if not ev:
        return None
    out = {"source": "ESPN"}

    # Corners — scoreboard already has them
    try:
        hc = int(ev.get("home_corners"))
        ac = int(ev.get("away_corners"))
        out["home_corners"] = hc
        out["away_corners"] = ac
        out["corners_total"] = hc + ac
    except (TypeError, ValueError):
        pass

    # Cards + full stats — fetch /summary for completed and live matches
    event_id = ev.get("event_id")
    slug = espnsource.ESPN_LEAGUE_SLUGS.get(league_name)
    is_post = ev.get("state") == "post" or ev.get("completed")
    is_live = ev.get("state") == "in"

    if event_id and slug and (is_post or is_live):
        summary = _fetch_espn_summary(slug, event_id)
        teams = ((summary or {}).get("boxscore") or {}).get("teams") or []
        home_team = next((t for t in teams if (t.get("homeAway") or "").lower() == "home"), None)
        away_team = next((t for t in teams if (t.get("homeAway") or "").lower() == "away"), None)

        def _int_stat(team_entry, name):
            for stat in (team_entry or {}).get("statistics") or []:
                if stat.get("name") == name:
                    try:
                        return int(stat.get("displayValue", 0))
                    except (TypeError, ValueError):
                        return 0
            return 0

        def _float_stat(team_entry, name):
            for stat in (team_entry or {}).get("statistics") or []:
                if stat.get("name") == name:
                    try:
                        return float(stat.get("displayValue", 0))
                    except (TypeError, ValueError):
                        return None
            return None

        if home_team is not None and away_team is not None:
            # Cards actuals (completed matches only)
            if is_post:
                home_yellow = _int_stat(home_team, "yellowCards")
                away_yellow = _int_stat(away_team, "yellowCards")
                home_red = _int_stat(home_team, "redCards")
                away_red = _int_stat(away_team, "redCards")
                out["home_cards"] = home_yellow + home_red
                out["away_cards"] = away_yellow + away_red
                out["cards_total"] = out["home_cards"] + out["away_cards"]

            # Corners from summary — fills gap when scoreboard is stale/out-of-window
            if "corners_total" not in out:
                try:
                    hc = int(_int_stat(home_team, "wonCorners") or 0)
                    ac = int(_int_stat(away_team, "wonCorners") or 0)
                    if hc > 0 or ac > 0:
                        out["home_corners"] = hc
                        out["away_corners"] = ac
                        out["corners_total"] = hc + ac
                except (TypeError, ValueError):
                    pass

            # Full boxscore stored on the match dict for the Stats tab
            espn_stats = {
                "home": {
                    "possession": _float_stat(home_team, "possessionPct"),
                    "shots": _int_stat(home_team, "totalShots"),
                    "shots_on_target": _int_stat(home_team, "shotsOnTarget"),
                    "corners": _int_stat(home_team, "wonCorners"),
                    "fouls": _int_stat(home_team, "foulsCommitted"),
                    "yellow_cards": _int_stat(home_team, "yellowCards"),
                    "red_cards": _int_stat(home_team, "redCards"),
                    "saves": _int_stat(home_team, "saves"),
                    "offsides": _int_stat(home_team, "offsides"),
                },
                "away": {
                    "possession": _float_stat(away_team, "possessionPct"),
                    "shots": _int_stat(away_team, "totalShots"),
                    "shots_on_target": _int_stat(away_team, "shotsOnTarget"),
                    "corners": _int_stat(away_team, "wonCorners"),
                    "fouls": _int_stat(away_team, "foulsCommitted"),
                    "yellow_cards": _int_stat(away_team, "yellowCards"),
                    "red_cards": _int_stat(away_team, "redCards"),
                    "saves": _int_stat(away_team, "saves"),
                    "offsides": _int_stat(away_team, "offsides"),
                },
            }
            plays = (summary or {}).get("keyEvents") or (summary or {}).get("scoringPlays") or []
            key_events = []
            for p in plays:
                entry = {
                    "type": ((p.get("type") or {}).get("text") or (p.get("type") or {}).get("id") or ""),
                    "clock": ((p.get("clock") or {}).get("displayValue") or ""),
                    "team": ((p.get("team") or {}).get("displayName") or (p.get("team") or {}).get("name") or ""),
                    "participant": (((p.get("participants") or [{}])[0]).get("athlete") or {}).get("displayName") or "",
                    "text": p.get("text") or p.get("shortText") or "",
                }
                if entry["text"] or entry["participant"]:
                    key_events.append(entry)
            if key_events:
                espn_stats["key_events"] = key_events
            h2h_raw = (summary or {}).get("headToHeadGames") or []
            h2h = []
            for g in h2h_raw[:5]:
                comps = ((g.get("competitions") or [{}])[0]).get("competitors") or []
                hc = next((c for c in comps if c.get("homeAway") == "home"), {})
                ac = next((c for c in comps if c.get("homeAway") == "away"), {})
                h2h.append({
                    "date": (g.get("date") or "")[:10],
                    "home_team": (hc.get("team") or {}).get("displayName") or "",
                    "away_team": (ac.get("team") or {}).get("displayName") or "",
                    "home_score": hc.get("score"),
                    "away_score": ac.get("score"),
                })
            if h2h:
                espn_stats["h2h"] = h2h
            if any(v for v in espn_stats["home"].values() if v):
                match["espn_stats"] = espn_stats

    return out if len(out) > 1 else None


def update_live_and_settle(store):
    """For every started, not-yet-closed match in the live window: show the in-play
    score, or settle on confirmed full time. Record matches stuck upcoming past their
    expected finish. Never settles by due-time (that stays the job of the 180m path)."""
    now = datetime.now(ADL)
    live_set = []
    settled = []
    stuck = []
    flash_events = None
    for L in store.get("leagues", []):
        for m in L.get("matches", []):
            if match_closed_for_result_check(m):
                continue
            mins = minutes_since_kickoff(m, now)
            is_live_status = str(m.get("status") or "").lower() == "live"
            if mins is None:
                # A match already marked live but with an unparseable kickoff time still
                # needs updating/settling; treat it as in-play and eligible for FT confirm.
                if not is_live_status:
                    continue
                mins = EARLY_FT_CONFIRM_MINUTES
            elif mins < 0 or mins > LIVE_LOOKBACK_HOURS * 60:
                continue
            league_name = L.get("name", "")
            label = f"{league_name}: {(m.get('home') or {}).get('name')} vs {(m.get('away') or {}).get('name')}"
            eid = m.get("id")

            # ESPN is the primary live/results source: independent, stays up when the
            # SofaScore API is blocked, and covers fixtures Flashscore omits.
            state = espn_state_for_match(league_name, m)
            source = "ESPN FT" if state else None
            if (not state or state[0] == "upcoming"):
                ss = sofascore_state(eid)
                if ss:
                    state = ss
                    source = "SofaScore FT"
            if (not state or state[0] == "upcoming"):
                ls = livescore_state_for_match(league_name, m)
                if ls:
                    state = ls
                    source = "LiveScore FT"
            # Flashscore in-play feed for a live score when the above have none.
            if (not state or state[0] == "upcoming"):
                fl = flashscore_live_state_for_match(league_name, m)
                if fl:
                    state = fl
                    source = "Flashscore live"
            # Flashscore confirms full time once a match should be over.
            if (not state or state[0] != "ft") and mins >= EARLY_FT_CONFIRM_MINUTES:
                if flash_events is None:
                    flash_events, _src = load_flashscore_result_events()
                fres = flashscore_result_for_match(flash_events or [], league_name, m)
                if fres and fres.get("home_score") is not None and settle_from_flashscore(m, fres):
                    if is_sofascore_event_id(eid):
                        act = actuals_for(eid, league_name, m)
                        if act:
                            m["actuals"] = {**(m.get("actuals") or {}), **act}
                    settle_stat_markets(m)
                    settled.append(f"{label} {m['home']['goals']}-{m['away']['goals']} [Flashscore FT]")
                    continue

            if not state:
                if mins >= STUCK_UPCOMING_MINUTES:
                    stuck.append({"label": label, "minutes_since_kickoff": round(mins), "id": eid,
                                  "date": m.get("date"), "time": m.get("time"), "status": m.get("status")})
                continue

            kind, h, a, minute = state
            if kind == "ft":
                if settle_confirmed_ft(m, league_name, h, a, source or "confirmed FT"):
                    settled.append(f"{label} {h}-{a} [confirmed FT]")
            elif kind == "live":
                if apply_live_state(m, h, a, minute):
                    live_set.append(f"{label} {h}-{a} ({minute or 'live'})")
                # Collect live ESPN stats for the Stats tab (summary cached; low overhead).
                espn_actuals_for_match(league_name, m)
            elif mins >= STUCK_UPCOMING_MINUTES:
                stuck.append({"label": label, "minutes_since_kickoff": round(mins), "id": eid,
                              "date": m.get("date"), "time": m.get("time"), "status": m.get("status")})
    return {"live": live_set, "settled": settled, "stuck": stuck}


def write_live_stuck_marker(stuck):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LIVE_STUCK_MARKER.write_text(json.dumps({
        "generated_at": datetime.now(ADL).isoformat(),
        "stuck_count": len(stuck),
        "matches": stuck,
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def run_live_update():
    print(f"=== soccer_routine.py live — {datetime.now(ADL).strftime('%Y-%m-%d %H:%M')} (Adelaide) ===")
    store = load_store()
    res = update_live_and_settle(store)
    print(f"  live={len(res['live'])} settled={len(res['settled'])} stuck={len(res['stuck'])}")
    for row in res["live"]:
        print(f"  live: {row}")
    for row in res["settled"]:
        print(f"  settled: {row}")
    for row in res["stuck"]:
        print(f"  STUCK upcoming past expected finish: {row['label']} (+{row['minutes_since_kickoff']}m)")
    sort_store(store)
    save_store(store)
    write_live_stuck_marker(res["stuck"])
    if res["live"] or res["settled"]:
        # Signal the results wrapper to upload the live/FT changes on its next pass
        # (it owns Firestore upload + the settlement gate + stat backfill).
        (OUT_DIR / "result_pending_upload_latest.json").write_text(json.dumps({
            "reason": f"live update changed data (live={len(res['live'])}, settled={len(res['settled'])})",
            "markedAt": datetime.now(ADL).isoformat(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    print_final_tally(store)


def run_results_only():
    print(f"=== soccer_routine.py results-only — {TODAY.isoformat()} (Adelaide) ===")
    print(f"  result_check_buffer_minutes={RESULT_CHECK_BUFFER_MINUTES}")
    store = load_store()
    pruned_bookmaker = prune_bookmaker_fixture_matches(store)
    if pruned_bookmaker:
        sort_store(store)
        save_store(store)
        print(f"  pruned_bookmaker_fixture_matches={pruned_bookmaker}")
    due_targets = due_result_targets(store)
    due_count = len(due_targets)
    print(f"  due_for_result_check={due_count}")

    print("\n[Results A] quick fetch due matches")
    if due_targets:
        for target in due_targets:
            match = target["match"]
            due_at = result_due_datetime(match)
            due_label = due_at.isoformat() if due_at else "unknown"
            print(
                "  due "
                f"id={target['event_id']} "
                f"due_at={due_label} "
                f"{target['league'].get('name')}: "
                f"{(match.get('home') or {}).get('name')} vs {(match.get('away') or {}).get('name')}"
            )
    pa = settle_due_matches_by_sofascore_id(due_targets)
    print(f"  settled={len(pa['settled'])}  skipped={pa['skipped']}  not_due={pa['not_due']}  flashscore_settled={pa.get('flashscore_settled', 0)}  livescore_settled={pa.get('livescore_settled', 0)}  closed={pa.get('closed', 0)}")

    print("\n[Results B] backfill stat actuals for recent FT matches")
    bf = backfill_stat_actuals(store)
    print(
        f"  stat_backfill attempted={bf['attempted']} refetched={bf['refetched']} "
        f"settled={len(bf['settled'])} still_pending={len(bf['still_pending'])}"
    )
    for row in bf["settled"]:
        print(f"  stat settled: {row}")
    for row in bf["still_pending"]:
        print(f"  stat still pending (will retry next run): {row}")

    sort_store(store)
    save_store(store)
    schedule_paths = write_result_schedule_log(store, {
        "settled": pa["settled"],
        "flashscore_settled": pa.get("flashscore_settled", 0),
        "livescore_settled": pa.get("livescore_settled", 0),
        "closed": pa.get("closed", 0),
        "skipped": pa.get("skipped", 0),
        "not_due": pa.get("not_due", 0),
        "backfilled": bf["refetched"],
        "merged_backfill_results": bf["settled"],
        "removed_result_shells": [],
        "enriched": 0,
        "calibration_created": 0,
        "calibration_settled_matches": 0,
        "protected": len(pa["settled"]),
        "pruned": [],
    })
    print(f"  result_schedule={schedule_paths['markdown']}")
    run_integrity_audit(store, "results")
    print_final_tally(store)


def run_seed_next_day():
    print(f"=== soccer_routine.py seed-next-day — {TODAY.isoformat()} (Adelaide) ===")
    print(f"  fixture_lookahead_days={FIXTURE_LOOKAHEAD_DAYS}")
    print(f"  fixture_target_dates={', '.join(fixture_target_dates())}")
    if TOP_UP_TARGETED:
        run_targeted_fixture_collectors()
    store = load_store()
    seen_ids = {m["id"] for L in store["leagues"] for m in L["matches"] if m.get("id")}

    print("\n[Seed A] compute team Elo + build xG index")
    elo = compute_team_elo(store)
    _XG_INDEX.clear(); _XG_INDEX.update(build_xg_index(store))
    n_teams_xg = sum(1 for tid, rows in _XG_INDEX.items() if rows)
    print(f"  teams_rated={len(elo)}  teams_with_xg={n_teams_xg}  elo_file={ELO_STORE.name}")

    print(f"\n[Seed B] forecast current/tomorrow (+{FIXTURE_LOOKAHEAD_DAYS} days)")
    pb = phase_b_forecast(store, seen_ids)
    print(f"  added={pb['added']}")

    print("\n[Seed C] attach standings to home/away")
    pb3 = phase_b3_attach_standings(store)
    print(f"  attached={pb3['attached']}")

    print("\n[Seed C.5] promote phase fixture cards")
    pbf = promote_phase_fixtures_to_store(store)
    print(f"  added={pbf['added']}")

    sort_store(store)
    save_store(store)
    if TOP_UP_TARGETED:
        store = run_targeted_top_up_helpers(store)
    else:
        run_dashboard_enrichment_helpers()
        store = load_store()
        save_store(store)
    print_final_tally(store)


def main():
    parser = argparse.ArgumentParser(description="Run Soccer Stats data routine.")
    parser.add_argument("--results-only", action="store_true", help="Only check due matches for results, enrich recent FT records, and save match_data.json.")
    parser.add_argument("--seed-next-day", action="store_true", help="Lightly seed the current/tomorrow fixture window after a slate has finished.")
    parser.add_argument("--live", action="store_true", help="Update in-play scores and confirm full time early for started matches; never settles by due-time.")
    args = parser.parse_args()
    if args.live:
        run_live_update()
    elif args.seed_next_day:
        run_seed_next_day()
    elif args.results_only:
        run_results_only()
    else:
        run_full_refresh()


if __name__ == "__main__":
    main()
