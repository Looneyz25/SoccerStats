#!/usr/bin/env python3
"""For every match, look up SofaScore market odds and attach `odds` to each h2h_streak
and team_streak entry by mapping the streak label (e.g. "More than 2.5 goals") to the
corresponding 90-minute market choice.

NOTE: Uses /api/v1/event/{id}/odds/1/all which returns 90-minute regular time markets
("Full time", "Match goals X.5", "Both teams to score", "Cards in match X.5",
"Corners 2-Way X.5", "1st half", "Double chance"). Extra-time markets are NOT used.
"""
import json, time, pathlib
import random
from curl_cffi import requests

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = FOLDER / "match_data.json"
BUDGET = 38
START = time.time()

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate=_profile(), timeout=12)
        if r.status_code != 200: return None
        return r.json()
    except Exception:
        return None

def sleep(): time.sleep(0.6)

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception:
        return None

def fetch_all_odds(eid):
    data = fetch("/api/v1/event/" + str(eid) + "/odds/1/all"); sleep()
    if not data: return {}
    out = {}
    for mk in data.get("markets", []):
        nm = mk.get("marketName", "")
        cg = mk.get("choiceGroup")
        key = nm if cg is None else (nm + " " + str(cg))
        choices = {}
        for ch in mk.get("choices", []):
            v = ch.get("fractionalValue") or ch.get("value")
            d = parse_frac(v)
            if d is not None: choices[ch.get("name", "")] = d
        if choices: out[key] = choices
    return out

def any_line(market_odds, prefix, choice):
    for k, choices in market_odds.items():
        if k.startswith(prefix + " ") and choice in choices:
            return choices[choice]
    return None

def implied_prob(d):
    return 1.0/d if d and d > 0 else 0.0

def derive_third(market_odds, market_key, present_a, present_b, target):
    m = market_odds.get(market_key)
    if not m: return None
    if target in m: return m[target]
    if present_a in m and present_b in m:
        p = 1.06 - implied_prob(m[present_a]) - implied_prob(m[present_b])
        if p > 0.01:
            return round(1.0 / p, 2)
    return None

def get_streak_odds(label, who, market_odds, home_name, away_name):
    """Map a SofaScore streak (label + which team) to the matching 90-minute market price."""
    lab = (label or '').lower()
    o = market_odds
    def g(k, c):
        d = o.get(k)
        return d.get(c) if d else None

    # GOALS
    is_more = ('over' in lab and 'goals' in lab) or ('more than' in lab and 'goals' in lab)
    is_less = ('under' in lab and 'goals' in lab) or ('less than' in lab and 'goals' in lab)
    for line in ('0.5','1.5','2.5','3.5','4.5','5.5'):
        if line in lab:
            if is_more: return g('Match goals ' + line, 'Over')
            if is_less: return g('Match goals ' + line, 'Under')

    # BTTS
    if 'both teams to score' in lab or 'both teams scoring' in lab: return g('Both teams to score', 'Yes')
    if 'no clean sheet' in lab or 'without clean sheet' in lab:     return g('Both teams to score', 'Yes')
    if lab == 'clean sheet' or 'no goals conceded' in lab:          return g('Both teams to score', 'No')
    if 'no goals scored' in lab:
        if who == 'home': return g('Team to score: ' + home_name, 'No')
        if who == 'away': return g('Team to score: ' + away_name, 'No')
        return g('Both teams to score', 'No')

    # 1X2 / Double chance
    if lab == 'wins':
        if who == 'home': return g('Full time', '1')
        if who == 'away': return g('Full time', '2')
    if lab == 'losses':
        if who == 'home': return g('Full time', '2')
        if who == 'away': return g('Full time', '1')
    if lab == 'no losses':
        if who == 'home': return g('Double chance', '1X')
        if who == 'away': return g('Double chance', 'X2')
    if lab == 'no wins':
        if who == 'home': return g('Double chance', 'X2')
        if who == 'away': return g('Double chance', '1X')
    if lab == 'draws':    return g('Full time', 'X')
    if lab == 'no draws': return g('Double chance', '12')

    # CARDS
    is_card_more = 'cards' in lab and ('over' in lab or 'more than' in lab)
    is_card_less = 'cards' in lab and ('under' in lab or 'less than' in lab)
    for line in ('2.5','3.5','4.5','5.5','6.5'):
        if line in lab:
            if is_card_more: return g('Cards in match ' + line, 'Over')  or any_line(o, 'Cards in match', 'Over')
            if is_card_less: return g('Cards in match ' + line, 'Under') or any_line(o, 'Cards in match', 'Under')

    # CORNERS
    is_corn_more = 'corners' in lab and ('over' in lab or 'more than' in lab)
    is_corn_less = 'corners' in lab and ('under' in lab or 'less than' in lab)
    for line in ('7.5','8.5','9.5','10.5','11.5','12.5'):
        if line in lab:
            if is_corn_more: return g('Corners 2-Way ' + line, 'Over')  or any_line(o, 'Corners 2-Way', 'Over')  or any_line(o, 'Corners', 'Over')
            if is_corn_less: return g('Corners 2-Way ' + line, 'Under') or any_line(o, 'Corners 2-Way', 'Under') or any_line(o, 'Corners', 'Under')

    # First to score / concede
    if 'first to score' in lab:
        if who == 'home': return g('First team to score', home_name) or derive_third(o, 'First team to score', away_name, 'No goal', home_name)
        if who == 'away': return g('First team to score', away_name) or derive_third(o, 'First team to score', home_name, 'No goal', away_name)
    if 'first to concede' in lab:
        if who == 'home': return g('First team to score', away_name) or derive_third(o, 'First team to score', home_name, 'No goal', away_name)
        if who == 'away': return g('First team to score', home_name) or derive_third(o, 'First team to score', away_name, 'No goal', home_name)

    # 1st half
    if 'first half winner' in lab:
        if who == 'home': return g('1st half', '1') or derive_third(o, '1st half', 'X', '2', '1')
        if who == 'away': return g('1st half', '2') or derive_third(o, '1st half', '1', 'X', '2')
    if 'first half loser' in lab:
        if who == 'home': return g('1st half', '2') or derive_third(o, '1st half', '1', 'X', '2')
        if who == 'away': return g('1st half', '1') or derive_third(o, '1st half', 'X', '2', '1')

    return None

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    odds_added = 0
    cache = {}
    for L in store["leagues"]:
        for m in L["matches"]:
            if time.time() - START > BUDGET:
                STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
                print("BUDGET reached. odds_added=" + str(odds_added))
                return
            eid = m.get("id")
            if not eid: continue
            home_name, away_name = m["home"]["name"], m["away"]["name"]
            all_streaks = (m.get("h2h_streaks") or []) + (m.get("team_streaks") or [])
            need = [s for s in all_streaks if s.get("odds") is None]
            if not need: continue
            if eid not in cache:
                cache[eid] = fetch_all_odds(eid)
            market = cache[eid]
            if not market: continue
            count = 0
            for s in need:
                o = get_streak_odds(s.get("label"), s.get("team", "both"), market, home_name, away_name)
                if o is not None:
                    s["odds"] = o
                    count += 1
            odds_added += count
            if count:
                print(" +" + str(count) + " " + home_name + " vs " + away_name)
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("DONE. odds_added=" + str(odds_added))

if __name__ == "__main__":
    main()
