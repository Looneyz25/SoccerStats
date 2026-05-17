#!/usr/bin/env python3
"""Compare alternative Winner-only predictors on the same walk-forward data.

For every FT match (chronological order) reconstruct pre-match state — Elo,
form deques, opponent-adjusted form, no-vig bookmaker implied probabilities —
and produce a Winner prediction from each of several candidate models. Score
each against the actual outcome and emit a leaderboard.

Use this to find a Winner formulation that beats the current Poisson + 40%
blend (45.9% hit, -15.2% ROI on 351 settled matches).
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
from soccer_backtest_walkforward import (  # noqa: E402
    collect_matches, synth_streaks, h2h_rows, empty_bucket, finalize, update_metrics,
)

FORM_WINDOW = 6
ELO_INIT = sr.ELO_INIT
ELO_K = sr.ELO_K
ELO_HOME_ADV = sr.ELO_HOME_ADV

OUT_PATH = ROOT / "docs" / "agent-system" / "outputs" / "backtest_winner_models.json"


# --------------------------------------------------------------------------
# Helpers


def no_vig_probs(odds):
    """Return {home, draw, away} no-vig implied probabilities from odds, or None."""
    if not odds:
        return None
    h = odds.get("home"); d = odds.get("draw"); a = odds.get("away")
    if not (h and d and a) or h <= 0 or d <= 0 or a <= 0:
        return None
    raw = {"home": 1 / h, "draw": 1 / d, "away": 1 / a}
    s = sum(raw.values())
    return {k: v / s for k, v in raw.items()}


def normalize(d):
    s = sum(d.values())
    if s <= 0:
        return {k: 1 / len(d) for k in d}
    return {k: v / s for k, v in d.items()}


def pick_side(probs):
    # Use the same draw-preference rule the live model uses, so the comparison
    # is apples-to-apples: a slight home/away edge that's actually a coin flip
    # with the draw becomes a draw pick.
    return sr.choose_winner_side(probs)


# --------------------------------------------------------------------------
# Candidate models


def model_status_quo(state, m):
    """Existing predict_enhanced with default blend=0.40."""
    pred = sr.predict_enhanced(
        state["h_att"], state["h_def"], state["a_att"], state["a_def"],
        m["h_name"], m["a_name"], state["streaks"],
        h2h=state["h2h"],
        h_team_id=m["h_id"], a_team_id=m["a_id"],
        league=m["league"],
        market_odds=m["odds"],
    )
    w = pred.get("winner") or {}
    probs = w.get("probabilities") or {}
    return probs


def model_bookmaker_only(state, m):
    """Pure no-vig bookmaker. Ceiling baseline."""
    return state["no_vig"] or {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3}


def model_elo_two_way_with_draw(state, m):
    """Pure Elo expected score, then carve out a draw probability based on
    how close the two ratings are. Larger Elo gap = smaller draw prob.
    """
    rh = state["elo_h"]; ra = state["elo_a"]
    e_home = 1.0 / (1.0 + 10 ** ((ra - rh - ELO_HOME_ADV) / 400.0))
    # Draw prob heuristic: 0.28 when teams are equal, falls to ~0.18 at large gaps.
    gap = abs(e_home - 0.5)  # 0 = even, 0.5 = totally lopsided
    p_draw = max(0.18, 0.28 - 0.20 * gap)
    p_h = e_home * (1 - p_draw)
    p_a = (1 - e_home) * (1 - p_draw)
    return normalize({"home": p_h, "draw": p_draw, "away": p_a})


def _predict_with_elo_params(state, m, scale, cap):
    """Run predict_enhanced with overridden ELO scale/cap."""
    old_scale = sr.ELO_LAMBDA_SCALE
    old_cap = sr.ELO_LAMBDA_CAP
    sr.ELO_LAMBDA_SCALE = scale
    sr.ELO_LAMBDA_CAP = cap
    try:
        pred = sr.predict_enhanced(
            state["h_att"], state["h_def"], state["a_att"], state["a_def"],
            m["h_name"], m["a_name"], state["streaks"],
            h2h=state["h2h"],
            h_team_id=m["h_id"], a_team_id=m["a_id"],
            league=m["league"],
            market_odds=m["odds"],
        )
    finally:
        sr.ELO_LAMBDA_SCALE = old_scale
        sr.ELO_LAMBDA_CAP = old_cap
    return (pred.get("winner") or {}).get("probabilities") or {}


def model_elo_strong(state, m):
    """Same model but Elo scale 200 (twice as sensitive) and cap 0.8."""
    return _predict_with_elo_params(state, m, scale=200, cap=0.8)


def model_elo_max(state, m):
    """Elo scale 150, cap 1.2 — let the rating diff dominate the lambdas."""
    return _predict_with_elo_params(state, m, scale=150, cap=1.2)


def model_opp_adj_form(state, m):
    """predict_enhanced fed opponent-adjusted form: each form sample is
    rescaled by the opponent's Elo strength so beating a top side counts more.
    Falls back to raw form for opponents we haven't seen yet.
    """
    pred = sr.predict_enhanced(
        state["h_att_adj"], state["h_def_adj"],
        state["a_att_adj"], state["a_def_adj"],
        m["h_name"], m["a_name"], state["streaks"],
        h2h=state["h2h"],
        h_team_id=m["h_id"], a_team_id=m["a_id"],
        league=m["league"],
        market_odds=m["odds"],
    )
    return (pred.get("winner") or {}).get("probabilities") or {}


def model_logistic_elo_book(state, m, weights):
    """Linear combo of Elo expected score and bookmaker no-vig prob, tuned
    via simple weights. weights = (w_elo, w_book). Picks side with max combo.
    """
    elo_probs = model_elo_two_way_with_draw(state, m)
    book = state["no_vig"] or {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3}
    w_elo, w_book = weights
    combo = {k: w_elo * elo_probs.get(k, 0) + w_book * book.get(k, 0) for k in ("home", "draw", "away")}
    return normalize(combo)


# --------------------------------------------------------------------------
# Walk-forward driver


def run(start_date=None):
    store = json.loads((ROOT / "match_data.json").read_text(encoding="utf-8"))
    matches = collect_matches(store)
    eval_set = {m["id"] for m in matches if (not start_date) or m["date"] >= start_date}
    print(f"FT matches: {len(matches)}  evaluating: {len(eval_set)}")

    form = defaultdict(lambda: deque(maxlen=FORM_WINDOW))            # (att, def) raw
    form_opp = defaultdict(lambda: deque(maxlen=FORM_WINDOW))        # (att, def, opp_elo) for opp adj
    cards_q = defaultdict(lambda: deque(maxlen=FORM_WINDOW))
    h2h_index = defaultdict(list)
    elo = {}

    models = {
        "status_quo (blend=0.4)": model_status_quo,
        "bookmaker_only": model_bookmaker_only,
        "elo_two_way": model_elo_two_way_with_draw,
        "elo_strong (scale=200,cap=0.8)": model_elo_strong,
        "elo_max (scale=150,cap=1.2)": model_elo_max,
        "opp_adj_form": model_opp_adj_form,
        "logistic 0.3/0.7": lambda s, m: model_logistic_elo_book(s, m, (0.3, 0.7)),
        "logistic 0.5/0.5": lambda s, m: model_logistic_elo_book(s, m, (0.5, 0.5)),
        "logistic 0.2/0.8": lambda s, m: model_logistic_elo_book(s, m, (0.2, 0.8)),
        "logistic 0.1/0.9": lambda s, m: model_logistic_elo_book(s, m, (0.1, 0.9)),
    }

    buckets = {name: empty_bucket() for name in models}

    def avg(q, idx):
        if len(q) < 3:
            return 1.40
        return sum(x[idx] for x in q) / len(q)

    def opp_adj_avg(q, idx):
        """Opponent-strength-adjusted form average. Each sample is multiplied by
        opponent's Elo / 1500 so beating a stronger side gives bigger values.
        """
        if len(q) < 3:
            return 1.40
        weighted = []
        for row in q:
            val = row[idx]
            opp_elo = row[2]
            factor = max(0.5, min(2.0, opp_elo / 1500.0))
            weighted.append(val * factor)
        return sum(weighted) / len(weighted)

    for m in matches:
        h_id, a_id = m["h_id"], m["a_id"]

        # Snapshot pre-match state
        sr._TEAM_ELO.clear()
        sr._TEAM_ELO.update(elo)

        rh = elo.get(h_id, ELO_INIT)
        ra = elo.get(a_id, ELO_INIT)

        state = {
            "elo_h": rh,
            "elo_a": ra,
            "h_att": avg(form[h_id], 0),
            "h_def": avg(form[h_id], 1),
            "a_att": avg(form[a_id], 0),
            "a_def": avg(form[a_id], 1),
            "h_att_adj": opp_adj_avg(form_opp[h_id], 0),
            "h_def_adj": opp_adj_avg(form_opp[h_id], 1),
            "a_att_adj": opp_adj_avg(form_opp[a_id], 0),
            "a_def_adj": opp_adj_avg(form_opp[a_id], 1),
            "streaks": synth_streaks(cards_q[h_id], cards_q[a_id]),
            "h2h": h2h_rows(h2h_index[frozenset({h_id, a_id})], h_id),
            "no_vig": no_vig_probs(m["odds"]),
        }

        if m["id"] in eval_set:
            actual = "home" if m["hg"] > m["ag"] else ("away" if m["ag"] > m["hg"] else "draw")
            odds_price = m["odds"]
            for name, fn in models.items():
                try:
                    probs = fn(state, m)
                except Exception as e:
                    print(f"  model {name} failed on {m['id']}: {e}")
                    continue
                if not probs:
                    continue
                pick = pick_side(probs)
                result = "hit" if pick == actual else "miss"
                prob_actual = probs.get(actual)
                price = odds_price.get(pick) if (odds_price and pick in odds_price) else None
                update_metrics(buckets[name], result, prob_actual, price)

        # Update state from this match's outcome
        form[h_id].append((m["hg"], m["ag"]))
        form[a_id].append((m["ag"], m["hg"]))
        # opp_adj form: store opponent's pre-match Elo so we can weight by strength
        form_opp[h_id].append((m["hg"], m["ag"], ra))
        form_opp[a_id].append((m["ag"], m["hg"], rh))
        if m["cards_total"] is not None:
            cards_q[h_id].append(m["cards_total"])
            cards_q[a_id].append(m["cards_total"])
        h2h_index[frozenset({h_id, a_id})].append({
            "h_id": h_id, "a_id": a_id, "hg": m["hg"], "ag": m["ag"], "date": m["date"],
        })
        e_h = 1.0 / (1.0 + 10 ** ((ra - rh - ELO_HOME_ADV) / 400.0))
        e_a = 1.0 - e_h
        if m["hg"] > m["ag"]:
            s_h, s_a = 1.0, 0.0
        elif m["hg"] < m["ag"]:
            s_h, s_a = 0.0, 1.0
        else:
            s_h, s_a = 0.5, 0.5
        elo[h_id] = rh + ELO_K * (s_h - e_h)
        elo[a_id] = ra + ELO_K * (s_a - e_a)

    out = {"start_date": start_date,
           "evaluated": len(eval_set),
           "models": {name: finalize(b) for name, b in buckets.items()}}
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWinner-model leaderboard (n={len(eval_set)}):")
    rows = [(name, b) for name, b in out["models"].items() if b]
    rows.sort(key=lambda x: -(x[1].get("hit_rate") or 0))
    print(f"  {'model':40s}  {'hit':>6s}  {'log_loss':>9s}  {'brier':>6s}  {'odds_net':>9s}  {'ROI':>7s}")
    for name, b in rows:
        print(f"  {name:40s}  {b['hit_rate']:.3f}  {b.get('log_loss','-'):>9}  {b.get('brier','-'):>6}  {b['odds_net']:+.2f}  {b['roi']*100:+.2f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-date", default="2026-04-22")
    args = ap.parse_args()
    run(start_date=args.start_date)


if __name__ == "__main__":
    main()
