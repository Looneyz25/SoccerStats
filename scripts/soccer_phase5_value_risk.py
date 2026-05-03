#!/usr/bin/env python3
"""Phase 5 value + risk.

Reads Phase 4 predictions, evaluates per-side edge / EV / Kelly stake,
classifies bet/lean/pass, applies per-bet and portfolio caps, writes the
Phase 5 review workbook.
"""
import argparse
import csv
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

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
PHASE4_CSV = OUT_DIR / "phase4_predictions_current.csv"
XLSX_PATH = OUT_DIR / "Phase5_Value_Risk.xlsx"
CSV_PATH = OUT_DIR / "phase5_value_risk_current.csv"
MD_PATH = OUT_DIR / "phase5_value_risk_current.md"

LOCAL_TZ = "Australia/Adelaide"
SIDES = ("home", "draw", "away")

DEFAULTS = dict(
    bankroll=1000.0,
    kelly_fraction=0.25,
    min_edge=0.05,
    min_price=1.30,
    max_stake_pct=0.02,
    max_exposure_pct=0.10,
)

HEADERS = [
    "run_timestamp", "league", "event_id", "date", "time", "home", "away",
    "home_p", "home_market", "home_edge", "home_ev", "home_kelly", "home_stake", "home_decision",
    "draw_p", "draw_market", "draw_edge", "draw_ev", "draw_kelly", "draw_stake", "draw_decision",
    "away_p", "away_market", "away_edge", "away_ev", "away_kelly", "away_stake", "away_decision",
    "top_side", "top_decision", "top_market_odds", "top_p", "top_edge", "top_stake",
    "risk_scale_factor",
    "phase5_status", "phase5_notes",
]


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def evaluate_side(p, market, cfg):
    if p is None or market is None or market <= 1.0:
        return {"edge": "", "ev": "", "kelly": 0.0, "decision": "pass"}
    implied = 1.0 / market
    edge = p - implied
    ev = p * (market - 1) - (1 - p)
    kelly_raw = (p * market - 1) / (market - 1)
    kelly = max(0.0, kelly_raw)
    if edge >= cfg["min_edge"] and ev > 0 and market >= cfg["min_price"]:
        decision = "bet"
    elif edge >= 0.5 * cfg["min_edge"] and ev > 0:
        decision = "lean"
    else:
        decision = "pass"
    return {"edge": round(edge, 4), "ev": round(ev, 4), "kelly": round(kelly, 4), "decision": decision}


def read_csv(path):
    if not path.exists():
        raise SystemExit(f"Missing input: {path}")
    with path.open("r", encoding="utf-8") as h:
        return list(csv.DictReader(h))


def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as h:
        w = csv.DictWriter(h, fieldnames=HEADERS)
        w.writeheader()
        w.writerows(rows)


def write_md(rows, notes):
    lines = ["# Phase 5 Value & Risk", "", f"Timezone: {LOCAL_TZ}", "",
             "## Run Notes", "", "| Item | Value |", "| --- | --- |"]
    for n in notes:
        lines.append(f"| {n['item']} | {n['value']} |")
    lines.extend(["", "## Picks", "",
                  "| Date | League | Match | Pick | Side | Market | Model p | Edge | Stake | Status |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"])
    for r in rows:
        lines.append(
            f"| {r.get('date','')} | {r.get('league','')} | "
            f"{r.get('home','')} vs {r.get('away','')} | {r.get('top_decision','')} | "
            f"{r.get('top_side','')} | {r.get('top_market_odds','')} | {r.get('top_p','')} | "
            f"{r.get('top_edge','')} | {r.get('top_stake','')} | {r.get('phase5_status','')} |"
        )
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def col_letter(index):
    out = ""
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def sheet_xml(headers, rows):
    table = [headers]
    for row in rows:
        table.append([row.get(h, "") for h in headers])
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
             "<sheetData>"]
    for r_idx, values in enumerate(table, 1):
        parts.append(f'<row r="{r_idx}">')
        for c_idx, value in enumerate(values, 1):
            cell = f"{col_letter(c_idx)}{r_idx}"
            text = escape(str(value if value is not None else ""))
            parts.append(f'<c r="{cell}" t="inlineStr"><is><t>{text}</t></is></c>')
        parts.append("</row>")
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


def write_xlsx(sheets):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet_names = list(sheets.keys())
    with zipfile.ZipFile(XLSX_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
            '<Default Extension="xml" ContentType="application/xml"/>\n'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheet_names) + 1))
            + "\n</Types>")
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n'
            '</Relationships>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheet_names) + 1))
            + "\n</Relationships>")
        zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>\n'
            + "".join(f'<sheet name="{escape(name[:31])}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(sheet_names, 1))
            + "\n</sheets></workbook>")
        for i, (name, (headers, rows)) in enumerate(sheets.items(), 1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(headers, rows))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bankroll", type=float, default=DEFAULTS["bankroll"])
    parser.add_argument("--kelly-fraction", type=float, default=DEFAULTS["kelly_fraction"])
    parser.add_argument("--min-edge", type=float, default=DEFAULTS["min_edge"])
    parser.add_argument("--min-price", type=float, default=DEFAULTS["min_price"])
    parser.add_argument("--max-stake-pct", type=float, default=DEFAULTS["max_stake_pct"])
    parser.add_argument("--max-exposure-pct", type=float, default=DEFAULTS["max_exposure_pct"])
    args = parser.parse_args()
    cfg = {k: getattr(args, k) for k in ("bankroll", "kelly_fraction", "min_edge", "min_price", "max_stake_pct", "max_exposure_pct")}

    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    p4_rows = read_csv(PHASE4_CSV)

    rows = []
    raw_stakes = {}  # event_id -> raw stake before exposure scaling

    for r in p4_rows:
        out = {h: "" for h in HEADERS}
        out["run_timestamp"] = run_ts
        out["league"] = r.get("league", "")
        out["event_id"] = r.get("event_id", "")
        out["date"] = r.get("date", "")
        out["time"] = r.get("time", "")
        out["home"] = r.get("home", "")
        out["away"] = r.get("away", "")
        out["risk_scale_factor"] = 1.0

        if r.get("phase4_status") != "ready_for_phase_5":
            out["phase5_status"] = "upstream_blocked"
            out["phase5_notes"] = f"Phase 4 status was {r.get('phase4_status','unknown')}."
            rows.append(out)
            continue

        side_eval = {}
        for side in SIDES:
            p = to_float(r.get(f"p_{side}"))
            market = to_float(r.get(f"market_{side}"))
            ev = evaluate_side(p, market, cfg)
            out[f"{side}_p"] = p if p is not None else ""
            out[f"{side}_market"] = market if market is not None else ""
            out[f"{side}_edge"] = ev["edge"]
            out[f"{side}_ev"] = ev["ev"]
            out[f"{side}_kelly"] = ev["kelly"]
            out[f"{side}_decision"] = ev["decision"]
            kelly_stake = ev["kelly"] * cfg["bankroll"] * cfg["kelly_fraction"]
            kelly_stake = min(kelly_stake, cfg["max_stake_pct"] * cfg["bankroll"])
            out[f"{side}_stake"] = round(kelly_stake, 2) if ev["decision"] == "bet" else 0.0
            side_eval[side] = (ev, kelly_stake, p, market)

        bets = [(s, ev[0], ev[1], ev[2], ev[3]) for s, ev in side_eval.items() if ev[0]["decision"] == "bet"]
        leans = [(s, ev[0], ev[1], ev[2], ev[3]) for s, ev in side_eval.items() if ev[0]["decision"] == "lean"]

        if bets:
            top = max(bets, key=lambda x: x[1]["edge"])
            for s, ev, _, _, _ in bets:
                if s != top[0]:
                    out[f"{s}_decision"] = "lean"
                    out[f"{s}_stake"] = 0.0
            top_side, top_ev, top_stake, top_p, top_market = top
            out["top_side"] = top_side
            out["top_decision"] = "bet"
            out["top_market_odds"] = top_market
            out["top_p"] = top_p
            out["top_edge"] = top_ev["edge"]
            out["top_stake"] = round(min(top_stake, cfg["max_stake_pct"] * cfg["bankroll"]), 2)
            out["phase5_status"] = "bet"
            out["phase5_notes"] = "Bet recommended; subject to portfolio cap."
            raw_stakes[out["event_id"]] = out["top_stake"]
        elif leans:
            top = max(leans, key=lambda x: x[1]["edge"])
            top_side, top_ev, _, top_p, top_market = top
            out["top_side"] = top_side
            out["top_decision"] = "lean"
            out["top_market_odds"] = top_market
            out["top_p"] = top_p
            out["top_edge"] = top_ev["edge"]
            out["top_stake"] = 0.0
            out["phase5_status"] = "lean"
            out["phase5_notes"] = "Edge above lean threshold but below bet threshold."
        else:
            out["top_decision"] = "pass"
            out["top_stake"] = 0.0
            out["phase5_status"] = "no_value"
            out["phase5_notes"] = "No side meets edge / EV / price thresholds."

        rows.append(out)

    total_raw = sum(raw_stakes.values())
    cap = cfg["max_exposure_pct"] * cfg["bankroll"]
    scale = 1.0
    if total_raw > cap and total_raw > 0:
        scale = cap / total_raw
        for r in rows:
            if r.get("phase5_status") == "bet":
                r["risk_scale_factor"] = round(scale, 4)
                r["top_stake"] = round((r.get("top_stake") or 0) * scale, 2)
                for side in SIDES:
                    if r.get(f"{side}_decision") == "bet":
                        r[f"{side}_stake"] = round((r.get(f"{side}_stake") or 0) * scale, 2)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("league", ""), r.get("home", "")))

    counts = Counter(r["phase5_status"] for r in rows)
    notes = [
        {"item": "run_timestamp", "value": run_ts},
        {"item": "bankroll", "value": cfg["bankroll"]},
        {"item": "kelly_fraction", "value": cfg["kelly_fraction"]},
        {"item": "min_edge", "value": cfg["min_edge"]},
        {"item": "min_price", "value": cfg["min_price"]},
        {"item": "max_stake_pct", "value": cfg["max_stake_pct"]},
        {"item": "max_exposure_pct", "value": cfg["max_exposure_pct"]},
        {"item": "raw_total_stake", "value": round(total_raw, 2)},
        {"item": "exposure_cap", "value": round(cap, 2)},
        {"item": "risk_scale_factor_applied", "value": round(scale, 4)},
        {"item": "bets", "value": counts.get("bet", 0)},
        {"item": "leans", "value": counts.get("lean", 0)},
        {"item": "no_value", "value": counts.get("no_value", 0)},
        {"item": "upstream_blocked", "value": counts.get("upstream_blocked", 0)},
    ]
    if counts.get("bet", 0):
        notes.append({"item": "next_action", "value": "Phase 6 will settle results once matches are FT."})
    else:
        notes.append({"item": "next_action", "value": "No bets today; revisit on next data refresh."})

    bets_sheet = [r for r in rows if r["phase5_status"] == "bet"]
    leans_sheet = [r for r in rows if r["phase5_status"] == "lean"]
    no_value = [r for r in rows if r["phase5_status"] == "no_value"]
    blocked = [r for r in rows if r["phase5_status"] == "upstream_blocked"]

    write_csv(rows)
    write_md(rows, notes)
    write_xlsx({
        "Picks": (HEADERS, rows),
        "Bets": (HEADERS, bets_sheet),
        "Leans": (HEADERS, leans_sheet),
        "No Value": (HEADERS, no_value),
        "Blocked": (HEADERS, blocked),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 5 picks written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"Markdown: {MD_PATH}")
    print(f"total={len(rows)} bets={counts.get('bet', 0)} leans={counts.get('lean', 0)} "
          f"no_value={counts.get('no_value', 0)} upstream_blocked={counts.get('upstream_blocked', 0)} "
          f"scale={round(scale, 4)}")


if __name__ == "__main__":
    main()
