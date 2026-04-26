#!/usr/bin/env python3
"""Pull Win-Draw-Win odds from sportsbet.com.au and merge into match_data.json as `sportsbet_odds`.
Australian "Win" prices are decimal-minus-1 (i.e. profit per unit). We add 1 to display as standard
decimal odds matching SofaScore convention."""
import json, re, time, pathlib
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data.json"

LEAGUE_PAGES = {
    "Premier League": "united-kingdom/english-premier-league",
    "Championship": "united-kingdom/english-championship",
    "LaLiga": "spain/spanish-la-liga",
    "Serie A": "italy/italian-serie-a",
    "Bundesliga": "germany/german-bundesliga",
    "Ligue 1": "france/french-ligue-1",
    "Eredivisie": "rest-of-europe/dutch-eredivisie",
    "UEFA Champions League": "uefa-competitions/uefa-champions-league",
    "UEFA Europa League": "uefa-competitions/uefa-europa-league",
}

ABBREV = {
    "wolves": "wolverhampton", "wolverhampton": "wolves",
    "manutd": "manchesterunited", "manchesterunited": "manutd", "manunited": "manchesterunited",
    "mancity": "manchestercity", "manchestercity": "mancity",
    "spurs": "tottenham",
    "forest": "nottinghamforest", "nottinghamforest": "forest",
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
    "rennes": "staderennais", "rennais": "staderennais",
    "stbrieuc": "stadebrestois",
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
    s = s.replace("utd", "united").replace("fc", "")
    return s

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
        r = requests.get(url, impersonate="chrome120", timeout=20)
        if r.status_code != 200: return None
        html = r.text
        start = html.find('window.__PRELOADED_STATE__ = ')
        if start == -1: return None
        start += len('window.__PRELOADED_STATE__ = ')
        end = html.find('window.__APOLLO_STATE__', start)
        blob = html[start:end].rstrip().rstrip(';').rstrip()
        return json.loads(blob)
    except Exception as e:
        print("ERR", slug, ":", e)
        return None

def to_decimal(num, den):
    """Sportsbet AU price = profit/stake (e.g. 1.88 means win 1.88 profit per 1 staked).
    Decimal odds = profit + 1."""
    return round(num / den + 1.0, 2)

def extract_odds(data):
    out = {}
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    markets = sb.get("markets", {})
    outcomes = sb.get("outcomes", {})
    for eid, ev in events.items():
        h = ev.get("participant1"); a = ev.get("participant2")
        if not h or not a: continue
        ts = (ev.get("startTime") or {}).get("milliseconds", 0)
        wdw = None
        for mid in ev.get("marketIds", []):
            mk = markets.get(str(mid)) or markets.get(mid)
            if not mk: continue
            if mk.get("name") in ("Win-Draw-Win", "Match Result", "1X2"):
                wdw = mk; break
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
            if rt == "H": odds["home"] = price
            elif rt == "D": odds["draw"] = price
            elif rt == "A": odds["away"] = price
        if "home" in odds and "draw" in odds and "away" in odds:
            out[(norm(h), norm(a))] = {"home": odds["home"], "draw": odds["draw"], "away": odds["away"],
                                       "event_id": ev.get("id"), "start_ts": ts // 1000,
                                       "home_name": h, "away_name": a}
    return out

def find_match(idx, home, away):
    nh, na = norm(home), norm(away)
    if (nh, na) in idx: return idx[(nh, na)]
    for (sh, sa), v in idx.items():
        if names_match(home, v["home_name"]) and names_match(away, v["away_name"]):
            return v
    return None

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    matched = 0
    no_page = 0
    no_match = []
    cache = {}
    for L in store["leagues"]:
        league_name = L["name"]
        slug = LEAGUE_PAGES.get(league_name)
        if not slug:
            no_page += 1; print("(no page) " + league_name); continue
        if slug not in cache:
            print("Fetching " + league_name + " (" + slug + ")")
            data = fetch_page_data(slug)
            if not data:
                cache[slug] = None; continue
            cache[slug] = extract_odds(data)
            print("  events with odds: " + str(len(cache[slug])))
            time.sleep(0.5)
        idx = cache[slug]
        if not idx: continue
        for m in L["matches"]:
            hit = find_match(idx, m["home"]["name"], m["away"]["name"])
            if hit:
                m["sportsbet_odds"] = {"home": hit["home"], "draw": hit["draw"], "away": hit["away"],
                                       "event_id": hit["event_id"]}
                matched += 1
            else:
                no_match.append((league_name, m["home"]["name"], m["away"]["name"]))
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("=== matched: " + str(matched) + " | unmatched: " + str(len(no_match)) + " | no page: " + str(no_page))
    for nm in no_match[:15]: print("  -", nm)

if __name__ == "__main__":
    main()
