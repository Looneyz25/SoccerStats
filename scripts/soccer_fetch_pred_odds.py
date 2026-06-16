#!/usr/bin/env python3
"""Attach odds to the five visible prediction cards for upcoming matches.

Sportsbet.com.au odds (from `sportsbet_odds`) take priority for the winner pick. Fallback to
SofaScore "Full time" 1X2. Other prediction types (BTTS / O-U goals / O-U cards) use SofaScore
90-minute regular-time markets only. Match-level corner and Draw No Bet odds are also cached so
the UI can price synthetic safety picks derived from the 1X2 model.
"""
import json, os, time, pathlib
import random
import re
from curl_cffi import requests

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = FOLDER / "match_data.json"
BUDGET = int(os.environ.get("SOCCER_ODDS_BUDGET", "420"))
START = time.time()
PREDICTION_MARKETS = ("winner", "btts", "ou_goals", "ou_cards")


def fixture_target_dates():
    dates = set()
    for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(","):
        item = item.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
            dates.add(item)
    return dates


def match_in_target_dates(match, target_dates):
    return not target_dates or match.get("date") in target_dates

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate=_profile(), timeout=12)
        if r.status_code != 200: return None
        return r.json()
    except Exception:
        return None

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception:
        return None

def fetch_all_odds(eid):
    data = fetch("/api/v1/event/" + str(eid) + "/odds/1/all"); time.sleep(0.6)
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

def seed_match_odds(m):
    """Build a market dict from already-attached odds as a no-network fallback.

    Preferred order: deep Sportsbet markets (`sportsbet_markets`) > Sportsbet 1X2 >
    SofaScore 1X2 stored on `odds`. SofaScore upstream sometimes writes the
    sentinel `{home:1, draw:1, away:1}` when a market isn't posted yet, so we
    require each price to be a real one before seeding it.
    """
    out = dict(m.get("sportsbet_markets") or {})
    odds = m.get("sportsbet_odds") or m.get("odds") or {}
    if all(is_price(odds.get(k)) for k in ("home", "draw", "away")):
        out.setdefault("Full time", {"1": odds["home"], "X": odds["draw"], "2": odds["away"]})
    return out

def any_line(market_odds, prefix, choice):
    for k, choices in market_odds.items():
        if k.startswith(prefix + " ") and choice in choices:
            return choices[choice]
    return None

def is_price(value):
    try:
        return float(value) > 1.01
    except Exception:
        return False

def matching_corner_streak_has_odds(m):
    for streak in (m.get("h2h_streaks") or []) + (m.get("team_streaks") or []):
        if "corner" in str(streak.get("label") or "").lower() and is_price(streak.get("odds")):
            return True
    return False

def has_corner_odds(m):
    corner_odds = m.get("corner_odds") or {}
    if matching_corner_streak_has_odds(m):
        return True
    for line in ("7.5", "8.5", "9.5", "10.5", "11.5", "12.5"):
        prices = corner_odds.get(line) or {}
        if is_price(prices.get("Over")) or is_price(prices.get("Under")):
            return True
    return False

def missing_major_market_odds(m):
    p = m.get("predictions") or {}
    missing = []
    for key in PREDICTION_MARKETS:
        market = p.get(key) or {}
        if market.get("pick") and not is_price(market.get("odds")):
            missing.append(key)
    if not has_corner_odds(m):
        missing.append("corners")
    return missing

def opposite_pick(pick):
    if pick == "Over":
        return "Under"
    if pick == "Under":
        return "Over"
    if pick == "Yes":
        return "No"
    if pick == "No":
        return "Yes"
    return pick

def inverse_two_way_odds(known_odds):
    try:
        implied = 1.0 / float(known_odds)
        if implied <= 0 or implied >= 1:
            return None
        return round(1.0 / (1.0 - implied), 2)
    except Exception:
        return None

def streak_price(m, keyword, line=None, pick=None):
    target_pick = (pick or "").lower()
    target_line = str(line) if line is not None else None
    for streak in (m.get("h2h_streaks") or []) + (m.get("team_streaks") or []):
        label = str(streak.get("label") or "").lower()
        if keyword not in label:
            continue
        if target_line and target_line not in label:
            continue
        if target_pick:
            is_over = "over" in label or "more than" in label
            is_under = "under" in label or "less than" in label
            is_yes = "both teams scoring" in label or "btts" in label
            is_no = "clean sheet" in label or "without clean sheet" in label
            label_pick = "over" if is_over else "under" if is_under else "yes" if is_yes else "no" if is_no else ""
            if label_pick and label_pick != target_pick:
                continue
        odds = streak.get("odds")
        if is_price(odds):
            return odds
    return None

def attach_corner_odds(m, market):
    """Store available two-way corner prices by line for UI-generated corner picks."""
    corner_odds = m.setdefault("corner_odds", {})
    added = 0
    for line in ("7.5", "8.5", "9.5", "10.5", "11.5", "12.5"):
        choices = market.get("Corners 2-Way " + line) or market.get("Corners " + line) or {}
        over = choices.get("Over")
        under = choices.get("Under")
        if over is None and under is None:
            continue
        existing = corner_odds.setdefault(line, {})
        before = len(existing)
        if over is not None:
            existing["Over"] = over
        if under is not None:
            existing["Under"] = under
        added += max(0, len(existing) - before)
    if not corner_odds:
        m.pop("corner_odds", None)
    return added

def _norm_name(value):
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())

def attach_draw_no_bet_odds(m, market):
    choices = (
        market.get("Draw No Bet")
        or market.get("Draw no bet")
        or market.get("Draw No Bet 90 Minutes")
        or market.get("Draw no bet 90 Minutes")
        or {}
    )
    if not choices:
        return 0
    home_name = _norm_name((m.get("home") or {}).get("name"))
    away_name = _norm_name((m.get("away") or {}).get("name"))
    stored = {}
    for label, price in choices.items():
        if not is_price(price):
            continue
        key = _norm_name(label)
        if label in ("1", "Home") or key == home_name:
            stored["1"] = price
        elif label in ("2", "Away") or key == away_name:
            stored["2"] = price
    if "1" not in stored or "2" not in stored:
        return 0
    markets = m.setdefault("sportsbet_markets", {})
    before = len(markets.get("Draw No Bet") or {})
    markets["Draw No Bet"] = stored
    return max(0, len(stored) - before)

def attach_pred_odds(m, market):
    p = m.get("predictions") or {}

    # Winner — sportsbet first, fallback SofaScore Full time (90-min only).
    # Gate on `not is_price(...)` rather than `is None` so the sentinel 1.0
    # placeholder (SofaScore "0/1" fractional → 1.0) gets overwritten.
    w = p.get("winner") or {}
    if w.get("type") and not is_price(w.get("odds")):
        wt = w["type"]
        sb = m.get("sportsbet_odds") or {}
        if is_price(sb.get(wt)):
            w["odds"] = sb[wt]
        else:
            full = market.get("Full time", {})
            key = "1" if wt == "home" else ("X" if wt == "draw" else "2")
            if is_price(full.get(key)):
                w["odds"] = full[key]

    # Goals
    og = p.get("ou_goals") or {}
    if og.get("pick") and not is_price(og.get("odds")):
        line = str(og.get("line", 2.5))
        v = (market.get(f"Match goals {line}") or {}).get(og["pick"])
        if v is None:
            v = streak_price(m, "goals", line, og["pick"])
        if v is not None: og["odds"] = v

    # BTTS
    b = p.get("btts") or {}
    if b.get("pick") and not is_price(b.get("odds")):
        v = (market.get("Both teams to score") or {}).get(b["pick"])
        if v is None:
            v = streak_price(m, "scoring", None, b["pick"]) or streak_price(m, "clean sheet", None, b["pick"])
        if v is not None: b["odds"] = v

    # Cards
    oc = p.get("ou_cards") or {}
    if oc.get("pick") and not is_price(oc.get("odds")):
        line = str(oc.get("line", 4.5))
        v = (market.get(f"Cards in match {line}") or {}).get(oc["pick"]) \
            or any_line(market, "Cards in match", oc["pick"])
        if v is None:
            v = streak_price(m, "cards", line, oc["pick"])
        if v is not None:
            oc["odds"] = v
        else:
            opposite = streak_price(m, "cards", line, opposite_pick(oc["pick"]))
            estimated = inverse_two_way_odds(opposite)
            if estimated is not None:
                oc["odds"] = estimated
                oc["odds_estimated"] = True

    return attach_corner_odds(m, market) + attach_draw_no_bet_odds(m, market)

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    target_dates = fixture_target_dates()
    if target_dates:
        print("target_dates=" + ",".join(sorted(target_dates)))
    added = 0
    matches = [
        (L, m)
        for L in store["leagues"]
        for m in L["matches"]
        if m.get("status") != "FT"
        and match_in_target_dates(m, target_dates)
    ]
    matches.sort(key=lambda item: (
        item[1].get("date", ""),
        item[1].get("time", ""),
        item[0].get("name", ""),
        item[1].get("home", {}).get("name", ""),
    ))
    for L, m in matches:
        if time.time() - START > BUDGET:
            STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
            print("BUDGET reached. added=" + str(added))
            return
        eid = m.get("id")
        if not eid: continue
        p = m.get("predictions") or {}
        need = (
            any(p.get(k) and p[k].get("pick") and not is_price(p[k].get("odds"))
                for k in PREDICTION_MARKETS)
            or not (m.get("corner_odds") or {}).get("10.5")
            or not has_corner_odds(m)
        )
        if not need: continue
        market = seed_match_odds(m)
        fetched = fetch_all_odds(eid)
        if fetched:
            market.update(fetched)
        if not market: continue
        before = sum(1 for k in PREDICTION_MARKETS if is_price((p.get(k) or {}).get("odds")))
        before_corners = sum(len(v or {}) for v in (m.get("corner_odds") or {}).values())
        attach_pred_odds(m, market)
        after = sum(1 for k in PREDICTION_MARKETS if is_price((p.get(k) or {}).get("odds")))
        after_corners = sum(len(v or {}) for v in (m.get("corner_odds") or {}).values())
        delta = (after - before) + (after_corners - before_corners)
        if delta:
            added += delta
            print(f" +{delta} {m['home']['name']} vs {m['away']['name']}")
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    missing_rows = []
    for L, m in matches:
        missing = missing_major_market_odds(m)
        if missing:
            missing_rows.append((L.get("name", ""), m, missing))
    print(f"DONE. added={added} five_market_missing={len(missing_rows)}")
    for league, m, missing in missing_rows[:20]:
        print(f"  missing {','.join(missing)}: {league} {m['home']['name']} vs {m['away']['name']} ({m.get('date','')})")

if __name__ == "__main__":
    main()
