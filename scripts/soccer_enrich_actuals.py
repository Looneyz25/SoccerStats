#!/usr/bin/env python3
"""Enrich finished matches with corners, first-to-score, half-time stats."""
import json, time, pathlib
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data.json"
BUDGET = 38
START = time.time()

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=12)
        if r.status_code == 404: return None
        if r.status_code != 200: return None
        return r.json()
    except Exception:
        return None

def sleep(): time.sleep(0.08)

def enrich(m):
    eid = m.get("id")
    if not eid: return False
    actuals = m.setdefault("actuals", {})

    # Skip if already enriched
    if "corners_total" in actuals and "first_to_score" in actuals: return False

    # Statistics
    if "corners_total" not in actuals or "fouls_total" not in actuals:
        stats = fetch("/api/v1/event/" + str(eid) + "/statistics")
        sleep()
        if stats:
            for period in stats.get("statistics", []):
                if period.get("period") != "ALL": continue
                for grp in period.get("groups", []):
                    for it in grp.get("statisticsItems", []):
                        k = it.get("key")
                        try:
                            h = int(it.get("home", 0))
                            a = int(it.get("away", 0))
                        except (TypeError, ValueError):
                            continue
                        if k == "cornerKicks":
                            actuals["home_corners"] = h
                            actuals["away_corners"] = a
                            actuals["corners_total"] = h + a
                        elif k == "fouls":
                            actuals["home_fouls"] = h
                            actuals["away_fouls"] = a
                            actuals["fouls_total"] = h + a
                        elif k == "shotsOnGoal":
                            actuals["home_sot"] = h
                            actuals["away_sot"] = a

    # Incidents (first goal, half-time)
    if "first_to_score" not in actuals or "ht_winner" not in actuals:
        inc = fetch("/api/v1/event/" + str(eid) + "/incidents")
        sleep()
        if inc:
            incidents = inc.get("incidents", []) or []
            # First goal: incidents are usually in reverse chronological order, so find the smallest 'time' goal
            goals = [i for i in incidents if i.get("incidentType") == "goal"]
            if goals:
                first = min(goals, key=lambda g: g.get("time", 9999))
                actuals["first_to_score"] = "home" if first.get("isHome") else "away"
                actuals["first_scorer"] = (first.get("player") or {}).get("name")
            else:
                actuals["first_to_score"] = None
            # Half-time
            ht = [i for i in incidents if i.get("incidentType") == "period" and i.get("text") == "HT"]
            if ht:
                hh = ht[0].get("homeScore", 0)
                aa = ht[0].get("awayScore", 0)
                actuals["ht_home"] = hh
                actuals["ht_away"] = aa
                if hh > aa: actuals["ht_winner"] = "home"
                elif aa > hh: actuals["ht_winner"] = "away"
                else: actuals["ht_winner"] = "draw"
    return True

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    enriched = 0
    skipped = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if time.time() - START > BUDGET:
                print("BUDGET reached, stopping.")
                STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
                print("enriched:", enriched, "skipped:", skipped)
                return
            if m.get("status") != "FT" or not m.get("id"): continue
            if "corners_total" in (m.get("actuals") or {}) and "first_to_score" in (m.get("actuals") or {}):
                skipped += 1; continue
            try:
                if enrich(m):
                    enriched += 1
                    print(" + " + str(m["home"]["name"]) + " vs " + str(m["away"]["name"]) + " corners=" + str(m.get("actuals", {}).get("corners_total")) + " first=" + str(m.get("actuals", {}).get("first_to_score")) + " ht=" + str(m.get("actuals", {}).get("ht_winner")))
                    # Save progress every 5 matches
                    if enriched % 5 == 0:
                        STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                print(" ! err:", e)
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("DONE - enriched:", enriched, "skipped:", skipped)

if __name__ == "__main__":
    main()
