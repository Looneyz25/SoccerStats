#!/usr/bin/env python3
"""Phase 3 team context.

Reads the Phase 2 odds slate, resolves each ready fixture's home and away teams
to SofaScore team IDs, fetches last-N completed matches per team via a
smart-mimic SofaScore session, derives form summary, streak labels, and
optional head-to-head, then writes the Phase 3 review workbook.

Inputs:
    docs/agent-system/outputs/phase2_odds_slate_current.csv

Outputs:
    docs/agent-system/outputs/Phase3_Team_Context.xlsx
    docs/agent-system/outputs/phase3_team_context_current.csv
    docs/agent-system/outputs/phase3_team_context_current.md
"""
import argparse
import csv
import html
import json
import random
import re
import time
import urllib.parse
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
PHASE2_CSV = OUT_DIR / "phase2_odds_slate_current.csv"
XLSX_PATH = OUT_DIR / "Phase3_Team_Context.xlsx"
CSV_PATH = OUT_DIR / "phase3_team_context_current.csv"
MD_PATH = OUT_DIR / "phase3_team_context_current.md"

LOCAL_TZ = "Australia/Adelaide"
READY = "ready_for_phase_4"
PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]
SOFA_BASE = "https://api.sofascore.com"
SOFA_WEB = "https://www.sofascore.com"
WARMUP_PATHS = ("/", "/football", "/tournaments")
LEAGUE_COUNTRY_HINT = {
    "Premier League": "england",
    "Championship": "england",
    "League One": "england",
    "League Two": "england",
    "LaLiga": "spain",
    "Bundesliga": "germany",
    "Ligue 1": "france",
    "Eredivisie": "netherlands",
    "UEFA Champions League": "europe",
    "MLS": "united states",
}

FORM_N = 5
FORM_MAX = 10
MIN_FORM_FOR_READY = 3

HEADERS = [
    "run_timestamp",
    "league",
    "event_id",
    "date",
    "time",
    "home",
    "away",
    "home_sofa_id",
    "away_sofa_id",
    "home_form_n",
    "away_form_n",
    "home_w5", "home_d5", "home_l5",
    "away_w5", "away_d5", "away_l5",
    "home_gf5", "home_ga5", "home_gd5",
    "away_gf5", "away_ga5", "away_gd5",
    "home_btts5", "away_btts5",
    "home_over25_5", "away_over25_5",
    "home_cs5", "away_cs5",
    "home_failed_to_score5", "away_failed_to_score5",
    "home_streaks",
    "away_streaks",
    "h2h_count",
    "h2h_home_wins",
    "h2h_away_wins",
    "h2h_draws",
    "h2h_labels",
    "source_health",
    "phase3_status",
    "phase3_notes",
]

HEALTH_HEADERS = [
    "run_timestamp", "source", "endpoint", "calls", "ok", "errors",
    "source_health", "notes",
]


# ---------- smart-mimic session ----------

def _headers(referer):
    return {
        "Accept": "*/*",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": SOFA_WEB,
        "Referer": referer,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
    }


def _gentle_sleep(base=0.5, jitter=0.6):
    time.sleep(base + random.random() * jitter)


def open_session():
    if cffi_requests is None:
        return None, "curl_cffi not installed"
    profile = random.choice(PROFILES)
    sess = cffi_requests.Session(impersonate=profile)
    referer = SOFA_WEB + "/"
    for path in WARMUP_PATHS:
        try:
            url = SOFA_WEB + path
            sess.get(url, headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-AU,en;q=0.9",
                "Referer": referer,
            }, timeout=15)
            referer = url
            _gentle_sleep(0.4, 0.5)
        except Exception:
            pass
    return sess, ""


# ---------- sofascore API helpers ----------

class CallStats:
    def __init__(self):
        self.calls = Counter()
        self.ok = Counter()
        self.errors = Counter()
        self.last_error = {}


def get_json(session, path, stats, label):
    if session is None:
        stats.errors[label] += 1
        stats.last_error[label] = "no session"
        return None
    url = SOFA_BASE + path
    referer = SOFA_WEB + "/"
    last_err = ""
    for attempt in range(3):
        stats.calls[label] += 1
        try:
            resp = session.get(url, headers=_headers(referer), timeout=15)
            if resp.status_code == 200:
                stats.ok[label] += 1
                try:
                    return resp.json()
                except Exception as exc:
                    last_err = f"json: {exc}"
                    break
            if resp.status_code in (403, 429, 503):
                last_err = f"HTTP {resp.status_code}"
                _gentle_sleep(1.5 + attempt, 1.0)
                continue
            last_err = f"HTTP {resp.status_code}"
            break
        except Exception as exc:
            last_err = str(exc)
            _gentle_sleep(1.0 + attempt, 0.8)
    stats.errors[label] += 1
    stats.last_error[label] = last_err
    return None


def norm(value):
    return re.sub(r"[^a-z0-9]", "", (value or "").lower()).replace("fc", "")


def search_team(session, name, league, stats):
    if not name:
        return None
    q = urllib.parse.quote(name)
    data = get_json(session, f"/api/v1/search/teams/{q}", stats, "search")
    if not data:
        return None
    target_country = LEAGUE_COUNTRY_HINT.get(league, "")
    candidates = []
    for entry in data.get("teams") or []:
        team = entry.get("team") if isinstance(entry, dict) and "team" in entry else entry
        if not team:
            continue
        sport = (team.get("sport") or {}).get("slug") or (team.get("sport") or {}).get("name") or ""
        if sport and "football" not in str(sport).lower() and "soccer" not in str(sport).lower():
            continue
        if (team.get("gender") or "").upper() == "F":
            continue
        if (team.get("type") or 0) != 0:
            # SofaScore team type 0 = senior club; non-zero often youth/reserves/national
            continue
        candidates.append(team)
    if not candidates:
        return None
    nname = norm(name)
    def score(team):
        tname = norm(team.get("name") or "")
        short = norm(team.get("shortName") or "")
        country = ((team.get("country") or {}).get("name") or "").lower()
        s = 0.0
        if tname == nname:
            s = 1.0
        elif tname.startswith(nname) or nname.startswith(tname):
            s = 0.85
        elif nname in tname or tname in nname:
            shorter = min(len(nname), len(tname))
            longer = max(len(nname), len(tname))
            s = round(shorter / longer, 3)
        if short and (short == nname or nname == short):
            s = max(s, 0.85)
        if target_country and target_country in country:
            s += 0.15
        return s
    best = max(candidates, key=score)
    if score(best) < 0.5:
        return None
    return best


def fetch_team_form(session, team_id, stats, n=FORM_MAX):
    data = get_json(session, f"/api/v1/team/{team_id}/events/last/0", stats, "team_events")
    if not data:
        return []
    events = [e for e in (data.get("events") or [])
              if (e.get("status") or {}).get("type") == "finished"]
    return events[-n:][::-1]


def find_upcoming_event_id(session, home_id, away_id, stats):
    """Locate the SofaScore event ID for the upcoming match between these two
    teams by walking the home team's next events."""
    if not home_id or not away_id:
        return None
    data = get_json(session, f"/api/v1/team/{home_id}/events/next/0", stats, "team_events_next")
    if not data:
        return None
    for e in data.get("events") or []:
        h = (e.get("homeTeam") or {}).get("id")
        a = (e.get("awayTeam") or {}).get("id")
        if {h, a} == {home_id, away_id}:
            return e.get("id")
    return None


def fetch_event_h2h_labels(session, event_id, stats):
    """SofaScore exposes H2H summary labels via /event/{id}/team-streaks under the
    `head2head` key. Returns the raw label list; counts are derived from `X/N`
    label values."""
    if not event_id:
        return []
    data = get_json(session, f"/api/v1/event/{event_id}/team-streaks", stats, "h2h")
    if not data:
        return []
    return data.get("head2head") or []


def summarize_h2h_labels(labels):
    """Pull a meeting count out of `X/N` style label values; return the largest N
    seen (best estimate of recent H2H sample) and a pipe-joined label string."""
    max_n = 0
    pretty = []
    for label in labels:
        name = label.get("name", "")
        value = label.get("value", "")
        team = label.get("team", "")
        if "/" in str(value):
            try:
                _, n_str = value.split("/", 1)
                max_n = max(max_n, int(n_str))
            except ValueError:
                pass
        pretty.append(f"{team}: {name} {value}".strip())
    return max_n, " | ".join(pretty)


def derive_h2h_from_form(home_events, away_events, home_id, away_id):
    """Fallback recent-H2H from intersecting last-N form events."""
    if not home_id or not away_id:
        return []
    away_event_ids = {e.get("id") for e in away_events if e.get("id") is not None}
    matched = []
    for e in home_events:
        eid = e.get("id")
        if eid is None or eid not in away_event_ids:
            continue
        h_id = (e.get("homeTeam") or {}).get("id")
        a_id = (e.get("awayTeam") or {}).get("id")
        if {h_id, a_id} != {home_id, away_id}:
            continue
        matched.append(e)
    return matched


# ---------- form / streak computation ----------

def perspective_row(event, team_id):
    is_home = (event.get("homeTeam") or {}).get("id") == team_id
    hg = (event.get("homeScore") or {}).get("current")
    ag = (event.get("awayScore") or {}).get("current")
    if hg is None or ag is None:
        return None
    if is_home:
        scored, conceded = hg, ag
    else:
        scored, conceded = ag, hg
    result = "W" if scored > conceded else ("L" if conceded > scored else "D")
    return {
        "result": result,
        "scored": scored,
        "conceded": conceded,
        "btts": (hg > 0 and ag > 0),
        "total": hg + ag,
        "clean_sheet": conceded == 0,
        "failed_to_score": scored == 0,
    }


def form_summary(events, team_id, n=FORM_N):
    rows = [r for r in (perspective_row(e, team_id) for e in events) if r is not None]
    last = rows[:n]
    if not last:
        return {}
    w = sum(1 for r in last if r["result"] == "W")
    d = sum(1 for r in last if r["result"] == "D")
    l = sum(1 for r in last if r["result"] == "L")
    gf = sum(r["scored"] for r in last)
    ga = sum(r["conceded"] for r in last)
    return {
        "n": len(last),
        "w": w, "d": d, "l": l,
        "gf": gf, "ga": ga, "gd": gf - ga,
        "btts": sum(1 for r in last if r["btts"]),
        "over25": sum(1 for r in last if r["total"] >= 3),
        "cs": sum(1 for r in last if r["clean_sheet"]),
        "fts": sum(1 for r in last if r["failed_to_score"]),
    }


def consec(seq, predicate):
    n = 0
    for x in seq:
        if predicate(x):
            n += 1
        else:
            break
    return n


def streak_labels(events, team_id):
    rows = [r for r in (perspective_row(e, team_id) for e in events) if r is not None]
    if not rows:
        return []
    labels = []
    wins = consec(rows, lambda r: r["result"] == "W")
    losses = consec(rows, lambda r: r["result"] == "L")
    draws = consec(rows, lambda r: r["result"] == "D")
    no_wins = consec(rows, lambda r: r["result"] != "W")
    no_losses = consec(rows, lambda r: r["result"] != "L")
    cs = consec(rows, lambda r: r["clean_sheet"])
    no_cs = consec(rows, lambda r: not r["clean_sheet"])
    fts = consec(rows, lambda r: r["failed_to_score"])
    if wins >= 2: labels.append(f"Wins {wins}")
    if losses >= 2: labels.append(f"Losses {losses}")
    if draws >= 2: labels.append(f"Draws {draws}")
    if no_wins >= 3: labels.append(f"No wins {no_wins}")
    if no_losses >= 3: labels.append(f"No losses {no_losses}")
    if cs >= 2: labels.append(f"Clean sheet {cs}")
    if no_cs >= 3: labels.append(f"Without clean sheet {no_cs}")
    if fts >= 2: labels.append(f"No goals scored {fts}")
    m = len(rows[:FORM_MAX])
    over25 = sum(1 for r in rows[:m] if r["total"] >= 3)
    btts = sum(1 for r in rows[:m] if r["btts"])
    if m >= 5:
        if over25 >= max(3, m * 0.6):
            labels.append(f"More than 2.5 goals {over25}/{m}")
        if btts >= max(3, m * 0.6):
            labels.append(f"Both teams scoring {btts}/{m}")
    return labels


def h2h_summary(events, home_id, away_id):
    n = 0
    h_wins = 0
    a_wins = 0
    draws = 0
    for e in events:
        if (e.get("status") or {}).get("type") != "finished":
            continue
        hg = (e.get("homeScore") or {}).get("current")
        ag = (e.get("awayScore") or {}).get("current")
        if hg is None or ag is None:
            continue
        e_home = (e.get("homeTeam") or {}).get("id")
        e_away = (e.get("awayTeam") or {}).get("id")
        if {e_home, e_away} != {home_id, away_id}:
            continue
        n += 1
        if hg == ag:
            draws += 1
        elif (hg > ag and e_home == home_id) or (ag > hg and e_away == home_id):
            h_wins += 1
        else:
            a_wins += 1
    return n, h_wins, a_wins, draws


# ---------- phase 2 ingestion ----------

def read_phase2():
    if not PHASE2_CSV.exists():
        raise SystemExit(f"Phase 2 slate not found: {PHASE2_CSV}. Run scripts/soccer_phase2_odds.py first.")
    with PHASE2_CSV.open("r", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


# ---------- output writers ----------

def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def write_md(rows, health_rows, notes):
    lines = [
        "# Phase 3 Team Context",
        "",
        f"Timezone: {LOCAL_TZ}",
        "Source: SofaScore (smart-mimic session)",
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
        "| Endpoint | Calls | OK | Errors | Health | Notes |",
        "| --- | --- | --- | --- | --- | --- |",
    ])
    for h in health_rows:
        lines.append(
            f"| {h.get('endpoint','')} | {h.get('calls','')} | {h.get('ok','')} | "
            f"{h.get('errors','')} | {h.get('source_health','')} | "
            f"{html.escape(str(h.get('notes','')))[:160]} |"
        )
    lines.extend([
        "",
        "## Form Summary",
        "",
        "| Date | League | Home | Away | H last5 (W-D-L GF-GA) | A last5 (W-D-L GF-GA) | H Streaks | A Streaks | H2H | Status |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ])
    for row in rows:
        h_form = f"{row.get('home_w5','')}-{row.get('home_d5','')}-{row.get('home_l5','')} {row.get('home_gf5','')}-{row.get('home_ga5','')}"
        a_form = f"{row.get('away_w5','')}-{row.get('away_d5','')}-{row.get('away_l5','')} {row.get('away_gf5','')}-{row.get('away_ga5','')}"
        h2h = f"{row.get('h2h_count','')} (H{row.get('h2h_home_wins','')}/A{row.get('h2h_away_wins','')}/D{row.get('h2h_draws','')})"
        lines.append(
            f"| {row.get('date','')} | {row.get('league','')} | {row.get('home','')} | {row.get('away','')} | "
            f"{h_form} | {a_form} | {row.get('home_streaks','')[:60]} | {row.get('away_streaks','')[:60]} | "
            f"{h2h} | {row.get('phase3_status','')} |"
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


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-h2h", action="store_true", help="Skip head-to-head fetches.")
    args = parser.parse_args()

    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    p2_rows = read_phase2()
    session, sess_err = open_session()
    if sess_err:
        print(f"[sofascore] session warmup failed: {sess_err}")

    stats = CallStats()
    team_cache = {}     # (league, normalized_name) -> SofaScore team dict
    form_cache = {}     # team_id -> events

    rows = []
    for r in p2_rows:
        out = {h: "" for h in HEADERS}
        out["run_timestamp"] = run_ts
        out["league"] = r.get("league", "")
        out["event_id"] = r.get("event_id", "")
        out["date"] = r.get("date", "")
        out["time"] = r.get("time", "")
        out["home"] = r.get("home", "")
        out["away"] = r.get("away", "")

        if r.get("phase2_status") != "ready_for_phase_3":
            out["phase3_status"] = "upstream_blocked"
            out["phase3_notes"] = f"Phase 2 status was {r.get('phase2_status','unknown')}."
            rows.append(out)
            continue

        league = r.get("league", "")
        notes = []
        h_team = team_cache.get((league, norm(out["home"])))
        if h_team is None and (league, norm(out["home"])) not in team_cache:
            h_team = search_team(session, out["home"], league, stats)
            team_cache[(league, norm(out["home"]))] = h_team
            _gentle_sleep()
        a_team = team_cache.get((league, norm(out["away"])))
        if a_team is None and (league, norm(out["away"])) not in team_cache:
            a_team = search_team(session, out["away"], league, stats)
            team_cache[(league, norm(out["away"]))] = a_team
            _gentle_sleep()

        if h_team:
            out["home_sofa_id"] = h_team.get("id", "")
        if a_team:
            out["away_sofa_id"] = a_team.get("id", "")

        if not h_team or not a_team:
            out["source_health"] = "degraded"
            out["phase3_status"] = "team_unresolved"
            out["phase3_notes"] = (
                f"Could not resolve team IDs (home={'ok' if h_team else 'miss'}, away={'ok' if a_team else 'miss'})."
            )
            rows.append(out)
            continue

        h_events = form_cache.get(h_team["id"])
        if h_events is None:
            h_events = fetch_team_form(session, h_team["id"], stats)
            form_cache[h_team["id"]] = h_events
            _gentle_sleep()
        a_events = form_cache.get(a_team["id"])
        if a_events is None:
            a_events = fetch_team_form(session, a_team["id"], stats)
            form_cache[a_team["id"]] = a_events
            _gentle_sleep()

        h_form = form_summary(h_events, h_team["id"])
        a_form = form_summary(a_events, a_team["id"])
        out["home_form_n"] = h_form.get("n", 0)
        out["away_form_n"] = a_form.get("n", 0)
        for k_local, k_form in (("w5", "w"), ("d5", "d"), ("l5", "l"),
                                 ("gf5", "gf"), ("ga5", "ga"), ("gd5", "gd"),
                                 ("btts5", "btts"), ("over25_5", "over25"),
                                 ("cs5", "cs"), ("failed_to_score5", "fts")):
            out[f"home_{k_local}"] = h_form.get(k_form, "")
            out[f"away_{k_local}"] = a_form.get(k_form, "")
        out["home_streaks"] = " | ".join(streak_labels(h_events, h_team["id"]))
        out["away_streaks"] = " | ".join(streak_labels(a_events, a_team["id"]))

        if not args.no_h2h:
            event_id = find_upcoming_event_id(session, h_team["id"], a_team["id"], stats)
            _gentle_sleep()
            label_n = 0
            label_str = ""
            if event_id:
                labels = fetch_event_h2h_labels(session, event_id, stats)
                _gentle_sleep()
                label_n, label_str = summarize_h2h_labels(labels)
            recent = derive_h2h_from_form(h_events, a_events, h_team["id"], a_team["id"])
            n_recent, hw, aw, dr = h2h_summary(recent, h_team["id"], a_team["id"])
            out["h2h_count"] = label_n if label_n else n_recent
            out["h2h_home_wins"] = hw
            out["h2h_away_wins"] = aw
            out["h2h_draws"] = dr
            out["h2h_labels"] = label_str

        if (h_form.get("n", 0) >= MIN_FORM_FOR_READY and
                a_form.get("n", 0) >= MIN_FORM_FOR_READY):
            out["source_health"] = "healthy"
            out["phase3_status"] = READY
            out["phase3_notes"] = "Form and streaks attached."
        else:
            out["source_health"] = "degraded"
            out["phase3_status"] = "partial_form"
            out["phase3_notes"] = (
                f"Insufficient form matches (home={h_form.get('n',0)}, away={a_form.get('n',0)})."
            )
        rows.append(out)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("league", ""), r.get("home", "")))

    health_rows = []
    for label in ("search", "team_events", "team_events_next", "h2h"):
        calls = stats.calls.get(label, 0)
        ok = stats.ok.get(label, 0)
        errors = stats.errors.get(label, 0)
        if calls == 0:
            continue
        health = "healthy" if errors == 0 else ("degraded" if ok > 0 else "blocked")
        health_rows.append({
            "run_timestamp": run_ts,
            "source": "SofaScore",
            "endpoint": label,
            "calls": calls,
            "ok": ok,
            "errors": errors,
            "source_health": health,
            "notes": stats.last_error.get(label, ""),
        })

    counts = Counter(r["phase3_status"] for r in rows)
    notes = [
        {"item": "run_timestamp", "value": run_ts},
        {"item": "timezone", "value": LOCAL_TZ},
        {"item": "source", "value": "SofaScore (smart-mimic session)"},
        {"item": "phase2_input_rows", "value": len(p2_rows)},
        {"item": "phase2_ready_rows", "value": sum(1 for r in p2_rows if r.get("phase2_status") == "ready_for_phase_3")},
        {"item": "phase3_total_rows", "value": len(rows)},
        {"item": "ready_for_phase_4", "value": counts.get(READY, 0)},
        {"item": "team_unresolved", "value": counts.get("team_unresolved", 0)},
        {"item": "partial_form", "value": counts.get("partial_form", 0)},
        {"item": "source_blocked", "value": counts.get("source_blocked", 0)},
        {"item": "upstream_blocked", "value": counts.get("upstream_blocked", 0)},
    ]
    bad = [h for h in health_rows if h["source_health"] != "healthy"]
    if not p2_rows:
        notes.append({"item": "next_action", "value": "No Phase 2 input; rerun Phase 2 first."})
    elif counts.get(READY, 0) == 0 and bad:
        notes.append({"item": "next_action", "value": "SofaScore endpoints failed. Check session warmup, IP, or rerun later."})
    elif bad:
        notes.append({"item": "next_action", "value": "Review Source Health for degraded endpoints, then proceed with Phase 4."})
    else:
        notes.append({"item": "next_action", "value": "Proceed with Phase 4 for ready_for_phase_4 rows."})

    ready = [r for r in rows if r["phase3_status"] == READY]
    unresolved = [r for r in rows if r["phase3_status"] in ("team_unresolved", "partial_form")]

    write_csv(rows)
    write_md(rows, health_rows, notes)
    write_xlsx({
        "Form": (HEADERS, rows),
        "Streaks": (
            ["league", "date", "home", "away", "home_streaks", "away_streaks", "phase3_status"],
            rows,
        ),
        "H2H": (
            ["league", "date", "home", "away", "h2h_count", "h2h_home_wins", "h2h_away_wins", "h2h_draws"],
            rows,
        ),
        "Ready For Phase 4": (HEADERS, ready),
        "Unresolved": (HEADERS, unresolved),
        "Source Health": (HEALTH_HEADERS, health_rows),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 3 team context written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"Markdown: {MD_PATH}")
    print(
        f"total={len(rows)} ready_for_phase_4={counts.get(READY, 0)} "
        f"unresolved={counts.get('team_unresolved', 0) + counts.get('partial_form', 0)} "
        f"upstream_blocked={counts.get('upstream_blocked', 0)}"
    )


if __name__ == "__main__":
    main()
