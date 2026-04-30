#!/usr/bin/env python3
"""TheSportsDB fallback — settle finished matches when SofaScore is blocking.

TheSportsDB is a free public API with no Cloudflare bot protection — it works
from any IP including cloud datacenters. Coverage is narrower than SofaScore
(focuses on top-tier global leagues) and the data is often a bit delayed,
but it's a reliable fallback when SofaScore returns 403.

Adds `thesportsdb_score` block to any match in our store that:
  1. has status != FT
  2. has a date in the recent past (yesterday or today Adelaide-local)
  3. matches by team names in TheSportsDB's daily events feed

Note: this script does NOT settle matches by itself (it doesn't compute hit/miss
or update predictions). It just records the score on the match record so a
follow-up run of soccer_routine.py's Phase A can use it as a hint when
SofaScore is unavailable.
"""
import json
import re
import time
import pathlib
import urllib.request
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"

API_BASE = "https://www.thesportsdb.com/api/v1/json/3"

# Map our canonical league names to TheSportsDB's strLeague filter values.
# (We accept anything that contains these substrings — TheSportsDB uses
# slightly different naming per locale.)
LEAGUE_HINTS = {
    "Premier League":         ["english premier league", "premier league"],
    "Championship":           ["english football league championship", "championship"],
    "League One":             ["english football league one", "league one"],
    "League Two":             ["english football league two", "league two"],
    "LaLiga":                 ["spanish la liga", "la liga"],
    "Bundesliga":             ["german bundesliga", "bundesliga"],
    "Ligue 1":                ["french ligue 1", "ligue 1"],
    "Eredivisie":             ["dutch eredivisie", "eredivisie"],
    "UEFA Champions League":  ["uefa champions league", "champions league"],
    "MLS":                    ["american major league soccer", "major league soccer", "mls"],
}


def norm_team(s):
    """Aggressive normalize for team-name matching across data sources."""
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]", "", s)
    s = s.replace("fc", "").replace("utd", "united")
    return s


ABBREV = {
    "manutd": "manchesterunited",
    "manunited": "manchesterunited",
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


def fetch_day(yyyy_mm_dd):
    url = f"{API_BASE}/eventsday.php?d={yyyy_mm_dd}&s=Soccer"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read())
        return data.get("events") or []
    except Exception as e:
        print(f"  ERR fetching {yyyy_mm_dd}: {e}")
        return []


def league_matches(canon_name, league_str):
    if not league_str:
        return False
    ls = league_str.lower()
    return any(h in ls for h in LEAGUE_HINTS.get(canon_name, []))


def main():
    store = json.loads(STORE.read_text(encoding="utf-8"))
    today = datetime.now(ADL).date()
    yesterday = today - timedelta(days=1)

    # Pull finished events for the past 2 days
    daily = {}
    for d in (yesterday.isoformat(), today.isoformat()):
        events = fetch_day(d)
        finished = [e for e in events if (e.get("strStatus") or "").lower() == "match finished"]
        daily[d] = finished
        print(f"  {d}: {len(events)} total events / {len(finished)} finished")
        time.sleep(0.4)

    matched = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") == "FT":
                continue
            d = m.get("date")
            if d not in daily:
                continue
            home = m.get("home", {}).get("name", "")
            away = m.get("away", {}).get("name", "")
            for e in daily[d]:
                if not league_matches(L["name"], e.get("strLeague", "")):
                    continue
                if not names_match(home, e.get("strHomeTeam", "")):
                    continue
                if not names_match(away, e.get("strAwayTeam", "")):
                    continue
                # Found it — record the score as a fallback hint.
                hs = e.get("intHomeScore")
                as_ = e.get("intAwayScore")
                if hs is None or as_ is None:
                    break
                try:
                    hs, as_ = int(hs), int(as_)
                except (TypeError, ValueError):
                    break
                m["thesportsdb_score"] = {
                    "home": hs,
                    "away": as_,
                    "status": "FT",
                    "source_event_id": e.get("idEvent"),
                    "fetched_at": today.isoformat(),
                }
                matched += 1
                print(f"  + {L['name']:25s}  {home} {hs}-{as_} {away}")
                break

    STORE.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDONE. matched={matched}")


if __name__ == "__main__":
    main()
