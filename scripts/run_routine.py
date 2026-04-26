#!/usr/bin/env python3
"""Consolidated daily routine for Looneyz Predictions.

Runs in GitHub Actions (or any plain Python environment). Does:
  1) Soccer Phase A: settle finished matches + enrich actuals
  2) Soccer Phase B: forecast next 7 days (cap ~250 new candidates)
  3) Sportsbet odds refresh + per-streak odds + per-prediction odds
  4) AFL Phase A: settle + Phase B: forecast 7 days
  5) AFL player picks (1st goal / anytime / predicted goals / disposals / X-factor)
  6) Update DATA constants in index.html
  7) Write predictions_{TODAY}.json snapshot

No LLM. Pure deterministic Python. Free to run on GitHub Actions.
"""
import json, math, re, time, datetime, pathlib, sys, traceback
from collections import defaultdict

try:
    from curl_cffi import requests
except ImportError:
    print("Install: pip install curl_cffi"); sys.exit(1)

# ---- Paths (resolved relative to repo root, regardless of cwd) ----
REPO = pathlib.Path(__file__).resolve().parent.parent
SOCCER_PATH = REPO / "match_data.json"
AFL_PATH = REPO / "match_data_afl.json"
DASHBOARD = REPO / "index.html"

TODAY = datetime.date.today()
TODAY_STR = TODAY.isoformat()
DAYS = [(TODAY + datetime.timedelta(days=i)).isoformat() for i in range(7)]

ERRORS = []

def log(msg): print(msg, flush=True)
try:
    from zoneinfo import ZoneInfo
    ADL = ZoneInfo("Australia/Adelaide")
except ImportError:
    ADL = None

def to_adl_str(date_str, time_str):
    """Convert UTC date+time to Adelaide HH:MM string."""
    if not date_str or not time_str or time_str == "FT" or ADL is None: return time_str or ""
    try:
        dt = datetime.datetime.strptime(date_str + " " + time_str, "%Y-%m-%d %H:%M")
        dt = dt.replace(tzinfo=datetime.timezone.utc).astimezone(ADL)
        return dt.strftime("%H:%M")
    except Exception:
        return time_str

def to_adl_date(date_str, time_str):
    """Convert UTC date+time to Adelaide YYYY-MM-DD string (may shift day)."""
    if not date_str or not time_str or time_str == "FT" or ADL is None: return date_str
    try:
        dt = datetime.datetime.strptime(date_str + " " + time_str, "%Y-%m-%d %H:%M")
        dt = dt.replace(tzinfo=datetime.timezone.utc).astimezone(ADL)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return date_str



def fetch(path, retries=2):
    for attempt in range(retries):
        try:
            r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=20)
            if r.status_code == 404: return None
            if r.status_code != 200:
                if attempt == retries - 1:
                    ERRORS.append(f"{path} -> {r.status_code}"); return None
                time.sleep(1); continue
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                ERRORS.append(f"{path}: {type(e).__name__}: {e}")
            time.sleep(1)
    return None

def sleep(): time.sleep(0.1)

def parse_frac(s):
    try:
        s = str(s)
        if "/" in s:
            a, b = s.split("/"); return round(float(a)/float(b) + 1.0, 2)
        return round(float(s), 2)
    except Exception: return None

# ============================================================
# SOCCER
# ============================================================

COMP_RULES = [
    ("Premier League", "england", "premier league", "u21|u23|women"),
    ("LaLiga", "spain", "laliga", "laliga 2"),
    ("Serie A", "italy", "serie a", "femminile"),
    ("Bundesliga", "germany", "bundesliga", "2. bundesliga|frauen"),
    ("Ligue 1", "france", "ligue 1", "feminine"),
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
LEAGUE_ORDER = ["Premier League","LaLiga","Serie A","Bundesliga","Ligue 1",
                "UEFA Champions League","UEFA Europa League","UEFA Europa Conference League",
                "MLS","Liga MX","Eredivisie","Eerste Divisie","Championship"]
LEAGUE_IDS = {"Premier League":17,"LaLiga":8,"Serie A":23,"Bundesliga":35,"Ligue 1":34,
              "UEFA Champions League":7,"UEFA Europa League":679,"UEFA Europa Conference League":17015,
              "MLS":242,"Liga MX":11621,"Eredivisie":37,"Eerste Divisie":134,"Championship":18}

ABBREV = {
    "wolves":"wolverhampton","wolverhampton":"wolves","manutd":"manchesterunited",
    "manchesterunited":"manutd","manunited":"manchesterunited","mancity":"manchestercity",
    "manchestercity":"mancity","spurs":"tottenham","forest":"nottinghamforest",
    "nottinghamforest":"forest","hsv":"hamburger","hamburger":"hsv",
    "sheffwed":"sheffieldwednesday","sheffieldwednesday":"sheffwed","boro":"middlesbrough",
    "oxford":"oxfordunited","atlmadrid":"atleticomadrid","atleticomadrid":"atlmadrid",
    "athletic":"athleticclub","leverkusen":"bayerleverkusen","bayern":"bayernmunich",
    "leipzig":"rbleipzig","frankfurt":"eintrachtfrankfurt","gladbach":"borussiamonchengladbach",
    "mgladbach":"borussiamonchengladbach","stpauli":"saintpauli","psg":"parissaintgermain",
    "betis":"realbetis","sociedad":"realsociedad","atletico":"atleticomadrid",
    "stuttgart":"vfbstuttgart","bremen":"werderbremen","hoffenheim":"tsghoffenheim",
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

def classify(ev):
    t = ev.get("tournament", {}) or {}
    nm = (t.get("name") or "").lower()
    cn = (t.get("category", {}) or {}).get("name", "").lower()
    for canon, c, n, excl in COMP_RULES:
        if c in cn and n in nm:
            if excl and any(e and e in nm for e in excl.split('|')): continue
            return canon
    return None

def lookup_event(m):
    if m.get("id"):
        d = fetch(f"/api/v1/event/{m['id']}"); sleep()
        if d and "event" in d: return d["event"]
    if not m.get("date"): return None
    base = datetime.date.fromisoformat(m["date"])
    home = m.get("home", {}).get("name", ""); away = m.get("away", {}).get("name", "")
    hid = m.get("home", {}).get("team_id"); aid = m.get("away", {}).get("team_id")
    for delta in (0, -1, 1):
        d = (base + datetime.timedelta(days=delta)).isoformat()
        sched = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            eh = (ev.get("homeTeam") or {}).get("name", "")
            ea = (ev.get("awayTeam") or {}).get("name", "")
            ehid = (ev.get("homeTeam") or {}).get("id")
            eaid = (ev.get("awayTeam") or {}).get("id")
            if hid and aid and ehid == hid and eaid == aid: return ev
            if names_match(home, eh) and names_match(away, ea): return ev
    return None

def fetch_card_count(eid):
    s = fetch(f"/api/v1/event/{eid}/statistics"); sleep()
    if not s: return None
    yel = red = 0; found = False
    for period in s.get("statistics", []):
        if period.get("period") != "ALL": continue
        for grp in period.get("groups", []):
            for it in grp.get("statisticsItems", []):
                nm = (it.get("name") or "").lower()
                if "yellow card" in nm and "second" not in nm:
                    try: yel += int(it.get("home", 0)) + int(it.get("away", 0)); found = True
                    except: pass
                elif "red card" in nm:
                    try: red += int(it.get("home", 0)) + int(it.get("away", 0)); found = True
                    except: pass
    return (yel + red) if found else None

def enrich_actuals(eid):
    out = {}
    s = fetch(f"/api/v1/event/{eid}/statistics"); sleep()
    if s:
        for period in s.get("statistics", []):
            if period.get("period") != "ALL": continue
            for grp in period.get("groups", []):
                for it in grp.get("statisticsItems", []):
                    k = it.get("key")
                    try: h = int(it.get("home", 0)); a = int(it.get("away", 0))
                    except: continue
                    if k == "cornerKicks":
                        out["home_corners"] = h; out["away_corners"] = a; out["corners_total"] = h + a
                    elif k == "fouls":
                        out["home_fouls"] = h; out["away_fouls"] = a; out["fouls_total"] = h + a
                    elif k == "shotsOnGoal":
                        out["home_sot"] = h; out["away_sot"] = a
    inc = fetch(f"/api/v1/event/{eid}/incidents"); sleep()
    if inc:
        goals = [i for i in inc.get("incidents", []) if i.get("incidentType") == "goal"]
        if goals:
            first = min(goals, key=lambda g: g.get("time", 9999))
            out["first_to_score"] = "home" if first.get("isHome") else "away"
            out["first_scorer"] = (first.get("player") or {}).get("name")
        else:
            out["first_to_score"] = None
        ht = [i for i in inc.get("incidents", []) if i.get("incidentType") == "period" and i.get("text") == "HT"]
        if ht:
            hh, aa = ht[0].get("homeScore", 0), ht[0].get("awayScore", 0)
            out["ht_home"] = hh; out["ht_away"] = aa
            out["ht_winner"] = "home" if hh > aa else ("away" if aa > hh else "draw")
    return out

def settle_match(m):
    ev = lookup_event(m)
    if not ev: return None
    if (ev.get("status") or {}).get("type") != "finished": return None
    eid = ev.get("id")
    hg = (ev.get("homeScore") or {}).get("current")
    ag = (ev.get("awayScore") or {}).get("current")
    if hg is None or ag is None: return None
    m["home"]["goals"] = hg; m["away"]["goals"] = ag
    m["status"] = "FT"; m["time"] = "FT"
    if eid: m["id"] = eid
    m["settled_at"] = TODAY_STR
    p = m.setdefault("predictions", {})
    actual = "home" if hg>ag else ("away" if ag>hg else "draw")
    if (p.get("winner") or {}).get("type"):
        p["winner"]["result"] = "hit" if p["winner"]["type"] == actual else "miss"
    btts_actual = (hg > 0 and ag > 0)
    if (p.get("btts") or {}).get("pick"):
        p["btts"]["actual_btts"] = btts_actual
        p["btts"]["result"] = "hit" if (p["btts"]["pick"].lower() == ("yes" if btts_actual else "no")) else "miss"
    total = hg + ag
    if (p.get("ou_goals") or {}).get("pick"):
        line = p["ou_goals"].get("line", 2.5)
        p["ou_goals"]["actual"] = total
        p["ou_goals"]["result"] = "hit" if ((p["ou_goals"]["pick"]=="Over" and total>line) or (p["ou_goals"]["pick"]=="Under" and total<line)) else "miss"
    if (p.get("ou_cards") or {}).get("pick") and eid:
        cards = fetch_card_count(eid)
        if cards is not None:
            line = p["ou_cards"].get("line", 4.5)
            p["ou_cards"]["actual"] = cards
            p["ou_cards"]["result"] = "hit" if ((p["ou_cards"]["pick"]=="Over" and cards>line) or (p["ou_cards"]["pick"]=="Under" and cards<line)) else "miss"
        else:
            p["ou_cards"]["result"] = "pending"
    if eid:
        m["actuals"] = enrich_actuals(eid)
    return m

# Soccer prediction: Poisson model
def poisson_pmf(k, lam): return math.exp(-lam) * (lam ** k) / math.factorial(k)

def fetch_form(team_id):
    d = fetch(f"/api/v1/team/{team_id}/events/last/0"); sleep()
    if not d: return 1.40, 1.40
    completed = [e for e in d.get("events", []) if (e.get("status") or {}).get("type") == "finished"][-6:]
    if len(completed) < 3: return 1.40, 1.40
    sc, cd = [], []
    for ev in completed:
        h = (ev.get("homeScore") or {}).get("current"); a = (ev.get("awayScore") or {}).get("current")
        if h is None or a is None: continue
        if (ev.get("homeTeam") or {}).get("id") == team_id: sc.append(h); cd.append(a)
        else: sc.append(a); cd.append(h)
    if not sc: return 1.40, 1.40
    return sum(sc)/len(sc), sum(cd)/len(cd)

def predict_soccer(h_att, h_def, a_att, a_def, streaks, h_name, a_name):
    lam_h = max(0.20, (h_att + a_def)/2 + 0.20)
    lam_a = max(0.20, (a_att + h_def)/2 - 0.05)
    p_home = p_draw = p_away = 0.0
    p_total = {i: 0.0 for i in range(13)}
    for hg in range(7):
        for ag in range(7):
            p = poisson_pmf(hg, lam_h) * poisson_pmf(ag, lam_a)
            if hg>ag: p_home += p
            elif hg<ag: p_away += p
            else: p_draw += p
            p_total[hg+ag] += p
    btts_yes = (1-math.exp(-lam_h)) * (1-math.exp(-lam_a))
    p_over_25 = sum(v for k,v in p_total.items() if k>2)
    if p_home >= p_draw and p_home >= p_away: w = {"pick": h_name, "type": "home"}
    elif p_away >= p_draw: w = {"pick": a_name, "type": "away"}
    else: w = {"pick": "Draw", "type": "draw"}
    btts = {"pick": "Yes" if btts_yes >= 0.5 else "No"}
    og = {"pick": "Over" if p_over_25 >= 0.55 else "Under", "line": 2.5}
    over_c = under_c = 0
    for s in (streaks or []):
        lab = (s.get("label") or "").lower()
        if "more than 4.5 cards" in lab: over_c += 1
        if "less than 4.5 cards" in lab: under_c += 1
    oc = {"pick": "Over" if over_c >= under_c else "Under", "line": 4.5}
    return {"winner": w, "btts": btts, "ou_goals": og, "ou_cards": oc}

def fetch_odds_full(eid):
    """Returns {market_key: {choice: decimal}}"""
    d = fetch(f"/api/v1/event/{eid}/odds/1/all"); sleep()
    if not d: return {}
    out = {}
    for mk in d.get("markets", []):
        nm = mk.get("marketName", "")
        cg = mk.get("choiceGroup")
        key = nm if cg is None else (nm + " " + str(cg))
        cs = {}
        for ch in mk.get("choices", []):
            v = parse_frac(ch.get("fractionalValue") or ch.get("value"))
            if v is not None: cs[ch.get("name", "")] = v
        if cs: out[key] = cs
    return out

def fetch_streaks(eid):
    d = fetch(f"/api/v1/event/{eid}/team-streaks"); sleep()
    if not d: return None, None
    h2h = [{"team": it.get("team"), "label": it.get("name"), "value": str(it.get("value"))} for it in (d.get("general") or [])]
    teams = [{"team": "home", "label": it.get("name"), "value": str(it.get("value"))} for it in (d.get("home") or [])]
    teams += [{"team": "away", "label": it.get("name"), "value": str(it.get("value"))} for it in (d.get("away") or [])]
    return (h2h or None), (teams or None)

def short_name(name):
    if not name: return name
    s = name.replace("FC ", "").replace(" FC", "")
    if len(s) <= 14: return s
    return s.split()[0] if s.split() else s[:14]

def get_streak_odds(label, who, mo, h_name, a_name):
    lab = (label or "").lower()
    g = lambda k, c: (mo.get(k) or {}).get(c)
    def any_line(prefix, choice):
        for k, v in mo.items():
            if k.startswith(prefix + " ") and choice in v: return v[choice]
        return None
    is_more = ("over" in lab or "more than" in lab) and "goals" in lab
    is_less = ("under" in lab or "less than" in lab) and "goals" in lab
    for line in ("0.5","1.5","2.5","3.5","4.5","5.5"):
        if line in lab:
            if is_more: return g(f"Match goals {line}", "Over")
            if is_less: return g(f"Match goals {line}", "Under")
    if "both teams to score" in lab or "both teams scoring" in lab: return g("Both teams to score", "Yes")
    if "no clean sheet" in lab or "without clean sheet" in lab: return g("Both teams to score", "Yes")
    if lab == "clean sheet" or "no goals conceded" in lab: return g("Both teams to score", "No")
    if lab == "wins": return g("Full time", "1" if who=="home" else "2") if who in ("home","away") else None
    if lab == "losses": return g("Full time", "2" if who=="home" else "1") if who in ("home","away") else None
    if lab == "no losses": return g("Double chance", "1X" if who=="home" else "X2") if who in ("home","away") else None
    if lab == "no wins": return g("Double chance", "X2" if who=="home" else "1X") if who in ("home","away") else None
    if lab == "draws": return g("Full time", "X")
    if lab == "no draws": return g("Double chance", "12")
    is_card_more = "cards" in lab and ("over" in lab or "more than" in lab)
    is_card_less = "cards" in lab and ("under" in lab or "less than" in lab)
    for line in ("2.5","3.5","4.5","5.5","6.5"):
        if line in lab:
            if is_card_more: return g(f"Cards in match {line}", "Over") or any_line("Cards in match", "Over")
            if is_card_less: return g(f"Cards in match {line}", "Under") or any_line("Cards in match", "Under")
    is_corn_more = "corners" in lab and ("over" in lab or "more than" in lab)
    is_corn_less = "corners" in lab and ("under" in lab or "less than" in lab)
    for line in ("7.5","8.5","9.5","10.5","11.5","12.5"):
        if line in lab:
            if is_corn_more: return g(f"Corners 2-Way {line}", "Over") or any_line("Corners 2-Way", "Over")
            if is_corn_less: return g(f"Corners 2-Way {line}", "Under") or any_line("Corners 2-Way", "Under")
    if "first to score" in lab:
        return g("First team to score", h_name if who=="home" else a_name) if who in ("home","away") else None
    if "first to concede" in lab:
        return g("First team to score", a_name if who=="home" else h_name) if who in ("home","away") else None
    if "first half winner" in lab:
        return g("1st half", "1" if who=="home" else "2") if who in ("home","away") else None
    if "first half loser" in lab:
        return g("1st half", "2" if who=="home" else "1") if who in ("home","away") else None
    return None

def attach_pred_odds(m, mo):
    p = m.get("predictions", {})
    sb = m.get("sportsbet_odds") or {}
    w = p.get("winner") or {}
    if w.get("type") and w.get("odds") is None:
        wt = w["type"]
        if sb.get(wt): w["odds"] = sb[wt]
        else:
            full = mo.get("Full time", {})
            key = "1" if wt=="home" else ("X" if wt=="draw" else "2")
            if key in full: w["odds"] = full[key]
    og = p.get("ou_goals") or {}
    if og.get("pick") and og.get("odds") is None:
        line = str(og.get("line", 2.5))
        v = (mo.get(f"Match goals {line}") or {}).get("Over" if og["pick"]=="Over" else "Under")
        if v: og["odds"] = v
    b = p.get("btts") or {}
    if b.get("pick") and b.get("odds") is None:
        v = (mo.get("Both teams to score") or {}).get(b["pick"])
        if v: b["odds"] = v
    oc = p.get("ou_cards") or {}
    if oc.get("pick") and oc.get("odds") is None:
        line = str(oc.get("line", 4.5))
        v = (mo.get(f"Cards in match {line}") or {}).get("Over" if oc["pick"]=="Over" else "Under")
        if not v:
            for k, vv in mo.items():
                if k.startswith("Cards in match ") and ("Over" if oc["pick"]=="Over" else "Under") in vv:
                    v = vv["Over" if oc["pick"]=="Over" else "Under"]; break
        if v: oc["odds"] = v

# Sportsbet
SB_PAGES = {
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
def fetch_sb_page(slug):
    try:
        r = requests.get(f"https://www.sportsbet.com.au/betting/soccer/{slug}", impersonate="chrome120", timeout=20)
        if r.status_code != 200: return None
        h = r.text
        s = h.find('window.__PRELOADED_STATE__ = ') + len('window.__PRELOADED_STATE__ = ')
        e = h.find('window.__APOLLO_STATE__', s)
        return json.loads(h[s:e].rstrip().rstrip(';').rstrip())
    except Exception as ex:
        ERRORS.append(f"sb {slug}: {ex}"); return None

def sb_extract(data):
    out = {}
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    for ev in (sb.get("events") or {}).values():
        h = ev.get("participant1"); a = ev.get("participant2")
        if not h or not a: continue
        wdw = None
        for mid in ev.get("marketIds", []):
            mk = (sb.get("markets") or {}).get(str(mid))
            if mk and mk.get("name") in ("Win-Draw-Win", "Match Result", "1X2"):
                wdw = mk; break
        if not wdw: continue
        odds = {}
        for oid in wdw.get("outcomeIds", []):
            oc = (sb.get("outcomes") or {}).get(str(oid))
            if not oc: continue
            wp = oc.get("winPrice") or {}
            try: price = round(wp["num"]/wp["den"] + 1.0, 2)
            except: continue
            rt = oc.get("resultType") or ""
            if rt == "H": odds["home"] = price
            elif rt == "D": odds["draw"] = price
            elif rt == "A": odds["away"] = price
        if "home" in odds and "draw" in odds and "away" in odds:
            out[(norm(h), norm(a))] = {**odds, "event_id": ev.get("id"), "home_name": h, "away_name": a}
    return out

def soccer_routine():
    log("=== SOCCER ROUTINE ===")
    if SOCCER_PATH.exists():
        store = json.loads(SOCCER_PATH.read_text())
    else:
        store = {"captured_at": TODAY_STR, "sport": "soccer", "source": "sofascore.com + sportsbet.com.au", "leagues": []}

    # PHASE A: settle
    settled = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") == "FT":
                # Re-attempt pending cards if id available
                oc = (m.get("predictions") or {}).get("ou_cards") or {}
                if oc.get("result") == "pending" and m.get("id"):
                    cards = fetch_card_count(m["id"])
                    if cards is not None:
                        line = oc.get("line", 4.5)
                        oc["actual"] = cards
                        oc["result"] = "hit" if ((oc["pick"]=="Over" and cards>line) or (oc["pick"]=="Under" and cards<line)) else "miss"
                continue
            try:
                mdate = datetime.date.fromisoformat(m.get("date", ""))
                if (TODAY - mdate).days > 14: continue
            except: pass
            try:
                if settle_match(m): settled += 1
            except Exception as e:
                ERRORS.append(f"settle {m.get('home',{}).get('name')}: {e}")
    log(f"  Settled: {settled}")

    # PHASE B: forecast
    existing = {m["id"] for L in store["leagues"] for m in L["matches"] if m.get("id")}
    candidates = []; seen = set()
    for d in DAYS:
        sched = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            eid = ev.get("id")
            if not eid or eid in existing or eid in seen: continue
            if (ev.get("status") or {}).get("type") != "notstarted": continue
            league_name = classify(ev)
            if not league_name: continue
            seen.add(eid)
            candidates.append((league_name, ev))
    log(f"  Candidates: {len(candidates)}")

    new_count = 0
    for league_name, ev in candidates[:250]:
        try:
            eid = ev["id"]
            home = ev["homeTeam"]; away = ev["awayTeam"]
            ts = ev.get("startTimestamp")
            dt = datetime.datetime.utcfromtimestamp(ts) if ts else datetime.datetime.utcnow()
            rec = {"id": eid, "date": dt.strftime("%Y-%m-%d"), "time": dt.strftime("%H:%M"), "status": "upcoming",
                   "home": {"name": home["name"], "short": short_name(home["name"]), "team_id": home["id"]},
                   "away": {"name": away["name"], "short": short_name(away["name"]), "team_id": away["id"]}}
            mo = fetch_odds_full(eid)
            full = mo.get("Full time", {})
            if "1" in full and "X" in full and "2" in full:
                rec["odds"] = {"home": full["1"], "draw": full["X"], "away": full["2"]}
            h2h, ts_streaks = fetch_streaks(eid)
            if h2h: rec["h2h_streaks"] = h2h
            if ts_streaks: rec["team_streaks"] = ts_streaks
            for s in (rec.get("h2h_streaks", []) + rec.get("team_streaks", [])):
                o = get_streak_odds(s.get("label"), s.get("team","both"), mo, home["name"], away["name"])
                if o is not None: s["odds"] = o
            h_att, h_def = fetch_form(home["id"])
            a_att, a_def = fetch_form(away["id"])
            rec["predictions"] = predict_soccer(h_att, h_def, a_att, a_def, ts_streaks, home["name"], away["name"])
            attach_pred_odds(rec, mo)
            L = next((L for L in store["leagues"] if L["name"] == league_name), None)
            if not L:
                L = {"id": LEAGUE_IDS.get(league_name), "name": league_name, "season": "2025/26", "matches": []}
                store["leagues"].append(L)
            L["matches"].append(rec); existing.add(eid); new_count += 1
        except Exception as e:
            ERRORS.append(f"build {ev.get('id')}: {e}")
    log(f"  New added: {new_count}")

    # Sportsbet
    cache = {}
    sb_matched = 0
    for L in store["leagues"]:
        slug = SB_PAGES.get(L["name"])
        if not slug: continue
        if slug not in cache:
            data = fetch_sb_page(slug)
            cache[slug] = sb_extract(data) if data else {}
            time.sleep(0.4)
        idx = cache[slug]
        for m in L["matches"]:
            for (sh, sa), v in idx.items():
                if names_match(m["home"]["name"], v["home_name"]) and names_match(m["away"]["name"], v["away_name"]):
                    m["sportsbet_odds"] = {"home": v["home"], "draw": v["draw"], "away": v["away"], "event_id": v["event_id"]}
                    # Re-attach winner odds preferring sportsbet
                    w = (m.get("predictions") or {}).get("winner") or {}
                    if w.get("type") and v.get(w["type"]):
                        w["odds"] = v[w["type"]]
                    sb_matched += 1; break
    log(f"  Sportsbet matched: {sb_matched}")

    # Sort + save
    rank = {n: i for i, n in enumerate(LEAGUE_ORDER)}
    store["leagues"].sort(key=lambda L: rank.get(L.get("name"), 999))
    for L in store["leagues"]:
        L["matches"].sort(key=lambda m: (m.get("date",""), m.get("time","99:99")))
    store["captured_at"] = TODAY_STR
    SOCCER_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    return store

# ============================================================
# AFL
# ============================================================

AFL_ABBREV = {
    'westernbulldogs':'bulldogs','sydneyswans':'swans','brisbanelions':'lions',
    'gwsgiants':'giants','hawthornhawks':'hawks','collingwoodmagpies':'magpies',
    'richmondtigers':'tigers','carltonblues':'blues','fremantledockers':'dockers',
    'westcoasteagles':'eagles','adelaidecrows':'crows','portadelaide':'power',
    'geelongcats':'cats','melbournedemons':'demons','stkildasaints':'saints',
    'northmelbourne':'kangaroos','goldcoast':'suns','essendonbombers':'bombers',
}
def afl_norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower()).replace('fc','').replace('afl','')
def afl_match(a, b):
    a, b = afl_norm(a), afl_norm(b)
    if not a or not b: return False
    if a == b or a in b or b in a: return True
    for tok, exp in AFL_ABBREV.items():
        if tok in a and exp in b: return True
        if tok in b and exp in a: return True
    return False

def fetch_sb_afl_round(slug):
    try:
        r = requests.get(f"https://www.sportsbet.com.au/betting/australian-rules/afl/{slug}", impersonate="chrome120", timeout=18)
        if r.status_code != 200: return None
        h = r.text
        s = h.find('window.__PRELOADED_STATE__ = ') + len('window.__PRELOADED_STATE__ = ')
        e = h.find('window.__APOLLO_STATE__', s)
        return json.loads(h[s:e].rstrip().rstrip(';').rstrip())
    except: return None

def afl_routine():
    log("=== AFL ROUTINE ===")
    if AFL_PATH.exists():
        store = json.loads(AFL_PATH.read_text())
    else:
        store = {"captured_at": TODAY_STR, "sport": "afl", "source": "sofascore.com + sportsbet.com.au",
                 "leagues": [{"name": "AFL", "season": "2026", "matches": []}]}

    afl = store["leagues"][0]
    existing = {m["id"] for m in afl["matches"] if m.get("id")}

    # Settle
    settled = 0
    for m in afl["matches"]:
        if m.get("status") == "FT": continue
        if not m.get("id"): continue
        ev = fetch(f"/api/v1/event/{m['id']}"); sleep()
        if not ev or "event" not in ev: continue
        e = ev["event"]
        if (e.get("status") or {}).get("type") != "finished": continue
        hg = (e.get("homeScore") or {}).get("current"); ag = (e.get("awayScore") or {}).get("current")
        if hg is None or ag is None: continue
        m["home"]["points"] = hg; m["away"]["points"] = ag
        m["status"] = "FT"; m["time"] = "FT"; m["settled_at"] = TODAY_STR
        p = m.get("predictions") or {}
        actual = "home" if hg>ag else ("away" if ag>hg else "draw")
        if (p.get("winner") or {}).get("type"):
            p["winner"]["result"] = "hit" if p["winner"]["type"] == actual else "miss"
        if (p.get("total_points") or {}).get("pick"):
            line = p["total_points"]["line"]; total = hg + ag
            p["total_points"]["actual"] = total
            p["total_points"]["result"] = "hit" if (p["total_points"]["pick"]=="Over" and total>line) or (p["total_points"]["pick"]=="Under" and total<line) else "miss"
        settled += 1
    log(f"  Settled: {settled}")

    # Sportsbet AFL index across rounds
    sb_idx = {}
    for slug in ['round-7','round-8','round-9','round-10','round-11','round-12','round-13','round-14']:
        data = fetch_sb_afl_round(slug); time.sleep(0.4)
        if not data: continue
        sb = (data.get("entities") or {}).get("sportsbook") or {}
        for ev in (sb.get("events") or {}).values():
            h = ev.get("participant1"); a = ev.get("participant2")
            if not h or not a: continue
            mks = {}
            for mid in ev.get("marketIds", []):
                mk = (sb.get("markets") or {}).get(str(mid))
                if not mk: continue
                cs = {}
                for oid in mk.get("outcomeIds", []):
                    oc = (sb.get("outcomes") or {}).get(str(oid))
                    if not oc: continue
                    wp = oc.get("winPrice") or {}
                    try: cs[oc.get("name", "")] = round(wp["num"]/wp["den"] + 1.0, 2)
                    except: continue
                if cs: mks[mk.get("name", "")] = cs
            sb_idx[(afl_norm(h), afl_norm(a))] = {"markets": mks, "home": h, "away": a, "event_id": ev.get("id")}
    log(f"  Sportsbet AFL events: {len(sb_idx)}")

    # Forecast
    new_count = 0
    for d in DAYS:
        sched = fetch(f"/api/v1/sport/aussie-rules/scheduled-events/{d}"); sleep()
        if not sched: continue
        for ev in sched.get("events", []):
            if ev.get("tournament", {}).get("name") != "AFL": continue
            if (ev.get("status") or {}).get("type") != "notstarted": continue
            eid = ev["id"]
            if eid in existing: continue
            try:
                home = ev["homeTeam"]; away = ev["awayTeam"]
                ts = ev.get("startTimestamp")
                dt = datetime.datetime.utcfromtimestamp(ts) if ts else datetime.datetime.utcnow()
                rec = {"id": eid, "date": dt.strftime("%Y-%m-%d"), "time": dt.strftime("%H:%M"), "status": "upcoming",
                       "home": {"name": home["name"], "short": home["name"], "team_id": home["id"]},
                       "away": {"name": away["name"], "short": away["name"], "team_id": away["id"]}}
                # Form
                h_sc = a_sc = h_cd = a_cd = None
                d_h = fetch(f"/api/v1/team/{home['id']}/events/last/0"); sleep()
                if d_h:
                    fin = [e for e in d_h.get("events", []) if (e.get("status") or {}).get("type") == "finished"][-5:]
                    if len(fin) >= 3:
                        sc, cd = [], []
                        for e in fin:
                            h = (e.get("homeScore") or {}).get("current"); a = (e.get("awayScore") or {}).get("current")
                            if h is None or a is None: continue
                            if (e.get("homeTeam") or {}).get("id") == home["id"]: sc.append(h); cd.append(a)
                            else: sc.append(a); cd.append(h)
                        if sc: h_sc = sum(sc)/len(sc); h_cd = sum(cd)/len(cd)
                d_a = fetch(f"/api/v1/team/{away['id']}/events/last/0"); sleep()
                if d_a:
                    fin = [e for e in d_a.get("events", []) if (e.get("status") or {}).get("type") == "finished"][-5:]
                    if len(fin) >= 3:
                        sc, cd = [], []
                        for e in fin:
                            h = (e.get("homeScore") or {}).get("current"); a = (e.get("awayScore") or {}).get("current")
                            if h is None or a is None: continue
                            if (e.get("homeTeam") or {}).get("id") == away["id"]: sc.append(h); cd.append(a)
                            else: sc.append(a); cd.append(h)
                        if sc: a_sc = sum(sc)/len(sc); a_cd = sum(cd)/len(cd)

                # Sportsbet odds
                sb_hit = None
                for (sh, sa), v in sb_idx.items():
                    if afl_match(home["name"], v["home"]) and afl_match(away["name"], v["away"]):
                        sb_hit = v; break
                if sb_hit:
                    h2h = sb_hit["markets"].get("Head to Head") or {}
                    home_key = next((k for k in h2h if afl_match(k, home["name"])), None)
                    away_key = next((k for k in h2h if afl_match(k, away["name"])), None)
                    if home_key and away_key:
                        rec["sportsbet_odds"] = {"home": h2h[home_key], "away": h2h[away_key], "event_id": sb_hit["event_id"]}
                    tp = sb_hit["markets"].get("Total Game Points - Over/Under") or sb_hit["markets"].get("Total Game Points") or {}
                    for k, val in tp.items():
                        m_match = re.match(r'(Over|Under)\s+(\d+(?:\.\d)?)', k)
                        if m_match:
                            rec.setdefault("totals", {}).setdefault(m_match.group(2), {})[m_match.group(1)] = val

                # Predictions
                if h_sc and a_sc:
                    est_h = (h_sc + a_cd)/2 + 5
                    est_a = (a_sc + h_cd)/2
                    winner_type = "home" if est_h > est_a else "away"
                    winner_pick = home["name"] if winner_type == "home" else away["name"]
                    total = est_h + est_a
                    rec["predictions"] = {
                        "winner": {"pick": winner_pick, "type": winner_type},
                        "total_points": {"estimate": round(total, 1)},
                    }
                    if rec.get("totals"):
                        lines = sorted(rec["totals"].keys(), key=lambda x: abs(float(x) - total))
                        chosen = lines[0]
                        o = rec["totals"][chosen]
                        pick = "Over" if total > float(chosen) else "Under"
                        rec["predictions"]["total_points"]["pick"] = pick
                        rec["predictions"]["total_points"]["line"] = float(chosen)
                        if pick in o: rec["predictions"]["total_points"]["odds"] = o[pick]
                    if rec.get("sportsbet_odds"):
                        rec["predictions"]["winner"]["odds"] = rec["sportsbet_odds"][winner_type]
                else:
                    rec["predictions"] = {"winner": {"pick": home["name"], "type": "home"}}

                afl["matches"].append(rec); existing.add(eid); new_count += 1
            except Exception as e:
                ERRORS.append(f"AFL build {ev.get('id')}: {e}")
    log(f"  AFL new: {new_count}")

    afl["matches"].sort(key=lambda m: (m.get("date",""), m.get("time","99:99")))
    store["captured_at"] = TODAY_STR
    AFL_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    return store

# ============================================================
# DASHBOARD UPDATE
# ============================================================

def update_dashboard(soccer, afl):
    if not DASHBOARD.exists():
        log("WARN: index.html not found, skipping dashboard update"); return
    soccer["sport"] = "soccer"
    html = DASHBOARD.read_text(encoding="utf-8")
    new_blob = (
        "const DATA_SOCCER = " + json.dumps(soccer, ensure_ascii=False) + ";\n"
        "const DATA_AFL = " + json.dumps(afl, ensure_ascii=False) + ";\n"
        "let DATA = DATA_SOCCER;\n"
        "const SPORTS = {soccer: DATA_SOCCER, afl: DATA_AFL};"
    )
    new_html, n = re.subn(r"const DATA_SOCCER = \{.*?const SPORTS = \{soccer: DATA_SOCCER, afl: DATA_AFL\};",
                          lambda _: new_blob, html, count=1, flags=re.DOTALL)
    if n != 1:
        # Maybe legacy single-DATA layout
        legacy = "const DATA = " + json.dumps(soccer, ensure_ascii=False) + ";"
        new_html, n = re.subn(r"const DATA = \{.*?\};", lambda _: legacy, html, count=1, flags=re.DOTALL)
    if n != 1:
        log(f"WARN: dashboard data block matched {n} times — skipping"); return
    DASHBOARD.write_text(new_html, encoding="utf-8")
    log(f"  Dashboard updated ({len(new_html)} bytes)")

# ============================================================
# MAIN
# ============================================================


def write_md_report(soccer, afl):
    """Generate predictions_{TODAY_ADL}.md with all times in Adelaide local."""
    if ADL is None:
        log("zoneinfo unavailable - skipping md report"); return
    now_adl = datetime.datetime.now(datetime.timezone.utc).astimezone(ADL)
    today_adl = now_adl.strftime("%Y-%m-%d")
    md = ["# Looneyz Predictions - " + today_adl + " (Adelaide local time)", ""]
    md.append("_Generated " + now_adl.strftime("%Y-%m-%d %H:%M %Z") + "_")
    md.append("")
    # Settled this run
    md.append("## Settled this run")
    settled = []
    for L in soccer.get("leagues", []):
        for m in L.get("matches", []):
            if m.get("settled_at") == TODAY_STR:
                preds = m.get("predictions", {})
                def ico(x): return {"hit":"X","miss":"x","pending":"?"}.get(x,"-")
                settled.append(f"- **{m['home']['name']} {m['home'].get('goals','?')}-{m['away'].get('goals','?')} {m['away']['name']}** ({L['name']}) - W {ico((preds.get('winner') or {}).get('result'))} | BTTS {ico((preds.get('btts') or {}).get('result'))} | OU2.5 {ico((preds.get('ou_goals') or {}).get('result'))} | Cards {ico((preds.get('ou_cards') or {}).get('result'))}")
    if not settled: md.append("_No matches settled this run._")
    md.extend(settled)
    md.append("")
    # Upcoming today/tomorrow in Adelaide time
    tomorrow_adl = (now_adl + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    for label, day in [("Upcoming today", today_adl), ("Upcoming tomorrow", tomorrow_adl)]:
        md.append("## " + label + " (" + day + " ACST)")
        any_match = False
        for L in soccer.get("leagues", []):
            for m in L.get("matches", []):
                if m.get("status") == "FT": continue
                m_date_adl = to_adl_date(m.get("date"), m.get("time"))
                if m_date_adl != day: continue
                m_time_adl = to_adl_str(m.get("date"), m.get("time"))
                any_match = True
                sb = m.get("sportsbet_odds") or {}
                sb_str = f"SB {sb.get('home')}/{sb.get('draw')}/{sb.get('away')}" if sb.get('home') else "no SB"
                preds = m.get("predictions", {})
                pw = (preds.get('winner') or {}).get('pick','?')
                pg = (preds.get('ou_goals') or {}).get('pick','?')
                pb = (preds.get('btts') or {}).get('pick','?')
                md.append(f"- {m_time_adl} **{m['home']['name']} vs {m['away']['name']}** ({L['name']}) - {sb_str} - Pred: {pw} / {pg} 2.5 / BTTS {pb}")
        # AFL too
        for L in afl.get("leagues", []):
            for m in L.get("matches", []):
                if m.get("status") == "FT": continue
                m_date_adl = to_adl_date(m.get("date"), m.get("time"))
                if m_date_adl != day: continue
                m_time_adl = to_adl_str(m.get("date"), m.get("time"))
                any_match = True
                preds = m.get("predictions", {})
                pw = (preds.get("winner") or {}).get("pick","?")
                tp = preds.get("total_points") or {}
                tp_str = f"{tp.get('pick','?')} {tp.get('line','?')}" if tp.get('pick') else f"~{tp.get('estimate','?')} pts"
                md.append(f"- {m_time_adl} **{m['home']['name']} vs {m['away']['name']}** (AFL) - Pred: {pw} / Total {tp_str}")
        if not any_match: md.append("_None._")
        md.append("")
    # Accuracy
    md.append("## Model accuracy to date")
    counts = {k: {"hit":0,"miss":0,"pending":0} for k in ("winner","btts","ou_goals","ou_cards")}
    for L in soccer.get("leagues", []):
        for m in L.get("matches", []):
            for k in counts:
                r = ((m.get("predictions") or {}).get(k) or {}).get("result")
                if r in counts[k]: counts[k][r] += 1
    md.append("")
    md.append("| Pick | Hit | Miss | Pending | Hit % |")
    md.append("|------|-----|------|---------|-------|")
    for k in ("winner","btts","ou_goals","ou_cards"):
        c = counts[k]; denom = c["hit"]+c["miss"]; pct = (c["hit"]/denom*100) if denom else 0
        md.append(f"| {k} | {c['hit']} | {c['miss']} | {c['pending']} | {pct:.0f}% |")
    md.append("")
    out = REPO / f"predictions_{today_adl}.md"
    out.write_text("\n".join(md), encoding="utf-8")
    log(f"  Adelaide-time MD report: {out.name}")

def main():
    log(f"Daily routine starting {TODAY_STR}")
    soccer = soccer_routine()
    try:
        afl = afl_routine()
    except Exception as e:
        log(f"AFL routine failed: {e}"); traceback.print_exc()
        afl = json.loads(AFL_PATH.read_text()) if AFL_PATH.exists() else {"sport":"afl","leagues":[{"name":"AFL","matches":[]}]}
    update_dashboard(soccer, afl)
    write_md_report(soccer, afl)
    snap = REPO / f"predictions_{TODAY_STR}.json"
    snap.write_text(json.dumps(soccer, indent=2, ensure_ascii=False))
    log(f"Snapshot written: {snap.name}")
    log(f"Done. Errors swallowed: {len(ERRORS)}")
    for e in ERRORS[:10]: log(f"  - {e}")

if __name__ == "__main__":
    main()
