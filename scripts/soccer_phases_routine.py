#!/usr/bin/env python3
"""Phase 7 orchestrator + daily summary.

Runs Phases 1-6 sequentially via subprocess, captures each phase's exit code
and headline counts, then composes a one-page daily summary for human review.
"""
import argparse
import csv
import json
import subprocess
import sys
import time
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
SCRIPTS = ROOT / "scripts"
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
SUMMARY_PATH = OUT_DIR / "Phase7_Daily_Summary.md"
RUN_LOG_PATH = OUT_DIR / "Phase7_Run_Log.json"

PHASES = [
    ("1 Fixtures",       "soccer_phase1_fixtures.py",      None),
    ("2 Odds",           "soccer_phase2_odds.py",          OUT_DIR / "phase1_fixture_slate_current.csv"),
    ("3 Team Context",   "soccer_phase3_team_context.py",  OUT_DIR / "phase2_odds_slate_current.csv"),
    ("4 Predictions",    "soccer_phase4_predictions.py",   OUT_DIR / "phase3_team_context_current.csv"),
    ("5 Value & Risk",   "soccer_phase5_value_risk.py",    OUT_DIR / "phase4_predictions_current.csv"),
    ("6 Settlement",     "soccer_phase6_settlement.py",    OUT_DIR / "phase5_value_risk_current.csv"),
]


def run_phase(label, script, required_input):
    if required_input and not required_input.exists():
        return {"label": label, "status": "skipped",
                "exit": None, "duration_s": 0, "last_line": "",
                "reason": f"missing input: {required_input.name}"}
    start = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / script)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=600,
        )
        out_lines = [l for l in (proc.stdout or "").splitlines() if l.strip()]
        last_line = out_lines[-1] if out_lines else ""
        status = "ok" if proc.returncode == 0 else "failed"
        return {"label": label, "status": status,
                "exit": proc.returncode, "duration_s": round(time.monotonic() - start, 2),
                "last_line": last_line,
                "stderr_tail": (proc.stderr or "")[-500:]}
    except Exception as exc:
        return {"label": label, "status": "failed",
                "exit": None, "duration_s": round(time.monotonic() - start, 2),
                "last_line": "", "stderr_tail": str(exc)}


def read_csv_safe(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as h:
        return list(csv.DictReader(h))


def health_table():
    p1 = read_csv_safe(OUT_DIR / "phase1_fixture_slate_current.csv")
    p2 = read_csv_safe(OUT_DIR / "phase2_odds_slate_current.csv")
    p3 = read_csv_safe(OUT_DIR / "phase3_team_context_current.csv")
    p4 = read_csv_safe(OUT_DIR / "phase4_predictions_current.csv")
    p5 = read_csv_safe(OUT_DIR / "phase5_value_risk_current.csv")
    p6 = read_csv_safe(OUT_DIR / "phase6_settlement_current.csv")
    def count(rows, key, val):
        return sum(1 for r in rows if r.get(key) == val)
    rows = [
        ("1 Fixtures", count(p1, "phase1_status", "ready_for_phase_2"),
         len(p1) - count(p1, "phase1_status", "ready_for_phase_2"),
         "Flashscore" if p1 else "n/a"),
        ("2 Odds", count(p2, "phase2_status", "ready_for_phase_3"),
         len(p2) - count(p2, "phase2_status", "ready_for_phase_3"),
         "Sportsbet (mimic)"),
        ("3 Team Context", count(p3, "phase3_status", "ready_for_phase_4"),
         len(p3) - count(p3, "phase3_status", "ready_for_phase_4"),
         "SofaScore (mimic)"),
        ("4 Predictions", count(p4, "phase4_status", "ready_for_phase_5"),
         len(p4) - count(p4, "phase4_status", "ready_for_phase_5"),
         "model"),
        ("5 Value & Risk",
         f"{count(p5, 'phase5_status', 'bet')} bets / {count(p5, 'phase5_status', 'lean')} leans",
         count(p5, "phase5_status", "no_value") + count(p5, "phase5_status", "upstream_blocked"),
         "model"),
        ("6 Settlement",
         f"{count(p6, 'phase6_status', 'won')} won / {count(p6, 'phase6_status', 'lost')} lost",
         count(p6, "phase6_status", "pending") + count(p6, "phase6_status", "not_found"),
         "Flashscore"),
    ]
    return rows


def history_summary():
    path = OUT_DIR / "phase6_settlement_history.jsonl"
    if not path.exists():
        return None
    bets = 0
    won = 0
    lost = 0
    staked = 0.0
    realized = 0.0
    with path.open("r", encoding="utf-8") as h:
        for line in h:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("phase5_status") != "bet":
                continue
            if rec.get("phase6_status") not in ("won", "lost"):
                continue
            bets += 1
            try:
                staked += float(rec.get("top_stake") or 0)
                realized += float(rec.get("realized_return") or 0)
            except (TypeError, ValueError):
                pass
            if rec["phase6_status"] == "won":
                won += 1
            else:
                lost += 1
    hit_rate = won / bets if bets else 0.0
    roi = realized / staked if staked else 0.0
    return {
        "bets": bets, "won": won, "lost": lost,
        "staked": round(staked, 2), "realized": round(realized, 2),
        "hit_rate": round(hit_rate, 4), "roi": round(roi, 4),
    }


def write_summary(run_results):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(ADL).strftime("%Y-%m-%d %H:%M %Z")
    p1 = read_csv_safe(OUT_DIR / "phase1_fixture_slate_current.csv")
    p5 = read_csv_safe(OUT_DIR / "phase5_value_risk_current.csv")
    dates = sorted({r.get("date", "") for r in p1 if r.get("date")})
    window = f"{dates[0]} to {dates[-1]}" if dates else "n/a"

    lines = [
        "# Soccer Stats Daily Summary",
        "",
        f"Generated: {now}",
        f"Date window: {window}",
        "",
        "## Phase Run Status",
        "",
        "| Phase | Status | Exit | Duration | Last line |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in run_results:
        last = (r.get("last_line") or "")[:120]
        lines.append(f"| {r['label']} | {r['status']} | {r.get('exit','')} | {r.get('duration_s','')}s | {last} |")

    lines.extend(["", "## Phase Health", "",
                  "| Phase | Ready | Blocked | Source |",
                  "| --- | --- | --- | --- |"])
    for label, ready, blocked, source in health_table():
        lines.append(f"| {label} | {ready} | {blocked} | {source} |")

    bets = [r for r in p5 if r.get("phase5_status") == "bet"]
    leans = [r for r in p5 if r.get("phase5_status") == "lean"]
    lines.extend(["", "## Today's Bets", ""])
    if bets:
        lines.extend([
            "| Date | Time | League | Match | Pick | Model p | Fair | Market | Edge | Stake |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ])
        for b in bets:
            try:
                fair = round(1.0 / float(b.get("top_p")), 3)
            except (TypeError, ValueError, ZeroDivisionError):
                fair = ""
            lines.append(
                f"| {b.get('date','')} | {b.get('time','')} | {b.get('league','')} | "
                f"{b.get('home','')} vs {b.get('away','')} | {b.get('top_side','')} | "
                f"{b.get('top_p','')} | {fair} | {b.get('top_market_odds','')} | "
                f"{b.get('top_edge','')} | {b.get('top_stake','')} |"
            )
    else:
        lines.append("No bets above threshold.")

    if leans:
        lines.extend(["", "## Leans (below bet threshold)", "",
                      "| Match | Pick | Model p | Market | Edge |",
                      "| --- | --- | --- | --- | --- |"])
        for l in leans:
            lines.append(
                f"| {l.get('home','')} vs {l.get('away','')} | {l.get('top_side','')} | "
                f"{l.get('top_p','')} | {l.get('top_market_odds','')} | {l.get('top_edge','')} |"
            )

    hist = history_summary()
    lines.extend(["", "## History", ""])
    if hist and hist["bets"]:
        lines.extend([
            f"- Total settled bets: {hist['bets']}",
            f"- Won: {hist['won']}  Lost: {hist['lost']}",
            f"- Hit rate: {hist['hit_rate'] * 100:.1f}%",
            f"- ROI: {hist['roi'] * 100:.2f}% (staked {hist['staked']} -> realized {hist['realized']})",
        ])
    else:
        lines.append("No settled bets in history yet.")

    lines.extend([
        "",
        "## Responsible Betting",
        "",
        "Estimates only. No guarantees. All probabilities and prices are derived from public sources and a Poisson model; actual outcomes can differ. Stake within personal limits.",
    ])

    SUMMARY_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-html", action="store_true",
                        help="(reserved) Update the dashboard data block in index.html. Default: off.")
    args = parser.parse_args()

    run_results = []
    for label, script, required in PHASES:
        result = run_phase(label, script, required)
        run_results.append(result)
        last = result.get("last_line") or result.get("reason") or ""
        print(f"[{label}] {result['status']}  {last}")

    write_summary(run_results)
    RUN_LOG_PATH.write_text(json.dumps(run_results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDaily summary: {SUMMARY_PATH}")
    print(f"Run log: {RUN_LOG_PATH}")

    if args.update_html:
        print("--update-html is reserved. No HTML changes performed in this build.")


if __name__ == "__main__":
    main()
