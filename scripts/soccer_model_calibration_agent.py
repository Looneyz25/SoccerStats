#!/usr/bin/env python3
"""Model calibration agent.

Turns the result-review summary into conservative learning controls consumed by
the live predictor and Phase 4/5 model pipeline.
"""
import json
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


def clamp(value, low, high):
    return max(low, min(high, value))


def adjustment_from_hit_rate(hit_rate, sample, max_delta):
    under = max(0.0, TARGET_HIT_RATE - hit_rate)
    sample_factor = clamp(sample / 100.0, 0.25, 1.0)
    trust_factor = clamp(1.0 - (under * 0.9 * sample_factor), MIN_TRUST_FACTOR, 1.0)
    min_edge_delta = clamp(under * 0.35 * sample_factor, 0.0, max_delta)
    return round(trust_factor, 4), round(min_edge_delta, 4)


def build_calibration(review):
    generated_at = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    market_adjustments = {}
    league_market_adjustments = {}

    for row in review.get("market_summary", []):
        market = row.get("market")
        key = MARKET_KEYS.get(market)
        settled = int(row.get("settled") or 0)
        hit_rate = float(row.get("hit_rate") or 0)
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
    review = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    calibration = build_calibration(review)
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
