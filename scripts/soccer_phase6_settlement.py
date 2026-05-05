#!/usr/bin/env python3
"""Phase 6 settlement.

Reads Phase 5 picks, fetches results from SofaScore (primary) then Flashscore
upcoming feed (fallback), marks each bet/lean as won/lost/push/void/pending,
appends settled outcomes to a persistent JSONL history, and writes the Phase 6
review workbook.
"""
import argparse
import csv
import json
import random
import re
import time
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

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "agent-system" / "outputs"
PHASE3_CSV = OUT_DIR / "phase3_team_context_current.csv"
PHASE5_CSV = OUT_DIR / "phase5_value_risk_current.csv"
HISTORY_JSONL = OUT_DIR / "phase6_settlement_history.jsonl"
XLSX_PATH = OUT_DIR / "Phase6_Settlement.xlsx"
CSV_PATH = OUT_DIR / "phase6_settlement_current.csv"
MD_PATH = OUT_DIR / "phase6_settlement_current.md"

LOCAL_TZ = "Australia/Adelaide"
SOFA_BASE = "https://api.sofascore.com"
SOFA_WEB = "https://www.sofascore.com"
PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]

HEADERS = [
    "run_timestamp", "event_id", "league", "date", "time", "home", "away",
    "top_side", "top_market_odds", "top_p", "top_edge", "top_stake", "phase5_status",
    "actual_status", "actual_home_score", "actual_away_score", "actual_outcome",
    "phase6_status", "realized_return", "phase6_notes",
]


# ---------- SofaScore session (mirrors Phase 3 pattern) ----------

def _sofa_headers(referer):
    return {
        "Accept": "*/*",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": SOFA_WEB,
        "Referer": referer,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
    }


def _sleep(base=0.5, jitter=0.5):
    time.sleep(base + random.random() * jitter)


def open_sofa_session():
    if cffi_requests is None:
        return None
    profile = random.choice(PROFILES)
    sess = cffi_requests.Session(impersonate=profile)
    referer = SOFA_WEB + "/"
    for path in ("/", "/football"):
        try:
            url = SOFA_WEB + path
            sess.get(url, headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-AU,en;q=0.9",
                "Referer": referer,
            }, timeout=15)
            referer = url
            _sleep(0.4, 0.4)
        except Exception:
            pass
    return sess


def sofa_get(session, path):
    if session is None:
        return None
    url = SOFA_BASE + path
    for attempt in range(3):
        try:
            resp = session.get(url, headers=_sofa_headers(SOFA_WEB + "/"), timeout=15)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (403, 429, 503):
                _sleep(1.5 + attempt, 1.0)
                continue
            return None
        except Exception:
            _sleep(1.0 + attempt, 0.8)
    return None


def fetch_sofa_result(session, home_sofa_id, away_sofa_id, match_date_str):
    """Query SofaScore last-events for home team, find the match against away team.
    Returns (home_score, away_score, status_str) or None if not found.
    match_date_str: "YYYY-MM-DD"
    """
    if not home_sofa_id or not away_sofa_id:
        return None
    try:
        home_id = int(home_sofa_id)
        away_id = int(away_sofa_id)
    except (TypeError, ValueError):
        return None

    data = sofa_get(session, f"/api/v1/team/{home_id}/events/last/0")
    if not data:
        return None
    events = data.get("events") or []
    for ev in events:
        ht = (ev.get("homeTeam") or {}).get("id")
        at = (ev.get("awayTeam") or {}).get("id")
        if {ht, at} != {home_id, away_id}:
            continue
        # Check date proximity
        ev_ts = ev.get("startTimestamp")
        if ev_ts:
            try:
                ev_date = datetime.fromtimestamp(ev_ts, tz=timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                ev_date = ""
            if ev_date and abs((datetime.strptime(ev_date, "%Y-%m-%d") -
                                datetime.strptime(match_date_str, "%Y-%m-%d")).days) > 3:
                continue
        status = (ev.get("status") or {}).get("type", "")
        h_score = (ev.get("homeScore") or {}).get("current")
        a_score = (ev.get("awayScore") or {}).get("current")
        # "finished" = FT; "inprogress" = live
        if status == "finished" and h_score is not None and a_score is not None:
            return int(h_score), int(a_score), "FT"
        if status == "inprogress":
            return h_score, a_score, "live"
        if status in ("notstarted", "scheduled"):
            return None, None, "upcoming"
    return None


# ---------- file helpers ----------

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


def read_phase3(path):
    """Return dict keyed by event_id with home_sofa_id + away_sofa_id."""
    out = {}
    if not path.exists():
        return out
    with path.open("r", encoding="utf-8") as h:
        for row in csv.DictReader(h):
            eid = row.get("event_id", "")
            if eid:
                out[eid] = {
                    "home_sofa_id": row.get("home_sofa_id", ""),
                    "away_sofa_id": row.get("away_sofa_id", ""),
                }
    return out


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


def settle_row(rec, h_score, a_score, status_text):
    rec["actual_status"] = status_text or ""
    rec["actual_home_score"] = h_score if h_score is not None else ""
    rec["actual_away_score"] = a_score if a_score is not None else ""
    out_outcome = actual_outcome(h_score, a_score) if status_text == "FT" else ""
    rec["actual_outcome"] = out_outcome

    side = rec.get("top_side", "")
    decision = rec.get("phase5_status", "")
    stake = to_float(rec.get("top_stake"), 0.0)
    market = to_float(rec.get("top_market_odds"))

    if not side:
        rec["phase6_status"] = "pending" if status_text not in ("FT", "postponed_or_cancelled") else "void"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "No recommendation to settle."
        return

    if status_text == "FT":
        if not out_outcome:
            rec["phase6_status"] = "pending"
            rec["realized_return"] = 0.0
            rec["phase6_notes"] = "FT but score unparseable."
            return
        if out_outcome == side:
            rec["phase6_status"] = "won"
            rec["realized_return"] = round(stake * (market - 1), 2) if (decision == "bet" and market and market > 1) else 0.0
            rec["phase6_notes"] = f"Pick {side} matched actual {out_outcome}."
        else:
            rec["phase6_status"] = "lost"
            rec["realized_return"] = round(-stake, 2) if decision == "bet" else 0.0
            rec["phase6_notes"] = f"Pick {side} missed actual {out_outcome}. Score {h_score}-{a_score}."
    elif status_text == "postponed_or_cancelled":
        rec["phase6_status"] = "void"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "Match postponed/cancelled; stake refunded."
    elif status_text == "live":
        rec["phase6_status"] = "pending"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = f"Match in progress ({h_score}-{a_score})."
    elif status_text == "upcoming":
        rec["phase6_status"] = "pending"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "Match not yet started."
    else:
        rec["phase6_status"] = "not_found"
        rec["realized_return"] = 0.0
        rec["phase6_notes"] = "Event not located in any source."


# ---------- output writers ----------

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
            + "\n</Relations>")
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
    p3_map = read_phase3(PHASE3_CSV)
    history = read_history()

    # --- SofaScore primary source ---
    sofa_session = open_sofa_session()
    sofa_health = "healthy" if sofa_session else "unavailable"

    # --- Flashscore fallback ---
    flash_health = "healthy"
    flash_note = ""
    events_by_id = {}
    try:
        raw = fetch_flashscore_feed()
        events = parse_flashscore_feed(raw)
        for ev in events:
            eid = ev.get("id")
            if eid:
                events_by_id[f"flashscore:{eid}"] = ev
        if not events:
            flash_health = "degraded"
            flash_note = "Flashscore parsed zero events."
    except Exception as exc:
        flash_health = "blocked"
        flash_note = str(exc)

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

        # Already settled in history
        existing = history.get(rec["event_id"])
        if existing and existing.get("phase6_status") in ("won", "lost", "void"):
            for k in ("actual_status", "actual_home_score", "actual_away_score",
                      "actual_outcome", "phase6_status", "realized_return", "phase6_notes"):
                rec[k] = existing.get(k, "")
            rows.append(rec)
            continue

        event_id = rec["event_id"]
        match_date = rec.get("date", "")
        p3 = p3_map.get(event_id, {})
        home_sofa_id = p3.get("home_sofa_id", "")
        away_sofa_id = p3.get("away_sofa_id", "")

        h_score = a_score = None
        status_text = None
        source_used = "none"

        # 1. SofaScore primary
        if sofa_session and home_sofa_id and away_sofa_id:
            result = fetch_sofa_result(sofa_session, home_sofa_id, away_sofa_id, match_date)
            if result is not None:
                h_score, a_score, status_text = result
                source_used = "SofaScore"
                _sleep(0.4, 0.3)

        # 2. Flashscore feed fallback
        if status_text is None:
            flash_ev = events_by_id.get(event_id)
            if flash_ev:
                fs = flashscore_status(flash_ev.get("status"))
                fh = to_int(flash_ev.get("home_score"))
                fa = to_int(flash_ev.get("away_score"))
                if fs == "FT":
                    h_score, a_score, status_text = fh, fa, "FT"
                elif fs == "live":
                    h_score, a_score, status_text = fh, fa, "live"
                elif fs == "postponed_or_cancelled":
                    status_text = "postponed_or_cancelled"
                else:
                    status_text = "upcoming"
                source_used = "Flashscore"

        if status_text is None:
            status_text = ""

        settle_row(rec, h_score, a_score, status_text)
        if source_used != "none":
            rec["phase6_notes"] = f"[{source_used}] " + rec.get("phase6_notes", "")
        rows.append(rec)
        if rec["phase6_status"] in ("won", "lost", "void"):
            new_history_records.append({k: rec.get(k, "") for k in HEADERS})

    append_history(new_history_records)
    history = read_history()
    summary = history_summary(history)

    rows.sort(key=lambda r: (r.get("date", ""), r.get("time", ""), r.get("home", "")))
    counts = Counter(r["phase6_status"] for r in rows)
    notes = [
        {"item": "run_timestamp",        "value": run_ts},
        {"item": "sofa_health",          "value": sofa_health},
        {"item": "flashscore_health",    "value": flash_health},
        {"item": "flashscore_note",      "value": flash_note},
        {"item": "phase5_input_rows",    "value": len(p5_rows)},
        {"item": "rows_settled_this_run","value": len(new_history_records)},
        {"item": "won_this_run",         "value": counts.get("won", 0)},
        {"item": "lost_this_run",        "value": counts.get("lost", 0)},
        {"item": "pending",              "value": counts.get("pending", 0)},
        {"item": "void",                 "value": counts.get("void", 0)},
        {"item": "not_found",            "value": counts.get("not_found", 0)},
        {"item": "skipped",              "value": counts.get("skipped", 0)},
    ]

    won_sheet  = [r for r in rows if r["phase6_status"] == "won"]
    lost_sheet = [r for r in rows if r["phase6_status"] == "lost"]
    pending_sheet = [r for r in rows if r["phase6_status"] == "pending"]
    summary_rows = [{"item": k, "value": v} for k, v in summary.items()]

    write_csv(rows)
    write_md(rows, summary, notes)
    write_xlsx({
        "Settled":        (HEADERS, rows),
        "Won":            (HEADERS, won_sheet),
        "Lost":           (HEADERS, lost_sheet),
        "Pending":        (HEADERS, pending_sheet),
        "History Summary": (["item", "value"], summary_rows),
        "Run Notes":      (["item", "value"], notes),
    })

    print(f"Phase 6 settlement written: {XLSX_PATH}")
    print(f"CSV: {CSV_PATH}")
    print(f"History: {HISTORY_JSONL}")
    print(f"settled_this_run={len(new_history_records)} won={counts.get('won', 0)} "
          f"lost={counts.get('lost', 0)} pending={counts.get('pending', 0)} "
          f"history_hit_rate={summary['history_hit_rate']} history_roi={summary['history_roi']}")


if __name__ == "__main__":
    main()
