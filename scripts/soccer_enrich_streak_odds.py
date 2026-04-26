#!/usr/bin/env python3
"""Backfill missing streaks AND fetch per-streak market odds for every match.
Also re-tries streaks where odds were null (in case the label vocabulary now matches)."""
import json, time, pathlib
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data.json"
BUDGET = 38
START = time.time()

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=12)
        if r.status_code != 200: return None
        return r.json()
    except Exception:
        return None

def sleep(): time.sleep(0.08)

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception:
        return None

def fetch_all_odds(eid):
    data = fetch("/api/v1/event/" + str(eid) + "/odds/1/all")
    sleep()
    if not data: return {}
    out = {}
    for mk in data.get("markets", []):
        nm = mk.get("marketName", "")
        cg = mk.get("choiceGroup")
        key = nm if cg is None else (nm + " " + str(cg))
        choices = {}
        for ch in mk.get("choices", []):
            cn = ch.get("name", "")
            v = ch.get("fractionalValue") or ch.get("value")
            d = parse_frac(v)
            if d is not None: choices[cn] = d
        if choices: out[key] = choices
    return out


def any_line(market_odds, prefix, choice):
    """Find any market starting with prefix and return that choice's odds (closest-line fallback)."""
    for k, choices in market_odds.items():
        if k.startswith(prefix + " ") and choice in choices:
            return choices[choice]
    return None


def implied_prob(d):
    """Decimal odds -> implied probability."""
    return 1.0/d if d and d > 0 else 0.0

def derive_third(market_odds, market_key, present_a, present_b, target):
    """If a 3-way market only has 2 of 3 choices, derive the third assuming margin from the other two.
    Returns decimal odds for `target` or None."""
    m = market_odds.get(market_key)
    if not m: return None
    if target in m: return m[target]
    # Need the other two
    if present_a in m and present_b in m:
        pa = implied_prob(m[present_a])
        pb = implied_prob(m[present_b])
        # Assume bookmaker margin ~6%, so total implied = 1.06; target prob = 1.06 - pa - pb
        p_target = 1.06 - pa - pb
        if p_target > 0.01:
            return round(1.0 / p_target, 2)
    return None

def get_streak_odds(label, who, market_odds, home_name, away_name):
    lab = (label or '').lower()
    o = market_odds
    def g(k, c):
        d = o.get(k)
        return d.get(c) if d else None

    # GOALS — handle both "over X goals" and "more than X goals" variants
    is_more = ('over' in lab and 'goals' in lab) or ('more than' in lab and 'goals' in lab)
    is_less = ('under' in lab and 'goals' in lab) or ('less than' in lab and 'goals' in lab)
    for line in ('0.5','1.5','2.5','3.5','4.5','5.5'):
        if line in lab:
            if is_more: return g('Match goals ' + line, 'Over')
            if is_less: return g('Match goals ' + line, 'Under')

    # BTTS variants
    if 'both teams to score' in lab or 'both teams scoring' in lab: return g('Both teams to score', 'Yes')
    if 'no clean sheet' in lab or 'without clean sheet' in lab: return g('Both teams to score', 'Yes')
    if lab == 'clean sheet' or 'no goals conceded' in lab: return g('Both teams to score', 'No')
    if 'no goals scored' in lab:
        # Team failed to score — opposite of team to score
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
    if lab == 'draws': return g('Full time', 'X')
    if lab == 'no draws': return g('Double chance', '12')

    # CARDS — try multiple lines
    is_card_more = 'cards' in lab and ('over' in lab or 'more than' in lab)
    is_card_less = 'cards' in lab and ('under' in lab or 'less than' in lab)
    for line in ('2.5','3.5','4.5','5.5','6.5'):
        if line in lab:
            if is_card_more:
                return g("Cards in match " + line, "Over") or g("Cards in match 4.5", "Over") or g("Cards in match 3.5", "Over") or any_line(o, "Cards in match", "Over")
            if is_card_less:
                return g('Cards in match ' + line, 'Under') or g('Cards in match 4.5', 'Under') or g('Cards in match 3.5', 'Under') or any_line(o, 'Cards in match', 'Under')

    # CORNERS — try multiple lines
    is_corn_more = 'corners' in lab and ('over' in lab or 'more than' in lab)
    is_corn_less = 'corners' in lab and ('under' in lab or 'less than' in lab)
    for line in ('7.5','8.5','9.5','10.5','11.5','12.5'):
        if line in lab:
            if is_corn_more:
                return g('Corners 2-Way ' + line, 'Over') or g('Corners ' + line, 'Over') or g('Corners 2-Way 10.5', 'Over') or any_line(o, 'Corners 2-Way', 'Over') or any_line(o, 'Corners', 'Over')
            if is_corn_less:
                return g('Corners 2-Way ' + line, 'Under') or g('Corners ' + line, 'Under') or g('Corners 2-Way 10.5', 'Under') or any_line(o, 'Corners 2-Way', 'Under') or any_line(o, 'Corners', 'Under')

    # First to score / concede
    if 'first to score' in lab:
        if who == 'home':
            return g('First team to score', home_name) or derive_third(o, 'First team to score', away_name, 'No goal', home_name)
        if who == 'away':
            return g('First team to score', away_name) or derive_third(o, 'First team to score', home_name, 'No goal', away_name)
    if 'first to concede' in lab:
        if who == 'home':
            return g('First team to score', away_name) or derive_third(o, 'First team to score', home_name, 'No goal', away_name)
        if who == 'away':
            return g('First team to score', home_name) or derive_third(o, 'First team to score', away_name, 'No goal', home_name)

    # 1st half
    if 'first half winner' in lab:
        if who == 'home':
            return g('1st half', '1') or derive_third(o, '1st half', 'X', '2', '1')
        if who == 'away':
            return g('1st half', '2') or derive_third(o, '1st half', '1', 'X', '2')
    if 'first half loser' in lab:
        if who == 'home':
            return g('1st half', '2') or derive_third(o, '1st half', '1', 'X', '2')
        if who == 'away':
            return g('1st half', '1') or derive_third(o, '1st half', 'X', '2', '1')

    return None

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    odds_added = 0
    odds_set_count = 0
    cache = {}
    for L in store["leagues"]:
        for m in L["matches"]:
            if time.time() - START > BUDGET:
                STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
                print("BUDGET reached. odds_added=" + str(odds_added))
                return
            eid = m.get("id")
            if not eid: continue
            home_name = m["home"]["name"]; away_name = m["away"]["name"]
            all_streaks = (m.get("h2h_streaks") or []) + (m.get("team_streaks") or [])
            if not all_streaks: continue
            need = [s for s in all_streaks if s.get("odds") is None]
            if not need: continue
            if eid not in cache:
                cache[eid] = fetch_all_odds(eid)
            market = cache[eid]
            if not market: continue
            count = 0
            for s in need:
                o = get_streak_odds(s.get("label"), s.get("team","both"), market, home_name, away_name)
                if o is not None:
                    s["odds"] = o
                    count += 1
            odds_added += count
            if count:
                print(" +" + str(count) + " " + home_name + " vs " + away_name)
            if odds_added and odds_added % 30 == 0:
                STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("DONE. odds_added=" + str(odds_added))

if __name__ == "__main__":
    main()
