#!/usr/bin/env python3
"""Master orchestrator for the Soccer Stats daily routine.

Runs the full pipeline against a fixed 10-tournament whitelist:
- Phase 0:   strict tournament-ID validation + Adelaide-local re-date + dedupe + prune
- Phase A:   settle pending matches (only if SofaScore confirms `status.type == "finished"`)
- Phase A.5: backfill finished-but-untracked matches + enrich every FT record
             (odds + h2h_streaks + team_streaks + actuals)
- Phase A.6: retrospective Poisson predictions for FT records that lack them
- Phase B:   forecast new upcoming matches (today + tomorrow Adelaide-local)
- Phase B.5: attach sportsbet.com.au Win-Draw-Win odds (90-min regular)
- Phase B.6: attach SofaScore market odds to each streak entry
- Phase B.7: attach odds to each prediction (sportsbet first, SofaScore fallback)
- Phase C:   write match_data.json, dated predictions snapshot + markdown report,
             splice DATA_SOCCER into index.html via the brace-aware safe splicer

DOES NOT touch git. `auto_push.bat` (Windows Task Scheduler) handles commits + push.

Usage:
    python3 scripts/soccer_routine.py
"""
import json, math, re, subprocess, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        # Windows ships no IANA data; fall back to fixed ACST offset.
        # User can pip install tzdata for DST-aware behaviour.
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

from curl_cffi import requests

# ----------------------------------------------------------------------------
ROOT  = Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"
INDEX = ROOT / "index.html"
SCRIPTS = ROOT / "scripts"
TODAY     = datetime.now(ADL).date()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW  = TODAY + timedelta(days=1)

TOURNAMENTS = {
    7:   "UEFA Champions League",
    17:  "Premier League",
    8:   "LaLiga",
    35:  "Bundesliga",
    34:  "Ligue 1",
    37:  "Eredivisie",
    242: "MLS",
    18:  "Championship",
    24:  "League One",
    25:  "League Two",
}
ORDER = ["Premier League","LaLiga","Bundesliga","Ligue 1","UEFA Champions League",
         "Eredivisie","MLS","Championship","League One","League Two"]


# ----------------------------------------------------------------------------
def fetch(path, retries=2):
    last = None
    for i in range(retries + 1):
        try:
            r = requests.get(f"https://api.sofascore.com{path}", impersonate="chrome120", timeout=15)
            if r.status_code == 404: return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e; time.sleep(0.4 * (i + 1))
    return None


def adl_date(ts): return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ADL).strftime("%Y-%m-%d")
def adl_time(ts): return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ADL).strftime("%H:%M")


def short(name):
    if not name: return ""
    parts = name.split()
    if len(parts) > 1:
        return parts[0] if len(parts[0]) >= 4 else " ".join(parts[:2])
    return name


def load_store():
    if STORE.exists():
        return json.loads(STORE.read_text(encoding="utf-8"))
    return {"captured_at": TODAY.isoformat(), "source": "sofascore.com + sportsbet.com.au", "leagues": []}


def save_store(store):
    store["captured_at"] = TODAY.isoformat()
    STORE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / f"predictions_{TODAY.isoformat()}.json").write_text(
        json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


# ----------------------------------------------------------------------------
def phase_0_validate(store):
    """Dedupe + strict tournament-ID validation + Adelaide-local re-date."""
    seen = {}
    drops_dupe = 0
    for L in store["leagues"]:
        keep = []
        for m in L["matches"]:
            eid = m.get("id")
            if eid and eid in seen:
                drops_dupe += 1; continue
            if eid: seen[eid] = True
            keep.append(m)
        L["matches"] = keep

    by_name = {info: L for info in TOURNAMENTS.values() for L in store["leagues"] if L["name"] == info}
    # ensure all canonical leagues exist
    for canon in TOURNAMENTS.values():
        if canon not in by_name:
            new_lg = {"id": next(k for k, v in TOURNAMENTS.items() if v == canon), "name": canon, "season": "2025/26", "round": None, "matches": []}
            store["leagues"].append(new_lg)
            by_name[canon] = new_lg

    # drop non-whitelisted league entries
    store["leagues"] = [L for L in store["leagues"] if L["name"] in TOURNAMENTS.values()]
    by_name = {L["name"]: L for L in store["leagues"]}

    # Per-match validation + re-date. Cache the event fetch for later phases.
    drops_no_id = 0; drops_foreign = 0; moved = 0; re_dated = 0
    cache = {}
    for L in list(store["leagues"]):
        keep = []
        for m in L["matches"]:
            eid = m.get("id")
            if not eid:
                drops_no_id += 1; continue
            ev = fetch(f"/api/v1/event/{eid}"); time.sleep(0.06)
            if ev is None:
                # network blip — keep the match, will be re-validated on next run
                keep.append(m); continue
            cache[eid] = ev
            e = ev.get("event") or ev
            utid = ((e.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS:
                drops_foreign += 1; continue
            correct = TOURNAMENTS[utid]
            ts = e.get("startTimestamp")
            if ts:
                new_d = adl_date(ts); new_t = "FT" if m.get("status") == "FT" else adl_time(ts)
                if m.get("date") != new_d or m.get("time") != new_t:
                    m["date"] = new_d; m["time"] = new_t; re_dated += 1
            if correct != L["name"]:
                by_name[correct]["matches"].append(m); moved += 1
            else:
                keep.append(m)
        L["matches"] = keep

    return {"dedupe": drops_dupe, "no_id": drops_no_id, "foreign": drops_foreign,
            "moved": moved, "re_dated": re_dated, "cache": cache}


# ----------------------------------------------------------------------------
def settle(m, e):
    hs = (e.get("homeScore") or {}).get("current")
    as_ = (e.get("awayScore") or {}).get("current")
    if hs is None or as_ is None: return False
    m["status"] = "FT"; m["time"] = "FT"
    m.setdefault("home", {})["goals"] = hs
    m.setdefault("away", {})["goals"] = as_
    m["settled_at"] = TODAY.isoformat()
    pred = m.get("predictions") or {}
    actual = "home" if hs > as_ else ("away" if as_ > hs else "draw")
    if pred.get("winner"):
        pred["winner"]["result"] = "hit" if pred["winner"].get("type") == actual else "miss"
    abtts = (hs > 0 and as_ > 0)
    if pred.get("btts"):
        pred["btts"]["actual_btts"] = abtts
        pred["btts"]["result"] = "hit" if (str(pred["btts"].get("pick", "")).lower() == "yes") == abtts else "miss"
    if pred.get("ou_goals"):
        line = float(pred["ou_goals"].get("line", 2.5)); tot = hs + as_
        pred["ou_goals"]["actual"] = tot
        pred["ou_goals"]["result"] = ("hit" if (pred["ou_goals"].get("pick") == "Over" and tot > line) or
                                      (pred["ou_goals"].get("pick") == "Under" and tot < line) else "miss")
    return True


def cards_count(eid):
    s = fetch(f"/api/v1/event/{eid}/statistics"); time.sleep(0.06)
    if not s: return None
    yc = rc = 0; found = False
    for per in s.get("statistics", []):
        if per.get("period") != "ALL": continue
        for grp in per.get("groups", []):
            for it in grp.get("statisticsItems", []):
                nm = (it.get("name") or "").lower()
                try:
                    h = int(it.get("homeValue") or it.get("home") or 0)
                    a = int(it.get("awayValue") or it.get("away") or 0)
                except: continue
                if "yellow card" in nm and "second" not in nm: yc = h + a; found = True
                elif "red card" in nm: rc = h + a; found = True
    return (yc + rc) if found else None


def phase_a_settle(store, cache):
    settled = []; skipped = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") == "FT": continue
            eid = m.get("id")
            if not eid: continue
            ev = cache.get(eid) or fetch(f"/api/v1/event/{eid}")
            if not ev: continue
            e = ev.get("event") or ev
            if (e.get("status") or {}).get("type") != "finished":
                skipped += 1; continue
            if settle(m, e):
                # also try cards
                c = (m.get("predictions") or {}).get("ou_cards") or {}
                if c.get("pick"):
                    cards = cards_count(eid)
                    if cards is not None:
                        line = float(c.get("line", 4.5))
                        c["actual"] = cards
                        c["result"] = ("hit" if (c["pick"] == "Over" and cards > line) or
                                       (c["pick"] == "Under" and cards < line) else "miss")
                settled.append(f"{L['name']}: {m['home']['name']} {m['home']['goals']}-{m['away']['goals']} {m['away']['name']}")
    return {"settled": settled, "skipped": skipped}


# ----------------------------------------------------------------------------
def parse_streaks_payload(sp):
    h2h = []; tstr = []
    for s in (sp.get("general") or []):
        h2h.append({"team": s.get("teamSide", "both"),
                    "label": s.get("name") or s.get("label", ""),
                    "value": str(s.get("count") or s.get("value", ""))})
    for side in ("home", "away"):
        for s in (sp.get(side) or []):
            tstr.append({"team": side,
                         "label": s.get("name") or s.get("label", ""),
                         "value": str(s.get("count") or s.get("value", ""))})
    return h2h, tstr


def parse_full_time_odds(payload):
    if not payload: return None
    for mk in (payload.get("markets") or []):
        if mk.get("marketId") == 1 or "full time" in (mk.get("marketName") or "").lower():
            out = {}
            for ch in (mk.get("choices") or []):
                v = ch.get("fractionalValue") or ch.get("value")
                if v is None: continue
                try:
                    if isinstance(v, str) and "/" in v:
                        n, d = v.split("/"); v = float(n)/float(d) + 1
                    else:
                        v = float(v)
                except: continue
                k = ch.get("name", "")
                if k == "1": out["home"] = round(v, 2)
                elif k == "X": out["draw"] = round(v, 2)
                elif k == "2": out["away"] = round(v, 2)
            if len(out) == 3: return out
    return None


def actuals_for(eid):
    out = {}
    s = fetch(f"/api/v1/event/{eid}/statistics"); time.sleep(0.06)
    if s:
        for per in s.get("statistics", []):
            if per.get("period") != "ALL": continue
            for grp in per.get("groups", []):
                for it in grp.get("statisticsItems", []):
                    k = it.get("key")
                    try:
                        h = int(it.get("homeValue") or it.get("home") or 0)
                        a = int(it.get("awayValue") or it.get("away") or 0)
                    except: continue
                    if k == "cornerKicks": out.update(home_corners=h, away_corners=a, corners_total=h+a)
                    elif k == "fouls":      out.update(home_fouls=h,   away_fouls=a,   fouls_total=h+a)
                    elif k == "shotsOnGoal": out.update(home_sot=h,    away_sot=a)
    inc = fetch(f"/api/v1/event/{eid}/incidents"); time.sleep(0.06)
    if inc:
        goals = [i for i in inc.get("incidents", []) if i.get("incidentType") == "goal"]
        if goals:
            first = min(goals, key=lambda g: g.get("time", 9999))
            out["first_to_score"] = "home" if first.get("isHome") else "away"
            out["first_scorer"]   = (first.get("player") or {}).get("name")
        ht = [i for i in inc.get("incidents", []) if i.get("incidentType") == "period" and i.get("text") == "HT"]
        if ht:
            out["ht_home"] = ht[0].get("homeScore", 0); out["ht_away"] = ht[0].get("awayScore", 0)
            out["ht_winner"] = "home" if out["ht_home"] > out["ht_away"] else ("away" if out["ht_away"] > out["ht_home"] else "draw")
    return out


def phase_a5_backfill_enrich(store, seen_ids):
    """Add finished-but-untracked + enrich every FT record."""
    by_name = {L["name"]: L for L in store["leagues"]}
    added = 0; add_brk = {}
    for d in (YESTERDAY.isoformat(), TODAY.isoformat()):
        data = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); time.sleep(0.15)
        if not data: continue
        for ev in data.get("events", []):
            eid = ev.get("id")
            if not eid or eid in seen_ids: continue
            utid = ((ev.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS: continue
            if (ev.get("status") or {}).get("type") != "finished": continue
            ts = ev.get("startTimestamp")
            h = ev.get("homeTeam") or {}; a = ev.get("awayTeam") or {}
            rec = {
                "id": eid, "date": adl_date(ts) if ts else d, "time": "FT", "status": "FT",
                "home": {"name": h.get("name",""), "short": short(h.get("shortName") or h.get("name","")),
                         "team_id": h.get("id"), "goals": (ev.get("homeScore") or {}).get("current")},
                "away": {"name": a.get("name",""), "short": short(a.get("shortName") or a.get("name","")),
                         "team_id": a.get("id"), "goals": (ev.get("awayScore") or {}).get("current")},
                "settled_at": TODAY.isoformat(),
            }
            by_name[TOURNAMENTS[utid]]["matches"].append(rec)
            seen_ids.add(eid); added += 1
            add_brk[TOURNAMENTS[utid]] = add_brk.get(TOURNAMENTS[utid], 0) + 1

    # Enrich every FT match (new or existing) with odds + streaks + actuals
    enriched = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") != "FT": continue
            eid = m.get("id")
            if not eid: continue
            need_odds = not m.get("odds")
            need_streaks = not (m.get("h2h_streaks") or m.get("team_streaks"))
            need_actuals = not m.get("actuals")
            if not (need_odds or need_streaks or need_actuals): continue
            if need_odds:
                op = fetch(f"/api/v1/event/{eid}/odds/1/all"); time.sleep(0.06)
                o = parse_full_time_odds(op)
                if o: m["odds"] = o
            if need_streaks:
                sp = fetch(f"/api/v1/event/{eid}/team-streaks"); time.sleep(0.06)
                if sp:
                    h2h, tstr = parse_streaks_payload(sp)
                    if h2h: m["h2h_streaks"] = h2h
                    if tstr: m["team_streaks"] = tstr
            if need_actuals:
                act = actuals_for(eid)
                if act: m["actuals"] = act
            enriched += 1
    return {"added": added, "add_brk": add_brk, "enriched": enriched}


# ----------------------------------------------------------------------------
def fetch_form(team_id, exclude_event_id=None):
    if not team_id: return 1.40, 1.40
    d = fetch(f"/api/v1/team/{team_id}/events/last/0"); time.sleep(0.06)
    if not d: return 1.40, 1.40
    fin = [e for e in d.get("events", [])
           if (e.get("status") or {}).get("type") == "finished"
           and e.get("id") != exclude_event_id][-6:]
    if len(fin) < 3: return 1.40, 1.40
    att = []; df = []
    for e in fin:
        is_home = (e.get("homeTeam") or {}).get("id") == team_id
        hs = (e.get("homeScore") or {}).get("current", 0); as_ = (e.get("awayScore") or {}).get("current", 0)
        if is_home: att.append(hs); df.append(as_)
        else:       att.append(as_); df.append(hs)
    return sum(att)/len(att), sum(df)/len(df)


def predict_poisson(h_att, h_def, a_att, a_def, h_name, a_name, streaks):
    lh = max(0.20, (h_att + a_def)/2 + 0.20)
    la = max(0.20, (a_att + h_def)/2 - 0.05)
    pmf = lambda k, l: math.exp(-l)*(l**k)/math.factorial(k)
    grid = [[pmf(i, lh)*pmf(j, la) for j in range(7)] for i in range(7)]
    p_h = sum(grid[i][j] for i in range(7) for j in range(7) if i > j)
    p_d = sum(grid[i][i] for i in range(7))
    p_a = sum(grid[i][j] for i in range(7) for j in range(7) if j > i)
    if p_h >= max(p_d, p_a):
        w = {"pick": h_name, "type": "home"}
    elif p_a >= p_d:
        w = {"pick": a_name, "type": "away"}
    else:
        w = {"pick": "Draw", "type": "draw"}
    btts = {"pick": "Yes" if (1 - math.exp(-lh))*(1 - math.exp(-la)) >= 0.50 else "No"}
    p_under_25 = sum(grid[i][j] for i in range(7) for j in range(7) if i + j < 3)
    ou_goals = {"pick": "Over" if (1 - p_under_25) >= 0.55 else "Under", "line": 2.5}
    over = sum(1 for s in (streaks or []) if "more than 4.5 cards" in (s.get("label") or "").lower())
    under = sum(1 for s in (streaks or []) if "less than 4.5 cards" in (s.get("label") or "").lower())
    cards = {"pick": "Over" if over >= under else "Under", "line": 4.5}
    return {"winner": w, "btts": btts, "ou_goals": ou_goals, "ou_cards": cards}


def phase_a6_retro(store):
    done = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") != "FT": continue
            if m.get("predictions"): continue
            h_id = m.get("home", {}).get("team_id"); a_id = m.get("away", {}).get("team_id")
            hg = m["home"].get("goals"); ag = m["away"].get("goals")
            if hg is None or ag is None: continue
            ev_id = m.get("id")
            h_att, h_def = fetch_form(h_id, ev_id)
            a_att, a_def = fetch_form(a_id, ev_id)
            pred = predict_poisson(h_att, h_def, a_att, a_def,
                                   m["home"]["name"], m["away"]["name"], m.get("team_streaks") or [])
            actual = "home" if hg > ag else ("away" if ag > hg else "draw")
            pred["winner"]["result"] = "hit" if pred["winner"]["type"] == actual else "miss"
            abtts = (hg > 0 and ag > 0)
            pred["btts"]["actual_btts"] = abtts
            pred["btts"]["result"] = "hit" if (pred["btts"]["pick"] == "Yes") == abtts else "miss"
            tot = hg + ag
            pred["ou_goals"]["actual"] = tot
            pred["ou_goals"]["result"] = ("hit" if (pred["ou_goals"]["pick"] == "Over" and tot > 2.5) or
                                          (pred["ou_goals"]["pick"] == "Under" and tot < 2.5) else "miss")
            cards = cards_count(ev_id)
            if cards is not None:
                pred["ou_cards"]["actual"] = cards
                pred["ou_cards"]["result"] = ("hit" if (pred["ou_cards"]["pick"] == "Over" and cards > 4.5) or
                                              (pred["ou_cards"]["pick"] == "Under" and cards < 4.5) else "miss")
            m["predictions"] = pred
            done += 1
    return {"retro": done}


# ----------------------------------------------------------------------------
def phase_b_forecast(store, seen_ids):
    by_name = {L["name"]: L for L in store["leagues"]}
    added = 0; add_brk = {}
    for d in (TODAY.isoformat(), TOMORROW.isoformat()):
        data = fetch(f"/api/v1/sport/football/scheduled-events/{d}"); time.sleep(0.15)
        if not data: continue
        for ev in data.get("events", []):
            eid = ev.get("id")
            if not eid or eid in seen_ids: continue
            if (ev.get("status") or {}).get("type") != "notstarted": continue
            utid = ((ev.get("tournament") or {}).get("uniqueTournament") or {}).get("id")
            if utid not in TOURNAMENTS: continue
            try:
                op = fetch(f"/api/v1/event/{eid}/odds/1/all"); time.sleep(0.06)
                odds = parse_full_time_odds(op)
                sp = fetch(f"/api/v1/event/{eid}/team-streaks"); time.sleep(0.06)
                h2h, tstr = parse_streaks_payload(sp) if sp else ([], [])
                h = ev.get("homeTeam") or {}; a = ev.get("awayTeam") or {}
                h_att, h_def = fetch_form(h.get("id"))
                a_att, a_def = fetch_form(a.get("id"))
                pred = predict_poisson(h_att, h_def, a_att, a_def, h.get("name",""), a.get("name",""), tstr)
                ts = ev.get("startTimestamp")
                rec = {
                    "id": eid, "date": adl_date(ts) if ts else d, "time": adl_time(ts) if ts else "00:00",
                    "status": "upcoming",
                    "home": {"name": h.get("name",""), "short": short(h.get("shortName") or h.get("name","")), "team_id": h.get("id")},
                    "away": {"name": a.get("name",""), "short": short(a.get("shortName") or a.get("name","")), "team_id": a.get("id")},
                    "predictions": pred,
                }
                if odds: rec["odds"] = odds
                if h2h: rec["h2h_streaks"] = h2h
                if tstr: rec["team_streaks"] = tstr
                by_name[TOURNAMENTS[utid]]["matches"].append(rec)
                seen_ids.add(eid); added += 1
                add_brk[TOURNAMENTS[utid]] = add_brk.get(TOURNAMENTS[utid], 0) + 1
            except Exception:
                pass
    return {"added": added, "add_brk": add_brk}


# ----------------------------------------------------------------------------
def run_helper(name):
    """Invoke a helper script. Captures and prints its stdout."""
    p = subprocess.run([sys.executable, str(SCRIPTS / name)], capture_output=True, text=True)
    if p.stdout: print(p.stdout.rstrip())
    if p.returncode != 0 and p.stderr:
        print(f"  [{name}] stderr: {p.stderr.rstrip()}")


def main():
    print(f"=== soccer_routine.py — {TODAY.isoformat()} (Adelaide) ===")
    store = load_store()

    # Phase 0
    print("\n[Phase 0] validate + dedupe + re-date")
    p0 = phase_0_validate(store)
    print(f"  dedupe={p0['dedupe']}  no_id={p0['no_id']}  foreign={p0['foreign']}  moved={p0['moved']}  re_dated={p0['re_dated']}")
    seen_ids = {m["id"] for L in store["leagues"] for m in L["matches"] if m.get("id")}

    # Phase A
    print("\n[Phase A] settle pending")
    pa = phase_a_settle(store, p0["cache"])
    print(f"  settled={len(pa['settled'])}  skipped={pa['skipped']}")

    # Phase A.5
    print("\n[Phase A.5] backfill finished + enrich")
    pa5 = phase_a5_backfill_enrich(store, seen_ids)
    print(f"  added={pa5['added']}  enriched={pa5['enriched']}")

    # Phase A.6
    print("\n[Phase A.6] retrospective predictions")
    pa6 = phase_a6_retro(store)
    print(f"  retro={pa6['retro']}")

    # Phase B
    print("\n[Phase B] forecast new upcoming")
    pb = phase_b_forecast(store, seen_ids)
    print(f"  added={pb['added']}")

    # Sort matches inside each league
    for L in store["leagues"]:
        L["matches"].sort(key=lambda m: (m.get("date", ""), m.get("time", "")))
    store["leagues"].sort(key=lambda L: ORDER.index(L["name"]) if L["name"] in ORDER else 99)

    # Persist before invoking helpers (they read match_data.json)
    save_store(store)

    print("\n[Phase B.5] sportsbet odds")
    run_helper("soccer_fetch_sportsbet.py")

    print("\n[Phase B.6] streak odds")
    run_helper("soccer_enrich_streak_odds.py")

    print("\n[Phase B.7] prediction odds")
    run_helper("soccer_fetch_pred_odds.py")

    print("\n[Phase C] update index.html")
    run_helper("soccer_update_index.py")

    # Final tally
    total = 0; ft = 0; up = 0
    hit = miss = pending = 0
    for L in store["leagues"]:
        total += len(L["matches"])
        for m in L["matches"]:
            if m.get("status") == "FT": ft += 1
            else: up += 1
            r = (m.get("predictions", {}).get("winner", {}) or {}).get("result")
            if r == "hit": hit += 1
            elif r == "miss": miss += 1
    pct = (hit / (hit + miss) * 100) if (hit + miss) else 0
    print(f"\n=== DONE ===")
    print(f"Store: {total} matches ({ft} FT / {up} upcoming)")
    print(f"Winner accuracy to date: {hit} hit / {miss} miss  ({pct:.0f}%)")
    print("auto_push.bat will commit + push within 15 min.")


if __name__ == "__main__":
    main()
