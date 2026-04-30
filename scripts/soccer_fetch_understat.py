#!/usr/bin/env python3
"""Understat xG enrichment — adds expected-goals data to finished matches.

Understat publishes xG (expected goals) and xGA for top-5 European leagues.
Data is embedded as JSON inside the HTML page (`var datesData = JSON.parse(...);`)
so we scrape the page, decode the inline JSON, and match by team name + date.

Adds an `xg` block to each FT match where xG data is found:
    "xg": {"home": 1.85, "away": 0.92, "source": "understat"}

Why xG matters: it's a much better predictor than raw goals for future
performance. A team that creates 2.5 xG but only scores 1 will tend to
revert upward. Useful for retro-prediction calibration.

Coverage: EPL, LaLiga, Serie A, Bundesliga, Ligue 1, RFPL (Russian).
"""
import json
import re
import time
import pathlib
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"

# Map our canonical names to Understat's URL slugs
LEAGUE_SLUGS = {
    "Premier League": "EPL",
    "LaLiga":         "La_liga",
    "Serie A":        "Serie_A",
    "Bundesliga":     "Bundesliga",
    "Ligue 1":        "Ligue_1",
}

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

# JS-string-escape decoder for the embedded JSON Understat ships
_HEX_ESC = re.compile(r"\\x([0-9a-fA-F]{2})")


def js_unescape(s):
    """Understat embeds the JSON as a JS string with \\xNN escapes inside JSON.parse('...')."""
    return _HEX_ESC.sub(lambda m: chr(int(m.group(1), 16)), s)


def fetch_league_page(slug, season=None):
    """Pull the league page HTML for a season (defaults to current ie 2025)."""
    if season is None:
        season = "2025"  # 2025/26 is "2025" in Understat
    url = f"https://understat.com/league/{slug}/{season}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ERR {slug}: {e}")
        return None


def extract_dates_data(html):
    """Pull `datesData` JSON out of the HTML script block."""
    m = re.search(r"var\s+datesData\s*=\s*JSON\.parse\(['\"](.+?)['\"]\)", html, re.DOTALL)
    if not m:
        return []
    raw = m.group(1)
    try:
        return json.loads(js_unescape(raw))
    except Exception as e:
        print(f"  parse error: {e}")
        return []


def norm_team(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]", "", s)
    s = s.replace("fc", "").replace("utd", "united")
    return s


ABBREV = {
    "manutd": "manchesterunited", "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "atletico": "atleticomadrid",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach",
    "stuttgart": "vfbstuttgart",
    "bremen": "werderbremen",
    "leverkusen": "bayerleverkusen",
    "psg": "parissaintgermain",
    "marseille": "olympiquemarseille",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "athletic": "athleticbilbao",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "leeds": "leedsunited",
    "wolves": "wolverhampton",
    "forest": "nottinghamforest",
}


def names_match(a, b):
    a, b = norm_team(a), norm_team(b)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    for tok, exp in ABBREV.items():
        if tok in a and exp in b:
            return True
        if tok in b and exp in a:
            return True
    return False


def main():
    store = json.loads(STORE.read_text(encoding="utf-8"))

    # Pull each league once
    by_league = {}
    for canon, slug in LEAGUE_SLUGS.items():
        print(f"  fetching Understat: {canon} ({slug})")
        html = fetch_league_page(slug)
        if not html:
            by_league[canon] = []
            continue
        events = extract_dates_data(html)
        # filter to finished matches (Understat marks them with isResult=true)
        finished = [e for e in events if e.get("isResult")]
        by_league[canon] = finished
        print(f"    found {len(events)} events, {len(finished)} finished")
        time.sleep(0.4)

    # Walk store and attach xG where we can
    enriched = 0
    for L in store["leagues"]:
        if L["name"] not in by_league:
            continue
        events = by_league[L["name"]]
        if not events:
            continue
        for m in L["matches"]:
            if m.get("status") != "FT":
                continue
            if m.get("xg"):
                continue  # already enriched
            home = m.get("home", {}).get("name", "")
            away = m.get("away", {}).get("name", "")
            mdate = m.get("date", "")
            for e in events:
                eh = (e.get("h") or {}).get("title", "")
                ea = (e.get("a") or {}).get("title", "")
                # Understat dates are like "2026-04-26 14:30:00"
                edate = (e.get("datetime") or "")[:10]
                if not names_match(home, eh) or not names_match(away, ea):
                    continue
                # Don't be too strict on date — Understat uses match-day in UTC.
                # If our store has the match dated within ±1 day, accept.
                if mdate and edate:
                    try:
                        d_store = datetime.strptime(mdate, "%Y-%m-%d").date()
                        d_us    = datetime.strptime(edate, "%Y-%m-%d").date()
                        if abs((d_store - d_us).days) > 1:
                            continue
                    except ValueError:
                        pass
                xg_h = (e.get("xG") or {}).get("h")
                xg_a = (e.get("xG") or {}).get("a")
                try:
                    xg_h = round(float(xg_h), 2) if xg_h is not None else None
                    xg_a = round(float(xg_a), 2) if xg_a is not None else None
                except (TypeError, ValueError):
                    continue
                if xg_h is None or xg_a is None:
                    continue
                m["xg"] = {"home": xg_h, "away": xg_a, "source": "understat",
                           "match_id": e.get("id")}
                enriched += 1
                print(f"  + {L['name']:18s}  {home} {xg_h} xG vs {xg_a} xG {away}")
                break

    STORE.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDONE. enriched={enriched}")


if __name__ == "__main__":
    main()
