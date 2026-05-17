#!/usr/bin/env python3
"""Walk-forward backtest for the soccer prediction stack.

For every FT match in match_data.json (in chronological order), reconstruct
form, Elo, H2H, and cards-streak state from *only matches before that one*,
call ``predict_enhanced`` with point-in-time inputs, then score the prediction
against the stored final score. Aggregates hit rate, log loss, Brier score,
and ROI per market and per league.

Notes / limitations:
  - No standings snapshot (rank/pts default to None — Elo carries the equivalent
    signal post-2026 refactor anyway).
  - No SofaScore team-streak feed; cards-streak prior is rebuilt from raw cards
    totals stored on prior FT matches (actuals.cards_total or
    predictions.ou_cards.actual).
  - Uses pre-match stored ``odds`` for the bookmaker blend; those were captured
    pre-kickoff so no lookahead.
  - Uses module-level calibration as deployed (``_MODEL_CALIBRATION``); pass
    ``--no-calibration`` to disable shrinkage and measure raw model output.
"""
import argparse
import json
import math
import sys
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import soccer_routine as sr  # noqa: E402

OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
SUMMARY_PATH = OUT_DIR / "backtest_walkforward.json"
MD_PATH = OUT_DIR / "backtest_walkforward.md"
ROWS_PATH = OUT_DIR / "backtest_walkforward_rows.csv"

FORM_WINDOW = 6
CARDS_WINDOW = 6
H2H_MAX = 10

NAME_TO_UTID = {name: utid for utid, name in sr.TOURNAMENTS.items()}


def chrono_key(m):
    return (m.get("date") or "", m.get("time") or "")


def collect_matches(store):
    out = []
    for league in store.get("leagues", []):
        lname = league.get("name") or ""
        for m in (league.get("matches") or []):
            if m.get("status") != "FT":
                continue
            h = m.get("home") or {}
            a = m.get("away") or {}
            h_id = h.get("team_id")
            a_id = a.get("team_id")
            hg = h.get("goals")
            ag = a.get("goals")
            if not h_id or not a_id or hg is None or ag is None:
                continue
            cards_total = None
            actuals = m.get("actuals") or {}
            if isinstance(actuals.get("cards_total"), (int, float)):
                cards_total = int(actuals["cards_total"])
            else:
                stored = ((m.get("predictions") or {}).get("ou_cards") or {}).get("actual")
                if isinstance(stored, (int, float)):
                    cards_total = int(stored)
            out.append({
                "id": m.get("id"),
                "league": lname,
                "date": m.get("date") or "",
                "time": m.get("time") or "",
                "h_id": h_id,
                "a_id": a_id,
                "h_name": h.get("name", ""),
                "a_name": a.get("name", ""),
                "hg": int(hg),
                "ag": int(ag),
                "odds": m.get("odds"),
                "cards_total": cards_total,
            })
    out.sort(key=lambda r: (r["date"], r["time"]))
    return out


def synth_streaks(home_cards, away_cards):
    """Build the synthetic streaks list predict_enhanced expects, derived from
    the home and away team's recent cards-totals deques. Each *match* in the
    window contributes one streak entry labelled over/under 4.5.
    """
    streaks = []
    for q in (home_cards, away_cards):
        for total in q:
            if total > 4.5:
                streaks.append({"team": "both", "label": "more than 4.5 cards", "value": "1"})
            else:
                streaks.append({"team": "both", "label": "less than 4.5 cards", "value": "1"})
    return streaks


def h2h_rows(history, current_h_id):
    """Re-orient stored h2h history (list of dicts with team ids + scores) so
    h_scored/a_scored are from the current match's home-team perspective —
    matches the shape predict_enhanced expects.
    """
    out = []
    for row in history[-H2H_MAX:]:
        if row["h_id"] == current_h_id:
            out.append({
                "h_scored": row["hg"],
                "a_scored": row["ag"],
            })
        else:
            out.append({
                "h_scored": row["ag"],
                "a_scored": row["hg"],
            })
    return out


def implied_from_odds(odds):
    if not odds:
        return None
    h = odds.get("home"); d = odds.get("draw"); a = odds.get("away")
    if not (h and d and a) or h <= 0 or d <= 0 or a <= 0:
        return None
    raw = {"home": 1 / h, "draw": 1 / d, "away": 1 / a}
    s = sum(raw.values())
    if s <= 0:
        return None
    return {k: v / s for k, v in raw.items()}


def score_winner(pred, actual_side, odds):
    p = pred.get("winner") or {}
    pick = p.get("type")
    result = "hit" if pick == actual_side else "miss"
    probs = p.get("probabilities") or {}
    prob_actual = probs.get(actual_side)
    odds_price = None
    if odds and pick in odds:
        odds_price = odds.get(pick)
    return result, prob_actual, odds_price


def score_btts(pred, hg, ag):
    p = pred.get("btts") or {}
    pick = str(p.get("pick", "")).lower()
    actual_yes = (hg > 0 and ag > 0)
    pick_yes = (pick == "yes")
    result = "hit" if pick_yes == actual_yes else "miss"
    prob_yes = p.get("probability") if pick_yes else (1 - p.get("probability", 0.5))
    prob_actual = prob_yes if actual_yes else (1 - prob_yes)
    return result, prob_actual


def score_goals(pred, hg, ag):
    p = pred.get("ou_goals") or {}
    pick = p.get("pick")
    line = float(p.get("line", 2.5))
    total = hg + ag
    actual_over = total > line
    pick_over = (pick == "Over")
    result = "hit" if pick_over == actual_over else "miss"
    prob_over = p.get("probability") if pick_over else (1 - p.get("probability", 0.5))
    prob_actual = prob_over if actual_over else (1 - prob_over)
    return result, prob_actual


def score_cards(pred, cards_total):
    if cards_total is None:
        return None, None
    p = pred.get("ou_cards") or {}
    pick = p.get("pick")
    line = float(p.get("line", 4.5))
    actual_over = cards_total > line
    pick_over = (pick == "Over")
    result = "hit" if pick_over == actual_over else "miss"
    prob_over = p.get("over_probability", p.get("probability", 0.5))
    prob_actual = prob_over if actual_over else (1 - prob_over)
    return result, prob_actual


def update_metrics(bucket, result, prob_actual, odds_price):
    bucket["n"] += 1
    if result == "hit":
        bucket["hits"] += 1
    elif result == "miss":
        bucket["misses"] += 1
    if prob_actual is not None and 0 < prob_actual < 1:
        bucket["log_loss_sum"] += -math.log(max(prob_actual, 1e-9))
        bucket["brier_sum"] += (1 - prob_actual) ** 2
        bucket["prob_n"] += 1
    if odds_price and odds_price > 0:
        if result == "hit":
            bucket["odds_net"] += (odds_price - 1)
        elif result == "miss":
            bucket["odds_net"] -= 1


def empty_bucket():
    return {
        "n": 0, "hits": 0, "misses": 0,
        "log_loss_sum": 0.0, "brier_sum": 0.0, "prob_n": 0,
        "odds_net": 0.0,
    }


def finalize(bucket):
    n = bucket["n"]
    if not n:
        return None
    out = {
        "n": n,
        "hits": bucket["hits"],
        "misses": bucket["misses"],
        "hit_rate": round(bucket["hits"] / n, 4) if n else None,
        "odds_net": round(bucket["odds_net"], 2),
        "roi": round(bucket["odds_net"] / n, 4) if n else None,
    }
    if bucket["prob_n"]:
        out["log_loss"] = round(bucket["log_loss_sum"] / bucket["prob_n"], 4)
        out["brier"] = round(bucket["brier_sum"] / bucket["prob_n"], 4)
    return out


def run(disable_calibration=False, start_date=None, blend=None):
    store = json.loads((ROOT / "match_data.json").read_text(encoding="utf-8"))

    if disable_calibration:
        sr._MODEL_CALIBRATION = {}
    if blend is not None:
        b = float(blend)
        sr.WINNER_BOOKMAKER_BLEND = b
        # blend_three_way_with_bookmaker captured the original 0.40 as a default
        # arg at import time; rewrite the default tuple to pick up the override.
        sr.blend_three_way_with_bookmaker.__defaults__ = (b,)

    matches = collect_matches(store)
    print(f"FT matches in store: {len(matches)}")
    if start_date:
        matches_eval = [m for m in matches if m["date"] >= start_date]
    else:
        matches_eval = matches
    print(f"Matches scored in eval window (>= {start_date or 'all'}): {len(matches_eval)}")

    form = defaultdict(lambda: deque(maxlen=FORM_WINDOW))   # team_id -> deque of (att, def)
    cards_q = defaultdict(lambda: deque(maxlen=CARDS_WINDOW))  # team_id -> deque of cards_total
    h2h_index = defaultdict(list)                            # frozenset({h_id, a_id}) -> list of past rows
    elo = {}                                                 # team_id -> rating

    market_buckets = defaultdict(empty_bucket)
    league_market_buckets = defaultdict(lambda: defaultdict(empty_bucket))
    league_buckets = defaultdict(empty_bucket)
    overall = empty_bucket()
    rows = []

    eval_set = {m["id"] for m in matches_eval}

    for m in matches:
        h_id, a_id = m["h_id"], m["a_id"]
        # Snapshot pre-match state for prediction
        h_form = form[h_id]
        a_form = form[a_id]
        if len(h_form) >= 3:
            h_att = sum(x[0] for x in h_form) / len(h_form)
            h_def = sum(x[1] for x in h_form) / len(h_form)
        else:
            h_att = h_def = 1.40
        if len(a_form) >= 3:
            a_att = sum(x[0] for x in a_form) / len(a_form)
            a_def = sum(x[1] for x in a_form) / len(a_form)
        else:
            a_att = a_def = 1.40

        streaks = synth_streaks(cards_q[h_id], cards_q[a_id])
        h2h_hist = h2h_rows(h2h_index[frozenset({h_id, a_id})], h_id)

        sr._TEAM_ELO.clear()
        sr._TEAM_ELO.update(elo)

        # Predict using only state derived from matches before this one
        if m["id"] in eval_set:
            pred = sr.predict_enhanced(
                h_att, h_def, a_att, a_def,
                m["h_name"], m["a_name"], streaks,
                h2h=h2h_hist,
                h_team_id=h_id, a_team_id=a_id,
                league=m["league"],
                market_odds=m["odds"],
            )
            actual_side = "home" if m["hg"] > m["ag"] else ("away" if m["ag"] > m["hg"] else "draw")

            r_w, p_w, o_w = score_winner(pred, actual_side, m["odds"])
            r_b, p_b = score_btts(pred, m["hg"], m["ag"])
            r_g, p_g = score_goals(pred, m["hg"], m["ag"])
            r_c, p_c = score_cards(pred, m["cards_total"])

            for label, result, prob, odds_price in [
                ("Winner", r_w, p_w, o_w),
                ("BTTS", r_b, p_b, None),
                ("Goals", r_g, p_g, None),
                ("Cards", r_c, p_c, None),
            ]:
                if result is None:
                    continue
                update_metrics(market_buckets[label], result, prob, odds_price)
                update_metrics(league_market_buckets[m["league"]][label], result, prob, odds_price)
                update_metrics(league_buckets[m["league"]], result, prob, odds_price)
                update_metrics(overall, result, prob, odds_price)

            rows.append({
                "date": m["date"], "league": m["league"],
                "home": m["h_name"], "away": m["a_name"],
                "score": f"{m['hg']}-{m['ag']}",
                "w_pick": (pred.get("winner") or {}).get("pick"),
                "w_prob": (pred.get("winner") or {}).get("probability"),
                "w_result": r_w,
                "btts_pick": (pred.get("btts") or {}).get("pick"),
                "btts_prob": (pred.get("btts") or {}).get("probability"),
                "btts_result": r_b,
                "goals_pick": (pred.get("ou_goals") or {}).get("pick"),
                "goals_prob": (pred.get("ou_goals") or {}).get("probability"),
                "goals_result": r_g,
                "cards_pick": (pred.get("ou_cards") or {}).get("pick"),
                "cards_prob": (pred.get("ou_cards") or {}).get("probability"),
                "cards_result": r_c,
            })

        # Update state from this match's outcome (applies whether eval'd or not)
        form[h_id].append((m["hg"], m["ag"]))
        form[a_id].append((m["ag"], m["hg"]))
        if m["cards_total"] is not None:
            cards_q[h_id].append(m["cards_total"])
            cards_q[a_id].append(m["cards_total"])
        h2h_index[frozenset({h_id, a_id})].append({
            "h_id": h_id, "a_id": a_id, "hg": m["hg"], "ag": m["ag"], "date": m["date"],
        })
        # Elo update
        rh = elo.get(h_id, sr.ELO_INIT)
        ra = elo.get(a_id, sr.ELO_INIT)
        e_h = 1.0 / (1.0 + 10 ** ((ra - rh - sr.ELO_HOME_ADV) / 400.0))
        e_a = 1.0 - e_h
        if m["hg"] > m["ag"]:
            s_h, s_a = 1.0, 0.0
        elif m["hg"] < m["ag"]:
            s_h, s_a = 0.0, 1.0
        else:
            s_h, s_a = 0.5, 0.5
        elo[h_id] = rh + sr.ELO_K * (s_h - e_h)
        elo[a_id] = ra + sr.ELO_K * (s_a - e_a)

    summary = {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "ft_matches_in_store": len(matches),
        "evaluated_matches": len(matches_eval),
        "start_date": start_date,
        "calibration_used": not disable_calibration,
        "overall": finalize(overall),
        "by_market": {k: finalize(v) for k, v in market_buckets.items()},
        "by_league": {k: finalize(v) for k, v in league_buckets.items()},
        "by_league_market": {
            lname: {mkt: finalize(b) for mkt, b in mkts.items()}
            for lname, mkts in league_market_buckets.items()
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown report
    md = ["# Walk-forward backtest", "",
          f"Generated: {summary['generated_at']}",
          f"FT matches in store: {summary['ft_matches_in_store']}",
          f"Evaluated (>= {summary['start_date'] or 'all'}): {summary['evaluated_matches']}",
          f"Calibration shrink applied: {summary['calibration_used']}",
          "",
          "## Overall", ""]
    o = summary["overall"] or {}
    md.append(f"- n={o.get('n')}  hit_rate={o.get('hit_rate')}  log_loss={o.get('log_loss')}  brier={o.get('brier')}  odds_net={o.get('odds_net')}  roi={o.get('roi')}")
    md += ["", "## By market", "",
           "| Market | n | hit_rate | log_loss | brier | odds_net | ROI |",
           "|---|---|---|---|---|---|---|"]
    for mk, b in summary["by_market"].items():
        if not b: continue
        md.append(f"| {mk} | {b['n']} | {b['hit_rate']} | {b.get('log_loss','')} | {b.get('brier','')} | {b['odds_net']} | {b['roi']} |")
    md += ["", "## By league", "",
           "| League | n | hit_rate | odds_net | ROI |",
           "|---|---|---|---|---|"]
    for ln, b in sorted(summary["by_league"].items(), key=lambda kv: (kv[1] or {}).get("hit_rate", 0) or 0):
        if not b: continue
        md.append(f"| {ln} | {b['n']} | {b['hit_rate']} | {b['odds_net']} | {b['roi']} |")
    MD_PATH.write_text("\n".join(md), encoding="utf-8")

    # CSV rows
    import csv
    if rows:
        with open(ROWS_PATH, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-calibration", action="store_true", help="Disable calibration shrink")
    ap.add_argument("--start-date", default=None, help="ISO date; only evaluate matches on/after this date")
    ap.add_argument("--blend", type=float, default=None, help="Override WINNER_BOOKMAKER_BLEND (0=model only, 1=bookmaker only)")
    args = ap.parse_args()
    s = run(disable_calibration=args.no_calibration, start_date=args.start_date, blend=args.blend)
    print(f"Wrote {SUMMARY_PATH}")
    print(f"Overall: {s.get('overall')}")
    for k, v in (s.get("by_market") or {}).items():
        print(f"  {k:8s} {v}")


if __name__ == "__main__":
    main()
