#!/usr/bin/env python3
"""Phase 2 odds collection.

Reads the Phase 1 fixture slate, fetches Win-Draw-Win (90-min regular) odds
from Sportsbet AU per listed league, matches each fixture to a Sportsbet
event by normalized team name, and writes the Phase 2 review workbook.

Inputs:
    docs/agent-system/outputs/phase1_fixture_slate_current.csv

Outputs:
    docs/agent-system/outputs/Phase2_Odds_Slate.xlsx
    docs/agent-system/outputs/phase2_odds_slate_current.csv
    docs/agent-system/outputs/phase2_odds_slate_current.md
"""
import argparse
import csv
import html
import json
import random
import re
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
PHASE1_CSV = OUT_DIR / "phase1_fixture_slate_current.csv"
XLSX_PATH = OUT_DIR / "Phase2_Odds_Slate.xlsx"
CSV_PATH = OUT_DIR / "phase2_odds_slate_current.csv"
MD_PATH = OUT_DIR / "phase2_odds_slate_current.md"

LOCAL_TZ = "Australia/Adelaide"
READY = "ready_for_phase_3"

LEAGUE_PAGES = {
    "Premier League":         "united-kingdom/english-premier-league",
    "Championship":           "united-kingdom/english-championship",
    "League One":             "united-kingdom/english-league-one",
    "League Two":             "united-kingdom/english-league-two",
    "LaLiga":                 "spain/spanish-la-liga",
    "Bundesliga":             "germany/german-bundesliga",
    "Ligue 1":                "france/french-ligue-1",
    "Eredivisie":             "rest-of-europe/dutch-eredivisie",
    "UEFA Champions League":  "uefa-competitions/uefa-champions-league",
    "MLS":                    "north-america/usa-major-league-soccer",
}

# Bridges Flashscore short names to Sportsbet canonical names. Kept aligned with
# scripts/soccer_fetch_sportsbet.py and extended for Flashscore-specific shortenings.
ABBREV = {
    # English
    "wolves": "wolverhampton",
    "manutd": "manchesterunited", "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "forest": "nottinghamforest",
    "nottingham": "nottinghamforest",
    "boro": "middlesbrough",
    "leeds": "leedsunited",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "westbrom": "westbromwich",
    # Spanish
    "atletico": "atleticomadrid", "atlmadrid": "atleticomadrid",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "athletic": "athleticbilbao",
    "oviedo": "realoviedo",
    "alaves": "deportivoalaves",
    "celta": "celtavigo",
    # German
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach", "mgladbach": "borussiamonchengladbach",
    "bmonchengladbach": "borussiamonchengladbach",
    "stuttgart": "vfbstuttgart",
    "bremen": "werderbremen",
    "leverkusen": "bayerleverkusen",
    "hoffenheim": "tsghoffenheim",
    "pauli": "stpauli",
    "hertha": "herthabsc",
    "freiburg": "scfreiburg",
    "wolfsburg": "vflwolfsburg",
    # French
    "marseille": "olympiquemarseille",
    "psg": "parissaintgermain",
    "rennes": "staderennais",
    "lyon": "olympiquelyonnais",
    "brest": "stadebrestois",
    "nice": "ogcnice",
    "lille": "loscleille",
    "monaco": "asmonaco",
    "lens": "rclens",
    # Dutch
    "ajax": "afcajax",
    "psv": "psveindhoven",
    "twente": "fctwente",
    "feyenoord": "feyenoord",
    "groningen": "fcgroningen",
    "volendam": "fcvolendam",
    "heerenveen": "scheerenveen",
    "nec": "necnijmegen",
    # MLS
    "nyc": "newyorkcityfc", "newyorkcity": "newyorkcityfc",
    "rsl": "realsaltlake",
    "lafc": "losangelesfc",
    "atlutd": "atlantaunited",
    "phillyunion": "philadelphiaunion",
    "minnesota": "minnesotaunited",
    "intermiami": "intermiamicf",
    "montreal": "cfmontreal",
    "vancouver": "vancouverwhitecaps",
    "lagalaxy": "lagalaxy",
}

WDW_MARKET_NAMES = {"Win-Draw-Win", "Match Result", "1X2"}
PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]
OVERROUND_MIN = 1.00
OVERROUND_MAX = 1.25
MATCH_CONFIDENCE_MIN = 0.6
SPORTSBET_BASE = "https://www.sportsbet.com.au"
SOCCER_HUB = "/betting/soccer"
WARMUP_PATHS = ("/", "/betting", SOCCER_HUB)
LOCATION_ERROR_MARKERS = ("/location-error", "Access Denied", "Pardon Our Interruption")

HEADERS = [
    "run_timestamp",
    "league_id",
    "league",
    "event_id",
    "date",
    "time",
    "timezone",
    "home",
    "away",
    "phase1_status",
    "odds_source",
    "sportsbet_event_id",
    "sportsbet_home_name",
    "sportsbet_away_name",
    "home_odds",
    "draw_odds",
    "away_odds",
    "implied_home",
    "implied_draw",
    "implied_away",
    "overround",
    "fair_home",
    "fair_draw",
    "fair_away",
    "match_method",
    "match_score",
    "source_health",
    "phase2_status",
    "phase2_notes",
]

HEALTH_HEADERS = [
    "run_timestamp",
    "source",
    "league",
    "endpoint",
    "http_status",
    "events_on_page",
    "wdw_markets",
    "source_health",
    "notes",
]


# ---------- name normalization ----------

def norm(value):
    text = re.sub(r"[^a-z0-9]", "", (value or "").lower())
    return text.replace("utd", "united").replace("fc", "")


def names_match(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0, "none"
    if na == nb:
        return 1.0, "exact"
    if na in nb or nb in na:
        shorter = min(len(na), len(nb))
        longer = max(len(na), len(nb))
        return round(shorter / longer, 3), "substring"
    for tok, exp in ABBREV.items():
        if (tok in na and exp in nb) or (tok in nb and exp in na):
            return 0.8, "alias"
    return 0.0, "none"


def pair_match_score(home_a, away_a, home_b, away_b):
    s_home, m_home = names_match(home_a, home_b)
    s_away, m_away = names_match(away_a, away_b)
    if s_home == 0 or s_away == 0:
        return 0.0, "none"
    method = "exact" if (m_home == "exact" and m_away == "exact") else (
        "alias" if "alias" in (m_home, m_away) else "substring"
    )
    return round((s_home + s_away) / 2.0, 3), method


# ---------- sportsbet fetch ----------

def _au_headers(referer):
    """Headers that mimic an AU desktop browser. curl_cffi adds the TLS/UA part
    via impersonate; we add language/locale/referer signals that the CDN checks."""
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": referer,
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }


def _gentle_sleep(base=1.2, jitter=1.4):
    time.sleep(base + random.random() * jitter)


def open_session():
    """Return a curl_cffi Session warmed by hitting public Sportsbet pages so the
    CDN sees an organic visit pattern (homepage → betting hub → soccer hub) before
    we request any league page. Profile is fixed per session to look like one user."""
    if cffi_requests is None:
        return None, "curl_cffi not installed"
    profile = random.choice(PROFILES)
    sess = cffi_requests.Session(impersonate=profile)
    referer = SPORTSBET_BASE + "/"
    for path in WARMUP_PATHS:
        try:
            url = SPORTSBET_BASE + path
            sess.get(url, headers=_au_headers(referer), timeout=20)
            referer = url
            _gentle_sleep(0.6, 0.6)
        except Exception:
            pass
    return sess, ""


def _looks_like_block(body, url):
    if not body:
        return True
    head = body[:4000]
    if any(marker in head for marker in LOCATION_ERROR_MARKERS):
        return True
    if "/location-error" in url:
        return True
    return False


def fetch_page(slug, session=None):
    if cffi_requests is None:
        return None, 0, "curl_cffi not installed"
    sess = session or cffi_requests
    url = SPORTSBET_BASE + SOCCER_HUB + "/" + slug
    referer = SPORTSBET_BASE + SOCCER_HUB + "/"
    headers = _au_headers(referer)
    last_err = ""
    last_status = 0
    for attempt in range(2):
        try:
            kwargs = {"headers": headers, "timeout": 25, "allow_redirects": True}
            if session is None:
                kwargs["impersonate"] = random.choice(PROFILES)
            resp = sess.get(url, **kwargs)
            last_status = resp.status_code
            final_url = getattr(resp, "url", url) or url
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code}"
            elif _looks_like_block(resp.text, str(final_url)):
                last_err = "geo/location block (location-error or interstitial)"
            else:
                body = resp.text
                start = body.find("window.__PRELOADED_STATE__ = ")
                if start == -1:
                    last_err = "preloaded state not found"
                else:
                    start += len("window.__PRELOADED_STATE__ = ")
                    end = body.find("window.__APOLLO_STATE__", start)
                    chunk = body[start:end].rstrip().rstrip(";").rstrip()
                    return json.loads(chunk), resp.status_code, ""
        except Exception as exc:
            last_err = str(exc)
        _gentle_sleep(1.5, 1.5)
    return None, last_status, last_err


def to_decimal(num, den):
    return round(float(num) / float(den) + 1.0, 2)


def extract_events(data):
    """Return list of {event_id, home, away, home_odds, draw_odds, away_odds, ts}."""
    out = []
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {}) or {}
    markets = sb.get("markets", {}) or {}
    outcomes = sb.get("outcomes", {}) or {}
    wdw_markets_seen = 0
    for ev in events.values():
        home = ev.get("participant1")
        away = ev.get("participant2")
        if not home or not away:
            continue
        ts_ms = (ev.get("startTime") or {}).get("milliseconds", 0)
        wdw = None
        for mid in ev.get("marketIds", []):
            mk = markets.get(str(mid)) or markets.get(mid)
            if not mk:
                continue
            if mk.get("name") in WDW_MARKET_NAMES:
                wdw = mk
                break
        if not wdw:
            continue
        wdw_markets_seen += 1
        prices = {}
        for oid in wdw.get("outcomeIds", []):
            oc = outcomes.get(str(oid)) or outcomes.get(oid)
            if not oc:
                continue
            wp = oc.get("winPrice") or {}
            try:
                price = to_decimal(wp["num"], wp["den"])
            except Exception:
                continue
            rt = oc.get("resultType") or ""
            if rt == "H":
                prices["home"] = price
            elif rt == "D":
                prices["draw"] = price
            elif rt == "A":
                prices["away"] = price
        out.append({
            "event_id": ev.get("id"),
            "home": home,
            "away": away,
            "ts": ts_ms // 1000 if ts_ms else 0,
            "home_odds": prices.get("home"),
            "draw_odds": prices.get("draw"),
            "away_odds": prices.get("away"),
        })
    return out, wdw_markets_seen


# ---------- phase 1 ingestion ----------

def read_phase1():
    if not PHASE1_CSV.exists():
        raise SystemExit(f"Phase 1 slate not found: {PHASE1_CSV}. Run scripts/soccer_phase1_fixtures.py first.")
    with PHASE1_CSV.open("r", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


# ---------- matching + scoring ----------

def best_match(fixture, candidates):
    best = None
    best_score = 0.0
    best_method = "none"
    for cand in candidates:
        score, method = pair_match_score(
            fixture["home"], fixture["away"],
            cand["home"], cand["away"],
        )
        if score > best_score:
            best = cand
            best_score = score
            best_method = method
    return best, best_score, best_method


def implied_and_fair(home, draw, away):
    if None in (home, draw, away):
        return {}, None
    try:
        ih = round(1.0 / float(home), 4)
        idr = round(1.0 / float(draw), 4)
        ia = round(1.0 / float(away), 4)
    except (TypeError, ValueError, ZeroDivisionError):
        return {}, None
    overround = round(ih + idr + ia, 4)
    if overround <= 0:
        return {}, None
    return {
        "implied_home": ih, "implied_draw": idr, "implied_away": ia,
        "fair_home": round(ih / overround, 4),
        "fair_draw": round(idr / overround, 4),
        "fair_away": round(ia / overround, 4),
    }, overround


def assign_phase2_status(row):
    if row.get("phase1_status") != "ready_for_phase_2":
        return "upstream_blocked", f"Phase 1 status was {row.get('phase1_status','unknown')}."
    if row.get("source_health") == "blocked":
        return "source_blocked", row.get("phase2_notes") or "Sportsbet page failed."
    home = row.get("home_odds")
    draw = row.get("draw_odds")
    away = row.get("away_odds")
    if not row.get("sportsbet_event_id"):
        return "unmatched_market", "No Sportsbet event matched this fixture."
    if None in (home, draw, away) or "" in (home, draw, away):
        return "partial_market", "One or more WDW prices missing."
    overround = row.get("overround")
    try:
        ovr = float(overround)
        if ovr < OVERROUND_MIN or ovr > OVERROUND_MAX:
            return "implausible_overround", f"Overround {ovr} outside {OVERROUND_MIN}..{OVERROUND_MAX}."
    except (TypeError, ValueError):
        return "partial_market", "Overround missing or invalid."
    try:
        score = float(row.get("match_score") or 0)
    except ValueError:
        score = 0.0
    if score < MATCH_CONFIDENCE_MIN:
        return "low_match_confidence", f"Match score {score} below {MATCH_CONFIDENCE_MIN}."
    return READY, "Clean Phase 2 odds."


# ---------- output writers ----------

def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def write_md(rows, health_rows, notes):
    lines = [
        "# Phase 2 Odds Slate",
        "",
        f"Timezone: {LOCAL_TZ}",
        f"Source: Sportsbet AU (Win-Draw-Win, 90-min regular time)",
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
        "| League | Endpoint | HTTP | Events | WDW Markets | Health | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ])
    for row in health_rows:
        lines.append(
            f"| {row.get('league','')} | {row.get('endpoint','')} | {row.get('http_status','')} | "
            f"{row.get('events_on_page','')} | {row.get('wdw_markets','')} | "
            f"{row.get('source_health','')} | {html.escape(str(row.get('notes','')))[:180]} |"
        )
    lines.extend([
        "",
        "## Odds",
        "",
        "| Date | Time | League | Home | Away | H | D | A | Overround | Match | Phase 2 Status |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ])
    for row in rows:
        lines.append(
            f"| {row.get('date','')} | {row.get('time','')} | {row.get('league','')} | "
            f"{row.get('home','')} | {row.get('away','')} | "
            f"{row.get('home_odds','')} | {row.get('draw_odds','')} | {row.get('away_odds','')} | "
            f"{row.get('overround','')} | {row.get('match_method','')}:{row.get('match_score','')} | "
            f"{row.get('phase2_status','')} |"
        )
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
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
             "<sheetData>"]
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
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
            '<Default Extension="xml" ContentType="application/xml"/>\n'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheet_names) + 1))
            + "\n</Types>")
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n'
            '</Relationships>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheet_names) + 1))
            + "\n</Relationships>")
        zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>\n'
            + "".join(f'<sheet name="{escape(name[:31])}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(sheet_names, 1))
            + "\n</sheets></workbook>")
        for i, (name, (headers, rows)) in enumerate(sheets.items(), 1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(headers, rows))


def league_summary(rows):
    grouped = defaultdict(Counter)
    for row in rows:
        league = row.get("league", "")
        grouped[league]["total"] += 1
        grouped[league][row.get("phase2_status", "")] += 1
    out = []
    statuses = ["total", READY, "unmatched_market", "partial_market", "implausible_overround",
                "low_match_confidence", "source_blocked", "upstream_blocked"]
    for league in sorted(grouped):
        row = {"league": league}
        for key in statuses:
            row[key] = grouped[league].get(key, 0)
        out.append(row)
    return out


# ---------- main pipeline ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--leagues", help="Comma-separated league names to limit fetch (default: all leagues with ready_for_phase_2 rows).")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to sleep between league fetches.")
    args = parser.parse_args()

    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    phase1_rows = read_phase1()

    requested_leagues = {x.strip() for x in args.leagues.split(",")} if args.leagues else None
    leagues_needed = sorted({
        r["league"] for r in phase1_rows
        if r.get("phase1_status") == "ready_for_phase_2"
        and r.get("league") in LEAGUE_PAGES
        and (requested_leagues is None or r["league"] in requested_leagues)
    })

    cache = {}
    health_rows = []
    session, session_err = open_session()
    if session_err:
        print(f"[sportsbet] session warmup failed: {session_err}")
    for league in leagues_needed:
        slug = LEAGUE_PAGES[league]
        endpoint = f"/betting/soccer/{slug}"
        print(f"[sportsbet] fetching {league} ({slug})")
        data, http_status, error = fetch_page(slug, session=session)
        events = []
        wdw_count = 0
        if data is None:
            health = "blocked"
            note = error or "unknown"
        else:
            try:
                events, wdw_count = extract_events(data)
                health = "healthy" if events else "degraded"
                note = "" if events else "no events parsed from page"
            except Exception as exc:
                health = "degraded"
                note = f"parse error: {exc}"
        cache[league] = events
        health_rows.append({
            "run_timestamp": run_ts,
            "source": "Sportsbet",
            "league": league,
            "endpoint": endpoint,
            "http_status": http_status,
            "events_on_page": len(events),
            "wdw_markets": wdw_count,
            "source_health": health,
            "notes": note,
        })
        _gentle_sleep(max(args.sleep, 0.6), 1.0)

    rows = []
    for r in phase1_rows:
        league = r.get("league", "")
        out = {
            "run_timestamp": run_ts,
            "league_id": r.get("league_id", ""),
            "league": league,
            "event_id": r.get("event_id", ""),
            "date": r.get("date", ""),
            "time": r.get("time", ""),
            "timezone": r.get("timezone", LOCAL_TZ),
            "home": r.get("home", ""),
            "away": r.get("away", ""),
            "phase1_status": r.get("phase1_status", ""),
            "odds_source": "",
            "sportsbet_event_id": "",
            "sportsbet_home_name": "",
            "sportsbet_away_name": "",
            "home_odds": "",
            "draw_odds": "",
            "away_odds": "",
            "implied_home": "",
            "implied_draw": "",
            "implied_away": "",
            "overround": "",
            "fair_home": "",
            "fair_draw": "",
            "fair_away": "",
            "match_method": "none",
            "match_score": 0.0,
            "source_health": "",
            "phase2_status": "",
            "phase2_notes": "",
        }
        if r.get("phase1_status") != "ready_for_phase_2":
            status, note = assign_phase2_status(out)
            out["phase2_status"] = status
            out["phase2_notes"] = note
            rows.append(out)
            continue
        candidates = cache.get(league)
        league_health = next((h for h in health_rows if h["league"] == league), None)
        if league_health:
            out["source_health"] = league_health["source_health"]
        if candidates is None:
            out["phase2_notes"] = "Sportsbet not fetched for this league."
            status, note = assign_phase2_status(out)
            out["phase2_status"] = status
            out["phase2_notes"] = (out["phase2_notes"] + " " + note).strip()
            rows.append(out)
            continue
        match, score, method = best_match({"home": out["home"], "away": out["away"]}, candidates)
        out["match_score"] = score
        out["match_method"] = method
        if match:
            out["odds_source"] = "Sportsbet"
            out["sportsbet_event_id"] = match.get("event_id", "")
            out["sportsbet_home_name"] = match.get("home", "")
            out["sportsbet_away_name"] = match.get("away", "")
            out["home_odds"] = match.get("home_odds")
            out["draw_odds"] = match.get("draw_odds")
            out["away_odds"] = match.get("away_odds")
            implied, overround = implied_and_fair(match.get("home_odds"), match.get("draw_odds"), match.get("away_odds"))
            out.update(implied)
            if overround is not None:
                out["overround"] = overround
        status, note = assign_phase2_status(out)
        out["phase2_status"] = status
        out["phase2_notes"] = note
        rows.append(out)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("league", ""), r.get("home", "")))

    counts = Counter(r["phase2_status"] for r in rows)
    notes = [
        {"item": "run_timestamp", "value": run_ts},
        {"item": "timezone", "value": LOCAL_TZ},
        {"item": "source", "value": "Sportsbet AU"},
        {"item": "phase1_input_rows", "value": len(phase1_rows)},
        {"item": "phase1_ready_rows", "value": sum(1 for r in phase1_rows if r.get("phase1_status") == "ready_for_phase_2")},
        {"item": "phase2_total_rows", "value": len(rows)},
        {"item": "ready_for_phase_3", "value": counts.get(READY, 0)},
        {"item": "unmatched_market", "value": counts.get("unmatched_market", 0)},
        {"item": "partial_market", "value": counts.get("partial_market", 0)},
        {"item": "implausible_overround", "value": counts.get("implausible_overround", 0)},
        {"item": "low_match_confidence", "value": counts.get("low_match_confidence", 0)},
        {"item": "source_blocked", "value": counts.get("source_blocked", 0)},
        {"item": "upstream_blocked", "value": counts.get("upstream_blocked", 0)},
    ]
    bad_sources = [h for h in health_rows if h["source_health"] != "healthy"]
    if not leagues_needed:
        notes.append({"item": "next_action", "value": "No ready_for_phase_2 fixtures in Phase 1; rerun Phase 1 first."})
    elif counts.get(READY, 0) == 0 and bad_sources:
        notes.append({"item": "next_action", "value": "Sportsbet pages were blocked or empty. Check curl_cffi profile and IP, then rerun."})
    elif bad_sources:
        notes.append({"item": "next_action", "value": "Review Source Health for degraded leagues, then proceed with Phase 3 for ready rows."})
    else:
        notes.append({"item": "next_action", "value": "Proceed with Phase 3 for ready_for_phase_3 rows."})

    ready_rows = [r for r in rows if r["phase2_status"] == READY]
    unmatched = [r for r in rows if r["phase2_status"] in ("unmatched_market", "partial_market", "low_match_confidence")]
    blocked = [r for r in rows if r["phase2_status"] in ("source_blocked", "upstream_blocked", "implausible_overround")]
    summary = league_summary(rows)

    write_csv(rows)
    write_md(rows, health_rows, notes)
    write_xlsx({
        "Odds": (HEADERS, rows),
        "Ready For Phase 3": (HEADERS, ready_rows),
        "Unmatched": (HEADERS, unmatched),
        "Blocked": (HEADERS, blocked),
        "League Summary": (
            ["league", "total", READY, "unmatched_market", "partial_market",
             "implausible_overround", "low_match_confidence", "source_blocked", "upstream_blocked"],
            summary,
        ),
        "Source Health": (HEALTH_HEADERS, health_rows),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 2 odds slate written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"Markdown: {MD_PATH}")
    print(
        f"total={len(rows)} ready_for_phase_3={counts.get(READY, 0)} "
        f"unmatched={counts.get('unmatched_market', 0) + counts.get('partial_market', 0) + counts.get('low_match_confidence', 0)} "
        f"blocked={counts.get('source_blocked', 0) + counts.get('upstream_blocked', 0) + counts.get('implausible_overround', 0)}"
    )


if __name__ == "__main__":
    main()
