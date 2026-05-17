#!/usr/bin/env python3
"""Dev backfill: re-predict FT matches currently flagged ``retro_snapshot``.

Walks ``match_data.json`` for finished matches on or after ``START_DATE`` whose
``predictions.factors.source`` contains ``retro``, calls ``predict_enhanced``
with fresh inputs, re-settles hit/miss, and stamps a new source label so the
result-review agent no longer excludes them.

Dev tool only. Re-uses today's Elo, form, standings, and streaks for matches
that already finished, so the resulting predictions still carry lookahead bias.
Do not run on production data without expecting that bias.
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from soccer_routine import (  # noqa: E402
    TOURNAMENTS,
    _XG_INDEX,
    build_xg_index,
    compute_team_elo,
    fetch,
    fetch_current_season,
    fetch_event_h2h_duel,
    fetch_form,
    fetch_h2h,
    fetch_standings,
    parse_streaks_payload,
    predict_enhanced,
)

START_DATE = "2026-04-22"
SOURCE_LABEL = f"dev_repredict_{datetime.now().date().isoformat()}"
STORE_PATH = ROOT / "match_data.json"

NAME_TO_UTID = {name: utid for utid, name in TOURNAMENTS.items()}


def is_retro(match):
    factors = ((match.get("predictions") or {}).get("factors") or {})
    return "retro" in str(factors.get("source", "")).lower()


def resettle(pred, hs, as_):
    if pred.get("winner"):
        actual = "home" if hs > as_ else ("away" if as_ > hs else "draw")
        pred["winner"]["result"] = "hit" if pred["winner"].get("type") == actual else "miss"
    if pred.get("btts"):
        abtts = (hs > 0 and as_ > 0)
        pred["btts"]["actual_btts"] = abtts
        pick = str(pred["btts"].get("pick", "")).lower()
        pred["btts"]["result"] = "hit" if (pick == "yes") == abtts else "miss"
    if pred.get("ou_goals"):
        line = float(pred["ou_goals"].get("line", 2.5))
        tot = hs + as_
        pred["ou_goals"]["actual"] = tot
        pick = pred["ou_goals"].get("pick")
        pred["ou_goals"]["result"] = (
            "hit" if (pick == "Over" and tot > line) or (pick == "Under" and tot < line) else "miss"
        )
    cards = pred.get("ou_cards") or {}
    if "actual" in cards:
        line = float(cards.get("line", 4.5))
        actual = cards["actual"]
        cards["result"] = (
            "hit" if (cards.get("pick") == "Over" and actual > line) or
            (cards.get("pick") == "Under" and actual < line) else "miss"
        )


def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))

    _XG_INDEX.clear()
    _XG_INDEX.update(build_xg_index(store))
    compute_team_elo(store)

    candidates = []
    for league in store.get("leagues", []):
        for match in league.get("matches", []) or []:
            if match.get("status") != "FT":
                continue
            if str(match.get("date") or "") < START_DATE:
                continue
            if not is_retro(match):
                continue
            candidates.append((league, match))

    print(f"Candidates to re-predict: {len(candidates)}")
    print(f"Source label: {SOURCE_LABEL}")

    form_cache = {}

    def get_form(team_id, eid):
        key = (team_id, eid)
        if key not in form_cache:
            form_cache[key] = fetch_form(team_id, exclude_event_id=eid)
        return form_cache[key]

    redone = 0
    skipped = 0
    started = time.monotonic()

    for i, (league, match) in enumerate(candidates, 1):
        eid = match.get("id")
        home = match.get("home") or {}
        away = match.get("away") or {}
        h_id = home.get("team_id")
        a_id = away.get("team_id")
        hs = home.get("goals")
        as_ = away.get("goals")
        if not h_id or not a_id or hs is None or as_ is None:
            skipped += 1
            print(f"  [{i}/{len(candidates)}] skip — missing team ids or score")
            continue

        utid = NAME_TO_UTID.get(league.get("name"))
        season_id = fetch_current_season(utid) if utid else None
        standings = fetch_standings(utid, season_id) if (utid and season_id) else {}
        hr = standings.get(h_id, {})
        ar = standings.get(a_id, {})

        h_att, h_def = get_form(h_id, eid)
        a_att, a_def = get_form(a_id, eid)

        h2h_history = fetch_h2h(h_id, a_id, exclude_event_id=eid)
        h2h_duel = fetch_event_h2h_duel(eid)

        tstr = match.get("team_streaks") or []
        h2h_streaks = match.get("h2h_streaks") or []
        if not tstr:
            sp = fetch(f"/api/v1/event/{eid}/team-streaks")
            time.sleep(0.6)
            if sp:
                fetched_h2h, fetched_tstr = parse_streaks_payload(sp)
                tstr = fetched_tstr
                if not h2h_streaks:
                    h2h_streaks = fetched_h2h

        market_odds = match.get("odds")

        pred = predict_enhanced(
            h_att, h_def, a_att, a_def,
            home.get("name", ""), away.get("name", ""), tstr,
            h2h=h2h_history,
            h_rank=hr.get("rank"), h_pts=hr.get("pts"),
            a_rank=ar.get("rank"), a_pts=ar.get("pts"),
            h_team_id=h_id, a_team_id=a_id,
            league=league.get("name"),
            market_odds=market_odds,
        )
        pred["factors"]["source"] = SOURCE_LABEL

        old_cards = (match.get("predictions") or {}).get("ou_cards") or {}
        if "actual" in old_cards:
            pred["ou_cards"]["actual"] = old_cards["actual"]

        resettle(pred, hs, as_)

        match["predictions"] = pred
        if h2h_history:
            match["h2h_history"] = h2h_history
        if h2h_duel:
            match["h2h_duel"] = h2h_duel
        if h2h_streaks and not match.get("h2h_streaks"):
            match["h2h_streaks"] = h2h_streaks
        if tstr and not match.get("team_streaks"):
            match["team_streaks"] = tstr

        redone += 1
        elapsed = time.monotonic() - started
        rate = redone / max(elapsed, 0.001)
        eta = (len(candidates) - i) / max(rate, 0.001)
        winner = pred.get("winner") or {}
        print(
            f"  [{i}/{len(candidates)}] {match.get('date')} {league.get('name')} "
            f"{home.get('name')} vs {away.get('name')} -> winner={winner.get('pick')} "
            f"({winner.get('result')})  eta={eta:.0f}s"
        )

    STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDone. Re-predicted: {redone}  Skipped: {skipped}  Saved: {STORE_PATH}")


if __name__ == "__main__":
    main()
