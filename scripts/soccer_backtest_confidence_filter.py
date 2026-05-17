#!/usr/bin/env python3
"""Bucket Winner predictions by bookmaker confidence and report hit rate / ROI
in each band. Tells us whether high-confidence picks are actually higher-hit
(real signal) or whether the bookmaker is uniformly noisy (favourite-longshot).

Run alongside soccer_backtest_winner_models.py — uses the same walk-forward
state machinery but groups results by the no-vig probability of the picked
side rather than aggregating everything together.
"""
import argparse
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import soccer_routine as sr  # noqa: E402
from soccer_backtest_walkforward import collect_matches  # noqa: E402
from soccer_backtest_winner_models import no_vig_probs, pick_side  # noqa: E402

ELO_INIT = sr.ELO_INIT
ELO_K = sr.ELO_K
ELO_HOME_ADV = sr.ELO_HOME_ADV

OUT_PATH = ROOT / "docs" / "agent-system" / "outputs" / "backtest_confidence_filter.json"


def run(start_date="2026-04-22"):
    store = json.loads((ROOT / "match_data.json").read_text(encoding="utf-8"))
    matches = collect_matches(store)
    eval_set = {m["id"] for m in matches if m["date"] >= start_date}

    # Buckets keyed by min-confidence threshold for the picked side
    bands = [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]
    band_stats = {b: {"n": 0, "hits": 0, "odds_net": 0.0} for b in bands}
    # Also bucket by no-vig prob band (deciles) for the picked side, to detect
    # favourite-longshot bias
    decile_stats = defaultdict(lambda: {"n": 0, "hits": 0, "odds_net": 0.0,
                                          "implied_sum": 0.0})

    elo = {}
    n_total = 0; n_with_odds = 0

    for m in matches:
        h_id, a_id = m["h_id"], m["a_id"]
        if m["id"] not in eval_set:
            # Still update elo state from this match
            rh = elo.get(h_id, ELO_INIT); ra = elo.get(a_id, ELO_INIT)
            e_h = 1.0 / (1.0 + 10 ** ((ra - rh - ELO_HOME_ADV) / 400.0))
            e_a = 1.0 - e_h
            if m["hg"] > m["ag"]: s_h, s_a = 1.0, 0.0
            elif m["hg"] < m["ag"]: s_h, s_a = 0.0, 1.0
            else: s_h, s_a = 0.5, 0.5
            elo[h_id] = rh + ELO_K * (s_h - e_h)
            elo[a_id] = ra + ELO_K * (s_a - e_a)
            continue

        n_total += 1
        no_vig = no_vig_probs(m["odds"])
        if not no_vig:
            continue
        n_with_odds += 1
        pick = pick_side(no_vig)
        pick_prob = no_vig.get(pick, 0)
        actual = "home" if m["hg"] > m["ag"] else ("away" if m["ag"] > m["hg"] else "draw")
        hit = (pick == actual)
        price = (m["odds"] or {}).get(pick)
        odds_net = ((price - 1) if (price and hit) else (-1 if price else 0))

        for b in bands:
            if pick_prob >= b:
                band_stats[b]["n"] += 1
                band_stats[b]["hits"] += int(hit)
                band_stats[b]["odds_net"] += odds_net

        decile_key = round(pick_prob * 10) / 10  # 0.3, 0.4, ..., 0.8
        decile_key = max(0.3, min(0.8, decile_key))
        ds = decile_stats[decile_key]
        ds["n"] += 1
        ds["hits"] += int(hit)
        ds["odds_net"] += odds_net
        ds["implied_sum"] += pick_prob

        # State update
        rh = elo.get(h_id, ELO_INIT); ra = elo.get(a_id, ELO_INIT)
        e_h = 1.0 / (1.0 + 10 ** ((ra - rh - ELO_HOME_ADV) / 400.0))
        e_a = 1.0 - e_h
        if m["hg"] > m["ag"]: s_h, s_a = 1.0, 0.0
        elif m["hg"] < m["ag"]: s_h, s_a = 0.0, 1.0
        else: s_h, s_a = 0.5, 0.5
        elo[h_id] = rh + ELO_K * (s_h - e_h)
        elo[a_id] = ra + ELO_K * (s_a - e_a)

    print(f"Evaluated {n_total} matches; {n_with_odds} had bookmaker odds.\n")

    print("=== HIT RATE / ROI BY MIN-CONFIDENCE THRESHOLD ===")
    print(f"{'min_conf':>9s}  {'n':>4s}  {'hit_rate':>9s}  {'odds_net':>9s}  {'ROI':>7s}")
    for b in bands:
        s = band_stats[b]
        if not s["n"]: continue
        hr = s["hits"] / s["n"]
        roi = s["odds_net"] / s["n"]
        print(f"  >= {b:.2f}  {s['n']:4d}     {hr:.3f}     {s['odds_net']:+7.2f}  {roi*100:+5.1f}%")

    print("\n=== CALIBRATION CHECK — picked-side implied vs actual hit rate ===")
    print(f"{'band':>5s}  {'n':>4s}  {'avg_implied':>11s}  {'actual_hr':>9s}  {'diff':>6s}  {'ROI':>7s}")
    for key in sorted(decile_stats):
        ds = decile_stats[key]
        if not ds["n"]: continue
        avg_imp = ds["implied_sum"] / ds["n"]
        hr = ds["hits"] / ds["n"]
        roi = ds["odds_net"] / ds["n"]
        print(f"  {key:.1f}  {ds['n']:4d}     {avg_imp:.3f}        {hr:.3f}    {hr - avg_imp:+.3f}  {roi*100:+5.1f}%")

    out = {
        "evaluated": n_total,
        "with_odds": n_with_odds,
        "bands": {f"{b:.2f}": band_stats[b] for b in bands},
        "deciles": {str(k): decile_stats[k] for k in sorted(decile_stats)},
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {OUT_PATH}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-date", default="2026-04-22")
    args = ap.parse_args()
    run(start_date=args.start_date)


if __name__ == "__main__":
    main()
