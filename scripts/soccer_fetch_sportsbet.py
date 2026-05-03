#!/usr/bin/env python3
"""Pull Win-Draw-Win (90-min regular time) odds from sportsbet.com.au and merge
into match_data.json as `sportsbet_odds`. Australian "Win" prices are decimal-minus-1
(profit per unit), so we add 1 to display as standard decimal odds.

NOTE: Markets matched are "Win-Draw-Win" / "Match Result" / "1X2" — these are 90-minute
regular time only. Extra-time markets ("Match Result Including Overtime", etc.) are
explicitly excluded.
"""
import json, re, time, pathlib
import random
from curl_cffi import requests

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

# Folder = this script's parent's parent (i.e. scripts/.. = repo root)
FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = FOLDER / "match_data.json"

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

ABBREV = {
    "wolves": "wolverhampton",
    "manutd": "manchesterunited", "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "forest": "nottinghamforest",
    "boro": "middlesbrough",
    "atletico": "atleticomadrid", "atlmadrid": "atleticomadrid",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach", "mgladbach": "borussiamonchengladbach",
    "marseille": "olympiquemarseille",
    "psg": "parissaintgermain",
    "stuttgart": "vfbstuttgart",
    "bremen": "werderbremen",
    "leverkusen": "bayerleverkusen",
    "hoffenheim": "tsghoffenheim",
    "pauli": "stpauli",
    "rennes": "staderennais",
    "leeds": "leedsunited",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "westbrom": "westbromwich",
    "oviedo": "realoviedo",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "athletic": "athleticbilbao",
}

def norm(s):
    s = re.sub(r'[^a-z0-9]', '', (s or '').lower())
    return s.replace("utd", "united").replace("fc", "")

def names_match(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return False
    if a == b or a in b or b in a: return True
    for tok, exp in ABBREV.items():
        if tok in a and exp in b: return True
        if tok in b and exp in a: return True
    return False

def fetch_page_data(slug):
    url = "https://www.sportsbet.com.au/betting/soccer/" + slug
    try:
        r = requests.get(url, impersonate=_profile(), timeout=20)
        if r.status_code != 200: return None
        html = r.text
        start = html.find('window.__PRELOADED_STATE__ = ')
        if start == -1: return None
        start += len('window.__PRELOADED_STATE__ = ')
        end = html.find('window.__APOLLO_STATE__', start)
        return json.loads(html[start:end].rstrip().rstrip(';').rstrip())
    except Exception as e:
        print("ERR", slug, ":", e)
        return None

def to_decimal(num, den):
    """Sportsbet AU price = profit/stake. Decimal odds = profit + 1."""
    return round(num / den + 1.0, 2)

def extract_odds(data):
    """Extract Win-Draw-Win (90-min regular time) prices for every event on the league page."""
    out = {}
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    markets = sb.get("markets", {})
    outcomes = sb.get("outcomes", {})
    for eid, ev in events.items():
        h, a = ev.get("participant1"), ev.get("participant2")
        if not h or not a: continue
        ts = (ev.get("startTime") or {}).get("milliseconds", 0)
        wdw = None
        for mid in ev.get("marketIds", []):
            mk = markets.get(str(mid)) or markets.get(mid)
            if not mk: continue
            # 90-MIN REGULAR TIME ONLY — skip extra-time markets
            if mk.get("name") in ("Win-Draw-Win", "Match Result", "1X2"):
                wdw = mk
                break
        if not wdw: continue
        odds = {}
        for oid in wdw.get("outcomeIds", []):
            oc = outcomes.get(str(oid)) or outcomes.get(oid)
            if not oc: continue
            wp = oc.get("winPrice") or {}
            try:
                price = to_decimal(wp["num"], wp["den"])
            except Exception:
                continue
            rt = oc.get("resultType") or ""
            if rt == "H":   odds["home"] = price
            elif rt == "D": odds["draw"] = price
            elif rt == "A": odds["away"] = price
        if "home" in odds and "draw" in odds and "away" in odds:
            out[(norm(h), norm(a))] = {
                "home": odds["home"], "draw": odds["draw"], "away": odds["away"],
                "event_id": ev.get("id"), "start_ts": ts // 1000,
                "home_name": h, "away_name": a,
            }
    return out

def find_match(idx, home, away):
    nh, na = norm(home), norm(away)
    if (nh, na) in idx: return idx[(nh, na)]
    for v in idx.values():
        if names_match(home, v["home_name"]) and names_match(away, v["away_name"]):
            return v
    return None

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    matched = 0
    no_match = []
    cache = {}
    for L in store["leagues"]:
        slug = LEAGUE_PAGES.get(L["name"])
        if not slug:
            print("(no page) " + L["name"]); continue
        if slug not in cache:
            print("Fetching " + L["name"] + " (" + slug + ")")
            data = fetch_page_data(slug)
            cache[slug] = extract_odds(data) if data else None
            print("  events with odds: " + str(len(cache[slug] or {})))
            time.sleep(1.0)
        idx = cache[slug]
        if not idx: continue
        for m in L["matches"]:
            if m.get("status") == "FT": continue
            hit = find_match(idx, m["home"]["name"], m["away"]["name"])
            if hit:
                m["sportsbet_odds"] = {"home": hit["home"], "draw": hit["draw"],
                                       "away": hit["away"], "event_id": hit["event_id"]}
                matched += 1
            else:
                no_match.append((L["name"], m["home"]["name"], m["away"]["name"]))
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"=== matched: {matched} | unmatched: {len(no_match)}")
    for nm in no_match[:15]: print("  -", nm)

if __name__ == "__main__":
    main()
