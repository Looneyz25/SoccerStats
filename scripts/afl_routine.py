#!/usr/bin/env python3
"""AFL daily routine: settle finished matches + forecast 4-day window with Sportsbet markets."""
import json, time, datetime, pathlib, re
from curl_cffi import requests

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data_afl.json"
TODAY = datetime.date(2026, 4, 26)
DAYS = [TODAY + datetime.timedelta(days=i) for i in range(7)]
TODAY_STR = TODAY.isoformat()
BUDGET = 38; START = time.time()
ERRORS = []

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=12)
        if r.status_code != 200: return None
        return r.json()
    except Exception as e:
        ERRORS.append(f"{path}: {e}"); return None

def sleep(): time.sleep(0.1)

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception: return None

# --- Sportsbet AFL ---
def fetch_sb_round(round_slug):
    try:
        r = requests.get(f"https://www.sportsbet.com.au/betting/australian-rules/afl/{round_slug}", impersonate="chrome120", timeout=18)
        html = r.text
        s_idx = html.find('window.__PRELOADED_STATE__ = ')
        if s_idx == -1: return None
        s_idx += len('window.__PRELOADED_STATE__ = ')
        end = html.find('window.__APOLLO_STATE__', s_idx)
        return json.loads(html[s_idx:end].rstrip().rstrip(';').rstrip())
    except Exception as e:
        ERRORS.append(f"sb {round_slug}: {e}"); return None

def sb_decimal(num, den):
    return round(num / den + 1.0, 2)

def get_sb_index():
    """Walk a few rounds, return {(home_norm, away_norm): {markets...}}."""
    out = {}
    for slug in ['round-7','round-8','round-9','round-10','round-11','round-12','round-13','round-14','round-15']:
        data = fetch_sb_round(slug); time.sleep(0.4)
        if not data: continue
        sb = (data.get("entities") or {}).get("sportsbook") or {}
        for eid, ev in (sb.get("events") or {}).items():
            h = ev.get("participant1"); a = ev.get("participant2")
            if not h or not a: continue
            ts = (ev.get("startTime") or {}).get("milliseconds", 0)
            mks = {}
            for mid in ev.get("marketIds", []):
                mk = (sb.get("markets") or {}).get(str(mid))
                if not mk: continue
                mname = mk.get("name", "")
                cs = {}
                for oid in mk.get("outcomeIds", []):
                    oc = (sb.get("outcomes") or {}).get(str(oid))
                    if not oc: continue
                    wp = oc.get("winPrice") or {}
                    try: price = sb_decimal(wp["num"], wp["den"])
                    except: continue
                    cs[oc.get("name", "")] = price
                if cs: mks[mname] = cs
            out[(norm(h), norm(a))] = {"markets": mks, "ts": ts // 1000, "home": h, "away": a, "event_id": ev.get("id")}
    return out

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower()).replace('fc','').replace('afl','')

ABBREV = {
    'westernbulldogs': 'bulldogs', 'sydneyswans': 'swans', 'brisbanelions': 'lions',
    'gwsgiants': 'giants', 'hawthornhawks': 'hawks', 'collingwoodmagpies': 'magpies',
    'richmondtigers': 'tigers', 'carltonblues': 'blues', 'fremantledockers': 'dockers',
    'westcoasteagles': 'eagles', 'adelaidecrows': 'crows', 'portadelaide': 'power',
    'geelongcats': 'cats', 'melbournedemons': 'demons', 'stkildasaints': 'saints',
    'northmelbourne': 'kangaroos', 'goldcoast': 'suns', 'essendonbombers': 'bombers',
}
def names_match(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return False
    if a == b or a in b or b in a: return True
    for tok, exp in ABBREV.items():
        if tok in a and exp in b: return True
        if tok in b and exp in a: return True
    return False

def find_sb(idx, home, away):
    for (sh, sa), v in idx.items():
        if names_match(home, v["home"]) and names_match(away, v["away"]):
            return v
    return None

# --- Form ---
def fetch_form(team_id):
    data = fetch(f"/api/v1/team/{team_id}/events/last/0"); sleep()
    if not data: return None, None
    events = [ev for ev in (data.get("events", []) or []) if (ev.get("status") or {}).get("type") == "finished"][-6:]
    if len(events) < 3: return None, None
    sc = []; cd = []
    for ev in events:
        h = (ev.get("homeScore") or {}).get("current"); a = (ev.get("awayScore") or {}).get("current")
        if h is None or a is None: continue
        if (ev.get("homeTeam") or {}).get("id") == team_id:
            sc.append(h); cd.append(a)
        else:
            sc.append(a); cd.append(h)
    if not sc: return None, None
    return sum(sc)/len(sc), sum(cd)/len(cd)

# --- Streaks (h2h only for AFL) ---
def fetch_streaks(eid):
    data = fetch(f"/api/v1/event/{eid}/team-streaks"); sleep()
    if not data: return None
    h2h = []
    for it in data.get("general", []) or []:
        h2h.append({"team": it.get("team"), "label": it.get("name"), "value": str(it.get("value"))})
    return h2h or None

# --- Build/settle ---
def build_match(ev, sb_idx):
    eid = ev["id"]
    home = ev["homeTeam"]; away = ev["awayTeam"]
    ts = ev.get("startTimestamp")
    dt = datetime.datetime.utcfromtimestamp(ts) if ts else datetime.datetime.utcnow()
    rec = {
        "id": eid, "date": dt.strftime("%Y-%m-%d"), "time": dt.strftime("%H:%M"), "status": "upcoming",
        "home": {"name": home["name"], "short": home["name"], "team_id": home["id"]},
        "away": {"name": away["name"], "short": away["name"], "team_id": away["id"]},
    }
    # SofaScore Full time odds (winner)
    od = fetch(f"/api/v1/event/{eid}/odds/1/all"); sleep()
    if od:
        for mk in od.get("markets", []):
            if mk.get("marketName") == "Full time":
                cs = {}
                for ch in mk.get("choices", []):
                    p = parse_frac(ch.get("fractionalValue") or ch.get("value"))
                    if p is not None: cs[ch.get("name")] = p
                if "1" in cs and "2" in cs:
                    rec["odds"] = {"home": cs["1"], "away": cs["2"]}
    # Sportsbet odds + extra markets
    sb_hit = find_sb(sb_idx, home["name"], away["name"])
    if sb_hit:
        sm = sb_hit["markets"]
        h2h = sm.get("Head to Head") or {}
        if home["name"] in h2h or any(home["name"].split()[0] in k for k in h2h):
            # try matching keys
            home_key = next((k for k in h2h if names_match(k, home["name"])), None)
            away_key = next((k for k in h2h if names_match(k, away["name"])), None)
            if home_key and away_key:
                rec["sportsbet_odds"] = {"home": h2h[home_key], "away": h2h[away_key], "event_id": sb_hit["event_id"]}
        # Total points line
        tp = sm.get("Total Game Points - Over/Under") or sm.get("Total Game Points") or {}
        for k, v in tp.items():
            m = re.match(r'(Over|Under)\s+(\d+(?:\.\d)?)', k)
            if m:
                rec.setdefault("totals", {}).setdefault(m.group(2), {})[m.group(1)] = v
    # H2H streaks
    h2h = fetch_streaks(eid)
    if h2h: rec["h2h_streaks"] = h2h
    # Form-based win prob + total points pred
    h_sc, h_cd = fetch_form(home["id"]); a_sc, a_cd = fetch_form(away["id"])
    if h_sc and a_sc:
        # Estimated points for each side
        est_h = (h_sc + a_cd) / 2 + 5  # home ground advantage ~5 pts
        est_a = (a_sc + h_cd) / 2
        winner_pick = home["name"] if est_h > est_a else away["name"]
        winner_type = "home" if est_h > est_a else "away"
        total = est_h + est_a
        rec["predictions"] = {
            "winner": {"pick": winner_pick, "type": winner_type},
            "total_points": {"estimate": round(total, 1)},
        }
        # If totals market exists, snap to closest line
        if rec.get("totals"):
            lines = sorted(rec["totals"].keys(), key=lambda x: abs(float(x) - total))
            chosen_line = lines[0]
            o = rec["totals"][chosen_line]
            pick = "Over" if total > float(chosen_line) else "Under"
            rec["predictions"]["total_points"]["pick"] = pick
            rec["predictions"]["total_points"]["line"] = float(chosen_line)
            if pick in o: rec["predictions"]["total_points"]["odds"] = o[pick]
        # Attach winner odds
        if rec.get("sportsbet_odds"):
            rec["predictions"]["winner"]["odds"] = rec["sportsbet_odds"][winner_type]
        elif rec.get("odds"):
            rec["predictions"]["winner"]["odds"] = rec["odds"][winner_type]
    else:
        rec["predictions"] = {"winner": {"pick": home["name"], "type": "home"}}
    return rec

def settle_match(m):
    eid = m.get("id")
    if not eid: return False
    ev = fetch(f"/api/v1/event/{eid}"); sleep()
    if not ev or "event" not in ev: return False
    e = ev["event"]
    if (e.get("status") or {}).get("type") != "finished": return False
    hg = (e.get("homeScore") or {}).get("current"); ag = (e.get("awayScore") or {}).get("current")
    if hg is None or ag is None: return False
    m["home"]["points"] = hg; m["away"]["points"] = ag
    m["status"] = "FT"; m["time"] = "FT"; m["settled_at"] = TODAY_STR
    p = m.get("predictions") or {}
    actual = "home" if hg > ag else ("away" if ag > hg else "draw")
    if "winner" in p and "type" in p["winner"]:
        p["winner"]["result"] = "hit" if p["winner"]["type"] == actual else "miss"
    if "total_points" in p and "pick" in p["total_points"]:
        line = p["total_points"]["line"]; total = hg + ag
        p["total_points"]["actual"] = total
        p["total_points"]["result"] = "hit" if (p["total_points"]["pick"] == "Over" and total > line) or (p["total_points"]["pick"] == "Under" and total < line) else "miss"
    return True

# --- Main ---
def main():
    if STORE_PATH.exists():
        store = json.loads(STORE_PATH.read_text())
    else:
        store = {"captured_at": TODAY_STR, "sport": "afl", "source": "sofascore.com + sportsbet.com.au", "leagues": [{"name": "AFL", "season": "2026", "matches": []}]}

    afl = store["leagues"][0]
    existing_ids = {m.get("id") for m in afl["matches"] if m.get("id")}

    # PHASE A: settle
    settled = 0
    for m in afl["matches"]:
        if m.get("status") == "FT": continue
        if settle_match(m): settled += 1
        if time.time() - START > BUDGET: break

    # PHASE B: forecast - 4 day window
    print("Fetching Sportsbet AFL index...")
    sb_idx = get_sb_index()
    print(f"  SB index: {len(sb_idx)} events")
    new_count = 0
    for d in DAYS:
        if time.time() - START > BUDGET: break
        sched = fetch(f"/api/v1/sport/aussie-rules/scheduled-events/{d.isoformat()}"); sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            if ev.get("tournament", {}).get("name") != "AFL": continue
            if (ev.get("status") or {}).get("type") != "notstarted": continue
            eid = ev["id"]
            if eid in existing_ids: continue
            try:
                rec = build_match(ev, sb_idx)
                afl["matches"].append(rec); existing_ids.add(eid); new_count += 1
                print(f"  +AFL: {ev['homeTeam']['name']} vs {ev['awayTeam']['name']}")
            except Exception as e:
                ERRORS.append(f"build {eid}: {e}")
            if time.time() - START > BUDGET: break

    # Sort
    afl["matches"].sort(key=lambda m: (m.get("date",""), m.get("time","99:99")))
    store["captured_at"] = TODAY_STR
    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    print(f"=== AFL run: settled {settled}, new {new_count}, errors {len(ERRORS)}, total {len(afl['matches'])} matches")

if __name__ == "__main__":
    main()
