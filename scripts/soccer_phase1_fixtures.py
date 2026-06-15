#!/usr/bin/env python3
"""Phase 1 fixture collection.

Builds the Phase 1 handoff workbook from SofaScore first, with API-Football,
Flashscore, TheSportsDB, and current match_data.json as fallbacks. All displayed
fixture dates/times are stored in Australia/Adelaide local time.

Environment:
    API_FOOTBALL_KEY or APISPORTS_KEY (fallback)
    THESPORTSDB_KEY or THESPORTSDB_API_KEY (optional; defaults to free v1 key 123)
"""
import argparse
import csv
import html
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
XLSX_PATH = OUT_DIR / "Phase1_Fixture_Slate.xlsx"
CSV_PATH = OUT_DIR / "phase1_fixture_slate_current.csv"
MD_PATH = OUT_DIR / "phase1_fixture_slate_current.md"

API_BASE = "https://v3.football.api-sports.io"
API_KEY_ENV = ("API_FOOTBALL_KEY", "APISPORTS_KEY")
THESPORTSDB_KEY_ENV = ("THESPORTSDB_KEY", "THESPORTSDB_API_KEY")
THESPORTSDB_DEFAULT_KEY = "123"
THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json"
SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
SOFASCORE_INT_FRIENDLY_TOURNAMENT_ID = 851
SOFASCORE_INT_FRIENDLY_SEASON_ID = 87155
LOCAL_TZ = "Australia/Adelaide"
DEFAULT_FLASHSCORE_FEED_URLS = (
    "https://www.flashscore.com.au/x/feed/f_1_0_3_en-au_1",
    "https://www.flashscore.com.au/x/feed/f_1_0_2_en-au_1",
    "https://www.flashscore.com/x/feed/f_1_0_3_en-uk_1",
    "https://2.flashscore.ninja/2/x/feed/f_1_0_3_en-uk_1",
)
FLASHSCORE_FEED_URLS = tuple(
    url.strip()
    for url in os.environ.get("FLASHSCORE_FEED_URLS", "").split(",")
    if url.strip()
) or DEFAULT_FLASHSCORE_FEED_URLS
FLASHSCORE_FEED_URL = FLASHSCORE_FEED_URLS[0]
LAST_FLASHSCORE_FEED_URL = FLASHSCORE_FEED_URL

# Provider IDs. The legacy IDs match the existing project league IDs; most
# SofaScore unique tournament IDs happen to match those legacy IDs, except
# International Friendly Games.
LEAGUES = [
    {"legacy_id": 7, "api_id": 2, "season": 2025, "sofa_id": 7, "sofa_season_id": 76953, "name": "UEFA Champions League"},
    {"legacy_id": 679, "api_id": 3, "season": 2025, "sofa_id": 679, "sofa_season_id": 76984, "name": "UEFA Europa League"},
    {"legacy_id": 17, "api_id": 39, "season": 2025, "sofa_id": 17, "sofa_season_id": 76986, "name": "Premier League"},
    {"legacy_id": 8, "api_id": 140, "season": 2025, "sofa_id": 8, "sofa_season_id": 77559, "name": "LaLiga"},
    {"legacy_id": 35, "api_id": 78, "season": 2025, "sofa_id": 35, "sofa_season_id": 77333, "name": "Bundesliga"},
    {"legacy_id": 23, "api_id": 135, "season": 2025, "sofa_id": 23, "sofa_season_id": 76457, "name": "Serie A"},
    {"legacy_id": 34, "api_id": 61, "season": 2025, "sofa_id": 34, "sofa_season_id": 77356, "name": "Ligue 1"},
    {"legacy_id": 17015, "api_id": 848, "season": 2025, "sofa_id": 17015, "sofa_season_id": 76960, "name": "UEFA Conference League"},
    {"legacy_id": 325, "api_id": 71, "season": 2026, "sofa_id": 325, "sofa_season_id": 87678, "name": "Brasileirão Betano"},
    {"legacy_id": 384, "api_id": 13, "season": 2026, "sofa_id": 384, "sofa_season_id": 87760, "name": "CONMEBOL Libertadores"},
    {"legacy_id": 136, "api_id": 188, "season": 2025, "sofa_id": 136, "sofa_season_id": 82603, "name": "A-League Men"},
    {"legacy_id": 16, "api_id": 1, "season": 2026, "sofa_id": 16, "sofa_season_id": 58210, "name": "FIFA World Cup"},
    {"legacy_id": 10, "api_id": 10, "season": 2026, "sofa_id": 851, "sofa_season_id": 87155, "name": "International Friendly Games"},
    {"legacy_id": 37, "api_id": 88, "season": 2025, "sofa_id": 37, "sofa_season_id": 77012, "name": "Eredivisie"},
    {"legacy_id": 238, "api_id": 94, "season": 2025, "sofa_id": 238, "sofa_season_id": 77806, "name": "Primeira Liga"},
    {"legacy_id": 242, "api_id": 253, "season": 2026, "sofa_id": 242, "sofa_season_id": 86668, "name": "MLS"},
    {"legacy_id": 36, "api_id": 179, "season": 2025, "sofa_id": 36, "sofa_season_id": 77128, "name": "Scottish Premiership"},
    {"legacy_id": 196, "api_id": 98, "season": 2026, "sofa_id": 196, "sofa_season_id": 87931, "name": "J1 League"},
    {"legacy_id": 18, "api_id": 40, "season": 2025, "sofa_id": 18, "sofa_season_id": 77347, "name": "Championship"},
    {"legacy_id": 24, "api_id": 41, "season": 2025, "sofa_id": 24, "sofa_season_id": 77352, "name": "League One"},
    {"legacy_id": 25, "api_id": 42, "season": 2025, "sofa_id": 25, "sofa_season_id": 77351, "name": "League Two"},
    {"legacy_id": 40, "api_id": 113, "season": 2026, "sofa_id": 40, "sofa_season_id": 87925, "name": "Allsvenskan"},
    {"legacy_id": 20, "api_id": 103, "season": 2026, "sofa_id": 20, "sofa_season_id": 87809, "name": "Eliteserien"},
]

LEAGUE_BY_API = {x["api_id"]: x for x in LEAGUES}
LEAGUE_BY_NAME = {x["name"]: x for x in LEAGUES}
READY = "ready_for_phase_2"

# TheSportsDB v1 league IDs for the same league set where available. These
# let us ask for a day within one competition instead of taking the tiny global
# free sample returned by eventsday.php?s=Soccer.
THESPORTSDB_LEAGUES = {
    "Premier League": "4328",
    "Championship": "4329",
    "Bundesliga": "4331",
    "Serie A": "4332",
    "Ligue 1": "4334",
    "LaLiga": "4335",
    "Eredivisie": "4337",
    "MLS": "4346",
    "UEFA Champions League": "4480",
    "UEFA Europa League": "4481",
    "Allsvenskan": "4339",
    "Eliteserien": "4396",
}

THESPORTSDB_LEAGUE_HINTS = {
    "Premier League": ("english premier league", "premier league"),
    "Championship": ("english league championship", "championship"),
    "League One": ("english league one", "league one"),
    "League Two": ("english league two", "league two"),
    "LaLiga": ("spanish la liga", "la liga"),
    "Bundesliga": ("german bundesliga", "bundesliga"),
    "Serie A": ("italian serie a", "serie a"),
    "Ligue 1": ("french ligue 1", "ligue 1"),
    "Eredivisie": ("dutch eredivisie", "eredivisie"),
    "Primeira Liga": ("portuguese primeira liga", "liga portugal", "primeira liga"),
    "A-League Men": ("a-league men", "a-league"),
    "Scottish Premiership": ("scottish premiership", "premiership"),
    "J1 League": ("japanese j1 league", "j1 league"),
    "UEFA Champions League": ("uefa champions league", "champions league"),
    "UEFA Europa League": ("uefa europa league", "europa league"),
    "UEFA Conference League": ("uefa europa conference league", "uefa conference league", "conference league"),
    "Brasileirão Betano": ("brasileirao betano", "brasileirão betano", "brazilian serie a", "campeonato brasileiro"),
    "CONMEBOL Libertadores": ("conmebol libertadores", "copa libertadores", "libertadores"),
    "FIFA World Cup": ("fifa world cup", "men's world cup", "world cup", "world championship"),
    "International Friendly Games": ("international friendly games", "international friendlies", "friendly international", "friendlies"),
    "MLS": ("american major league soccer", "major league soccer", "mls"),
    "Allsvenskan": ("swedish allsvenskan", "allsvenskan"),
    "Eliteserien": ("norwegian eliteserien", "eliteserien"),
}

# Exact Flashscore league names (after stripping the country prefix). Some
# Flashscore feeds prepend "COUNTRY: " (e.g. "ENGLAND: Premier League"); we
# strip that before comparison. Exact match prevents LaLiga2/MLS Next Pro
# style leaks where substring matches succeed.
FLASHSCORE_LEAGUE_NAMES = {
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

# Tokens that indicate a competition is NOT one of the listed top-flight men's leagues.
LEAGUE_EXCLUSION_TOKENS = (
    "women", "wom.", "women's", "ladies", "feminine", "femenina", "femenino",
    "next pro", "reserves", "reserve", "u23", "u21", "u20", "u19", "u18", "u17",
    "youth", "academy", "premier league 2", "primavera", "regionalliga",
    "oberliga", "ekstraklasa", "premier league cup", "fa cup", "efl cup",
    "copa del rey", "dfb pokal", "coupe de france", "knvb", "us open cup",
    "leagues cup", "concacaf",
)

# Marker patterns Flashscore uses for women's teams in event names.
WOMEN_TEAM_MARKERS = (" w", " (w)", "(w)")
YOUTH_TEAM_RE = re.compile(r"\b(?:u|under\s*)(?:17|18|19|20|21|23)\b", re.I)
SOFASCORE_PROFILES = ("chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0")
SOFASCORE_EVENTS_PAGES = int(os.environ.get("SOCCER_SOFASCORE_EVENT_PAGES", "4"))

HEADERS = [
    "run_timestamp",
    "source",
    "source_health",
    "league_id",
    "api_league_id",
    "league",
    "league_logo",
    "event_id",
    "date",
    "time",
    "timezone",
    "utc_timestamp",
    "status",
    "home",
    "home_team_id",
    "home_logo",
    "home_goals",
    "away",
    "away_team_id",
    "away_logo",
    "away_goals",
    "is_duplicate",
    "is_stale",
    "missing_fields",
    "phase1_status",
    "phase1_notes",
]


def now_adelaide():
    return datetime.now(ADL)


def iso_date_range(start, days):
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]


def fixture_target_dates_from_env():
    dates = []
    for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            date.fromisoformat(item)
        except ValueError:
            continue
        dates.append(item)
    return sorted(set(dates))


def api_key():
    for name in API_KEY_ENV:
        val = os.environ.get(name)
        if val:
            return val
    return ""


def thesportsdb_key():
    for name in THESPORTSDB_KEY_ENV:
        val = os.environ.get(name)
        if val:
            return val
    return THESPORTSDB_DEFAULT_KEY


def parse_source_datetime(value, timestamp=None):
    if timestamp:
        try:
            dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(ADL)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M"), int(timestamp)
        except Exception:
            pass
    if not value:
        return "", "", ""
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ADL)
        local = dt.astimezone(ADL)
        utc_ts = int(local.astimezone(timezone.utc).timestamp())
        return local.strftime("%Y-%m-%d"), local.strftime("%H:%M"), utc_ts
    except Exception:
        return "", "", ""


def norm_text(value):
    return "".join(ch for ch in (value or "").lower() if ch.isalnum())


def provider_team_id(provider, value):
    normalized = norm_text(value)
    return f"{provider}:{normalized}" if normalized else ""


def short_status(api_status):
    code = ((api_status or {}).get("short") or "").upper()
    if code in ("FT", "AET", "PEN"):
        return "FT"
    if code in ("PST", "CANC", "ABD", "SUSP"):
        return "postponed_or_cancelled"
    if code in ("1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE"):
        return "live"
    if code in ("NS", "TBD"):
        return "upcoming"
    return "unresolved"


def missing_fields(row):
    required = ["event_id", "league_id", "date", "time", "status", "home", "home_team_id", "away", "away_team_id"]
    return [k for k in required if row.get(k) in ("", None)]


def assign_phase1_status(row, today):
    missing = missing_fields(row)
    row["missing_fields"] = ",".join(missing)
    if row.get("is_duplicate") == "yes":
        return "duplicate_event_id", "Duplicate event ID."
    if "event_id" in missing:
        return "missing_event_id", "Missing fixture/event ID."
    if row.get("league") not in LEAGUE_BY_NAME:
        return "wrong_league", "Fixture is outside the listed league set."
    if "date" in missing or "time" in missing:
        return "missing_datetime", "Missing or unparseable date/time."
    if "home_team_id" in missing or "away_team_id" in missing:
        return "missing_team_id", "Missing home or away team ID."
    if row.get("status") == "postponed_or_cancelled":
        return "postponed_or_cancelled", "Fixture is postponed, cancelled, abandoned, or suspended."
    if row.get("source_health") != "healthy":
        try:
            is_stale = date.fromisoformat(row["date"]) < today and row.get("status") != "FT"
        except Exception:
            is_stale = False
        row["is_stale"] = "yes" if is_stale else "no"
        if is_stale:
            return "needs_settlement", "Past fixture is still not confirmed FT."
        return "source_unverified", "Primary source did not validate this fixture."
    try:
        is_stale = date.fromisoformat(row["date"]) < today and row.get("status") != "FT"
    except Exception:
        is_stale = True
    row["is_stale"] = "yes" if is_stale else "no"
    if is_stale:
        return "needs_settlement", "Past fixture is still not confirmed FT."
    return READY, "Clean Phase 1 fixture."


def fetch_api_fixtures(day, league, key):
    params = {
        "date": day,
        "league": str(league["api_id"]),
        "season": str(league["season"]),
        "timezone": LOCAL_TZ,
    }
    url = API_BASE + "/fixtures?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-apisports-key": key})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def flashscore_headers(url):
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "X-Fsign": "SW9D1eZo",
        "Referer": origin + "/",
        "Origin": origin,
    }


def fetch_flashscore_feed():
    global LAST_FLASHSCORE_FEED_URL
    errors = []
    for url in FLASHSCORE_FEED_URLS:
        req = urllib.request.Request(url, headers=flashscore_headers(url))
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                LAST_FLASHSCORE_FEED_URL = url
                return resp.read().decode("utf-8", errors="replace")
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("Flashscore feeds failed: " + " | ".join(errors))


def flashscore_fields(chunk):
    fields = {}
    for delimiter in ("¬", "\xAC", "Â¬"):
        if delimiter in chunk:
            parts = chunk.split(delimiter)
            break
    else:
        parts = [chunk]
    for part in parts:
        if "÷" in part:
            key, _, value = part.partition("÷")
        elif "\xF7" in part:
            key, _, value = part.partition("\xF7")
        elif "Ã·" in part:
            key, _, value = part.partition("Ã·")
        else:
            continue
        fields[key.strip()] = value.strip()
    return fields


def parse_flashscore_feed(raw):
    events = []
    league_name = ""
    league_country = ""
    for chunk in (raw or "").split("~"):
        chunk = chunk.strip()
        if not chunk:
            continue
        fields = flashscore_fields(chunk)
        if "ZA" in fields:
            league_name = fields.get("ZA", "")
            league_country = fields.get("ZY", "")
            continue
        if "AA" not in fields:
            continue
        events.append({
            "id": fields.get("AA", ""),
            "league": league_name,
            "country": league_country,
            "home": fields.get("AE") or fields.get("CX") or fields.get("FH") or "",
            "away": fields.get("AF") or fields.get("FK") or "",
            "home_score": fields.get("AG", ""),
            "away_score": fields.get("AH", ""),
            "status": fields.get("AB") or fields.get("AC") or "",
            "ts": fields.get("AD", ""),
        })
    return events


def flashscore_status(code):
    code = str(code or "").strip().upper()
    if code == "3":
        return "FT"
    if code in ("1", "2", "4", "5", "6", "7"):
        return "live"
    if code in ("POSTP", "PST", "CANC", "ABD", "SUSP"):
        return "postponed_or_cancelled"
    return "upcoming"


FLASHSCORE_STATS_FEED_TEMPLATES = [
    "https://www.flashscore.com.au/x/feed/df_st_1_{eid}",
    "https://www.flashscore.com/x/feed/df_st_1_{eid}",
    "https://2.flashscore.ninja/2/x/feed/df_st_1_{eid}",
]


def _flashscore_stat_int(value):
    match = re.search(r"-?\d+", str(value or ""))
    return int(match.group()) if match else None


def parse_flashscore_event_stats(raw):
    """Parse a Flashscore df_st detail feed into full-match cards/corners actuals.

    The feed is the same ÷/¬ delimited format as the fixture feed. ``SE`` marks a
    period ("Match", "1st Half", "2nd Half") and each stat row is
    ``SD÷id¬SG÷<name>¬SH÷<home>¬SI÷<away>``. Only the full-match ("Match") block is
    used. Flashscore omits zero-count rows, so within a populated block a missing
    card row legitimately means zero — corners presence confirms the block is real.
    """
    period = ""
    home_corners = away_corners = None
    home_yellow = away_yellow = home_red = away_red = 0
    saw_cards = False
    for chunk in (raw or "").split("~"):
        fields = flashscore_fields(chunk)
        if "SE" in fields:
            period = (fields.get("SE") or "").strip().lower()
            continue
        if period != "match":
            continue
        name = (fields.get("SG") or "").strip().lower()
        if not name:
            continue
        home = _flashscore_stat_int(fields.get("SH"))
        away = _flashscore_stat_int(fields.get("SI"))
        if home is None or away is None:
            continue
        if "corner" in name:
            home_corners, away_corners = home, away
        elif "yellow card" in name:
            home_yellow, away_yellow = home, away
            saw_cards = True
        elif "red card" in name:
            home_red, away_red = home, away
            saw_cards = True
    if home_corners is None:
        # No corners in the full-match block means stats are not published yet.
        return {}
    out = {
        "source": "Flashscore",
        "home_corners": home_corners,
        "away_corners": away_corners,
        "corners_total": home_corners + away_corners,
    }
    if saw_cards or home_corners is not None:
        out["home_cards"] = home_yellow + home_red
        out["away_cards"] = away_yellow + away_red
        out["cards_total"] = out["home_cards"] + out["away_cards"]
    return out


def fetch_flashscore_event_stats(event_id):
    """Return full-match stat actuals for a Flashscore event id, or {} if unavailable."""
    if not event_id:
        return {}
    for template in FLASHSCORE_STATS_FEED_TEMPLATES:
        url = template.format(eid=event_id)
        req = urllib.request.Request(url, headers=flashscore_headers(url))
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except Exception:
            continue
        stats = parse_flashscore_event_stats(raw)
        if stats:
            return stats
    return {}


def flashscore_league(event):
    country = (event.get("country") or "").lower()
    league = (event.get("league") or "").lower()
    if any(tok in league for tok in LEAGUE_EXCLUSION_TOKENS):
        return None
    if any(tok in country for tok in LEAGUE_EXCLUSION_TOKENS):
        return None
    # Strip leading "COUNTRY: " prefix that Flashscore feeds sometimes add.
    bare_league = league
    if ":" in bare_league:
        bare_league = bare_league.split(":", 1)[1].strip()
    for name, (country_hint, accepted_names) in FLASHSCORE_LEAGUE_NAMES.items():
        if country_hint and country_hint not in country:
            continue
        if bare_league in accepted_names:
            return LEAGUE_BY_NAME[name]
    return None


def is_women_team(name):
    if not name:
        return False
    lower = " " + name.strip().lower()
    return any(marker in lower for marker in WOMEN_TEAM_MARKERS)


def is_youth_or_reserve_team(name):
    lower = (name or "").strip().lower()
    if not lower:
        return False
    return bool(YOUTH_TEAM_RE.search(lower)) or any(
        token in lower for token in ("youth", "academy", "reserve", "reserves")
    )


def is_excluded_fixture(league_name, home, away):
    if league_name != "International Friendly Games":
        return False
    return is_youth_or_reserve_team(home) or is_youth_or_reserve_team(away)


def rows_from_flashscore(start_date, days, run_ts):
    try:
        raw = fetch_flashscore_feed()
        events = parse_flashscore_feed(raw)
        health = "healthy" if events else "degraded"
        notes = "" if events else "Flashscore feed parsed zero events."
    except Exception as exc:
        return [], [{
            "run_timestamp": run_ts,
            "source": "Flashscore",
            "endpoint": ", ".join(FLASHSCORE_FEED_URLS),
            "date": "",
            "league": "",
            "source_health": "blocked",
            "records": 0,
            "notes": str(exc),
        }]

    allowed_dates = set(iso_date_range(start_date, days))
    rows = []
    matched = 0
    league_hit = 0
    out_of_window = 0
    skipped_women = 0
    skipped_youth = 0
    league_counter = Counter()
    sample_leagues = []
    seen_pairs = set()
    for event in events:
        country = (event.get("country") or "").strip()
        league_name = (event.get("league") or "").strip()
        pair = (country, league_name)
        if pair not in seen_pairs:
            seen_pairs.add(pair)
            if len(sample_leagues) < 8:
                sample_leagues.append(f"{country}|{league_name}")
        league = flashscore_league(event)
        if not league:
            continue
        league_hit += 1
        if is_women_team(event.get("home")) or is_women_team(event.get("away")):
            skipped_women += 1
            continue
        if is_excluded_fixture(league["name"], event.get("home"), event.get("away")):
            skipped_youth += 1
            continue
        local_date, local_time, utc_ts = parse_source_datetime(None, event.get("ts"))
        if local_date not in allowed_dates:
            out_of_window += 1
            continue
        league_counter[league["name"]] += 1
        status_text = flashscore_status(event.get("status"))
        matched += 1
        rows.append({
            "run_timestamp": run_ts,
            "source": "Flashscore",
            "source_health": health,
            "league_id": league["legacy_id"],
            "api_league_id": "",
            "league": league["name"],
            "event_id": "flashscore:" + str(event.get("id", "")),
            "date": local_date,
            "time": "FT" if status_text == "FT" else local_time,
            "timezone": LOCAL_TZ,
            "utc_timestamp": utc_ts,
            "status": status_text,
            "home": event.get("home", ""),
            "home_team_id": provider_team_id("flashscore", event.get("home", "")),
            "away": event.get("away", ""),
            "away_team_id": provider_team_id("flashscore", event.get("away", "")),
            "is_duplicate": "no",
            "is_stale": "no",
            "missing_fields": "",
            "phase1_status": "",
            "phase1_notes": "Keyless Flashscore fixture feed.",
        })

    diag = (
        f"events={len(events)} league_hit={league_hit} "
        f"skipped_women={skipped_women} skipped_youth={skipped_youth} "
        f"out_of_window={out_of_window} matched={matched} "
        f"by_league={dict(league_counter)} sample_leagues={sample_leagues}"
    )
    print(f"[flashscore] {diag}")
    combined_notes = (notes + " " + diag).strip() if notes else diag
    return rows, [{
        "run_timestamp": run_ts,
        "source": "Flashscore",
        "endpoint": LAST_FLASHSCORE_FEED_URL,
        "date": f"{min(allowed_dates)} to {max(allowed_dates)}" if allowed_dates else "",
        "league": "listed leagues",
        "source_health": health,
        "records": matched,
        "notes": combined_notes,
    }]


def sofascore_fetch(path):
    if not cffi_requests:
        return None
    url = SOFASCORE_BASE + path
    for attempt in range(3):
        try:
            response = cffi_requests.get(
                url,
                impersonate=random.choice(SOFASCORE_PROFILES),
                timeout=20,
            )
            if response.status_code in (403, 404):
                return None
            response.raise_for_status()
            return response.json()
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.0 + attempt)
    return None


def sofascore_status(status):
    status_type = ((status or {}).get("type") or "").lower()
    status_code = (status or {}).get("code")
    if status_type == "finished" or status_code in (100, 110, 120):
        return "FT"
    if status_type in ("canceled", "cancelled", "postponed", "interrupted") or status_code in (60, 70):
        return "postponed_or_cancelled"
    if status_type in ("inprogress", "live"):
        return "live"
    if status_type in ("notstarted", "not_started"):
        return "upcoming"
    return "unresolved"


def sofa_team_id(team):
    team_id = team.get("id")
    if team_id:
        return str(team_id)
    return provider_team_id("sofascore", team.get("name") or team.get("shortName") or "")


def rows_from_sofascore_league(league, start_date, days, run_ts):
    sofa_id = league.get("sofa_id")
    sofa_season_id = league.get("sofa_season_id")
    if not sofa_id or not sofa_season_id:
        return [], [{
            "run_timestamp": run_ts,
            "source": "SofaScore",
            "endpoint": "unique-tournament season config",
            "date": "",
            "league": league["name"],
            "source_health": "blocked",
            "records": 0,
            "notes": "Missing SofaScore unique tournament or season ID.",
        }]

    allowed_dates = set(iso_date_range(start_date, days))
    rows = []
    seen = set()
    endpoints = []
    blocked = False
    successful = False
    for direction in ("last", "next"):
        for page in range(SOFASCORE_EVENTS_PAGES):
            path = (
                f"/unique-tournament/{sofa_id}"
                f"/season/{sofa_season_id}/events/{direction}/{page}"
            )
            endpoints.append(path)
            payload = sofascore_fetch(path)
            if payload is None:
                blocked = True
                continue
            successful = True
            events = payload.get("events") or []
            if not events:
                continue
            for event in events:
                event_id = event.get("id")
                if not event_id or event_id in seen:
                    continue
                ts = event.get("startTimestamp")
                if not ts:
                    continue
                local_date, local_time, utc_ts = parse_source_datetime(None, ts)
                if local_date not in allowed_dates:
                    continue
                home = event.get("homeTeam") or {}
                away = event.get("awayTeam") or {}
                home_name = home.get("name") or home.get("shortName") or ""
                away_name = away.get("name") or away.get("shortName") or ""
                if is_women_team(home_name) or is_women_team(away_name):
                    continue
                if is_excluded_fixture(league["name"], home_name, away_name):
                    continue
                seen.add(event_id)
                status_text = sofascore_status(event.get("status"))
                home_score = event.get("homeScore") or {}
                away_score = event.get("awayScore") or {}
                rows.append({
                    "run_timestamp": run_ts,
                    "source": "SofaScore",
                    "source_health": "healthy",
                    "league_id": league["legacy_id"],
                    "api_league_id": sofa_id,
                    "league": league["name"],
                    "league_logo": f"https://img.sofascore.com/api/v1/unique-tournament/{sofa_id}/image",
                    "event_id": str(event_id),
                    "date": local_date,
                    "time": "FT" if status_text == "FT" else local_time,
                    "timezone": LOCAL_TZ,
                    "utc_timestamp": utc_ts,
                    "status": status_text,
                    "home": home_name,
                    "home_team_id": sofa_team_id(home),
                    "home_logo": f"https://img.sofascore.com/api/v1/team/{home.get('id')}/image" if home.get("id") else "",
                    "home_goals": home_score.get("normaltime", home_score.get("current", "")) if status_text == "FT" else "",
                    "away": away_name,
                    "away_team_id": sofa_team_id(away),
                    "away_logo": f"https://img.sofascore.com/api/v1/team/{away.get('id')}/image" if away.get("id") else "",
                    "away_goals": away_score.get("normaltime", away_score.get("current", "")) if status_text == "FT" else "",
                    "is_duplicate": "no",
                    "is_stale": "no",
                    "missing_fields": "",
                    "phase1_status": "",
                    "phase1_notes": "Primary SofaScore tournament fixture feed.",
                })
    health = "healthy" if successful else ("blocked" if blocked else "degraded")
    return rows, [{
        "run_timestamp": run_ts,
        "source": "SofaScore",
        "endpoint": f"unique-tournament/{sofa_id}/season/{sofa_season_id}",
        "date": f"{min(allowed_dates)} to {max(allowed_dates)}" if allowed_dates else "",
        "league": league["name"],
        "source_health": health,
        "records": len(rows),
        "notes": f"Primary tournament feed from sofascore.com; pages checked={len(endpoints)}.",
    }]


def rows_from_sofascore(start_date, days, run_ts):
    rows = []
    health_rows = []
    if not cffi_requests:
        return rows, [{
            "run_timestamp": run_ts,
            "source": "SofaScore",
            "endpoint": "curl_cffi",
            "date": f"{start_date.isoformat()} to {(start_date + timedelta(days=days-1)).isoformat()}",
            "league": "all",
            "source_health": "blocked",
            "records": 0,
            "notes": "curl_cffi is not installed; cannot use SofaScore smart-mimic requests.",
        }]

    for league in LEAGUES:
        league_rows, league_health = rows_from_sofascore_league(league, start_date, days, run_ts)
        rows.extend(league_rows)
        health_rows.extend(league_health)
        time.sleep(0.15 + random.random() * 0.25)
    return rows, health_rows


def rows_from_api(start_date, days, run_ts, key):
    rows = []
    health_rows = []
    for day in iso_date_range(start_date, days):
        for league in LEAGUES:
            status = "healthy"
            notes = ""
            count = 0
            try:
                payload = fetch_api_fixtures(day, league, key)
                errors = payload.get("errors")
                if errors:
                    status = "degraded"
                    notes = json.dumps(errors, ensure_ascii=False)
                fixtures = payload.get("response") or []
                count = len(fixtures)
            except Exception as exc:
                status = "blocked"
                notes = str(exc)
                fixtures = []

            health_rows.append({
                "run_timestamp": run_ts,
                "source": "API-Football",
                "endpoint": "/fixtures",
                "date": day,
                "league": league["name"],
                "source_health": status,
                "records": count,
                "notes": notes,
            })

            for item in fixtures:
                fixture = item.get("fixture") or {}
                api_league = item.get("league") or {}
                teams = item.get("teams") or {}
                goals = item.get("goals") or {}
                home = teams.get("home") or {}
                away = teams.get("away") or {}
                local_date, local_time, utc_ts = parse_source_datetime(
                    fixture.get("date"), fixture.get("timestamp")
                )
                api_id = api_league.get("id") or league["api_id"]
                canonical = LEAGUE_BY_API.get(api_id, league)
                if is_excluded_fixture(canonical["name"], home.get("name", ""), away.get("name", "")):
                    continue
                status_text = short_status(fixture.get("status"))
                row = {
                    "run_timestamp": run_ts,
                    "source": "API-Football",
                    "source_health": status,
                    "league_id": canonical["legacy_id"],
                    "api_league_id": api_id,
                    "league": canonical["name"],
                    "league_logo": api_league.get("logo", ""),
                    "event_id": fixture.get("id", ""),
                    "date": local_date,
                    "time": "FT" if status_text == "FT" else local_time,
                    "timezone": LOCAL_TZ,
                    "utc_timestamp": utc_ts,
                    "status": status_text,
                    "home": home.get("name", ""),
                    "home_team_id": home.get("id", ""),
                    "home_logo": home.get("logo", ""),
                    "away": away.get("name", ""),
                    "away_team_id": away.get("id", ""),
                    "away_logo": away.get("logo", ""),
                    "is_duplicate": "no",
                    "is_stale": "no",
                    "missing_fields": "",
                    "phase1_status": "",
                    "phase1_notes": "",
                }
                if status_text == "FT":
                    row["phase1_notes"] = f"FT score {goals.get('home')}-{goals.get('away')}"
                rows.append(row)
    return rows, health_rows


def thesportsdb_league_matches(canonical_name, provider_league):
    league = (provider_league or "").lower()
    return any(hint in league for hint in THESPORTSDB_LEAGUE_HINTS.get(canonical_name, ()))


def thesportsdb_status(event):
    if str(event.get("strPostponed") or "").lower() == "yes":
        return "postponed_or_cancelled"
    status = (event.get("strStatus") or "").lower()
    if "finished" in status:
        return "FT"
    if any(token in status for token in ("live", "half", "extra", "penalty", "progress")):
        return "live"
    if any(token in status for token in ("postponed", "cancelled", "abandoned", "suspended")):
        return "postponed_or_cancelled"
    return "upcoming"


def thesportsdb_event_datetime(event):
    local_date = event.get("dateEventLocal") or event.get("dateEvent") or ""
    local_time = (event.get("strTimeLocal") or event.get("strTime") or "").strip()
    if local_time:
        local_time = local_time[:5]

    utc_ts = ""
    timestamp = event.get("strTimestamp")
    if timestamp:
        text = str(timestamp).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local = dt.astimezone(ADL)
            local_date = local.strftime("%Y-%m-%d")
            local_time = local.strftime("%H:%M")
            utc_ts = int(dt.astimezone(timezone.utc).timestamp())
        except Exception:
            pass

    return local_date, local_time, utc_ts


def fetch_thesportsdb_events(day, key, league_id=None):
    params = {"d": day}
    if league_id:
        params["l"] = league_id
    else:
        params["s"] = "Soccer"
    url = f"{THESPORTSDB_BASE}/{key}/eventsday.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("events") or [], url


def rows_from_thesportsdb(start_date, days, run_ts):
    rows = []
    health_rows = []
    key = thesportsdb_key()
    allowed_dates = iso_date_range(start_date, days)

    for day in allowed_dates:
        for league in LEAGUES:
            provider_league_id = THESPORTSDB_LEAGUES.get(league["name"])
            if not provider_league_id:
                continue

            status = "healthy"
            notes = ""
            try:
                events, url = fetch_thesportsdb_events(day, key, provider_league_id)
            except Exception as exc:
                events = []
                url = f"{THESPORTSDB_BASE}/{key}/eventsday.php?d={day}&l={provider_league_id}"
                status = "blocked"
                notes = str(exc)

            matched = 0
            for event in events:
                if not thesportsdb_league_matches(league["name"], event.get("strLeague", "")):
                    continue
                if is_women_team(event.get("strHomeTeam")) or is_women_team(event.get("strAwayTeam")):
                    continue
                local_date, local_time, utc_ts = thesportsdb_event_datetime(event)
                if local_date not in allowed_dates:
                    continue
                status_text = thesportsdb_status(event)
                row = {
                    "run_timestamp": run_ts,
                    "source": "TheSportsDB",
                    "source_health": status,
                    "league_id": league["legacy_id"],
                    "api_league_id": provider_league_id,
                    "league": league["name"],
                    "league_logo": event.get("strLeagueBadge", ""),
                    "event_id": "thesportsdb:" + str(event.get("idEvent", "")),
                    "date": local_date,
                    "time": "FT" if status_text == "FT" else local_time,
                    "timezone": LOCAL_TZ,
                    "utc_timestamp": utc_ts,
                    "status": status_text,
                    "home": event.get("strHomeTeam", ""),
                    "home_team_id": event.get("idHomeTeam", ""),
                    "home_logo": event.get("strHomeTeamBadge", ""),
                    "away": event.get("strAwayTeam", ""),
                    "away_team_id": event.get("idAwayTeam", ""),
                    "away_logo": event.get("strAwayTeamBadge", ""),
                    "is_duplicate": "no",
                    "is_stale": "no",
                    "missing_fields": "",
                    "phase1_status": "",
                    "phase1_notes": "TheSportsDB v1 free API fallback.",
                }
                if status_text == "FT":
                    row["phase1_notes"] = f"FT score {event.get('intHomeScore')}-{event.get('intAwayScore')}. TheSportsDB v1 free API fallback."
                rows.append(row)
                matched += 1

            health_rows.append({
                "run_timestamp": run_ts,
                "source": "TheSportsDB",
                "endpoint": url.replace(f"/{key}/", "/<key>/"),
                "date": day,
                "league": league["name"],
                "source_health": status,
                "records": matched,
                "notes": notes,
            })
            time.sleep(0.2)

    if not rows:
        # Last attempt: use the global soccer day feed. The free key only
        # returns a very small sample, but it is still better than dropping
        # straight to local stale data when a listed league is present.
        for day in allowed_dates:
            status = "healthy"
            notes = ""
            try:
                events, url = fetch_thesportsdb_events(day, key)
            except Exception as exc:
                events = []
                url = f"{THESPORTSDB_BASE}/{key}/eventsday.php?d={day}&s=Soccer"
                status = "blocked"
                notes = str(exc)

            matched = 0
            for event in events:
                league = next(
                    (item for item in LEAGUES if thesportsdb_league_matches(item["name"], event.get("strLeague", ""))),
                    None,
                )
                if not league:
                    continue
                local_date, local_time, utc_ts = thesportsdb_event_datetime(event)
                status_text = thesportsdb_status(event)
                rows.append({
                    "run_timestamp": run_ts,
                    "source": "TheSportsDB",
                    "source_health": status,
                    "league_id": league["legacy_id"],
                    "api_league_id": event.get("idLeague", ""),
                    "league": league["name"],
                    "league_logo": event.get("strLeagueBadge", ""),
                    "event_id": "thesportsdb:" + str(event.get("idEvent", "")),
                    "date": local_date,
                    "time": "FT" if status_text == "FT" else local_time,
                    "timezone": LOCAL_TZ,
                    "utc_timestamp": utc_ts,
                    "status": status_text,
                    "home": event.get("strHomeTeam", ""),
                    "home_team_id": event.get("idHomeTeam", ""),
                    "home_logo": event.get("strHomeTeamBadge", ""),
                    "away": event.get("strAwayTeam", ""),
                    "away_team_id": event.get("idAwayTeam", ""),
                    "away_logo": event.get("strAwayTeamBadge", ""),
                    "is_duplicate": "no",
                    "is_stale": "no",
                    "missing_fields": "",
                    "phase1_status": "",
                    "phase1_notes": "TheSportsDB global soccer day fallback.",
                })
                matched += 1

            health_rows.append({
                "run_timestamp": run_ts,
                "source": "TheSportsDB",
                "endpoint": url.replace(f"/{key}/", "/<key>/"),
                "date": day,
                "league": "Soccer",
                "source_health": status,
                "records": matched,
                "notes": notes or "Global free feed returns a small sample.",
            })
            time.sleep(0.2)

    return rows, health_rows


def rows_from_store(run_ts):
    if not STORE.exists():
        return [], [{
            "run_timestamp": run_ts,
            "source": "local match_data.json",
            "endpoint": "match_data.json",
            "date": "",
            "league": "",
            "source_health": "blocked",
            "records": 0,
            "notes": "match_data.json not found and no API-Football key set.",
        }]
    store = json.loads(STORE.read_text(encoding="utf-8"))
    rows = []
    for league in store.get("leagues", []):
        canonical = LEAGUE_BY_NAME.get(league.get("name", ""), {"legacy_id": league.get("id", ""), "api_id": "", "name": league.get("name", "")})
        for match in league.get("matches", []):
            if match.get("status") == "FT":
                continue
            home = match.get("home") or {}
            away = match.get("away") or {}
            rows.append({
                "run_timestamp": run_ts,
                "source": "local match_data.json",
                "source_health": "source_unverified",
                "league_id": canonical.get("legacy_id", league.get("id", "")),
                "api_league_id": canonical.get("api_id", ""),
                "league": canonical.get("name", league.get("name", "")),
                "league_logo": league.get("logo", league.get("logo_url", "")),
                "event_id": match.get("id", ""),
                "date": match.get("date", ""),
                "time": match.get("time", ""),
                "timezone": LOCAL_TZ,
                "utc_timestamp": "",
                "status": match.get("status", "unresolved"),
                "home": home.get("name", ""),
                "home_team_id": home.get("team_id", ""),
                "home_logo": home.get("logo", home.get("logo_url", "")),
                "away": away.get("name", ""),
                "away_team_id": away.get("team_id", ""),
                "away_logo": away.get("logo", away.get("logo_url", "")),
                "is_duplicate": "no",
                "is_stale": "no",
                "missing_fields": "",
                "phase1_status": "",
                "phase1_notes": "Fallback row from current match_data.json; API-Football key not available.",
            })
    return rows, [{
        "run_timestamp": run_ts,
        "source": "API-Football",
        "endpoint": "/fixtures",
        "date": "",
        "league": "",
        "source_health": "blocked",
        "records": 0,
        "notes": "Missing API_FOOTBALL_KEY/APISPORTS_KEY; used local match_data.json fallback.",
    }]


def finalize_rows(rows, today):
    seen = Counter(str(r.get("event_id", "")) for r in rows if r.get("event_id", "") != "")
    for row in rows:
        if row.get("event_id") and seen[str(row["event_id"])] > 1:
            row["is_duplicate"] = "yes"
        status, notes = assign_phase1_status(row, today)
        if row.get("phase1_notes") and notes != "Clean Phase 1 fixture.":
            row["phase1_notes"] = row["phase1_notes"] + " " + notes
        elif not row.get("phase1_notes") or row["phase1_notes"].startswith("Fallback row"):
            row["phase1_notes"] = (row.get("phase1_notes", "") + " " + notes).strip()
        row["phase1_status"] = status
    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("league", ""), r.get("home", "")))
    return rows


def league_summary(rows):
    grouped = defaultdict(Counter)
    for row in rows:
        league = row.get("league", "")
        grouped[league]["total"] += 1
        grouped[league][row.get("phase1_status", "")] += 1
        grouped[league][row.get("status", "")] += 1
    out = []
    statuses = ["total", READY, "needs_settlement", "source_unverified", "missing_team_id", "missing_event_id", "wrong_league", "duplicate_event_id", "postponed_or_cancelled", "missing_datetime", "upcoming", "live", "FT"]
    for league in sorted(grouped):
        row = {"league": league}
        for key in statuses:
            row[key] = grouped[league].get(key, 0)
        out.append(row)
    return out


def run_notes(rows, health_rows, start_date, days, source_mode):
    counts = Counter(r.get("phase1_status", "") for r in rows)
    notes = [
        {"item": "date_window", "value": f"{start_date.isoformat()} to {(start_date + timedelta(days=days-1)).isoformat()}"},
        {"item": "timezone", "value": LOCAL_TZ},
        {"item": "source_mode", "value": source_mode},
        {"item": "total_fixtures", "value": len(rows)},
        {"item": "ready_for_phase_2", "value": counts.get(READY, 0)},
        {"item": "needs_settlement", "value": counts.get("needs_settlement", 0)},
        {"item": "blocked_or_invalid", "value": len(rows) - counts.get(READY, 0) - counts.get("needs_settlement", 0)},
    ]
    bad_sources = [h for h in health_rows if h.get("source_health") != "healthy"]
    notes.append({"item": "source_issues", "value": len(bad_sources)})
    if source_mode != "SofaScore":
        notes.append({"item": "next_action", "value": "Review SofaScore Source Health; API-Football, Flashscore, TheSportsDB, and local data are fallback-only paths."})
    elif bad_sources:
        notes.append({"item": "next_action", "value": "Review Source Health sheet before Phase 2."})
    else:
        notes.append({"item": "next_action", "value": "Proceed with Phase 2 for ready_for_phase_2 rows."})
    return notes


def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def write_md(rows, health_rows, notes):
    lines = [
        "# Phase 1 Fixture Slate",
        "",
        f"Timezone: {LOCAL_TZ}",
        "",
        "## Run Notes",
        "",
        "| Item | Value |",
        "| --- | --- |",
    ]
    for note in notes:
        lines.append(f"| {note['item']} | {note['value']} |")
    lines.extend([
        "",
        "## Source Health",
        "",
        "| Source | Endpoint | Date | League | Health | Records | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ])
    for row in health_rows:
        lines.append(f"| {row.get('source','')} | {row.get('endpoint','')} | {row.get('date','')} | {row.get('league','')} | {row.get('source_health','')} | {row.get('records','')} | {html.escape(str(row.get('notes','')))[:180]} |")
    lines.extend([
        "",
        "## Fixtures",
        "",
        "| Date | Time | League | Home | Away | Event ID | Status | Phase 1 Status | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ])
    for row in rows:
        lines.append(f"| {row.get('date','')} | {row.get('time','')} | {row.get('league','')} | {row.get('home','')} | {row.get('away','')} | {row.get('event_id','')} | {row.get('status','')} | {row.get('phase1_status','')} | {html.escape(str(row.get('phase1_notes','')))[:180]} |")
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def col_letter(index):
    out = ""
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def sheet_xml(headers, rows):
    table = [headers]
    for row in rows:
        table.append([row.get(h, "") for h in headers])
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    parts.append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    parts.append("<sheetData>")
    for r_idx, values in enumerate(table, 1):
        parts.append(f'<row r="{r_idx}">')
        for c_idx, value in enumerate(values, 1):
            cell = f"{col_letter(c_idx)}{r_idx}"
            text = escape(str(value if value is not None else ""))
            parts.append(f'<c r="{cell}" t="inlineStr"><is><t>{text}</t></is></c>')
        parts.append("</row>")
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


def write_xlsx(sheets):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet_names = list(sheets.keys())
    with zipfile.ZipFile(XLSX_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
""" + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheet_names)+1)) + "\n</Types>")
        zf.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""")
        zf.writestr("xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
""" + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheet_names)+1)) + "\n</Relationships>")
        zf.writestr("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
""" + "".join(f'<sheet name="{escape(name[:31])}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(sheet_names, 1)) + "\n</sheets></workbook>")
        for i, (name, (headers, rows)) in enumerate(sheets.items(), 1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(headers, rows))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", help="Start date in YYYY-MM-DD. Defaults to today in Adelaide.")
    parser.add_argument(
        "--days",
        type=int,
        default=int(os.environ.get("SOCCER_FIXTURE_DAYS", "7")),
        help="Number of days to collect. Defaults to SOCCER_FIXTURE_DAYS or 7.",
    )
    args = parser.parse_args()

    env_target_dates = fixture_target_dates_from_env()
    if args.start:
        start_date = date.fromisoformat(args.start)
        days = args.days
    elif env_target_dates:
        start_date = date.fromisoformat(env_target_dates[0])
        end_date = date.fromisoformat(env_target_dates[-1])
        days = max(1, (end_date - start_date).days + 1)
    else:
        start_date = now_adelaide().date()
        days = args.days
    run_ts = now_adelaide().strftime("%Y-%m-%d %H:%M:%S %Z")
    key = api_key()

    rows, health_rows = rows_from_sofascore(start_date, days, run_ts)
    source_mode = "SofaScore"

    if not rows and key:
        api_rows, api_health = rows_from_api(start_date, days, run_ts, key)
        rows = api_rows
        health_rows.extend(api_health)
        source_mode = "API-Football fallback"

    if not rows:
        flash_rows, flash_health = rows_from_flashscore(start_date, days, run_ts)
        rows = flash_rows
        health_rows.extend(flash_health)
        source_mode = "Flashscore fallback"
        if not rows:
            tsdb_rows, tsdb_health = rows_from_thesportsdb(start_date, days, run_ts)
            rows = tsdb_rows
            health_rows.extend(tsdb_health)
            source_mode = "TheSportsDB fallback"
        if not rows:
            fallback_rows, fallback_health = rows_from_store(run_ts)
            rows = fallback_rows
            health_rows.extend(fallback_health)
            source_mode = "local fallback"

    if env_target_dates:
        rows = [row for row in rows if row.get("date") in env_target_dates]
    rows = finalize_rows(rows, start_date)
    ready = [r for r in rows if r["phase1_status"] == READY]
    needs_settlement = [r for r in rows if r["phase1_status"] == "needs_settlement"]
    blocked = [r for r in rows if r["phase1_status"] not in (READY, "needs_settlement")]
    summary = league_summary(rows)
    notes = run_notes(rows, health_rows, start_date, days, source_mode)
    if env_target_dates:
        notes.append({"item": "target_dates", "value": ",".join(env_target_dates)})

    write_csv(rows)
    write_md(rows, health_rows, notes)
    write_xlsx({
        "Fixtures": (HEADERS, rows),
        "Ready For Phase 2": (HEADERS, ready),
        "Needs Settlement": (HEADERS, needs_settlement),
        "Blocked Or Invalid": (HEADERS, blocked),
        "League Summary": (["league", "total", READY, "needs_settlement", "source_unverified", "missing_team_id", "missing_event_id", "wrong_league", "duplicate_event_id", "postponed_or_cancelled", "missing_datetime", "upcoming", "live", "FT"], summary),
        "Source Health": (["run_timestamp", "source", "endpoint", "date", "league", "source_health", "records", "notes"], health_rows),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 1 fixture slate written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"Markdown: {MD_PATH}")
    print(f"total={len(rows)} ready_for_phase_2={len(ready)} needs_settlement={len(needs_settlement)} blocked_or_invalid={len(blocked)} source={source_mode}")
    if not key and source_mode == "Flashscore":
        print("NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY; used keyless Flashscore feed.")
    elif source_mode == "TheSportsDB":
        print("NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY and Flashscore returned no fixtures; used TheSportsDB v1 fallback.")
    elif source_mode == "local fallback":
        print("NOTE: Missing API_FOOTBALL_KEY/APISPORTS_KEY and live fallbacks returned no fixtures; used local match_data.json fallback.")


if __name__ == "__main__":
    main()
