#!/usr/bin/env python3
"""Phase 6 settlement.

Reads Phase 5 picks, fetches the Flashscore feed, matches by Flashscore event ID,
marks each bet/lean as won/lost/push/void/pending, appends settled outcomes to a
persistent JSONL history, and writes the Phase 6 review workbook.
"""
import argparse
import csv
import json
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

# Reuse Flashscore fetch + parse from Phase 1.
from soccer_phase1_fixtures import fetch_flashscore_feed, parse_flashscore_feed, flashscore_status

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
PHASE5_CSV = OUT_DIR / "phase5_value_risk_current.csv"
HISTORY_JSONL = OUT_DIR / "phase6_settlement_history.jsonl"
XLSX_PATH = OUT_DIR / "Phase6_Settlement.xlsx"
CSV_PATH = OUT_DIR / "phase6_settlement_current.csv"
MD_PATH = OUT_DIR / "phase6_settlement_current.md"

LOCAL_TZ = "Australia/Adelaide"

HEADERS = [
    "run_timestamp", "event_id", "league", "date", "time", "home", "away",
    "top_side", "top_market_odds", "top_p", "top_edge", "top_stake", "phase5_status",
    "actual_status", "actual_home_score", "actual_away_score", "actual_outcome",
    "phase6_status", "realized_return", "phase6_notes",
]


def to_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def read_csv(path):
    if not path.exists():
        raise SystemExit(f"Missing input: {path}")
    with path.open("r", encoding="utf-8") as h:
        return list(csv.DictReader(h))


def read_history():
    if not HISTORY_JSONL.exists():
        return {}
    out = {}
    with HISTORY_JSONL.open("r", encoding="utf-8") as h:
        for line in h:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("event_id"):
                out[rec["event_id"]] = rec
    return out


def append_history(records):
    if not records:
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with HISTORY_JSONL.open("a", encoding="utf-8") as h:
        for rec in records:
            h.write(json.dumps(rec, ensure_ascii=False) + "\n")


def actual_outcome(home_score, away_score):
    if home_score is None or away_score is None:
        return ""
    if home_score > away_score:
        return "home"
    if away_score > home_score:
        return "away"
    return "draw"


def settle_row(rec, event):
    out_status = ""
    out_home = ""
    out_away = ""
    out_outcome = ""
    if event:
        status_text = flashscore_status(event.get("status"))
        h_score = to_int(event.get("home_score"))
        a_score = to_int(event.get("away_score"))
        if status_text == "FT":
            out_status = "FT"
            out_home = h_score if h_score is not None else ""
            out_away = a_score if a_score is not None else ""
            out_outcome = actual_outcome(h_score, a_score)
        elif status_text == "postponed_or_cancelled":
            out_status = status_text
        elif status_text == "live":
            out_status = "live"
        else:
            out_status = "upcoming"
    else:
        out_status = "unknown"

    rec["actual_status"] = out_status
    rec["actual_home_score"] = out_home
    rec["actual_away_score"] = out_away
    rec["actual_outcome"] = out_outcome

    side = rec.get("top_side", "")
    decision = rec.get("phase5_status", "")
    stake = to_float(rec.get("top_stake"), 0.0)
    market = to_float(rec.get("top_market_odds"))

    if not side:
        rec["phase6_status"] = "pending" if out_status not in ("FT", "postponed_or_cancelled") else "void"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "No recommendation to settle."
        return

    if out_status == "FT":
        if not out_outcome:
            rec["phase6_status"] = "pending"
            rec["realized_return"] = 0.0
            rec["phase6_notes"] = "FT but score unparseable."
            return
        if out_outcome == side:
            rec["phase6_status"] = "won"
            if decision == "bet" and market and market > 1:
                rec["realized_return"] = round(stake * (market - 1), 2)
            else:
                rec["realized_return"] = 0.0
            rec["phase6_notes"] = f"Pick {side} matched actual {out_outcome}."
        else:
            rec["phase6_status"] = "lost"
            rec["realized_return"] = round(-stake, 2) if decision == "bet" else 0.0
            rec["phase6_notes"] = f"Pick {side} missed actual {out_outcome}."
    elif out_status == "postponed_or_cancelled":
        rec["phase6_status"] = "void"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "Match postponed/cancelled; stake refunded."
    elif out_status == "unknown":
        rec["phase6_status"] = "not_found"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "Event not located in Flashscore feed."
    else:
        rec["phase6_status"] = "pending"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = f"Match status {out_status}; not yet settled."


def write_csv(rows):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as h:
        w = csv.DictWriter(h, fieldnames=HEADERS)
        w.writeheader()
        w.writerows(rows)


def write_md(rows, summary, notes):
    lines = ["# Phase 6 Settlement", "", f"Timezone: {LOCAL_TZ}", "",
             "## Run Notes", "", "| Item | Value |", "| --- | --- |"]
    for n in notes:
        lines.append(f"| {n['item']} | {n['value']} |")
    lines.extend(["", "## History Summary", "", "| Item | Value |", "| --- | --- |"])
    for k, v in summary.items():
        lines.append(f"| {k} | {v} |")
    lines.extend(["", "## Settlements", "",
                  "| Date | Match | Pick | Odds | Stake | Actual | Outcome | Status | Return |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"])
    for r in rows:
        actual = (
            f"{r.get('actual_home_score','')}-{r.get('actual_away_score','')}"
            if r.get("actual_status") == "FT" else r.get("actual_status", "")
        )
        lines.append(
            f"| {r.get('date','')} | {r.get('home','')} vs {r.get('away','')} | "
            f"{r.get('top_side','')} | {r.get('top_market_odds','')} | {r.get('top_stake','')} | "
            f"{actual} | {r.get('actual_outcome','')} | {r.get('phase6_status','')} | {r.get('realized_return','')} |"
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


def history_summary(history):
    bets = [h for h in history.values() if h.get("phase5_status") == "bet"]
    settled = [h for h in bets if h.get("phase6_status") in ("won", "lost", "void")]
    won = sum(1 for h in settled if h["phase6_status"] == "won")
    lost = sum(1 for h in settled if h["phase6_status"] == "lost")
    voided = sum(1 for h in settled if h["phase6_status"] == "void")
    realized = sum(to_float(h.get("realized_return"), 0.0) for h in settled)
    staked = sum(to_float(h.get("top_stake"), 0.0) for h in settled if h["phase6_status"] != "void")
    hit_rate = (won / (won + lost)) if (won + lost) else 0.0
    roi = (realized / staked) if staked else 0.0
    return {
        "history_total_bets_settled": won + lost,
        "history_wins": won,
        "history_losses": lost,
        "history_voids": voided,
        "history_total_staked": round(staked, 2),
        "history_realized_return": round(realized, 2),
        "history_hit_rate": round(hit_rate, 4),
        "history_roi": round(roi, 4),
    }


def main():
    parser = argparse.ArgumentParser()
    args = parser.parse_args()
    run_ts = datetime.now(ADL).strftime("%Y-%m-%d %H:%M:%S %Z")
    p5_rows = read_csv(PHASE5_CSV)
    history = read_history()

    feed_health = "healthy"
    feed_note = ""
    events_by_id = {}
    try:
        raw = fetch_flashscore_feed()
        events = parse_flashscore_feed(raw)
        for ev in events:
            eid = ev.get("id")
            if eid:
                events_by_id[f"flashscore:{eid}"] = ev
        if not events:
            feed_health = "degraded"
            feed_note = "Flashscore parsed zero events."
    except Exception as exc:
        feed_health = "blocked"
        feed_note = str(exc)

    rows = []
    new_history_records = []
    for r in p5_rows:
        rec = {h: "" for h in HEADERS}
        rec["run_timestamp"] = run_ts
        for k in ("event_id", "league", "date", "time", "home", "away",
                  "top_side", "top_market_odds", "top_p", "top_edge", "top_stake", "phase5_status"):
            rec[k] = r.get(k, "")

        if r.get("phase5_status") not in ("bet", "lean"):
            rec["phase6_status"] = "skipped"
            rec["realized_return"] = 0.0
            rec["phase6_notes"] = f"No recommendation (phase5_status={r.get('phase5_status','')})."
            rows.append(rec)
            continue

        existing = history.get(rec["event_id"])
        if existing and existing.get("phase6_status") in ("won", "lost", "void"):
            for k in ("actual_status", "actual_home_score", "actual_away_score",
                      "actual_outcome", "phase6_status", "realized_return", "phase6_notes"):
                rec[k] = existing.get(k, "")
            rows.append(rec)
            continue

        event = events_by_id.get(rec["event_id"])
        settle_row(rec, event)
        rows.append(rec)
        if rec["phase6_status"] in ("won", "lost", "void"):
            new_history_records.append({k: rec.get(k, "") for k in HEADERS})

    append_history(new_history_records)
    history = read_history()
    summary = history_summary(history)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("home", "")))
    counts = Counter(r["phase6_status"] for r in rows)
    notes = [
        {"item": "run_timestamp", "value": run_ts},
        {"item": "feed_health", "value": feed_health},
        {"item": "feed_note", "value": feed_note},
        {"item": "phase5_input_rows", "value": len(p5_rows)},
        {"item": "rows_settled_this_run", "value": len(new_history_records)},
        {"item": "won_this_run", "value": counts.get("won", 0)},
        {"item": "lost_this_run", "value": counts.get("lost", 0)},
        {"item": "pending", "value": counts.get("pending", 0)},
        {"item": "void", "value": counts.get("void", 0)},
        {"item": "not_found", "value": counts.get("not_found", 0)},
        {"item": "skipped", "value": counts.get("skipped", 0)},
    ]

    won_sheet = [r for r in rows if r["phase6_status"] == "won"]
    lost_sheet = [r for r in rows if r["phase6_status"] == "lost"]
    pending_sheet = [r for r in rows if r["phase6_status"] == "pending"]
    summary_rows = [{"item": k, "value": v} for k, v in summary.items()]

    write_csv(rows)
    write_md(rows, summary, notes)
    write_xlsx({
        "Settled": (HEADERS, rows),
        "Won": (HEADERS, won_sheet),
        "Lost": (HEADERS, lost_sheet),
        "Pending": (HEADERS, pending_sheet),
        "History Summary": (["item", "value"], summary_rows),
        "Run Notes": (["item", "value"], notes),
    })

    print(f"Phase 6 settlement written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"History: {HISTORY_JSONL}")
    print(f"settled_this_run={len(new_history_records)} won={counts.get('won', 0)} "
          f"lost={counts.get('lost', 0)} pending={counts.get('pending', 0)} "
          f"history_hit_rate={summary['history_hit_rate']} history_roi={summary['history_roi']}")


if __name__ == "__main__":
    main()
