#!/usr/bin/env python3
"""Attach `odds` to every prediction (winner, btts, ou_goals, ou_cards) for upcoming matches.

Sportsbet.com.au odds (from `sportsbet_odds`) take priority for the winner pick. Fallback to
SofaScore "Full time" 1X2. Other prediction types (BTTS / O-U goals / O-U cards) use SofaScore
90-minute regular-time markets only.
"""
import json, time, pathlib
from curl_cffi import requests

FOLDER = pathlib.Path(__file__).resolve().parent.parent
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

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception:
        return None

def fetch_all_odds(eid):
    data = fetch("/api/v1/event/" + str(eid) + "/odds/1/all"); time.sleep(0.08)
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

def attach_pred_odds(m, market):
    p = m.get("predictions") or {}

    # Winner — sportsbet first, fallback SofaScore Full time (90-min only)
    w = p.get("winner") or {}
    if w.get("type") and w.get("odds") is None:
        wt = w["type"]
        sb = m.get("sportsbet_odds") or {}
        if sb.get(wt) is not None:
            w["odds"] = sb[wt]
        else:
            full = market.get("Full time", {})
            key = "1" if wt == "home" else ("X" if wt == "draw" else "2")
            if key in full: w["odds"] = full[key]

    # Goals
    og = p.get("ou_goals") or {}
    if og.get("pick") and og.get("odds") is None:
        line = str(og.get("line", 2.5))
        v = (market.get(f"Match goals {line}") or {}).get(og["pick"])
        if v is not None: og["odds"] = v

    # BTTS
    b = p.get("btts") or {}
    if b.get("pick") and b.get("odds") is None:
        v = (market.get("Both teams to score") or {}).get(b["pick"])
        if v is not None: b["odds"] = v

    # Cards
    oc = p.get("ou_cards") or {}
    if oc.get("pick") and oc.get("odds") is None:
        line = str(oc.get("line", 4.5))
        v = (market.get(f"Cards in match {line}") or {}).get(oc["pick"]) \
            or any_line(market, "Cards in match", oc["pick"])
        if v is not None: oc["odds"] = v

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    added = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if time.time() - START > BUDGET:
                STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
                print("BUDGET reached. added=" + str(added))
                return
            eid = m.get("id")
            if not eid: continue
            p = m.get("predictions") or {}
            need = any(p.get(k) and p[k].get("pick") and p[k].get("odds") is None
                       for k in ("winner", "ou_goals", "btts", "ou_cards"))
            if not need: continue
            market = fetch_all_odds(eid)
            if not market: continue
            before = sum(1 for k in ("winner","ou_goals","btts","ou_cards") if (p.get(k) or {}).get("odds") is not None)
            attach_pred_odds(m, market)
            after = sum(1 for k in ("winner","ou_goals","btts","ou_cards") if (p.get(k) or {}).get("odds") is not None)
            delta = after - before
            if delta:
                added += delta
                print(f" +{delta} {m['home']['name']} vs {m['away']['name']}")
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"DONE. added={added}")

if __name__ == "__main__":
    main()
