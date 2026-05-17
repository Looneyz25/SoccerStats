#!/usr/bin/env python3
"""Flashscore score fallback — used when SofaScore returns 403.

Pulls the global football live feed from `2.flashscore.ninja` (no Cloudflare block,
works from cloud IPs), parses Flashscore's proprietary delimited format, and matches
finished games against our store by team-name + date. Records score on each match
as `flashscore_score` so soccer_routine.py's Phase A can settle from it as a hint.

Format: each event is a record terminated by `~`. Inside a record, fields are
`KEY÷VALUE` separated by `¬`. Useful keys per event:
  AA = match id (Flashscore's, not SofaScore's)
  AE/CX/FH = home team name (Flashscore varies keys between feeds)
  AF/FK = away team name
  AG, AH = home/away current score
  AD = start timestamp (UTC)
  AB = match status code (`3` = finished)
"""
import json
import os
import pathlib
import random
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

from curl_cffi import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "match_data.json"

ADL = timezone(timedelta(hours=9, minutes=30))

_PROFILES = ["chrome120", "chrome124", "chrome131", "chrome116", "edge101", "safari17_0"]
def _profile(): return random.choice(_PROFILES)

DEFAULT_FEED_URLS = (
    "https://www.flashscore.com.au/x/feed/f_1_0_3_en-au_1",
    "https://www.flashscore.com.au/x/feed/f_1_0_2_en-au_1",
    "https://www.flashscore.com/x/feed/f_1_0_3_en-uk_1",
    "https://2.flashscore.ninja/2/x/feed/f_1_0_3_en-uk_1",
)
FEED_URLS = tuple(
    url.strip()
    for url in os.environ.get("FLASHSCORE_FEED_URLS", "").split(",")
    if url.strip()
) or DEFAULT_FEED_URLS
LAST_FEED_URL = FEED_URLS[0]


def feed_headers(url):
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "X-Fsign": "SW9D1eZo",
        "Referer": origin + "/",
        "Origin": origin,
    }


def fetch_feed():
    global LAST_FEED_URL
    errors = []
    for url in FEED_URLS:
        try:
            r = requests.get(url, impersonate=_profile(), timeout=20, headers=feed_headers(url))
            if r.status_code == 200:
                LAST_FEED_URL = url
                return r.text
            errors.append(f"{url}: HTTP {r.status_code}")
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    print("Flashscore feeds failed: " + " | ".join(errors))
    return None


def parse_feed(raw):
    """Parse Flashscore's `KEY÷VALUE¬` delimited format into a list of events."""
    if not raw:
        return []
    events = []
    current = {}
    league_name = None
    league_country = None
    for chunk in raw.split("~"):
        chunk = chunk.strip()
        if not chunk:
            continue
        fields = {}
        for kv in chunk.split("¬"):
            if "÷" not in kv:
                continue
            k, _, v = kv.partition("÷")
            fields[k.strip()] = v.strip()
        # Tournament header rows have ZA (tournament name) + ZY (country)
        if "ZA" in fields:
            league_name = fields.get("ZA", "")
            league_country = fields.get("ZY", "")
            continue
        # Event rows have AA (match id)
        if "AA" not in fields:
            continue
        events.append({
            "id": fields.get("AA"),
            "league": league_name or "",
            "country": league_country or "",
            "home": fields.get("AE") or fields.get("CX") or fields.get("FH") or "",
            "away": fields.get("AF") or fields.get("FK") or "",
            "home_score": fields.get("AG"),
            "away_score": fields.get("AH"),
            "status": fields.get("AB") or fields.get("AC") or "",
            "ts": fields.get("AD"),
        })
    return events


def norm(s):
    s = re.sub(r"[^a-z0-9]", "", (s or "").lower())
    return s.replace("fc", "").replace("utd", "united")


ABBREV = {
    "manutd": "manchesterunited", "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "atletico": "atleticomadrid",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach",
    "stuttgart": "vfbstuttgart",
    "bremen": "werderbremen",
    "leverkusen": "bayerleverkusen",
    "psg": "parissaintgermain",
    "marseille": "olympiquemarseille",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "athletic": "athleticbilbao",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "leeds": "leedsunited",
    "wolves": "wolverhampton",
    "forest": "nottinghamforest",
    "boro": "middlesbrough",
}


def names_match(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    for tok, exp in ABBREV.items():
        if tok in a and exp in b:
            return True
        if tok in b and exp in a:
            return True
    return False


# Map our canonical league names to Flashscore's "country" + "league" hints
LEAGUE_HINTS = {
    "Premier League":         ("england",     "premier league"),
    "Championship":           ("england",     "championship"),
    "League One":             ("england",     "league one"),
    "League Two":             ("england",     "league two"),
    "LaLiga":                 ("spain",       "laliga"),
    "Bundesliga":             ("germany",     "bundesliga"),
    "Ligue 1":                ("france",      "ligue 1"),
    "Eredivisie":             ("netherlands", "eredivisie"),
    "UEFA Champions League":  ("europe",      "champions league"),
    "MLS":                    ("usa",         "mls"),
}


def league_hint_match(canon, fs_country, fs_league):
    expected_country, expected_league = LEAGUE_HINTS.get(canon, ("", ""))
    fc = (fs_country or "").lower()
    fl = (fs_league or "").lower()
    if expected_country and expected_country not in fc:
        return False
    if expected_league and expected_league not in fl:
        return False
    return True


def main():
    store = json.loads(STORE.read_text(encoding="utf-8"))

    raw = fetch_feed()
    if not raw:
        print("could not fetch Flashscore feed; abort")
        return
    events = parse_feed(raw)
    finished = [e for e in events if e.get("status") == "3" and e.get("home_score") and e.get("away_score")]
    print(f"  parsed {len(events)} events, {len(finished)} finished from {LAST_FEED_URL}")

    today = datetime.now(ADL).date().isoformat()
    matched = 0
    for L in store["leagues"]:
        for m in L["matches"]:
            if m.get("status") == "FT":
                continue
            if m.get("flashscore_score"):
                continue  # already has fallback hint
            for ev in finished:
                if not league_hint_match(L["name"], ev["country"], ev["league"]):
                    continue
                if not names_match(m["home"]["name"], ev["home"]):
                    continue
                if not names_match(m["away"]["name"], ev["away"]):
                    continue
                try:
                    hs = int(ev["home_score"])
                    as_ = int(ev["away_score"])
                except (TypeError, ValueError):
                    break
                m["flashscore_score"] = {
                    "home": hs, "away": as_, "status": "FT",
                    "source_match_id": ev["id"],
                    "fetched_at": today,
                }
                matched += 1
                print(f"  + {L['name']:25s}  {m['home']['name']} {hs}-{as_} {m['away']['name']}")
                break

    STORE.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDONE. matched={matched}")


if __name__ == "__main__":
    main()
