#!/usr/bin/env python3
"""Compute SofaScore-style streak labels from raw team match history.

Fallback for when SofaScore's `/team-streaks` endpoint is unavailable. Uses each
team's last 10 completed matches (pulled from `/team/{id}/events/last/0`) and
derives labels like "No losses 4", "Without clean sheet 4", "More than 2.5 goals 8/10".

Streak forms produced:
- "Wins N", "Losses N", "Draws N" — consecutive run from most recent
- "No wins N", "No losses N", "No draws N" — consecutive non-occurrence
- "Without clean sheet N", "Clean sheet N" — based on goals conceded
- "No goals scored N" — team failed to score
- "More than X.5 goals N/M" — count over total threshold across last M
- "Less than X.5 goals N/M" — count under threshold
- "Both teams scoring N/M" — count BTTS=Yes
- "More than 4.5 cards N/M", "More than 10.5 corners N/M" — IF actuals present

Each computed streak is added to the match's `team_streaks` list with team="home"
or team="away" and `source: "computed"` so it can be distinguished from SofaScore
streaks.
"""
import json
import math
import pathlib
import random
import time
import re

import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from curl_cffi import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"

_PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]
def _profile(): return random.choice(_PROFILES)

def fetch(path):
    try:
        r = requests.get(f"https://api.sofascore.com{path}", impersonate=_profile(), timeout=15)
        if r.status_code != 200: return None
        return r.json()
    except Exception:
        return None

# --- Streak computation ---

def _consec_from_recent(seq, predicate):
    """Count how many of the most recent N matches in `seq` satisfy `predicate`,
    stopping at the first non-match. Returns the consecutive count."""
    n = 0
    for x in seq:
        if predicate(x): n += 1
        else: break
    return n


def _ratio(seq, predicate):
    """Count of matches in `seq` (size M) where predicate true. Returns (n, len(seq))."""
    return sum(1 for x in seq if predicate(x)), len(seq)


def streaks_for_team(matches, team_id):
    """Walk a team's last completed matches (most recent first) and emit streak labels.

    Each `m` is a SofaScore event payload with `homeTeam.id`, `awayTeam.id`, scores.
    """
    perspective = []
    for e in matches:
        is_home = (e.get("homeTeam") or {}).get("id") == team_id
        hg = (e.get("homeScore") or {}).get("current")
        ag = (e.get("awayScore") or {}).get("current")
        if hg is None or ag is None: continue
        if is_home:
            scored, conceded = hg, ag
        else:
            scored, conceded = ag, hg
        result = "W" if scored > conceded else ("L" if conceded > scored else "D")
        perspective.append({
            "result": result, "scored": scored, "conceded": conceded,
            "total_goals": hg + ag, "btts": (hg > 0 and ag > 0),
        })

    if not perspective: return []

    out = []
    def add(label, value):
        if isinstance(value, int) and value <= 0: return
        if isinstance(value, tuple):
            n, m = value
            if n <= 0: return
            out.append({"label": label, "value": f"{n}/{m}"})
        else:
            out.append({"label": label, "value": str(value)})

    # Consecutive (from most recent) — only emit if 3+
    def consec(threshold=3, **kwargs):
        for label, pred in kwargs.items():
            n = _consec_from_recent(perspective, pred)
            if n >= threshold:
                add(label.replace("_", " ").title(), n)

    consec(
        Wins=lambda x: x["result"] == "W",
        Losses=lambda x: x["result"] == "L",
        Draws=lambda x: x["result"] == "D",
        No_wins=lambda x: x["result"] != "W",
        No_losses=lambda x: x["result"] != "L",
        Without_clean_sheet=lambda x: x["conceded"] > 0,
        Clean_sheet=lambda x: x["conceded"] == 0,
        No_goals_scored=lambda x: x["scored"] == 0,
    )

    # Ratios over last M (use 10, 8, 7, 6, 5)
    for window in (10, 8, 7, 6, 5):
        if len(perspective) < window: continue
        slab = perspective[:window]
        for label, pred in [
            (f"More than 2.5 goals", lambda x: x["total_goals"] > 2.5),
            (f"Less than 2.5 goals", lambda x: x["total_goals"] < 2.5),
            (f"Both teams scoring",  lambda x: x["btts"]),
        ]:
            n, m = _ratio(slab, pred)
            # Only emit if dominant (≥ 80% of window)
            if n >= math.ceil(window * 0.8):
                add(label, (n, m))
        # Use the longest "dominant" window per label, then break to avoid duplicates
        if any(o["value"].endswith(f"/{window}") for o in out):
            break

    return out


def fetch_team_form(team_id, n=10):
    """Pull last completed matches for a team."""
    if not team_id: return []
    d = fetch(f"/api/v1/team/{team_id}/events/last/0")
    if not d: return []
    return [e for e in d.get("events", []) if (e.get("status") or {}).get("type") == "finished"][-n:][::-1]


def main():
    store = json.loads(STORE.read_text(encoding="utf-8"))
    enriched = 0
    cache = {}  # team_id -> form
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") == "FT": continue
            h_id = m.get("home", {}).get("team_id")
            a_id = m.get("away", {}).get("team_id")
            if not h_id or not a_id: continue

            if h_id not in cache:
                cache[h_id] = fetch_team_form(h_id, 10)
                time.sleep(0.6)
            if a_id not in cache:
                cache[a_id] = fetch_team_form(a_id, 10)
                time.sleep(0.6)

            home_streaks = streaks_for_team(cache[h_id], h_id)
            away_streaks = streaks_for_team(cache[a_id], a_id)

            # PRIMARY mode: replace any existing team_streaks with computed ones.
            # Preserve h2h_streaks (separate field, sourced from SofaScore when available).
            new_list = []
            for s in home_streaks:
                new_list.append({"team": "home", "source": "computed", **s})
            for s in away_streaks:
                new_list.append({"team": "away", "source": "computed", **s})
            if new_list:
                m["team_streaks"] = new_list
                enriched += 1
                print(f"  + {L['name']:25s} {m['home']['name']} vs {m['away']['name']}: "
                      f"{len(home_streaks)} home / {len(away_streaks)} away")

    STORE.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDONE. enriched={enriched}")


if __name__ == "__main__":
    main()
