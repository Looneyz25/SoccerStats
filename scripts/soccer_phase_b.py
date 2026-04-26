#!/usr/bin/env python3
"""Phase B: forecast today + tomorrow. Saves progress after each match - resumable."""
import json, math, re, time, datetime, pathlib, sys
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data.json"
TODAY = datetime.date(2026, 4, 26)
TOMORROW = TODAY + datetime.timedelta(days=1)
TODAY_STR = TODAY.isoformat()
TOMORROW_STR = TOMORROW.isoformat()

# Time budget for this run (seconds). Save and exit when exceeded.
BUDGET = 38
START = time.time()

ERRORS = []
NEW_ADDED = []

COMP_RULES = [
    ("Premier League", "england", "premier league", None),
    ("LaLiga", "spain", "laliga", "laliga 2"),
    ("Serie A", "italy", "serie a", "femminile"),
    ("Bundesliga", "germany", "bundesliga", "2. bundesliga|frauen"),
    ("Ligue 1", "france", "ligue 1", None),
    ("UEFA Champions League", "europe", "uefa champions league", "women"),
    ("UEFA Europa League", "europe", "uefa europa league", "women"),
    ("UEFA Europa Conference League", "europe", "uefa conference league", "women"),
    ("MLS", "usa", "mls", "next pro"),
    ("Liga MX", "mexico", "liga mx", "expansion"),
    ("Eredivisie", "netherlands", "eredivisie", None),
    ("Eerste Divisie", "netherlands", "eerste divisie", None),
    ("Eerste Divisie", "netherlands", "keuken kampioen", None),
    ("Championship", "england", "championship", None),
]

LEAGUE_ORDER = [
    "Premier League", "LaLiga", "Serie A", "Bundesliga", "Ligue 1",
    "UEFA Champions League", "UEFA Europa League", "UEFA Europa Conference League",
    "MLS", "Liga MX", "Eredivisie", "Eerste Divisie", "Championship",
]

LEAGUE_IDS = {
    "Premier League": 17, "LaLiga": 8, "Serie A": 23, "Bundesliga": 35,
    "Ligue 1": 34, "UEFA Champions League": 7, "UEFA Europa League": 679,
    "UEFA Europa Conference League": 17015, "MLS": 242, "Liga MX": 11621,
    "Eredivisie": 37, "Eerste Divisie": 134, "Championship": 18,
}

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=12)
        if r.status_code == 404: return None
        if r.status_code != 200:
            ERRORS.append(path + " -> " + str(r.status_code))
            return None
        return r.json()
    except Exception as e:
        ERRORS.append(path + " -> " + type(e).__name__ + ": " + str(e))
        return None

def sleep(): time.sleep(0.08)

def classify_event(ev):
    t = ev.get("tournament", {}) or {}
    cat = t.get("category", {}) or {}
    name = (t.get("name") or "").lower()
    country = (cat.get("name") or "").lower()
    for canon, c_match, n_match, excl in COMP_RULES:
        if c_match in country and n_match in name:
            if excl and any(e and e in name for e in excl.split('|')): continue
            return canon
    return None

def get_or_make_league(store, name):
    for L in store["leagues"]:
        if L.get("name") == name: return L
    L = {"id": LEAGUE_IDS.get(name), "name": name, "season": "2025/26", "matches": []}
    store["leagues"].append(L)
    return L

def fetch_odds(event_id):
    data = fetch("/api/v1/event/" + str(event_id) + "/odds/1/all")
    sleep()
    if not data: return None
    for mk in data.get("markets", []):
        mname = (mk.get("marketName") or "").lower()
        if mk.get("marketId") == 1 or mname == "full time" or mname == "1x2":
            choices = mk.get("choices") or []
            out = {}
            for ch in choices:
                nm = ch.get("name", "")
                v = ch.get("fractionalValue") or ch.get("value")
                try:
                    if "/" in str(v):
                        a, b = str(v).split("/"); fv = float(a)/float(b) + 1.0
                    else:
                        fv = float(v)
                except Exception: continue
                if nm == "1": out["home"] = round(fv, 2)
                elif nm == "X": out["draw"] = round(fv, 2)
                elif nm == "2": out["away"] = round(fv, 2)
            if out: return out
    return None

def fetch_streaks(event_id):
    data = fetch("/api/v1/event/" + str(event_id) + "/team-streaks")
    sleep()
    if not data: return None, None
    h2h = []
    for it in data.get("general", []) or []:
        h2h.append({"team": it.get("team"), "label": it.get("name"), "value": str(it.get("value"))})
    teams = []
    for it in (data.get("home", []) or []):
        teams.append({"team": "home", "label": it.get("name"), "value": str(it.get("value"))})
    for it in (data.get("away", []) or []):
        teams.append({"team": "away", "label": it.get("name"), "value": str(it.get("value"))})
    return (h2h or None), (teams or None)

def fetch_form(team_id):
    data = fetch("/api/v1/team/" + str(team_id) + "/events/last/0")
    sleep()
    if not data: return 1.40, 1.40
    events = data.get("events", []) or []
    completed = [ev for ev in events if (ev.get("status") or {}).get("type") == "finished"][-6:]
    if len(completed) < 3: return 1.40, 1.40
    scored = []; conceded = []
    for ev in completed:
        h = (ev.get("homeScore") or {}).get("current")
        a = (ev.get("awayScore") or {}).get("current")
        if h is None or a is None: continue
        if (ev.get("homeTeam") or {}).get("id") == team_id:
            scored.append(h); conceded.append(a)
        else:
            scored.append(a); conceded.append(h)
    if not scored: return 1.40, 1.40
    return sum(scored)/len(scored), sum(conceded)/len(conceded)

def poisson_pmf(k, lam):
    return math.exp(-lam) * (lam ** k) / math.factorial(k)

def predict(home_att, home_def, away_att, away_def, team_streaks, home_name, away_name):
    lam_h = max(0.20, (home_att + away_def) / 2 + 0.20)
    lam_a = max(0.20, (away_att + home_def) / 2 - 0.05)
    p_home = p_draw = p_away = 0.0
    p_total = {i: 0.0 for i in range(13)}
    for hg in range(7):
        for ag in range(7):
            p = poisson_pmf(hg, lam_h) * poisson_pmf(ag, lam_a)
            if hg > ag: p_home += p
            elif hg < ag: p_away += p
            else: p_draw += p
            p_total[hg + ag] += p
    btts_yes = (1 - math.exp(-lam_h)) * (1 - math.exp(-lam_a))
    p_over_25 = sum(v for k, v in p_total.items() if k > 2)
    if p_home >= p_draw and p_home >= p_away:
        winner = {"pick": home_name, "type": "home"}
    elif p_away >= p_draw:
        winner = {"pick": away_name, "type": "away"}
    else:
        winner = {"pick": "Draw", "type": "draw"}
    btts = {"pick": "Yes" if btts_yes >= 0.50 else "No"}
    ou_goals = {"pick": "Over" if p_over_25 >= 0.55 else "Under", "line": 2.5}
    over_cards = under_cards = 0
    for s in (team_streaks or []):
        lab = (s.get("label") or "").lower()
        if "more than 4.5 cards" in lab: over_cards += 1
        if "less than 4.5 cards" in lab: under_cards += 1
    if over_cards > under_cards:
        ou_cards = {"pick": "Over", "line": 4.5}
    elif under_cards > over_cards:
        ou_cards = {"pick": "Under", "line": 4.5}
    else:
        ou_cards = {"pick": "Over", "line": 4.5}
    return {"winner": winner, "btts": btts, "ou_goals": ou_goals, "ou_cards": ou_cards}

def short_name(name):
    if not name: return name
    s = name.replace("FC ", "").replace(" FC", "")
    if len(s) <= 14: return s
    parts = s.split()
    return parts[0] if parts else s[:14]

def build_match_record(ev):
    eid = ev.get("id")
    home = ev.get("homeTeam") or {}
    away = ev.get("awayTeam") or {}
    ts = ev.get("startTimestamp")
    if ts:
        dt = datetime.datetime.utcfromtimestamp(ts)
        date_str = dt.strftime("%Y-%m-%d")
        time_str = dt.strftime("%H:%M")
    else:
        date_str = TODAY_STR; time_str = "TBD"
    rec = {
        "id": eid, "date": date_str, "time": time_str, "status": "upcoming",
        "home": {"name": home.get("name"), "short": short_name(home.get("name")), "team_id": home.get("id")},
        "away": {"name": away.get("name"), "short": short_name(away.get("name")), "team_id": away.get("id")},
    }
    odds = fetch_odds(eid)
    if odds: rec["odds"] = odds
    h2h, streaks = fetch_streaks(eid)
    if h2h: rec["h2h_streaks"] = h2h
    if streaks: rec["team_streaks"] = streaks
    home_att, home_def = fetch_form(home.get("id"))
    away_att, away_def = fetch_form(away.get("id"))
    rec["predictions"] = predict(home_att, home_def, away_att, away_def, streaks, home.get("name"), away.get("name"))
    return rec

def save_store(store):
    for L in store["leagues"]:
        L["matches"].sort(key=lambda m: (m.get("date",""), m.get("time","99:99")))
    rank = {n: i for i, n in enumerate(LEAGUE_ORDER)}
    store["leagues"].sort(key=lambda L: rank.get(L.get("name"), 999))
    store["captured_at"] = TODAY_STR
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    existing_ids = set()
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("id"): existing_ids.add(m["id"])
    print("existing ids:", len(existing_ids))
    candidates = []
    seen = set()
    for d in [(TODAY + datetime.timedelta(days=i)).isoformat() for i in range(7)]:
        sched = fetch("/api/v1/sport/football/scheduled-events/" + d)
        sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            eid = ev.get("id")
            if not eid or eid in existing_ids or eid in seen: continue
            status_type = (ev.get("status") or {}).get("type")
            if status_type != "notstarted": continue
            league_name = classify_event(ev)
            if not league_name: continue
            seen.add(eid)
            candidates.append((league_name, ev))
    print("candidates:", len(candidates))
    new_count = 0
    for league_name, ev in candidates[:200]:
        if time.time() - START > BUDGET:
            print("BUDGET EXCEEDED - saving and exiting (more candidates remain)")
            break
        try:
            rec = build_match_record(ev)
            L = get_or_make_league(store, league_name)
            L["matches"].append(rec)
            existing_ids.add(ev.get("id"))
            new_count += 1
            print("  +" + league_name + ": " + rec["home"]["name"] + " vs " + rec["away"]["name"])
            # Save after each match for resumability
            save_store(store)
        except Exception as e:
            ERRORS.append("build " + str(ev.get("id")) + ": " + str(e))
    save_store(store)
    snap = FOLDER / ("predictions_" + TODAY_STR + ".json")
    snap.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print("=== NEW added this run: " + str(new_count) + " | Errors: " + str(len(ERRORS)))
    for e in ERRORS[:10]: print(" - " + e)

if __name__ == "__main__":
    main()
