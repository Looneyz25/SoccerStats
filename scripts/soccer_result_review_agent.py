#!/usr/bin/env python3
"""Result review agent for model calibration.

Reads finished matches from match_data.json, reviews settled prediction markets,
and writes daily model-feedback outputs for the agent system.
"""
import csv
import json
from collections import Counter, defaultdict
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
CSV_PATH = OUT_DIR / "model_result_review_current.csv"
MD_PATH = OUT_DIR / "model_result_review_current.md"
SUMMARY_JSON = OUT_DIR / "model_result_review_summary.json"

MARKETS = [
    ("winner", "Winner"),
    ("btts", "BTTS"),
    ("ou_goals", "Goals"),
    ("ou_cards", "Cards"),
]

ROW_HEADERS = [
    "run_timestamp", "league", "event_id", "date", "home", "away",
    "market", "pick", "line", "odds", "implied_probability", "model_probability",
    "result", "actual", "review_flag", "model_note",
]


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def flatten_matches(data):
    rows = []
    for league in data.get("leagues", []):
        for match in league.get("matches", []) or []:
            item = dict(match)
            item["league"] = league.get("name", "")
            item["league_id"] = league.get("id", "")
            rows.append(item)
    return rows


def market_pick(market_key, market):
    if market_key == "winner":
        return market.get("pick") or market.get("type") or ""
    if market_key in ("ou_goals", "ou_cards"):
        line = market.get("line")
        return f"{market.get('pick', '')} {line}".strip() if line not in (None, "") else market.get("pick", "")
    return market.get("pick", "")


def market_actual(market_key, match, market):
    actuals = match.get("actuals") or {}
    if market_key == "winner":
        home_goals = ((match.get("home") or {}).get("goals"))
        away_goals = ((match.get("away") or {}).get("goals"))
        if isinstance(home_goals, int) and isinstance(away_goals, int):
            if home_goals > away_goals:
                return "home"
            if away_goals > home_goals:
                return "away"
            return "draw"
    if market_key == "btts":
        if "actual_btts" in market:
            return market.get("actual_btts")
        home_goals = ((match.get("home") or {}).get("goals"))
        away_goals = ((match.get("away") or {}).get("goals"))
        if isinstance(home_goals, int) and isinstance(away_goals, int):
            return home_goals > 0 and away_goals > 0
    if market_key == "ou_goals":
        return market.get("actual")
    if market_key == "ou_cards":
        return market.get("actual") if "actual" in market else actuals.get("cards_total")
    return ""


def model_probability(market):
    for key in ("probability", "model_probability", "p", "top_p"):
        value = to_float(market.get(key))
        if value is not None:
            return value
    return None


def review_flag(market_key, match, market):
    odds = to_float(market.get("odds"))
    probability = model_probability(market)
    factors = ((match.get("predictions") or {}).get("factors") or {})
    source = str(factors.get("source", "")).lower()
    if "retro" in source:
        return "retro_snapshot"
    if probability is None:
        return "missing_model_probability"
    if odds and odds > 0:
        implied = 1 / odds
        edge = probability - implied
        if edge >= 0.08 and market.get("result") == "miss":
            return "high_edge_miss"
        if edge <= -0.05 and market.get("result") == "hit":
            return "low_edge_hit"
    if market_key == "winner" and market.get("type") == "draw":
        return "draw_pick"
    return ""


def model_note(flag, market_key, market):
    if flag == "retro_snapshot":
        return "Use for hit-rate tracking only; source was retrofitted after original prediction."
    if flag == "missing_model_probability":
        return "Store market probability with the prediction so calibration bins can be measured."
    if flag == "high_edge_miss":
        return "Review overconfidence: model edge was strong but outcome missed."
    if flag == "low_edge_hit":
        return "Review possible underconfidence: low or negative edge still hit."
    if flag == "draw_pick":
        return "Audit draw threshold separately; draw picks can distort winner-market calibration."
    if market_key == "ou_cards" and market.get("result") == "miss":
        return "Check cards line source and referee/team-card weighting."
    return ""


def build_rows(data):
    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    rows = []
    for match in flatten_matches(data):
        if match.get("status") != "FT":
            continue
        predictions = match.get("predictions") or {}
        for market_key, label in MARKETS:
            market = predictions.get(market_key) or {}
            result = market.get("result")
            if result not in ("hit", "miss"):
                continue
            odds = to_float(market.get("odds"))
            probability = model_probability(market)
            flag = review_flag(market_key, match, market)
            rows.append({
                "run_timestamp": run_ts,
                "league": match.get("league", ""),
                "event_id": match.get("id", ""),
                "date": match.get("date", ""),
                "home": (match.get("home") or {}).get("name", ""),
                "away": (match.get("away") or {}).get("name", ""),
                "market": label,
                "pick": market_pick(market_key, market),
                "line": market.get("line", ""),
                "odds": odds if odds is not None else "",
                "implied_probability": round(1 / odds, 4) if odds and odds > 0 else "",
                "model_probability": probability if probability is not None else "",
                "result": result,
                "actual": market_actual(market_key, match, market),
                "review_flag": flag,
                "model_note": model_note(flag, market_key, market),
            })
    rows.sort(key=lambda r: (r["date"], r["league"], r["home"], r["market"]))
    return rows


def summarize(rows, group_key):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row[group_key]].append(row)
    summary = []
    for key, items in sorted(grouped.items()):
        hits = sum(1 for item in items if item["result"] == "hit")
        misses = sum(1 for item in items if item["result"] == "miss")
        odds_hit = sum(to_float(item["odds"]) or 0 for item in items if item["result"] == "hit")
        odds_loss = sum(to_float(item["odds"]) or 0 for item in items if item["result"] == "miss")
        summary.append({
            group_key: key,
            "settled": hits + misses,
            "hits": hits,
            "misses": misses,
            "hit_rate": round(hits / (hits + misses), 4) if hits + misses else 0,
            "odds_hit": round(odds_hit, 2),
            "odds_loss": round(odds_loss, 2),
            "odds_net": round(odds_hit - odds_loss, 2),
        })
    return summary


def weak_spots(rows):
    league_market = defaultdict(list)
    for row in rows:
        league_market[(row["league"], row["market"])].append(row)
    spots = []
    for (league, market), items in sorted(league_market.items()):
        settled = len(items)
        if settled < 5:
            continue
        hits = sum(1 for item in items if item["result"] == "hit")
        hit_rate = hits / settled
        odds_net = sum((to_float(item["odds"]) or 0) if item["result"] == "hit" else -(to_float(item["odds"]) or 0) for item in items)
        if hit_rate < 0.45 or odds_net < -5:
            spots.append({
                "league": league,
                "market": market,
                "settled": settled,
                "hit_rate": round(hit_rate, 4),
                "odds_net": round(odds_net, 2),
                "action": "review_weighting",
            })
    spots.sort(key=lambda item: (item["hit_rate"], item["odds_net"]))
    return spots[:12]


def recommendations(rows, market_summary, weak):
    flags = Counter(row["review_flag"] for row in rows if row["review_flag"])
    recs = []
    if flags.get("missing_model_probability"):
        recs.append("Persist model probabilities per market in match_data.json so the review agent can compare confidence bands to actual hit rate.")
    if flags.get("high_edge_miss"):
        recs.append("Inspect high-edge misses before raising thresholds; they are the cleanest overconfidence signal.")
    for item in market_summary:
        if item["settled"] >= 30 and item["hit_rate"] < 0.45:
            recs.append(f"Reduce trust or raise the value threshold for {item['market']} until its recent hit rate recovers.")
    if weak:
        top = weak[0]
        recs.append(f"First targeted review: {top['league']} {top['market']} ({top['settled']} settled, {top['hit_rate'] * 100:.1f}% hit rate).")
    if not recs:
        recs.append("No urgent model change from this sample; keep collecting settled results before changing weights.")
    return recs[:6]


def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ROW_HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def write_md(rows, market_summary, league_summary, weak, recs):
    run_ts = rows[0]["run_timestamp"] if rows else datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    lines = [
        "# Model Result Review",
        "",
        f"Generated: {run_ts}",
        f"Settled market rows: {len(rows)}",
        "",
        "## Market Summary",
        "",
        "| Market | Settled | Hits | Misses | Hit Rate | Odds Hit | Odds Loss | Odds Net |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in market_summary:
        lines.append(
            f"| {row['market']} | {row['settled']} | {row['hits']} | {row['misses']} | "
            f"{row['hit_rate'] * 100:.1f}% | {row['odds_hit']} | {row['odds_loss']} | {row['odds_net']} |"
        )
    lines.extend([
        "",
        "## League Summary",
        "",
        "| League | Settled | Hits | Misses | Hit Rate | Odds Net |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in league_summary:
        lines.append(
            f"| {row['league']} | {row['settled']} | {row['hits']} | {row['misses']} | "
            f"{row['hit_rate'] * 100:.1f}% | {row['odds_net']} |"
        )
    lines.extend(["", "## Weak Spots", ""])
    if weak:
        lines.extend([
            "| League | Market | Settled | Hit Rate | Odds Net | Action |",
            "| --- | --- | ---: | ---: | ---: | --- |",
        ])
        for item in weak:
            lines.append(
                f"| {item['league']} | {item['market']} | {item['settled']} | "
                f"{item['hit_rate'] * 100:.1f}% | {item['odds_net']} | {item['action']} |"
            )
    else:
        lines.append("No weak spot met the minimum sample threshold.")
    lines.extend(["", "## Recommendations", ""])
    for rec in recs:
        lines.append(f"- {rec}")
    lines.extend([
        "",
        "## Review Flags",
        "",
        "| Flag | Count |",
        "| --- | ---: |",
    ])
    for flag, count in Counter(row["review_flag"] or "none" for row in rows).most_common():
        lines.append(f"| {flag} | {count} |")
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_summary_json(rows, market_summary, league_summary, weak, recs):
    payload = {
        "generated_at": rows[0]["run_timestamp"] if rows else datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z"),
        "settled_market_rows": len(rows),
        "market_summary": market_summary,
        "league_summary": league_summary,
        "weak_spots": weak,
        "recommendations": recs,
        "outputs": {
            "csv": str(CSV_PATH.relative_to(ROOT)),
            "markdown": str(MD_PATH.relative_to(ROOT)),
        },
    }
    SUMMARY_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    if not STORE.exists():
        raise SystemExit(f"Missing match data: {STORE}")
    data = json.loads(STORE.read_text(encoding="utf-8"))
    rows = build_rows(data)
    market_summary = summarize(rows, "market")
    league_summary = summarize(rows, "league")
    weak = weak_spots(rows)
    recs = recommendations(rows, market_summary, weak)

    write_csv(rows)
    write_md(rows, market_summary, league_summary, weak, recs)
    write_summary_json(rows, market_summary, league_summary, weak, recs)

    top_action = recs[0] if recs else "No recommendation."
    print(f"Result review written: {MD_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"settled_market_rows={len(rows)} weak_spots={len(weak)} top_action={top_action}")


if __name__ == "__main__":
    main()
