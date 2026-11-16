#!/usr/bin/env python3
"""Model calibration agent.

Turns the result-review summary into conservative learning controls consumed by
the live predictor and Phase 4/5 model pipeline.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ADL = ZoneInfo("Australia/Adelaide")
    except ZoneInfoNotFoundError:
        ADL = timezone(timedelta(hours=9, minutes=30))
except ImportError:
    ADL = timezone(timedelta(hours=9, minutes=30))

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
STORE = ROOT / "match_data.json"
REVIEW_JSON = OUT_DIR / "model_result_review_summary.json"
CALIBRATION_JSON = OUT_DIR / "model_calibration.json"
CALIBRATION_MD = OUT_DIR / "model_calibration.md"

MARKET_KEYS = {
    "Winner": "winner",
    "BTTS": "btts",
    "Goals": "ou_goals",
    "Cards": "ou_cards",
    "Corners": "ou_corners",
}

MIN_MARKET_SAMPLE = 50
MIN_LEAGUE_MARKET_SAMPLE = 20
TARGET_HIT_RATE = 0.60
MAX_MARKET_EDGE_DELTA = 0.04
MAX_LEAGUE_EDGE_DELTA = 0.06
MIN_TRUST_FACTOR = 0.85
# Must match soccer_result_review_agent.PREDICTION_TRACKING_START_DATE.
PREDICTION_TRACKING_START_DATE = "2026-04-22"
WINNER_SIDES = ("home", "draw", "away")
WINNER_TRUST_STEP = 0.01


def clamp(value, low, high):
    return max(low, min(high, value))


def adjustment_from_hit_rate(hit_rate, sample, max_delta):
    under = max(0.0, TARGET_HIT_RATE - hit_rate)
    sample_factor = clamp(sample / 100.0, 0.25, 1.0)
    trust_factor = clamp(1.0 - (under * 0.9 * sample_factor), MIN_TRUST_FACTOR, 1.0)
    min_edge_delta = clamp(under * 0.35 * sample_factor, 0.0, max_delta)
    return round(trust_factor, 4), round(min_edge_delta, 4)


def three_way(value):
    """Normalised {home, draw, away} from a stored probability dict, else None."""
    if not isinstance(value, dict):
        return None
    out = {}
    for side in WINNER_SIDES:
        p = value.get(side)
        if isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or p < 0:
            return None
        out[side] = float(p)
    total = sum(out.values())
    if total <= 0:
        return None
    return {side: p / total for side, p in out.items()}


def winner_benchmark_rows(store):
    """Settled winner predictions that carry a bookmaker 1X2 benchmark.

    Each row holds the pre-shrink model probabilities, the no-vig bookmaker
    probabilities and blend weight used when it was published, and the actual side.
    """
    rows = []
    for league in store.get("leagues", []) or []:
        for match in league.get("matches", []) or []:
            if match.get("status") != "FT" or str(match.get("date") or "") < PREDICTION_TRACKING_START_DATE:
                continue
            predictions = match.get("predictions") or {}
            if "retro" in str((predictions.get("factors") or {}).get("source", "")).lower():
                continue
            winner = predictions.get("winner") or {}
            if winner.get("result") not in ("hit", "miss"):
                continue
            home_goals = (match.get("home") or {}).get("goals")
            away_goals = (match.get("away") or {}).get("goals")
            if not isinstance(home_goals, int) or not isinstance(away_goals, int):
                continue
            raw = three_way(winner.get("raw_probabilities"))
            book = three_way(winner.get("bookmaker_probabilities"))
            weight = winner.get("bookmaker_blend_weight")
            if not raw or not book or isinstance(weight, bool) or not isinstance(weight, (int, float)) or not 0 <= weight <= 1:
                continue
            if home_goals > away_goals:
                actual = "home"
            elif away_goals > home_goals:
                actual = "away"
            else:
                actual = "draw"
            rows.append({"raw": raw, "book": book, "weight": float(weight), "actual": actual})
    return rows


def published_winner_probabilities(row, trust_factor):
    """Mirror soccer_routine.predict_enhanced: shrink raw toward 1/3, normalise, blend with the bookmaker."""
    model = {side: (1 / 3) + (row["raw"][side] - (1 / 3)) * trust_factor for side in WINNER_SIDES}
    total = sum(model.values())
    model = {side: p / total for side, p in model.items()}
    weight = row["weight"]
    blended = {side: model[side] * (1 - weight) + row["book"][side] * weight for side in WINNER_SIDES}
    total = sum(blended.values())
    return {side: p / total for side, p in blended.items()}


def mean_log_loss(rows, probabilities_for):
    return sum(-math.log(max(probabilities_for(row)[row["actual"]], 1e-12)) for row in rows) / len(rows)


def fit_winner_trust(rows):
    """Trust factor in [MIN_TRUST_FACTOR, 1.0] that minimises published log loss; ties keep the higher trust."""
    steps = int(round((1.0 - MIN_TRUST_FACTOR) / WINNER_TRUST_STEP))
    grid = [round(MIN_TRUST_FACTOR + i * WINNER_TRUST_STEP, 4) for i in range(steps + 1)]
    scored = [
        (round(mean_log_loss(rows, lambda row, t=t: published_winner_probabilities(row, t)), 10), -t)
        for t in grid
    ]
    best_loss, neg_trust = min(scored)
    return {
        "trust_factor": -neg_trust,
        "published_log_loss": round(best_loss, 4),
        "full_trust_log_loss": round(mean_log_loss(rows, lambda row: published_winner_probabilities(row, 1.0)), 4),
        "bookmaker_log_loss": round(mean_log_loss(rows, lambda row: row["book"]), 4),
    }


def winner_market_adjustment(review_row, benchmark_rows):
    settled = int(review_row.get("settled") or 0)
    hit_rate = float(review_row.get("hit_rate") or 0)
    min_edge_delta = 0.0
    if settled >= MIN_MARKET_SAMPLE and hit_rate < TARGET_HIT_RATE:
        _, min_edge_delta = adjustment_from_hit_rate(hit_rate, settled, MAX_MARKET_EDGE_DELTA)
    edge_reason = f"edge delta from {hit_rate:.1%} hit rate vs {TARGET_HIT_RATE:.0%} target."
    if len(benchmark_rows) < MIN_MARKET_SAMPLE:
        if min_edge_delta <= 0:
            return None
        return {
            "market": review_row.get("market") or "Winner",
            "settled": settled,
            "hit_rate": hit_rate,
            "trust_factor": 1.0,
            "min_edge_delta": min_edge_delta,
            "trust_rule": "insufficient_benchmark",
            "benchmark_rows": len(benchmark_rows),
            "reason": (
                f"Winner trust left at 1.0: {len(benchmark_rows)} settled rows with bookmaker odds "
                f"(need {MIN_MARKET_SAMPLE}); {edge_reason}"
            ),
        }
    fit = fit_winner_trust(benchmark_rows)
    if fit["trust_factor"] >= 1.0 and min_edge_delta <= 0:
        return None
    return {
        "market": review_row.get("market") or "Winner",
        "settled": settled,
        "hit_rate": hit_rate,
        "trust_factor": fit["trust_factor"],
        "min_edge_delta": min_edge_delta,
        "trust_rule": "log_loss_fit",
        "benchmark_rows": len(benchmark_rows),
        "published_log_loss": fit["published_log_loss"],
        "full_trust_log_loss": fit["full_trust_log_loss"],
        "bookmaker_log_loss": fit["bookmaker_log_loss"],
        "reason": (
            f"Winner trust fitted to published log loss over {len(benchmark_rows)} settled rows with "
            f"bookmaker odds (published {fit['published_log_loss']:.4f}, bookmaker {fit['bookmaker_log_loss']:.4f}); "
            f"{edge_reason}"
        ),
    }


def build_calibration(review, store):
    generated_at = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    market_adjustments = {}
    league_market_adjustments = {}
    winner_rows = winner_benchmark_rows(store)

    for row in review.get("market_summary", []):
        market = row.get("market")
        key = MARKET_KEYS.get(market)
        settled = int(row.get("settled") or 0)
        hit_rate = float(row.get("hit_rate") or 0)
        if key == "winner":
            adjustment = winner_market_adjustment(row, winner_rows)
            if adjustment:
                market_adjustments[key] = adjustment
            continue
        if not key or settled < MIN_MARKET_SAMPLE or hit_rate >= TARGET_HIT_RATE:
            continue
        trust_factor, min_edge_delta = adjustment_from_hit_rate(hit_rate, settled, MAX_MARKET_EDGE_DELTA)
        market_adjustments[key] = {
            "market": market,
            "settled": settled,
            "hit_rate": hit_rate,
            "trust_factor": trust_factor,
            "min_edge_delta": min_edge_delta,
            "reason": f"{market} below {TARGET_HIT_RATE:.0%} target over {settled} settled markets.",
        }

    for row in review.get("weak_spots", []):
        market = row.get("market")
        key = MARKET_KEYS.get(market)
        league = row.get("league")
        settled = int(row.get("settled") or 0)
        hit_rate = float(row.get("hit_rate") or 0)
        if not key or not league or settled < MIN_LEAGUE_MARKET_SAMPLE:
            continue
        trust_factor, min_edge_delta = adjustment_from_hit_rate(hit_rate, settled, MAX_LEAGUE_EDGE_DELTA)
        league_market_adjustments[f"{league}|{key}"] = {
            "league": league,
            "market": market,
            "market_key": key,
            "settled": settled,
            "hit_rate": hit_rate,
            "odds_net": row.get("odds_net", 0),
            "trust_factor": trust_factor,
            "min_edge_delta": min_edge_delta,
            "reason": f"{league} {market} weak spot from result review.",
        }

    return {
        "generated_at": generated_at,
        "source": str(REVIEW_JSON.relative_to(ROOT)),
        "mode": "conservative_auto_learning",
        "rules": {
            "target_hit_rate": TARGET_HIT_RATE,
            "winner_trust_rule": "log_loss_fit",
            "min_market_sample": MIN_MARKET_SAMPLE,
            "min_league_market_sample": MIN_LEAGUE_MARKET_SAMPLE,
            "min_trust_factor": MIN_TRUST_FACTOR,
            "max_market_edge_delta": MAX_MARKET_EDGE_DELTA,
            "max_league_edge_delta": MAX_LEAGUE_EDGE_DELTA,
        },
        "market_adjustments": market_adjustments,
        "league_market_adjustments": league_market_adjustments,
        "notes": [
            "Trust factors shrink model probabilities toward neutral, not toward the opposite pick.",
            "Winner market trust is the factor that minimises published log loss on settled rows with bookmaker odds; other markets use the hit-rate target.",
            "Edge deltas raise the threshold before a value pick becomes a bet.",
            "Adjustments are regenerated from settled results during the daily routine.",
        ],
    }


def write_md(calibration):
    lines = [
        "# Model Calibration",
        "",
        f"Generated: {calibration['generated_at']}",
        f"Mode: {calibration['mode']}",
        "",
        "## Market Adjustments",
        "",
        "| Market | Settled | Hit Rate | Trust Factor | Min Edge Delta | Reason |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in calibration["market_adjustments"].values():
        lines.append(
            f"| {row['market']} | {row['settled']} | {row['hit_rate'] * 100:.1f}% | "
            f"{row['trust_factor']} | {row['min_edge_delta']} | {row['reason']} |"
        )
    if not calibration["market_adjustments"]:
        lines.append("| None | 0 | 0.0% | 1.0 | 0.0 | No market met the learning threshold. |")

    lines.extend([
        "",
        "## League Market Adjustments",
        "",
        "| League | Market | Settled | Hit Rate | Trust Factor | Min Edge Delta | Reason |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ])
    for row in calibration["league_market_adjustments"].values():
        lines.append(
            f"| {row['league']} | {row['market']} | {row['settled']} | {row['hit_rate'] * 100:.1f}% | "
            f"{row['trust_factor']} | {row['min_edge_delta']} | {row['reason']} |"
        )
    if not calibration["league_market_adjustments"]:
        lines.append("| None | None | 0 | 0.0% | 1.0 | 0.0 | No league/market weak spot met the learning threshold. |")

    lines.extend(["", "## Notes", ""])
    for note in calibration["notes"]:
        lines.append(f"- {note}")
    CALIBRATION_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    if not REVIEW_JSON.exists():
        raise SystemExit(f"Missing result review summary: {REVIEW_JSON}")
    if not STORE.exists():
        raise SystemExit(f"Missing match store: {STORE}")
    review = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    store = json.loads(STORE.read_text(encoding="utf-8"))
    calibration = build_calibration(review, store)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CALIBRATION_JSON.write_text(json.dumps(calibration, indent=2, ensure_ascii=False), encoding="utf-8")
    write_md(calibration)
    print(f"Model calibration written: {CALIBRATION_JSON}")
    print(f"Markdown: {CALIBRATION_MD}")
    print(
        "market_adjustments="
        f"{len(calibration['market_adjustments'])} "
        "league_market_adjustments="
        f"{len(calibration['league_market_adjustments'])}"
    )


if __name__ == "__main__":
    main()
