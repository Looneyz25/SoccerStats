#!/usr/bin/env python3
"""Phase A only: settle finished matches."""
import json, re, time, datetime, pathlib
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data.json"
TODAY = datetime.date(2026, 4, 26)
TODAY_STR = TODAY.isoformat()

ERRORS = []
SETTLED = []
SKIPPED_NOT_DONE = []

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=20)
        if r.status_code == 404: return None
        if r.status_code != 200:
            ERRORS.append(path + " -> " + str(r.status_code))
            return None
        return r.json()
    except Exception as e:
        ERRORS.append(path + " -> " + type(e).__name__ + ": " + str(e))
        return None

def sleep(): time.sleep(0.2)

ABBREV = {
    "wolves": "wolverhampton", "wolverhampton": "wolves",
    "manutd": "manchesterunited", "manchesterunited": "manutd",
    "mancity": "manchestercity", "manchestercity": "mancity",
    "spurs": "tottenham",
    "forest": "nottinghamforest", "nottinghamforest": "forest",
    "hsv": "hamburger", "hamburger": "hsv",
    "sheffwed": "sheffieldwednesday", "sheffieldwednesday": "sheffwed",
    "sheffutd": "sheffieldunited", "sheffieldunited": "sheffutd",
    "westbrom": "westbromwich",
    "boro": "middlesbrough",
    "oxford": "oxfordunited",
    "atlmadrid": "atleticomadrid", "atleticomadrid": "atlmadrid",
    "athletic": "athleticclub",
    "leverkusen": "bayerleverkusen",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "moenchengladbach", "mgladbach": "moenchengladbach",
    "stpauli": "saintpauli",
    "psg": "parissaintgermain",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "atletico": "atleticomadrid",
}

def norm(s):
    s = re.sub(r'[^a-z0-9]', '', (s or '').lower())
    s = s.replace("utd", "united")
    return s

def names_match(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return False
    if a == b or a in b or b in a:
        return True
    for tok, exp in ABBREV.items():
        if tok in a and exp in b: return True
        if tok in b and exp in a: return True
    return False

def lookup_event_for_match(m):
    if m.get("id"):
        ev_data = fetch("/api/v1/event/" + str(m["id"]))
        sleep()
        if ev_data and "event" in ev_data:
            return ev_data["event"]
    date = m.get("date")
    if not date: return None
    home = m.get("home", {}).get("name", "")
    away = m.get("away", {}).get("name", "")
    home_id = m.get("home", {}).get("team_id")
    away_id = m.get("away", {}).get("team_id")
    base = datetime.date.fromisoformat(date)
    for delta in (0, -1, 1):
        d = (base + datetime.timedelta(days=delta)).isoformat()
        sched = fetch("/api/v1/sport/football/scheduled-events/" + d)
        sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            eh = (ev.get("homeTeam") or {}).get("name", "")
            ea = (ev.get("awayTeam") or {}).get("name", "")
            ehid = (ev.get("homeTeam") or {}).get("id")
            eaid = (ev.get("awayTeam") or {}).get("id")
            if home_id and away_id and ehid == home_id and eaid == away_id:
                return ev
            if names_match(home, eh) and names_match(away, ea):
                return ev
    return None

def fetch_card_count(event_id):
    stats = fetch("/api/v1/event/" + str(event_id) + "/statistics")
    sleep()
    if not stats: return None
    yel = red = 0
    found = False
    for period in stats.get("statistics", []):
        if period.get("period") != "ALL": continue
        for grp in period.get("groups", []):
            for item in grp.get("statisticsItems", []):
                nm = (item.get("name") or "").lower()
                if "yellow card" in nm and "second" not in nm:
                    try:
                        yel += int(item.get("home", 0)) + int(item.get("away", 0))
                        found = True
                    except: pass
                elif "red card" in nm:
                    try:
                        red += int(item.get("home", 0)) + int(item.get("away", 0))
                        found = True
                    except: pass
    return (yel + red) if found else None

def settle_winner(preds, hg, ag):
    actual_type = "home" if hg > ag else "away" if ag > hg else "draw"
    w = preds.get("winner")
    if w and "type" in w:
        w["result"] = "hit" if w["type"] == actual_type else "miss"
    b = preds.get("btts")
    actual_btts = (hg > 0 and ag > 0)
    if b and "pick" in b:
        b["actual_btts"] = actual_btts
        b["result"] = "hit" if (b["pick"].lower() == ("yes" if actual_btts else "no")) else "miss"
    total = hg + ag
    og = preds.get("ou_goals")
    if og and "pick" in og:
        line = og.get("line", 2.5)
        og["actual"] = total
        og["result"] = "hit" if ((og["pick"]=="Over" and total>line) or (og["pick"]=="Under" and total<line)) else "miss"

def settle_cards(preds, eid):
    oc = preds.get("ou_cards")
    if not (oc and "pick" in oc): return
    cards = fetch_card_count(eid) if eid else None
    if cards is None:
        oc["result"] = "pending"
    else:
        line = oc.get("line", 4.5)
        oc["actual"] = cards
        oc["result"] = "hit" if ((oc["pick"]=="Over" and cards>line) or (oc["pick"]=="Under" and cards<line)) else "miss"

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    for L in store["leagues"]:
        for m in L["matches"]:
            preds = m.setdefault("predictions", {})
            if m.get("status") == "FT":
                if (preds.get("ou_cards") or {}).get("result") == "pending" and m.get("id"):
                    print("  cards pending for " + m["home"]["name"] + " vs " + m["away"]["name"])
                    settle_cards(preds, m["id"])
                continue
            try:
                mdate = datetime.date.fromisoformat(m.get("date", ""))
                if (TODAY - mdate).days > 14:
                    continue
            except Exception:
                pass
            hn = m["home"]["name"]; an = m["away"]["name"]
            print("trying " + hn + " vs " + an + " (" + str(m.get("date")) + " " + str(m.get("time")) + ")")
            ev = lookup_event_for_match(m)
            if not ev:
                ERRORS.append("no event found: " + hn + " vs " + an)
                continue
            status = (ev.get("status") or {}).get("type")
            if status != "finished":
                SKIPPED_NOT_DONE.append((hn, an, status))
                print("  not finished: " + str(status))
                continue
            eid = ev.get("id")
            hg = (ev.get("homeScore") or {}).get("current")
            ag = (ev.get("awayScore") or {}).get("current")
            if hg is None or ag is None: continue
            m["home"]["goals"] = hg
            m["away"]["goals"] = ag
            m["status"] = "FT"
            m["time"] = "FT"
            if eid: m["id"] = eid
            m["settled_at"] = TODAY_STR
            settle_winner(preds, hg, ag)
            settle_cards(preds, eid)
            SETTLED.append({
                "home": hn, "away": an, "hg": hg, "ag": ag,
                "winner": (preds.get("winner") or {}).get("result"),
                "btts": (preds.get("btts") or {}).get("result"),
                "ou_goals": (preds.get("ou_goals") or {}).get("result"),
                "ou_cards": (preds.get("ou_cards") or {}).get("result"),
            })
            print("  -> SETTLED " + str(hg) + "-" + str(ag))
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("=== Settled: " + str(len(SETTLED)) + " | Skipped not-done: " + str(len(SKIPPED_NOT_DONE)) + " | Errors: " + str(len(ERRORS)))
    for e in ERRORS[:10]: print(" - " + e)
    for s in SETTLED:
        print("  " + s["home"] + " " + str(s["hg"]) + "-" + str(s["ag"]) + " " + s["away"] + " | W:" + str(s["winner"]) + " BTTS:" + str(s["btts"]) + " G:" + str(s["ou_goals"]) + " C:" + str(s["ou_cards"]))

if __name__ == "__main__":
    main()
