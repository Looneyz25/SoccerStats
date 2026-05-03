#!/usr/bin/env python3
"""Phase 4 prediction.

Joins Phase 3 (form) and Phase 2 (odds) by event_id, runs a Poisson scoreline
model, and writes 1X2 / BTTS / O-U probabilities, fair odds, and edge.
"""
import argparse
import csv
import html
import math
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
PHASE2_CSV = OUT_DIR / "phase2_odds_slate_current.csv"
PHASE3_CSV = OUT_DIR / "phase3_team_context_current.csv"
XLSX_PATH = OUT_DIR / "Phase4_Predictions.xlsx"
CSV_PATH = OUT_DIR / "phase4_predictions_current.csv"
MD_PATH = OUT_DIR / "phase4_predictions_current.md"

LOCAL_TZ = "Australia/Adelaide"
READY = "ready_for_phase_5"
HOME_ADV = 0.20
GRID = 7
LAMBDA_FLOOR = 0.20

HEADERS = [
    "run_timestamp", "league", "event_id", "date", "time", "home", "away",
    "home_form_n", "away_form_n",
    "lambda_home", "lambda_away",
    "p_home", "p_draw", "p_away",
    "p_btts", "p_over25",
    "model_pick",
    "fair_home", "fair_draw", "fair_away",
    "market_home", "market_draw", "market_away",
    "market_implied_home", "market_implied_draw", "market_implied_away",
    "edge_home", "edge_draw", "edge_away",
    "phase4_status", "phase4_notes",
]


def read_csv(path):
    if not path.exists():
        raise SystemExit(f"Missing input: {path}")
    with path.open("r", encoding="utf-8") as h:
        return list(csv.DictReader(h))


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def poisson_pmf(k, lam):
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def score_grid(lh, la):
    return [[poisson_pmf(i, lh) * poisson_pmf(j, la) for j in range(GRID)] for i in range(GRID)]


def aggregate(grid):
    p_h = sum(grid[i][j] for i in range(GRID) for j in range(GRID) if i > j)
    p_d = sum(grid[i][i] for i in range(GRID))
    p_a = sum(grid[i][j] for i in range(GRID) for j in range(GRID) if j > i)
    p_btts = sum(grid[i][j] for i in range(1, GRID) for j in range(1, GRID))
    p_over25 = sum(grid[i][j] for i in range(GRID) for j in range(GRID) if i + j >= 3)
    total = p_h + p_d + p_a
    if total > 0:
        p_h /= total; p_d /= total; p_a /= total
    return {
        "p_home": round(p_h, 4),
        "p_draw": round(p_d, 4),
        "p_away": round(p_a, 4),
        "p_btts": round(p_btts, 4),
        "p_over25": round(p_over25, 4),
    }


def fair_odds(probs):
    out = {}
    for k_in, k_out in (("p_home", "fair_home"), ("p_draw", "fair_draw"), ("p_away", "fair_away")):
        p = probs.get(k_in, 0)
        out[k_out] = round(1.0 / p, 3) if p and p > 0 else ""
    return out


def edge(probs, market):
    out = {"market_implied_home": "", "market_implied_draw": "", "market_implied_away": "",
           "edge_home": "", "edge_draw": "", "edge_away": ""}
    for side in ("home", "draw", "away"):
        m = market.get(side)
        if m and m > 0:
            implied = round(1.0 / m, 4)
            out[f"market_implied_{side}"] = implied
            out[f"edge_{side}"] = round(probs.get(f"p_{side}", 0) - implied, 4)
    return out


def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as h:
        w = csv.DictWriter(h, fieldnames=HEADERS)
        w.writeheader()
        w.writerows(rows)


def write_md(rows, notes):
    lines = ["# Phase 4 Predictions", "", f"Timezone: {LOCAL_TZ}",
             "Model: capped Poisson grid, last-5 form, +0.20 home advantage", "",
             "## Run Notes", "", "| Item | Value |", "| --- | --- |"]
    for n in notes:
        lines.append(f"| {n['item']} | {n['value']} |")
    lines.extend(["", "## Predictions", "",
                  "| Date | League | Match | λH | λA | pH | pD | pA | pick | fH/mH | fD/mD | fA/mA | edgeH | edgeD | edgeA | Status |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"])
    for r in rows:
        lines.append(
            f"| {r.get('date','')} | {r.get('league','')} | {r.get('home','')} vs {r.get('away','')} | "
            f"{r.get('lambda_home','')} | {r.get('lambda_away','')} | "
            f"{r.get('p_home','')} | {r.get('p_draw','')} | {r.get('p_away','')} | "
            f"{r.get('model_pick','')} | "
            f"{r.get('fair_home','')}/{r.get('market_home','')} | "
            f"{r.get('fair_draw','')}/{r.get('market_draw','')} | "
            f"{r.get('fair_away','')}/{r.get('market_away','')} | "
            f"{r.get('edge_home','')} | {r.get('edge_draw','')} | {r.get('edge_away','')} | "
            f"{r.get('phase4_status','')} |"
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
    args = parser.parse_args()
    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    p2 = {r["event_id"]: r for r in read_csv(PHASE2_CSV) if r.get("event_id")}
    p3_rows = read_csv(PHASE3_CSV)

    rows = []
    for r in p3_rows:
        out = {h: "" for h in HEADERS}
        out["run_timestamp"] = run_ts
        out["league"] = r.get("league", "")
        out["event_id"] = r.get("event_id", "")
        out["date"] = r.get("date", "")
        out["time"] = r.get("time", "")
        out["home"] = r.get("home", "")
        out["away"] = r.get("away", "")
        out["home_form_n"] = r.get("home_form_n", "")
        out["away_form_n"] = r.get("away_form_n", "")

        if r.get("phase3_status") != "ready_for_phase_4":
            out["phase4_status"] = "upstream_blocked"
            out["phase4_notes"] = f"Phase 3 status was {r.get('phase3_status','unknown')}."
            rows.append(out)
            continue

        h_gf = to_float(r.get("home_gf5")) or 0
        h_ga = to_float(r.get("home_ga5")) or 0
        a_gf = to_float(r.get("away_gf5")) or 0
        a_ga = to_float(r.get("away_ga5")) or 0
        h_n = max(1, int(to_float(r.get("home_form_n")) or 5))
        a_n = max(1, int(to_float(r.get("away_form_n")) or 5))
        h_attack, h_defence = h_gf / h_n, h_ga / h_n
        a_attack, a_defence = a_gf / a_n, a_ga / a_n
        lh = max(LAMBDA_FLOOR, 0.5 * (h_attack + a_defence) + HOME_ADV)
        la = max(LAMBDA_FLOOR, 0.5 * (a_attack + h_defence) - HOME_ADV / 4)
        out["lambda_home"] = round(lh, 3)
        out["lambda_away"] = round(la, 3)

        probs = aggregate(score_grid(lh, la))
        out.update(probs)
        out.update(fair_odds(probs))
        out["model_pick"] = max(("home", "draw", "away"), key=lambda k: probs[f"p_{k}"])

        market = {}
        p2_row = p2.get(out["event_id"])
        if p2_row:
            for side in ("home", "draw", "away"):
                v = to_float(p2_row.get(f"{side}_odds"))
                if v:
                    market[side] = v
                    out[f"market_{side}"] = v
        out.update(edge(probs, market))

        if all(side in market for side in ("home", "draw", "away")):
            out["phase4_status"] = READY
            out["phase4_notes"] = "Probabilities + fair odds attached; market joined."
        else:
            out["phase4_status"] = "model_only"
            out["phase4_notes"] = "Probabilities computed but Phase 2 odds incomplete; no edge."
        rows.append(out)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("league", ""), r.get("home", "")))
    counts = Counter(r["phase4_status"] for r in rows)
    notes = [
        {"item": "run_timestamp", "value": run_ts},
        {"item": "model", "value": "capped Poisson 7x7, last-5 form, home advantage +0.20"},
        {"item": "phase3_input_rows", "value": len(p3_rows)},
        {"item": "phase4_total_rows", "value": len(rows)},
        {"item": "ready_for_phase_5", "value": counts.get(READY, 0)},
        {"item": "model_only", "value": counts.get("model_only", 0)},
        {"item": "upstream_blocked", "value": counts.get("upstream_blocked", 0)},
    ]
    if counts.get(READY, 0):
        notes.append({"item": "next_action", "value": "Proceed with Phase 5 for ready_for_phase_5 rows."})
    else:
        notes.append({"item": "next_action", "value": "No ready predictions; check Phase 2/3 outputs."})

    ready = [r for r in rows if r["phase4_status"] == READY]
    model_only = [r for r in rows if r["phase4_status"] == "model_only"]
    blocked = [r for r in rows if r["phase4_status"] == "upstream_blocked"]

    write_csv(rows)
    write_md(rows, notes)
    write_xlsx({
        "Predictions": (HEADERS, rows),
        "Ready For Phase 5": (HEADERS, ready),
        "Model Only": (HEADERS, model_only),
        "Blocked": (HEADERS, blocked),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 4 predictions written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"Markdown: {MD_PATH}")
    print(f"total={len(rows)} ready_for_phase_5={counts.get(READY, 0)} "
          f"model_only={counts.get('model_only', 0)} upstream_blocked={counts.get('upstream_blocked', 0)}")


if __name__ == "__main__":
    main()
