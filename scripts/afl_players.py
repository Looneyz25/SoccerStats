#!/usr/bin/env python3
"""AFL player form + 1st-goal / anytime / X-factor predictions per upcoming match."""
import json, time, math, pathlib, re
from curl_cffi import requests
from collections import defaultdict

FOLDER = pathlib.Path("/sessions/charming-awesome-faraday/mnt/Soccer Stats")
STORE_PATH = FOLDER / "match_data_afl.json"
BUDGET = 38; START = time.time()

def fetch(path):
    try:
        r = requests.get("https://api.sofascore.com" + path, impersonate="chrome120", timeout=12)
        if r.status_code != 200: return None
        return r.json()
    except: return None

def sleep(): time.sleep(0.08)

# Cache team form to avoid duplicate fetching (both teams in match overlap)
TEAM_FORM_CACHE = {}

def get_team_form(team_id):
    """Returns {player_name: {games, goals, disposals, kicks, marks, tackles, max_goals}}."""
    if team_id in TEAM_FORM_CACHE: return TEAM_FORM_CACHE[team_id]
    out = defaultdict(lambda: {"games": 0, "goals": 0, "disposals": 0, "kicks": 0, "marks": 0, "tackles": 0, "max_goals": 0})
    events = fetch(f"/api/v1/team/{team_id}/events/last/0"); sleep()
    if not events: TEAM_FORM_CACHE[team_id] = {}; return {}
    completed = [e for e in events.get("events", []) if (e.get("status") or {}).get("type") == "finished"][-5:]
    for ev in completed:
        eid = ev.get("id")
        if not eid: continue
        lu = fetch(f"/api/v1/event/{eid}/lineups"); sleep()
        if not lu: continue
        is_home = (ev.get("homeTeam") or {}).get("id") == team_id
        side = lu.get("home" if is_home else "away") or {}
        for p in side.get("players", []) or []:
            nm = (p.get("player") or {}).get("name")
            if not nm: continue
            stats = p.get("statistics") or {}
            out[nm]["games"] += 1
            out[nm]["goals"] += stats.get("goals", 0) or 0
            out[nm]["disposals"] += stats.get("disposals", 0) or 0
            out[nm]["kicks"] += stats.get("kicks", 0) or 0
            out[nm]["marks"] += stats.get("marks", 0) or 0
            out[nm]["tackles"] += stats.get("tackles", 0) or 0
            out[nm]["max_goals"] = max(out[nm]["max_goals"], stats.get("goals", 0) or 0)
    TEAM_FORM_CACHE[team_id] = dict(out)
    return TEAM_FORM_CACHE[team_id]

def fetch_sb_round(round_slug):
    try:
        r = requests.get(f"https://www.sportsbet.com.au/betting/australian-rules/afl/{round_slug}", impersonate="chrome120", timeout=18)
        html = r.text
        s_idx = html.find('window.__PRELOADED_STATE__ = ')
        if s_idx == -1: return None
        s_idx += len('window.__PRELOADED_STATE__ = ')
        end = html.find('window.__APOLLO_STATE__', s_idx)
        return json.loads(html[s_idx:end].rstrip().rstrip(';').rstrip())
    except: return None

def sb_markets_for_event(slug, home_name, away_name):
    """Find a specific event in a SB round page and return its market->{outcome:price} dict."""
    data = fetch_sb_round(slug); time.sleep(0.3)
    if not data: return None
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    for ev in (sb.get("events") or {}).values():
        h = ev.get("participant1"); a = ev.get("participant2")
        if not h or not a: continue
        if not (norm(h) in norm(home_name) or norm(home_name) in norm(h)): continue
        if not (norm(a) in norm(away_name) or norm(away_name) in norm(a)): continue
        out = {}
        for mid in ev.get("marketIds", []):
            mk = (sb.get("markets") or {}).get(str(mid))
            if not mk: continue
            mname = mk.get("name", "")
            cs = {}
            for oid in mk.get("outcomeIds", []):
                oc = (sb.get("outcomes") or {}).get(str(oid))
                if not oc: continue
                wp = oc.get("winPrice") or {}
                try: price = round(wp["num"] / wp["den"] + 1.0, 2)
                except: continue
                cs[oc.get("name", "")] = price
            if cs: out[mname] = cs
        return out
    return None

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())

def names_match_player(model_name, market_name):
    """Match a player name across SofaScore vs Sportsbet."""
    a = norm(model_name); b = norm(market_name)
    if not a or not b: return False
    if a == b: return True
    # last name match
    a_parts = model_name.split(); b_parts = market_name.split()
    if a_parts and b_parts and a_parts[-1].lower() == b_parts[-1].lower(): return True
    return False

def build_player_picks(home_form, away_form, sb_markets, home_name, away_name):
    """For each player: 1st-goal prob, anytime goal, multi-goal probs, disposal predictions, value edges."""
    if not sb_markets: return None
    first_goal_market = sb_markets.get("1st Goal") or {}
    anytime_market = sb_markets.get("1+ Goal") or {}
    multi_market = sb_markets.get("2+ Goals") or {}

    # Combined player pool from both teams
    all_players = {}
    for nm, st in home_form.items(): all_players[nm] = (st, "home")
    for nm, st in away_form.items(): all_players[nm] = (st, "away")

    # Compute per-player model goal rate (mean goals per game)
    two_goal_market = sb_markets.get("2+ Goals") or {}
    three_goal_market = sb_markets.get("3+ Goals") or {}
    disp20_market = sb_markets.get("20+ Disposals") or {}
    disp25_market = sb_markets.get("25+ Disposals") or {}

    def pois_at_least(k, lam):
        # 1 - sum_{i<k} e^-lam * lam^i / i!
        s = 0.0; term = math.exp(-lam)
        for i in range(0, k):
            if i == 0: s += term
            else:
                term = term * lam / i
                s += term
        return 1 - s

    def disp_prob_at_least(line, mu, sigma=4.5):
        # Normal CDF approximation: 1 - 0.5*(1+erf((line-mu)/(sigma*sqrt(2))))
        return 1 - 0.5 * (1 + math.erf((line - mu) / (sigma * math.sqrt(2))))

    rated = []
    for player_name, (stats, side) in all_players.items():
        games = stats.get("games", 0)
        if games < 1: continue
        avg_g = stats["goals"] / games
        avg_d = stats["disposals"] / games
        # Match into markets by name
        def match_market(mkt):
            for mk_name, price in mkt.items():
                if names_match_player(player_name, mk_name): return price
            return None
        sb_first = match_market(first_goal_market)
        sb_any = match_market(anytime_market)
        sb_two = match_market(two_goal_market)
        sb_three = match_market(three_goal_market)
        sb_d20 = match_market(disp20_market)
        sb_d25 = match_market(disp25_market)

        # Skip players who have no goal AND no disposal market (avoids noise)
        if avg_g < 0.1 and avg_d < 12: continue

        # Model probabilities
        p_any = pois_at_least(1, avg_g)        # 1+ goals
        p_two = pois_at_least(2, avg_g)        # 2+ goals
        p_three = pois_at_least(3, avg_g)      # 3+ goals
        # First goal prob (same logic as before)
        team_total_g = sum(s["goals"]/s["games"] for s in (home_form if side=="home" else away_form).values() if s["games"]>0)
        h_total = sum(s["goals"]/s["games"] for s in home_form.values() if s["games"]>0)
        a_total = sum(s["goals"]/s["games"] for s in away_form.values() if s["games"]>0)
        p_team_first = (h_total if side=="home" else a_total) / max(0.1, h_total + a_total)
        p_first = (avg_g / max(0.1, team_total_g)) * p_team_first if team_total_g > 0 else 0
        # Predicted goals (rounded estimate of expected value)
        pred_goals = round(avg_g, 1)
        pred_disposals = round(avg_d, 1)
        # Disposal probabilities
        p_d20 = disp_prob_at_least(20, avg_d, 4.5) if avg_d > 0 else 0
        p_d25 = disp_prob_at_least(25, avg_d, 4.5) if avg_d > 0 else 0
        # Edges
        def edge(price, prob): return round(price * prob - 1, 3) if (price and prob) else None
        rated.append({
            "name": player_name, "side": side, "games": games,
            "avg_goals": round(avg_g, 2), "max_goals": stats["max_goals"],
            "avg_disposals": round(avg_d, 1),
            "pred_goals": pred_goals, "pred_disposals": pred_disposals,
            "p_first_model": round(p_first, 4),
            "p_anytime_model": round(p_any, 3),
            "p_two_model": round(p_two, 3),
            "p_three_model": round(p_three, 3),
            "p_d20_model": round(p_d20, 3),
            "p_d25_model": round(p_d25, 3),
            "first_goal_odds": sb_first,
            "anytime_odds": sb_any,
            "two_goal_odds": sb_two,
            "three_goal_odds": sb_three,
            "d20_odds": sb_d20,
            "d25_odds": sb_d25,
            "first_edge": edge(sb_first, p_first),
            "anytime_edge": edge(sb_any, p_any),
            "two_edge": edge(sb_two, p_two),
            "three_edge": edge(sb_three, p_three),
            "d20_edge": edge(sb_d20, p_d20),
            "d25_edge": edge(sb_d25, p_d25),
        })

    # Top picks by model probability — each list ranks differently
    by_first = sorted(rated, key=lambda r: -r["p_first_model"])[:5]
    by_anytime = sorted(rated, key=lambda r: -r["p_anytime_model"])[:6]
    by_pred_goals = sorted([r for r in rated if r["avg_goals"] >= 0.3], key=lambda r: -r["pred_goals"])[:6]
    by_pred_disposals = sorted([r for r in rated if r["avg_disposals"] >= 14], key=lambda r: -r["pred_disposals"])[:6]
    # X-factor: best edge across any market
    def best_edge(r):
        edges = [v for v in [r.get("first_edge"), r.get("anytime_edge"), r.get("two_edge"), r.get("three_edge"), r.get("d20_edge"), r.get("d25_edge")] if v is not None]
        return max(edges) if edges else None
    rated_with_edge = [r for r in rated if best_edge(r) is not None]
    rated_with_edge.sort(key=lambda r: -(best_edge(r) or -99))
    xfactor = rated_with_edge[:5] if rated_with_edge else []

    return {
        "first_goal_top": by_first,
        "anytime_top": by_anytime,
        "predicted_goals": by_pred_goals,
        "predicted_disposals": by_pred_disposals,
        "x_factor": xfactor,
    }

def main():
    store = json.loads(STORE_PATH.read_text())
    afl = store["leagues"][0]
    sb_round_slugs = ['round-7','round-8','round-9','round-10','round-11','round-12','round-13','round-14','round-15','round-16','round-17','round-18','round-19','round-20']
    enriched = 0
    for m in afl["matches"]:
        if time.time() - START > BUDGET: break
        if m.get("status") == "FT": continue
        # Skip if player_picks already attached
        # always recompute player_picks (cheap, uses cached form)
        h_id = m["home"].get("team_id"); a_id = m["away"].get("team_id")
        if not h_id or not a_id: continue
        print(f"-> {m['home']['name']} vs {m['away']['name']}")
        h_form = get_team_form(h_id)
        a_form = get_team_form(a_id)
        if not h_form and not a_form: continue
        # Find Sportsbet markets across rounds
        sb_markets = None
        for slug in sb_round_slugs:
            sb_markets = sb_markets_for_event(slug, m['home']['name'], m['away']['name'])
            if sb_markets: break
        if not sb_markets:
            print("   no SB markets found")
            continue
        picks = build_player_picks(h_form, a_form, sb_markets, m['home']['name'], m['away']['name'])
        if picks:
            m.setdefault("predictions", {})["player_picks"] = picks
            # Top first-goal pick + first-goal odds
            if picks["first_goal_top"]:
                top = picks["first_goal_top"][0]
                print(f"   1st goal pick: {top['name']} (avg {top['avg_goals']}/g, model p={top['p_first_model']}, odds {top.get('first_goal_odds','?')})")
            if picks["x_factor"]:
                xf = picks["x_factor"][0]
                print(f"   X-factor: {xf['name']} (edge {xf.get('first_edge')}, odds {xf.get('first_goal_odds','?')})")
            enriched += 1
        STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    print(f"DONE - enriched {enriched} matches")

if __name__ == "__main__":
    main()
