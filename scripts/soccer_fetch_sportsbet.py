#!/usr/bin/env python3
"""Pull Win-Draw-Win (90-min regular time) odds from sportsbet.com.au and merge
into match_data.json as `sportsbet_odds`. Australian "Win" prices are decimal-minus-1
(profit per unit), so we add 1 to display as standard decimal odds.

Also pulls the deeper market book from each matched event's page and stores it as
`sportsbet_markets` in SofaScore-compatible keys ("Full time", "Both teams to score",
"Match goals 2.5", "Cards in match 4.5", "Corners 2-Way 9.5", etc.) so the
prediction-odds attacher can consume it without changes to its keying scheme.

NOTE: Markets matched are "Win-Draw-Win" / "Match Result" / "1X2" — these are 90-minute
regular time only. Extra-time markets ("Match Result Including Overtime", etc.) are
explicitly excluded.
"""
import copy, json, math, os, re, time, pathlib, unicodedata
import random, sys, subprocess
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from curl_cffi import requests
from team_aliases import NATIONAL_TEAM_ALIASES

try:
    from zoneinfo import ZoneInfo
    ADL = ZoneInfo("Australia/Adelaide")
except Exception:
    ADL = timezone(timedelta(hours=9, minutes=30))

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

# Folder = this script's parent's parent (i.e. scripts/.. = repo root)
FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = FOLDER / "match_data.json"
QUICK_BETS_PATH = FOLDER / "sportsbet_quick_bets.json"
SPORTSBET_SOCCER_URL = "https://www.sportsbet.com.au/betting/soccer"
SPORTSBET_EVENT_RESULTS_URL = (
    "https://www.sportsbet.com.au/apigw/sportsbook-sports/"
    "Sportsbook/Sports/Events/{event_id}/Results"
)
QUICK_BET_HISTORY_DAYS = 30
QUICK_BET_REFRESH_MINUTES = 60
QUICK_BET_COVERAGE_MARKETS = {
    "winner": ("Full time", ("1", "X", "2")),
    "btts": ("Both teams to score", ("Yes", "No")),
    **{f"goals:{line}": (f"Match goals {line}", ("Over", "Under")) for line in (0.5, 1.5, 2.5, 3.5)},
}


def fixture_target_dates():
    dates = []
    for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(","):
        item = item.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
            dates.append(item)
    return set(dates)


def match_in_target_dates(match, target_dates):
    return not target_dates or match.get("date") in target_dates

# PRE-KICKOFF only: a match has kicked off once live/FT or its Adelaide-local
# date+time is at/before now. Skipping kicked-off matches keeps captured odds
# pre-kickoff and freezes them (a later run won't overwrite with live prices).
def has_kicked_off(m):
    status = str(m.get("status") or "").lower()
    if status in ("live", "ft"):
        return True
    d = m.get("date"); t = str(m.get("time") or "")
    if not d or not re.match(r"^\d{1,2}:\d{2}$", t):
        return False
    try:
        ko = datetime.strptime(d + " " + t, "%Y-%m-%d %H:%M").replace(tzinfo=ADL)
    except Exception:
        return False
    return datetime.now(ADL) >= ko

LEAGUE_PAGES = {
    "Premier League":         "united-kingdom/english-premier-league",
    "Championship":           "united-kingdom/english-championship",
    "League One":             "united-kingdom/english-league-1",
    "League Two":             "united-kingdom/english-league-2",
    "LaLiga":                 "spain/spanish-la-liga",
    "Serie A":                "italy/italian-serie-a",
    "Bundesliga":             "germany/german-bundesliga",
    "Ligue 1":                "france/french-ligue-1",
    "Eredivisie":             "rest-of-europe/dutch-eredivisie",
    "Primeira Liga":          "portugal/portuguese-primeira-liga",
    "UEFA Champions League":  "uefa-competitions/uefa-champions-league",
    "UEFA Europa League":     "uefa-competitions/uefa-europa-league",
    "UEFA Conference League": "uefa-competitions/uefa-europa-conference-league",
    "MLS":                    "usa/us-major-league-soccer",
    "A-League Men":           "australia/australian-a-league-men",
    "Scottish Premiership":   "united-kingdom/scottish-premiership",
    "J1 League":              "asia/japanese-j-league",
    "CONMEBOL Libertadores":  "americas/conmebol-copa-libertadores",
    "FIFA World Cup":         "world-cup/mens-world-cup",
    "International Friendly Games": "international-soccer/international-friendlies",
    "Allsvenskan":            "rest-of-europe/swedish-allsvenskan",
    "Eliteserien":            "rest-of-europe/norwegian-eliteserien",
}

ABBREV = {
    "wolves": "wolverhampton",
    "manutd": "manchesterunited", "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "forest": "nottinghamforest",
    "boro": "middlesbrough",
    "atletico": "atleticomadrid", "atlmadrid": "atleticomadrid",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach", "mgladbach": "borussiamonchengladbach",
    "marseille": "olympiquemarseille",
    "psg": "parissaintgermain",
    "stuttgart": "vfbstuttgart",
    "bremen": "werderbremen",
    "leverkusen": "bayerleverkusen",
    "hoffenheim": "tsghoffenheim",
    "pauli": "stpauli",
    "rennes": "staderennais",
    "leeds": "leedsunited",
    "newcastle": "newcastleunited",
    "westham": "westhamunited",
    "westbrom": "westbromwich",
    "oviedo": "realoviedo",
    "betis": "realbetis",
    "sociedad": "realsociedad",
    "athletic": "athleticbilbao",
}
# National-team synonyms (Cabo Verde/Cape Verde, etc.) live in one shared map so a
# new country alias is added once across settlement and all odds matchers.
ABBREV.update(NATIONAL_TEAM_ALIASES)

def norm(s):
    # Fold accented characters to ASCII so München -> munchen, Étienne -> etienne, etc.
    folded = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r'[^a-z0-9]', '', folded.lower())
    return s.replace("utd", "united").replace("fc", "")

def url_slug(s):
    folded = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii')
    slug = re.sub(r'[^a-z0-9]+', '-', folded.lower()).strip('-')
    return slug

# Significant tokens of a name, order-independent. Drops connective/suffix words so
# "Bosnia & Herzegovina" == "Bosnia-Herzegovina" and "DR Congo" == "Congo DR".
_NAME_STOPWORDS = {"fc", "afc", "cf", "sc", "and", "the", "of", "club"}
_NAME_TOKEN_ALIASES = {"utd": "united", "st": "saint", "dr": "dr"}

def name_tokens(s):
    folded = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii').lower()
    out = set()
    for tok in re.split(r'[^a-z0-9]+', folded):
        if not tok or tok in _NAME_STOPWORDS:
            continue
        out.add(_NAME_TOKEN_ALIASES.get(tok, tok))
    return out

def names_match(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb: return False
    if na == nb or na in nb or nb in na: return True
    for tok, exp in ABBREV.items():
        if tok in na and exp in nb: return True
        if tok in nb and exp in na: return True
    # Order-insensitive exact token-set match (additive — requires the full significant
    # token set to be equal, so it can't loosen existing matches into false positives).
    ta, tb = name_tokens(a), name_tokens(b)
    if ta and ta == tb: return True
    return False

def quick_bet_names_match(a, b):
    """Only exact team identities and explicitly registered aliases can associate forecasts."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    na, nb = norm(a), norm(b)
    aliases = {norm(key): norm(value) for key, value in ABBREV.items()}
    return bool(na and nb and aliases.get(na, na) == aliases.get(nb, nb))


def quick_bet_canonical_match(fixture, match):
    if quick_bet_kickoff(fixture) is None or quick_bet_kickoff(fixture) != quick_bet_kickoff(match):
        return False
    for side in ("home", "away"):
        team = match.get(side) or {}
        team = team if isinstance(team, dict) else {"name": team}
        fixture_id, team_id = fixture.get(side + "_id"), team.get("id")
        if fixture_id is not None and team_id is not None:
            if str(fixture_id) != str(team_id):
                return False
        elif not quick_bet_names_match(fixture.get(side), team.get("name") or team.get("short")):
            return False
    return True

def fetch_page_data(slug=""):
    url = SPORTSBET_SOCCER_URL + (("/" + slug) if slug else "")
    try:
        r = requests.get(url, impersonate=_profile(), timeout=20)
        if r.status_code != 200: return None
        # An unknown slug does not 404 — Sportsbet redirects to the parent section (or the
        # soccer root) and still serves a valid __PRELOADED_STATE__, so a stale slug reads
        # as a full book for the WRONG competition. Refuse anything that moved.
        final = str(getattr(r, "url", "") or "").split("?")[0].rstrip("/")
        if slug and final and not final.endswith(slug):
            print("  SLUG REDIRECTED: " + slug + " -> " + final + " (wrong competition; treating as no page)")
            return None
        if not slug:
            parsed = urlparse(final)
            host = (parsed.hostname or "").lower()
            if parsed.scheme != "https" or not (host == "sportsbet.com.au" or host.endswith(".sportsbet.com.au")) or parsed.path.rstrip("/") != "/betting/soccer":
                print("  SOCCER ROOT REDIRECTED: " + final + " (treating as failed refresh)")
                return None
        html = r.text
        return preloaded_state_from_html(html)
    except Exception as e:
        print("ERR", slug, ":", e)
        return None

def preloaded_state_from_html(html):
    start = html.find('window.__PRELOADED_STATE__ = ')
    if start == -1:
        return None
    start += len('window.__PRELOADED_STATE__ = ')
    end = html.find('window.__APOLLO_STATE__', start)
    if end == -1:
        return None
    return json.loads(html[start:end].rstrip().rstrip(';').rstrip())

def fetch_event_page_snapshot(event_url):
    try:
        r = requests.get(event_url, impersonate=_profile(), timeout=20)
        if r.status_code != 200:
            return None, None
        return preloaded_state_from_html(r.text), str(getattr(r, "url", "") or "")
    except Exception:
        return None, None

def fetch_event_page_data(event_url):
    data, _final_url = fetch_event_page_snapshot(event_url)
    return data

def to_decimal(num, den):
    """Sportsbet AU price = profit/stake. Decimal odds = profit + 1."""
    return round(num / den + 1.0, 2)


_GOALS_MARKET_RE = re.compile(r"^Over/Under\s+(\d+(?:\.\d+)?)\s+Goals$", re.I)
_CARDS_MARKET_RE = re.compile(r"^Over/Under\s+(\d+(?:\.\d+)?)\s+Cards$", re.I)
_CORNERS_MARKET_RE = re.compile(r"^Total\s+Corners\s+(\d+(?:\.\d+)?)$", re.I)
_OVER_UNDER_OUTCOME_RE = re.compile(r"^(Over|Under)\b", re.I)


def _outcome_price(oc):
    wp = oc.get("winPrice") or {}
    try:
        return to_decimal(wp["num"], wp["den"])
    except Exception:
        return None


def extract_event_markets(ev, markets, outcomes, include_empty=False):
    """Normalize Sportsbet markets into SofaScore-shaped keys.

    Returns {market_key: {choice: decimal_price}} with keys:
        "Full time"          -> {"1","X","2"}
        "Both teams to score"-> {"Yes","No"}
        "Double chance"      -> {"1X","X2","12"}
        "Match goals 2.5"    -> {"Over","Under"}
        "Cards in match 4.5" -> {"Over","Under"}
        "Corners 2-Way 9.5"  -> {"Over","Under"}
    """
    out = {}
    unmapped = set()
    for mid in ev.get("marketIds", []):
        mk = markets.get(str(mid)) or markets.get(mid)
        if not mk:
            continue
        name = (mk.get("name") or "").strip()
        # Record cards/corners TOTAL-style lines our regexes DON'T recognise, so the
        # missed-odds reviewer can flag scraper coverage gaps (book offered a market we
        # didn't capture). Excludes non-O/U card/corner markets (e.g. "Red Card Markets").
        low = name.lower()
        is_double_chance = low in ("double chance", "double chance 90 minutes")
        if (re.search(r"card|corner", low) and re.search(r"over|under|total", low)
                and re.search(r"\d", name)
                and not re.match(r"(home|away|1st half|2nd half|first half|second half)\b", low)
                and not _CARDS_MARKET_RE.match(name) and not _CORNERS_MARKET_RE.match(name)):
            unmapped.add(name)
        choices = {}
        for oid in mk.get("outcomeIds", []):
            oc = outcomes.get(str(oid)) or outcomes.get(oid)
            if not oc:
                continue
            price = _outcome_price(oc)
            if price is None or price <= 1.01:
                continue
            if is_double_chance and not math.isfinite(price):
                continue
            label = (oc.get("name") or "").strip()
            rt = oc.get("resultType") or ""
            if name in ("Win-Draw-Win", "Match Result", "1X2"):
                if rt == "H":
                    choices["1"] = price
                elif rt == "D":
                    choices["X"] = price
                elif rt == "A":
                    choices["2"] = price
                continue
            ou = _OVER_UNDER_OUTCOME_RE.match(label)
            if ou:
                choices[ou.group(1).capitalize()] = price
                continue
            if label in ("Yes", "No"):
                choices[label] = price
            if is_double_chance:
                normalized = re.sub(r"\s+", " ", label.casefold()).strip()
                home = str(ev.get("participant1") or "").strip().casefold()
                away = str(ev.get("participant2") or "").strip().casefold()
                aliases = {"1x": "1X", "x2": "X2", "12": "12",
                           "home or draw": "1X", "draw or away": "X2",
                           "away or draw": "X2", "home or away": "12"}
                if home and away:
                    aliases.update({f"{home} or draw": "1X", f"draw or {home}": "1X",
                                    f"{away} or draw": "X2", f"draw or {away}": "X2",
                                    f"{home} or {away}": "12", f"{away} or {home}": "12"})
                aliases.update({label.replace(" or ", " and "): side for label, side in list(aliases.items())})
                choice = aliases.get(normalized)
                if choice:
                    choices[choice] = price
                continue
        if not choices and not include_empty:
            continue
        if name in ("Win-Draw-Win", "Match Result", "1X2"):
            if include_empty or all(k in choices for k in ("1", "X", "2")):
                out["Full time"] = choices
            continue
        if name == "Both Teams To Score":
            out["Both teams to score"] = choices
            continue
        if is_double_chance:
            choices = {side: price for side, price in choices.items() if side in ("1X", "X2", "12")}
            if include_empty or choices:
                out["Double chance"] = choices
            continue
        m_goals = _GOALS_MARKET_RE.match(name)
        if m_goals:
            out[f"Match goals {m_goals.group(1)}"] = choices
            continue
        m_cards = _CARDS_MARKET_RE.match(name)
        if m_cards:
            out[f"Cards in match {m_cards.group(1)}"] = choices
            continue
        m_corners = _CORNERS_MARKET_RE.match(name)
        if m_corners:
            out[f"Corners 2-Way {m_corners.group(1)}"] = choices
            continue
    return out, sorted(unmapped)


def valid_sportsbet_event_response(requested_url, final_url):
    requested_id = sportsbet_event_id_from_url(requested_url)
    final_id = sportsbet_event_id_from_url(final_url)
    try:
        parsed = urlparse(str(final_url or ""))
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except Exception:
        return False
    safe_host = host == "sportsbet.com.au" or host.endswith(".sportsbet.com.au")
    return (parsed.scheme == "https" and safe_host and not parsed.username and not parsed.password
            and port in (None, 443) and parsed.path.startswith("/betting/soccer/")
            and bool(requested_id) and final_id == requested_id)


def fetch_event_markets_snapshot(event_url, expected_fixture=None):
    """Return normalized markets only for a validated Sportsbet event response."""
    if not valid_sportsbet_event_response(event_url, event_url):
        return {}, [], False
    data, final_url = fetch_event_page_snapshot(event_url)
    if not data or not valid_sportsbet_event_response(event_url, final_url):
        return {}, [], False
    if expected_fixture and str(final_url).split("?")[0].rstrip("/") != str(event_url).split("?")[0].rstrip("/"):
        return {}, [], False
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    markets = sb.get("markets", {})
    outcomes = sb.get("outcomes", {})
    event_id = sportsbet_event_id_from_url(event_url)
    if not all(isinstance(entities, dict) for entities in (events, markets, outcomes)):
        return {}, [], False
    if event_id:
        ev = find_event(data, event_id=event_id)
        if (not isinstance(ev, dict) or str(ev.get("id")) != event_id
                or not isinstance(ev.get("marketIds"), list)):
            return {}, [], False
        if expected_fixture:
            try:
                start = datetime.fromtimestamp(int(ev["startTime"]["milliseconds"]) / 1000, timezone.utc).astimezone(ADL)
            except (KeyError, TypeError, ValueError, OverflowError):
                return {}, [], False
            candidate = {"event_id": str(ev.get("id")), "date": start.strftime("%Y-%m-%d"),
                         "time": start.strftime("%H:%M"), "home": str(ev.get("participant1") or ""),
                         "away": str(ev.get("participant2") or "")}
            matched, reversed_order = quick_bet_forecast_match(expected_fixture, [candidate])
            if not matched:
                return {}, [], False
        for mid in ev["marketIds"]:
            if not isinstance(mid, (str, int)) or isinstance(mid, bool):
                return {}, [], False
            market = _entity(markets, mid)
            if (not isinstance(market, dict) or not isinstance(market.get("outcomeIds"), list)
                    or any(not isinstance(oid, (str, int)) or isinstance(oid, bool)
                           or not isinstance(_entity(outcomes, oid), dict) for oid in market["outcomeIds"])):
                return {}, [], False
        normalized, unmapped = extract_event_markets(ev, markets, outcomes, include_empty=True)
        if expected_fixture:
            return normalized, unmapped, True, candidate
        return normalized, unmapped, True
    best, best_unmapped = {}, []
    for ev in events.values():
        if not ev.get("marketIds"):
            continue
        markets_for_ev, unmapped_ev = extract_event_markets(ev, markets, outcomes)
        if len(markets_for_ev) > len(best):
            best, best_unmapped = markets_for_ev, unmapped_ev
    return best, best_unmapped, True


def fetch_event_markets(event_url):
    """Fetch a single event page; return (normalized market dict, unmapped card/corner names)."""
    markets, unmapped, _ok = fetch_event_markets_snapshot(event_url)
    return markets, unmapped

SPORTSBET_TERMINAL_STATUS_WORDS = ("postponed", "cancelled", "canceled", "abandoned")

def sportsbet_event_id_from_url(event_url):
    # Read the id only from the final path segment. An unanchored search matches the
    # leftmost "-<digits>" and swallows the rest via [/?#].*, so a league slug that
    # contains a digit (english-league-1) yields "1" instead of the event id.
    path = str(event_url or "").split("?")[0].split("#")[0].rstrip("/")
    segment = path.rsplit("/", 1)[-1]
    m = re.search(r"-(\d+)$", segment)
    return m.group(1) if m else None

def find_event(data, event_id=None, home=None, away=None):
    sb = ((data or {}).get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    if event_id:
        event = events.get(str(event_id))
        if not event and str(event_id).isdigit():
            event = events.get(int(event_id))
        if event:
            return event
        for ev in events.values():
            if str(ev.get("id") or "") == str(event_id):
                return ev
    if home and away:
        for ev in events.values():
            if names_match(home, ev.get("participant1")) and names_match(away, ev.get("participant2")):
                return ev
            if names_match(home, ev.get("participant2")) and names_match(away, ev.get("participant1")):
                return ev
    return None

def _terminal_status_text(value):
    if isinstance(value, str):
        lowered = value.lower()
        if any(word in lowered for word in SPORTSBET_TERMINAL_STATUS_WORDS):
            return value.strip()
        return None
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key).lower()
            child_hit = _terminal_status_text(child)
            if child_hit:
                return child_hit
            if any(word in key_text for word in SPORTSBET_TERMINAL_STATUS_WORDS) and child:
                return str(key)
    if isinstance(value, list):
        for child in value:
            child_hit = _terminal_status_text(child)
            if child_hit:
                return child_hit
    return None

def event_terminal_status(event):
    text = _terminal_status_text(event or {})
    if not text:
        return None
    lowered = text.lower()
    state = "postponed" if "postpon" in lowered else "cancelled"
    return {"status": state, "status_text": text, "event": event}

def fetch_event_status(event_url=None, event_id=None, league_slug=None, home=None, away=None):
    event_id = event_id or sportsbet_event_id_from_url(event_url)
    for data in (
        fetch_event_page_data(event_url) if event_url else None,
        fetch_page_data(league_slug) if league_slug else None,
    ):
        if not data:
            continue
        event = find_event(data, event_id=event_id, home=home, away=away)
        status = event_terminal_status(event)
        if status:
            status["event_id"] = event_id or (event or {}).get("id")
            return status
    return None


def fetch_event_results(event_id):
    event_id = str(event_id or "").strip()
    if not re.fullmatch(r"\d+", event_id):
        return None
    try:
        response = requests.get(
            SPORTSBET_EVENT_RESULTS_URL.format(event_id=event_id),
            impersonate=_profile(),
            timeout=20,
            headers={"Accept": "application/json, text/plain, */*"},
        )
        if response.status_code != 200:
            return None
        payload = response.json()
    except Exception:
        return None
    if not isinstance(payload, dict) or str(payload.get("id") or "") != event_id:
        return None
    if not isinstance(payload.get("markets"), list):
        return None
    return payload


def _record_result_winner(winners, ambiguous, family, key):
    if not family or not key or family in ambiguous:
        return
    previous = winners.get(family)
    if previous is None:
        winners[family] = key
    elif previous != key:
        winners.pop(family, None)
        ambiguous.add(family)


def _sportsbet_result_winners(result_event, home, away):
    winners = {}
    ambiguous = set()
    for market in (result_event or {}).get("markets") or []:
        if not isinstance(market, dict):
            continue
        name = str(market.get("name") or "").strip()
        raw_selections = market.get("selections")
        if not isinstance(raw_selections, list):
            continue
        selections = [
            selection for selection in raw_selections
            if isinstance(selection, dict) and str(selection.get("statusCode") or "").upper() == "W"
        ]
        if len(selections) != 1:
            continue
        selection = selections[0]
        selection_name = str(selection.get("name") or "").strip()
        if name == "Win-Draw-Win":
            result_type = str(selection.get("resultType") or "").upper()
            key = {"H": "home", "D": "draw", "A": "away"}.get(result_type)
            if not key and names_match(selection_name, home):
                key = "home"
            elif not key and names_match(selection_name, away):
                key = "away"
            elif not key and selection_name.lower() == "draw":
                key = "draw"
            _record_result_winner(winners, ambiguous, "winner", key)
            continue
        if name == "Both Teams To Score":
            key = selection_name.lower()
            _record_result_winner(winners, ambiguous, "btts", key if key in ("yes", "no") else None)
            continue
        line_match = re.fullmatch(r"Over/Under (\d+(?:\.\d+)?) Goals", name)
        side_match = re.fullmatch(r"(Over|Under) (\d+(?:\.\d+)?) Goals", selection_name)
        if line_match and side_match and float(line_match.group(1)) == float(side_match.group(2)):
            line = str(float(line_match.group(1))).rstrip("0").rstrip(".")
            _record_result_winner(
                winners, ambiguous, f"goals:{line}", f"{side_match.group(1).lower()}:{line}",
            )
    return winners


def _captured_quick_bet_key(family, selection):
    if not isinstance(selection, dict):
        return None
    try:
        odds = float(selection.get("odds"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(odds) or not 1 < odds < 1.5:
        return None
    key = str(selection.get("key") or "").lower()
    if family == "winner":
        return ("winner", key) if key in ("home", "draw", "away") else None
    if family == "btts":
        return ("btts", key) if key in ("yes", "no") else None
    side = "over" if family == "goalsOver" else "under"
    try:
        numeric_line = float(selection.get("line"))
    except (TypeError, ValueError):
        return None
    if numeric_line < 0 or str(selection.get("side") or "").lower() != side:
        return None
    line = str(numeric_line).rstrip("0").rstrip(".")
    stable_key = f"{side}:{line}"
    return (f"goals:{line}", stable_key) if key == stable_key else None


def settle_quick_bet_markets(markets, result_event, home, away):
    settled = copy.deepcopy(markets if isinstance(markets, dict) else {})
    winners = _sportsbet_result_winners(result_event, home, away)
    captured_count = graded_count = 0
    for family in ("winner", "btts", "goalsOver", "goalsUnder"):
        if family not in settled:
            continue
        selections = settled.get(family)
        if not isinstance(selections, list):
            captured_count += 1
            continue
        for selection in selections:
            captured_count += 1
            captured = _captured_quick_bet_key(family, selection)
            if not captured:
                continue
            winner = winners.get(captured[0])
            if not winner:
                continue
            selection.pop("result", None)
            selection["result"] = "hit" if captured[1] == winner else "miss"
            graded_count += 1
    return settled, graded_count, captured_count

def extract_odds(data, league_slug=None):
    """Extract Win-Draw-Win (90-min regular time) prices for every event on the league page."""
    out = {}
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    markets = sb.get("markets", {})
    outcomes = sb.get("outcomes", {})
    for eid, ev in events.items():
        h, a = ev.get("participant1"), ev.get("participant2")
        if not h or not a: continue
        ts = (ev.get("startTime") or {}).get("milliseconds", 0)
        wdw = None
        for mid in ev.get("marketIds", []):
            mk = markets.get(str(mid)) or markets.get(mid)
            if not mk: continue
            # 90-MIN REGULAR TIME ONLY — skip extra-time markets
            if mk.get("name") in ("Win-Draw-Win", "Match Result", "1X2"):
                wdw = mk
                break
        if not wdw: continue
        odds = {}
        for oid in wdw.get("outcomeIds", []):
            oc = outcomes.get(str(oid)) or outcomes.get(oid)
            if not oc: continue
            wp = oc.get("winPrice") or {}
            try:
                price = to_decimal(wp["num"], wp["den"])
            except Exception:
                continue
            rt = oc.get("resultType") or ""
            if rt == "H":   odds["home"] = price
            elif rt == "D": odds["draw"] = price
            elif rt == "A": odds["away"] = price
        if "home" in odds and "draw" in odds and "away" in odds:
            event_url = None
            if league_slug and ev.get("id"):
                event_url = "https://www.sportsbet.com.au/betting/soccer/{}/{}-{}".format(
                    league_slug, url_slug(ev.get("name") or f"{h} v {a}"), ev.get("id")
                )
            out[(norm(h), norm(a))] = {
                "home": odds["home"], "draw": odds["draw"], "away": odds["away"],
                "event_id": ev.get("id"), "start_ts": ts // 1000,
                "home_name": h, "away_name": a, "event_url": event_url,
            }
    return out

def find_match(idx, home, away):
    nh, na = norm(home), norm(away)
    if (nh, na) in idx:
        return {**idx[(nh, na)], "reversed": False}
    if (na, nh) in idx:
        return {**idx[(na, nh)], "reversed": True}
    for v in idx.values():
        if names_match(home, v["home_name"]) and names_match(away, v["away_name"]):
            return {**v, "reversed": False}
        if names_match(home, v["away_name"]) and names_match(away, v["home_name"]):
            return {**v, "reversed": True}
    return None

def fixture_side_odds(hit):
    if hit.get("reversed"):
        return hit["away"], hit["draw"], hit["home"]
    return hit["home"], hit["draw"], hit["away"]

def markets_for_fixture(markets_dict, reversed_fixture=False):
    if not reversed_fixture:
        return markets_dict
    out = {}
    for key, choices in (markets_dict or {}).items():
        if key in ("Full time", "Draw No Bet") and isinstance(choices, dict):
            flipped = dict(choices)
            if "1" in choices or "2" in choices:
                flipped["1"] = choices.get("2")
                flipped["2"] = choices.get("1")
            out[key] = {k: v for k, v in flipped.items() if v is not None}
        elif key == "Double chance" and isinstance(choices, dict):
            out[key] = {({"1X": "X2", "X2": "1X"}.get(side, side)): price
                        for side, price in choices.items()}
        else:
            out[key] = choices
    return out


def _entity(mapping, key):
    return (mapping or {}).get(str(key)) or (mapping or {}).get(key)


def _short_price(value):
    return value if not isinstance(value, bool) and isinstance(value, (int, float)) and 1 < value < 1.5 else None


def _goal_line(value):
    try:
        line = float(value)
    except (TypeError, ValueError):
        return None
    return line if line >= 0 and line not in (float("inf"), float("-inf")) else None


def _line_text(line):
    return format(float(line), "g")


def quick_markets_from_normalized(normalized, home, away):
    full_time = (normalized or {}).get("Full time") or {}
    btts = (normalized or {}).get("Both teams to score") or {}
    out = {"winner": [], "btts": [], "goalsOver": [], "goalsUnder": []}
    for key, label, value in (("home", home, full_time.get("1")), ("draw", "Draw", full_time.get("X")), ("away", away, full_time.get("2"))):
        price = _short_price(value)
        if price is not None:
            out["winner"].append({"key": key, "label": label, "odds": price})
    for key, label in (("yes", "Yes"), ("no", "No")):
        price = _short_price(btts.get(label))
        if price is not None:
            out["btts"].append({"key": key, "label": label, "odds": price})
    goal_rows = []
    for name, prices in (normalized or {}).items():
        matched = re.fullmatch(r"Match goals (\d+(?:\.\d+)?)", str(name))
        if not matched or not isinstance(prices, dict):
            continue
        line = _goal_line(matched.group(1))
        if line is None:
            continue
        for side, market in (("over", "goalsOver"), ("under", "goalsUnder")):
            if side == "under" and line == 4.5:
                continue
            price = _short_price(prices.get(side.title()))
            if price is not None:
                label = f"{side.title()} {_line_text(line)}"
                goal_rows.append((line, side, market, {
                    "key": f"{side}:{_line_text(line)}", "side": side,
                    "line": line, "label": label, "odds": price,
                }))
    for _line, _side, market, row in sorted(goal_rows):
        out[market].append(row)
    return out


def _retained_deep_markets(prior, home, away):
    prior_markets = (prior or {}).get("markets") or {}
    retained = {"winner": [], "btts": [], "goalsOver": [], "goalsUnder": []}
    for item in prior_markets.get("btts") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip().lower()
        key = str(item.get("key") or label).lower()
        if key not in ("yes", "no") or _short_price(item.get("odds")) is None:
            continue
        retained["btts"].append({"key": key, "label": key.title(), "odds": item["odds"]})
    for market, side in (("goalsOver", "over"), ("goalsUnder", "under")):
        for item in prior_markets.get(market) or []:
            if not isinstance(item, dict) or _short_price(item.get("odds")) is None:
                continue
            matched = re.fullmatch(r"(?:Over|Under)\s+(\d+(?:\.\d+)?)", str(item.get("label") or ""), re.I)
            line = _goal_line(item.get("line") if item.get("line") is not None else (matched.group(1) if matched else None))
            if line is None or (side == "under" and line == 4.5):
                continue
            retained[market].append({
                "key": f"{side}:{_line_text(line)}", "side": side, "line": line,
                "label": f"{side.title()} {_line_text(line)}", "odds": item["odds"],
            })
    return retained


def merge_quick_markets(current, deep):
    return {
        "winner": list((current or {}).get("winner") or []),
        "btts": list((deep or {}).get("btts") or []),
        "goalsOver": list((deep or {}).get("goalsOver") or []),
        "goalsUnder": list((deep or {}).get("goalsUnder") or []),
    }


def discover_quick_bet_events(data, now=None, league_slug=None):
    now = now or datetime.now(ADL)
    if now.tzinfo is None:
        now = now.replace(tzinfo=ADL)
    last_date = now.date() + timedelta(days=6)
    sb = ((data or {}).get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events") or {}
    markets = sb.get("markets") or {}
    outcomes = sb.get("outcomes") or {}
    competitions = sb.get("competitions") or {}
    discovered = []
    for event in events.values():
        home = str(event.get("participant1") or "").strip()
        away = str(event.get("participant2") or "").strip()
        if not home or not away or event.get("removed"):
            continue
        try:
            start = datetime.fromtimestamp(int((event.get("startTime") or {}).get("milliseconds")) / 1000, timezone.utc).astimezone(ADL)
        except Exception:
            continue
        if start <= now or start.date() < now.date() or start.date() > last_date:
            continue
        competition = _entity(competitions, event.get("competitionId")) or {}
        region = str(competition.get("regionId") or "").strip()
        competition_name = str(competition.get("name") or "Soccer").strip()
        slug = league_slug or (f"{region}/{url_slug(competition_name)}" if region else None)
        if not slug or not event.get("id"):
            continue
        event_url = f"{SPORTSBET_SOCCER_URL}/{slug}/{url_slug(event.get('name') or f'{home} v {away}')}-{event.get('id')}"
        normalized, _unmapped = extract_event_markets(event, markets, outcomes)
        discovered.append({
            "event_id": str(event.get("id")), "league": competition_name,
            "date": start.strftime("%Y-%m-%d"), "time": start.strftime("%H:%M"),
            "home": home, "away": away, "event_url": event_url,
            "markets": quick_markets_from_normalized(normalized, home, away),
            "root_captured_at": now.isoformat(), "root_stale": False,
            "deep_captured_at": None, "deep_generation": None, "deep_stale": True,
        })
    return sorted(discovered, key=lambda row: (row["date"], row["time"], row["event_id"]))


def read_quick_bets(path=QUICK_BETS_PATH):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) and isinstance(payload.get("events"), list) else None
    except Exception:
        return None


def quick_bet_kickoff(row):
    try:
        return datetime.strptime(
            f"{row.get('date')} {row.get('time')}", "%Y-%m-%d %H:%M"
        ).replace(tzinfo=ADL)
    except (AttributeError, TypeError, ValueError):
        return None


def roll_quick_bet_history(previous, current_events, now=None, leagues=None):
    """Freeze kicked-off captures into history without mutating the caller."""
    now = now or datetime.now(ADL)
    if now.tzinfo is None:
        now = now.replace(tzinfo=ADL)
    previous = previous if isinstance(previous, dict) else {}
    prior_events = {
        str(row.get("event_id")): copy.deepcopy(row)
        for row in previous.get("events") or []
        if isinstance(row, dict) and row.get("event_id") is not None
    }
    existing_history = {
        str(row.get("event_id")): copy.deepcopy(row)
        for row in previous.get("history") or []
        if isinstance(row, dict) and row.get("event_id") is not None
    }

    future = []
    started = {}
    for raw in current_events or []:
        if not isinstance(raw, dict) or raw.get("event_id") is None:
            continue
        event_id = str(raw.get("event_id"))
        current = copy.deepcopy(raw)
        frozen = prior_events.get(event_id, current)
        kickoff = quick_bet_kickoff(frozen) or quick_bet_kickoff(current)
        if kickoff and kickoff <= now:
            started[event_id] = frozen
        else:
            future.append(current)
    for event_id, frozen in prior_events.items():
        kickoff = quick_bet_kickoff(frozen)
        if kickoff and kickoff <= now:
            started.setdefault(event_id, frozen)

    history = dict(existing_history)
    for event_id, frozen in started.items():
        if not any((frozen.get("markets") or {}).values()) and not quick_bet_inspection_authoritative(frozen):
            continue
        if event_id not in history:
            frozen["status"] = "started"
            if not any((frozen.get("markets") or {}).values()):
                frozen["inspection_only"] = True
            frozen["lifecycle_updated_at"] = now.isoformat()
            history[event_id] = frozen

    cutoff = now.date() - timedelta(days=QUICK_BET_HISTORY_DAYS)
    kept = []
    for row in history.values():
        kickoff = quick_bet_kickoff(row)
        canonical_retained = quick_bet_inspection_authoritative(row) and any(
            quick_bet_canonical_match(row.get("canonical") or row, match)
            for league in leagues or [] for match in league.get("matches") or [])
        if kickoff and (kickoff.date() >= cutoff or canonical_retained):
            kept.append(row)
    future.sort(key=lambda row: (row.get("date") or "", row.get("time") or "", str(row.get("event_id") or "")))
    kept.sort(key=lambda row: (row.get("date") or "", row.get("time") or "", str(row.get("event_id") or "")))
    return future, kept


def capture_quick_bet_stars(payload, previous, leagues, now=None):
    capture_input = {"sidecar": payload, "previous": previous, "leagues": leagues or []}
    if now is not None:
        capture_input["now"] = now.isoformat()
    result = subprocess.run(
        ["node", str(FOLDER / "scripts" / "capture_quick_bet_stars.mjs")],
        input=json.dumps(capture_input),
        encoding="utf-8", capture_output=True, check=True, timeout=60,
    )
    enriched = json.loads(result.stdout)
    if not isinstance(enriched, dict) or not isinstance(enriched.get("events"), list) or not isinstance(enriched.get("history"), list):
        raise ValueError("Invalid Quick Bets star snapshot payload")
    return enriched


def atomic_write_json(path, payload):
    temp_path = path.with_suffix(path.suffix + ".tmp")
    try:
        temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def quick_bet_forecast(leagues, now):
    rows = []
    seen = set()
    through = (now.date() + timedelta(days=6)).isoformat()
    for league in leagues or []:
        for match in league.get("matches") or []:
            date = str(match.get("date") or "")
            status = str(match.get("status") or "").lower()
            if date < now.date().isoformat() or date > through or status in (
                    "ft", "finished", "result", "live", "postponed_or_cancelled", "cancelled", "canceled", "postponed", "void"):
                continue
            home, away = match.get("home") or {}, match.get("away") or {}
            home = home if isinstance(home, dict) else {"name": home}
            away = away if isinstance(away, dict) else {"name": away}
            row = {"league": league.get("name") or "", "date": date, "time": str(match.get("time") or ""),
                   "home": str(home.get("name") or home.get("short") or ""),
                   "away": str(away.get("name") or away.get("short") or ""),
                   "home_id": home.get("id"), "away_id": away.get("id")}
            reference = match.get("sportsbet_odds") or {}
            event_url = reference.get("event_url")
            event_id = sportsbet_event_id_from_url(event_url)
            if (event_id and valid_sportsbet_event_response(event_url, event_url)
                    and str(reference.get("event_id") or event_id) == event_id):
                row["known_event_id"], row["known_event_url"] = event_id, event_url
            kickoff = quick_bet_kickoff(row)
            if kickoff and kickoff <= now:
                continue
            key = (date, row["time"], norm(row["home"]), norm(row["away"]))
            if not row["home"] or not row["away"] or key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return sorted(rows, key=lambda row: (row["date"], row["time"], row["league"], row["home"]))


def quick_bet_forecast_match(fixture, events):
    kickoff = quick_bet_kickoff(fixture)
    if not kickoff:
        return None, False
    hits = {}
    for event in events:
        if quick_bet_kickoff(event) != kickoff:
            continue
        direct = quick_bet_names_match(fixture["home"], event["home"]) and quick_bet_names_match(fixture["away"], event["away"])
        reverse = quick_bet_names_match(fixture["home"], event["away"]) and quick_bet_names_match(fixture["away"], event["home"])
        if direct != reverse:
            hits[event["event_id"]] = (event, reverse)
    return next(iter(hits.values())) if len(hits) == 1 else (None, len(hits) > 1)


def quick_bet_market_coverage(normalized):
    coverage = {}
    for key, (name, choices) in QUICK_BET_COVERAGE_MARKETS.items():
        prices = (normalized or {}).get(name)
        if prices is None:
            status = "not_offered"
        elif any(_short_price(value) is not None for value in prices.values()):
            status = "selection"
        elif all(isinstance(prices.get(choice), (int, float)) and not isinstance(prices.get(choice), bool)
                 and math.isfinite(prices[choice]) and prices[choice] > 1 for choice in choices):
            status = "no_selection"
        else:
            status = "no_price"
        coverage[key] = status
    return coverage


def quick_bet_inspection_authoritative(row):
    coverage = row.get("last_inspection_coverage") or row.get("market_coverage")
    return isinstance(coverage, dict) and all(coverage.get(key) in (
        "selection", "no_selection", "no_price", "not_offered") for key in QUICK_BET_COVERAGE_MARKETS)


def quick_bet_inspection_fresh(row, now):
    try:
        captured = datetime.fromisoformat(str(row.get("deep_captured_at")))
        age = (now - captured).total_seconds()
        return (row.get("deep_stale") is False and quick_bet_inspection_authoritative({
            "market_coverage": row.get("market_coverage")}) and 0 <= age < QUICK_BET_REFRESH_MINUTES * 60)
    except (TypeError, ValueError):
        return False


def refresh_quick_bets(root_data, now=None, budget_seconds=None, event_limit=None,
                       fetcher=fetch_event_markets_snapshot, sleep_seconds=0.8,
                       path=QUICK_BETS_PATH, leagues=None, page_fetcher=fetch_page_data,
                       page_cache=None):
    capture_now = now
    now = now or datetime.now(ADL)
    now = now.replace(tzinfo=ADL) if now.tzinfo is None else now.astimezone(ADL)
    now_iso = now.isoformat()
    previous = read_quick_bets(path)
    previous_events = {str(row.get("event_id")): row for row in (previous or {}).get("events") or []}
    previous_deep = (previous or {}).get("deep") or {}
    discovered = {event["event_id"]: event for event in discover_quick_bet_events(root_data, now)}
    page_cache = page_cache if page_cache is not None else {}
    forecast = quick_bet_forecast(leagues, now)
    for fixture in forecast:
        fixture["event_id"] = None
        if not quick_bet_kickoff(fixture):
            fixture["status"] = "kickoff_unknown"
            continue
        slug = LEAGUE_PAGES.get(fixture["league"])
        candidates = list(discovered.values())
        if slug:
            if slug not in page_cache:
                try:
                    page_cache[slug] = page_fetcher(slug)
                except Exception:
                    page_cache[slug] = None
                if sleep_seconds:
                    time.sleep(sleep_seconds)
            candidates += discover_quick_bet_events(page_cache[slug], now, slug)
        event, reversed_or_ambiguous = quick_bet_forecast_match(fixture, candidates)
        if event:
            fixture["event_id"] = event["event_id"]
            fixture["status"] = "matched"
            event["canonical"] = {**fixture, "reversed": reversed_or_ambiguous}
            discovered[event["event_id"]] = event
        else:
            fixture["status"] = "ambiguous" if reversed_or_ambiguous else (
                "page_failed" if slug and page_cache[slug] is None else "unmapped_league" if not slug else "unmatched")
            prior, _ = quick_bet_forecast_match(fixture, list(previous_events.values()))
            known_url = fixture.get("known_event_url") or (prior or {}).get("event_url")
            known_id = sportsbet_event_id_from_url(known_url)
            if (not reversed_or_ambiguous and known_id and known_id not in discovered
                    and valid_sportsbet_event_response(known_url, known_url)):
                fixture["pending_event_id"] = known_id
                fallback = {"event_id": known_id, "event_url": known_url, "league": fixture["league"],
                            "date": fixture["date"], "time": fixture["time"], "home": fixture["home"], "away": fixture["away"],
                            "markets": {}, "root_stale": False, "deep_stale": True,
                            "pending_canonical": {**fixture, "reversed": False}, "verify_fixture": dict(fixture)}
                if prior and prior["event_id"] == known_id:
                    fallback = {**copy.deepcopy(prior), "root_stale": False, "deep_stale": True,
                                "verify_fixture": dict(prior)}
                discovered[known_id] = fallback
    for event_id, prior in previous_events.items():
        kickoff = quick_bet_kickoff(prior)
        if (event_id not in discovered and kickoff and now < kickoff and kickoff.date() <= now.date() + timedelta(days=6)
                and (not root_data or quick_bet_inspection_authoritative(prior))):
            stale = copy.deepcopy(prior)
            stale["root_stale"] = True
            stale["deep_stale"] = True
            discovered[event_id] = stale

    events = sorted(discovered.values(), key=lambda row: (row["date"], row["time"], row["event_id"]))
    ids = [event["event_id"] for event in events]
    previous_members = [str(value) for value in previous_deep.get("member_ids") or previous_events.keys()]
    generation = max(1, int(previous_deep.get("generation") or 1))
    for event in events:
        prior = previous_events.get(event["event_id"]) or {}
        same_fixture = (prior.get("date"), prior.get("time"), prior.get("home"), prior.get("away")) == (
            event["date"], event["time"], event["home"], event["away"])
        if same_fixture:
            event["markets"] = merge_quick_markets(event["markets"], _retained_deep_markets(prior, event["home"], event["away"]))
            event["deep_captured_at"] = prior.get("deep_captured_at")
            event["market_coverage"] = prior.get("market_coverage")
            if quick_bet_inspection_authoritative(prior):
                event["last_inspection_coverage"] = copy.deepcopy(prior.get("last_inspection_coverage") or prior["market_coverage"])
                event["markets"] = copy.deepcopy(prior.get("markets") or {})
        event["deep_stale"] = bool(event.get("root_stale")) or not (same_fixture and quick_bet_inspection_fresh(prior, now))
        event["deep_generation"] = generation
    if previous_deep.get("complete") and any(event["deep_stale"] for event in events):
        generation += 1

    budget_seconds = max(0.0, float(budget_seconds if budget_seconds is not None else os.environ.get("SOCCER_SPORTSBET_QUICK_BETS_DEEP_BUDGET", "90")))
    event_limit = max(0, int(event_limit if event_limit is not None else os.environ.get("SOCCER_SPORTSBET_QUICK_BETS_DEEP_LIMIT", "30")))
    previous_cursor = str(previous_deep.get("next_event_id") or "")
    cursor_reset = bool(previous_cursor and previous_cursor not in ids)
    if cursor_reset and previous_cursor in previous_members:
        old_position = previous_members.index(previous_cursor)
        previous_cursor = next((previous_members[(old_position + offset) % len(previous_members)]
                                for offset in range(1, len(previous_members))
                                if previous_members[(old_position + offset) % len(previous_members)] in ids), "")
    position = ids.index(previous_cursor) if previous_cursor in ids else 0
    started = time.monotonic()
    attempted = fresh = failed = visited = 0
    event_market_cache = {}
    while events and visited < len(events) and attempted < event_limit:
        event = events[position]
        if event["deep_stale"] and not event.get("root_stale"):
            if budget_seconds <= 0 or time.monotonic() - started >= budget_seconds:
                break
            try:
                snapshot = (fetcher(event["event_url"], expected_fixture=event["verify_fixture"])
                    if event.get("verify_fixture") else fetcher(event["event_url"]))
                normalized, unmapped, ok = snapshot[:3]
                if ok and event.get("verify_fixture"):
                    identity = snapshot[3] if len(snapshot) > 3 else None
                    canonical = event.get("pending_canonical") or event.get("canonical")
                    verified, reverse = quick_bet_forecast_match(canonical or event, [identity] if identity else [])
                    ok = bool(verified and verified["event_id"] == event["event_id"])
                    if ok:
                        event["home"], event["away"] = verified["home"], verified["away"]
                        if canonical:
                            event["canonical"] = {**canonical, "reversed": reverse}
            except Exception:
                normalized, unmapped, ok = {}, [], False
            attempted += 1
            if ok:
                detail = quick_markets_from_normalized(normalized, event["home"], event["away"])
                event["markets"] = detail
                event["market_coverage"] = quick_bet_market_coverage(normalized)
                event["last_inspection_coverage"] = dict(event["market_coverage"])
                event.pop("pending_canonical", None)
                event.pop("verify_fixture", None)
                event["deep_captured_at"] = now_iso
                event["deep_generation"] = generation
                event["deep_stale"] = False
                event_market_cache[event["event_id"]] = (normalized, unmapped)
                fresh += 1
            else:
                event["market_coverage"] = {key: "fetch_failed" for key in QUICK_BET_COVERAGE_MARKETS}
                failed += 1
            if sleep_seconds:
                time.sleep(sleep_seconds)
        position = (position + 1) % len(events)
        visited += 1

    for event in events:
        if event["deep_stale"]:
            old_coverage = event.get("market_coverage") or {}
            event["market_coverage"] = {key: "fetch_failed" if old_coverage.get(key) == "fetch_failed"
                                        else "stale" if event.get("deep_captured_at") else "not_checked"
                                        for key in QUICK_BET_COVERAGE_MARKETS}
    by_id = {event["event_id"]: event for event in events}
    checked = 0
    for fixture in forecast:
        event = by_id.get(fixture["event_id"] or fixture.get("pending_event_id"))
        fixture["markets"] = event["market_coverage"] if event else {key: "not_checked" for key in QUICK_BET_COVERAGE_MARKETS}
        fixture["checked_at"] = event.get("deep_captured_at") if event else None
        fixture["checked"] = bool(event and quick_bet_inspection_fresh(event, now) and not event.get("root_stale"))
        if fixture["checked"]:
            fixture["status"] = "matched"
            fixture["event_id"] = event["event_id"]
        fixture.pop("pending_event_id", None)
        checked += int(fixture["checked"])
    stale_events = sum(1 for event in events if event["deep_stale"])
    complete = bool(root_data) and stale_events == 0 and checked == len(forecast)
    next_event_id = next((events[(position + offset) % len(events)]["event_id"]
                          for offset in range(len(events)) if events[(position + offset) % len(events)]["deep_stale"]), None)
    events, history = roll_quick_bet_history(previous, events, now, leagues=leagues)
    payload = {
        "schema_version": 2, "source": "Sportsbet", "source_url": SPORTSBET_SOCCER_URL,
        "captured_at": now_iso if root_data else (previous or {}).get("captured_at"), "attempted_at": now_iso,
        "status": "complete" if complete else "partial" if root_data or checked else "stale",
        "window": {"timezone": "Australia/Adelaide", "from_date": now.date().isoformat(),
                   "through_date": (now.date() + timedelta(days=6)).isoformat()},
        "coverage": {"fromDate": now.date().isoformat(), "throughDate": (now.date() + timedelta(days=6)).isoformat(),
                     "capturedAt": now_iso, "refreshMinutes": QUICK_BET_REFRESH_MINUTES,
                     "totalFixtures": len(forecast), "checkedFixtures": checked, "pendingFixtures": len(forecast) - checked,
                     "fixtures": forecast},
        "deep": {
            "generation": generation, "member_ids": ids, "budget_seconds": budget_seconds, "event_limit": event_limit,
            "attempted_events": attempted, "fresh_events": fresh, "failed_events": failed,
            "stale_events": stale_events, "next_event_id": next_event_id, "cursor_reset": cursor_reset,
            "membership_changed": bool(previous and set(ids) != set(previous_members)), "complete": complete,
        },
        "events": events, "history": history,
    }
    payload = capture_quick_bet_stars(payload, previous, leagues, capture_now)
    atomic_write_json(path, payload)
    return payload, event_market_cache

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    target_dates = fixture_target_dates()
    if target_dates:
        print("target_dates=" + ",".join(sorted(target_dates)))
    print("Fetching Sportsbet soccer root for seven-day quick bets")
    root_data = fetch_page_data()
    page_cache = {}
    sidecar, event_market_cache = refresh_quick_bets(root_data, leagues=store.get("leagues"), page_cache=page_cache)
    print(f"  quick_bets status={sidecar.get('status')} events={len(sidecar.get('events') or [])} "
          f"fresh={((sidecar.get('deep') or {}).get('fresh_events') or 0)} "
          f"stale={((sidecar.get('deep') or {}).get('stale_events') or 0)} "
          f"next={((sidecar.get('deep') or {}).get('next_event_id') or '-')}")
    if "--quick-bets-only" in sys.argv:
        return
    matched = 0
    no_match = []
    cache = {}
    deep_budget = float(os.environ.get("SOCCER_SPORTSBET_DEEP_BUDGET", "180"))
    deep_start = time.time()
    deep_targets = []
    for L in store["leagues"]:
        slug = LEAGUE_PAGES.get(L["name"])
        if not slug:
            print("(no page) " + L["name"]); continue
        if slug not in cache:
            print("Fetching " + L["name"] + " (" + slug + ")")
            if slug not in page_cache:
                page_cache[slug] = fetch_page_data(slug)
            data = page_cache[slug]
            cache[slug] = extract_odds(data, slug) if data else None
            print("  events with odds: " + str(len(cache[slug] or {})))
            time.sleep(1.0)
        idx = cache[slug]
        if not idx: continue
        for m in L["matches"]:
            if has_kicked_off(m): continue  # PRE-KICKOFF odds only — skip live/started/FT
            if not match_in_target_dates(m, target_dates): continue
            hit = find_match(idx, m["home"]["name"], m["away"]["name"])
            if hit:
                home_odds, draw_odds, away_odds = fixture_side_odds(hit)
                m["sportsbet_odds"] = {"home": home_odds, "draw": draw_odds,
                                       "away": away_odds, "event_id": hit["event_id"],
                                       "event_url": hit.get("event_url"),
                                       "event_name": f"{hit.get('home_name')} vs {hit.get('away_name')}"}
                if hit.get("reversed"):
                    m["sportsbet_odds"]["reversed_fixture"] = True
                matched += 1
                if hit.get("event_url"):
                    deep_targets.append(m)
            else:
                no_match.append((L["name"], m["home"]["name"], m["away"]["name"]))

    deep_targets.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
    deep_hits = 0
    for m in deep_targets:
        if time.time() - deep_start > deep_budget:
            print(f"[deep] budget {deep_budget:.0f}s reached; stopped after {deep_hits} events")
            break
        url = (m.get("sportsbet_odds") or {}).get("event_url")
        if not url:
            continue
        event_id = str((m.get("sportsbet_odds") or {}).get("event_id") or "")
        cached = event_market_cache.get(event_id)
        if cached:
            markets_dict, unmapped = cached
            ok = True
        else:
            markets_dict, unmapped, ok = fetch_event_markets_snapshot(url)
        time.sleep(0.8)
        if not ok or not markets_dict:
            continue
        if event_id and not cached:
            event_market_cache[event_id] = (markets_dict, unmapped)
        m["sportsbet_markets"] = markets_for_fixture(
            markets_dict,
            bool((m.get("sportsbet_odds") or {}).get("reversed_fixture"))
        )
        # Cards/corners total lines the book offered but our regexes didn't map —
        # feeds the missed-odds reviewer (coverage_gap detection).
        if unmapped:
            m["sportsbet_unmapped_markets"] = unmapped
        else:
            m.pop("sportsbet_unmapped_markets", None)
        deep_hits += 1

    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"=== matched: {matched} | deep_markets: {deep_hits} | unmatched: {len(no_match)}")
    for nm in no_match[:15]: print("  -", nm)

if __name__ == "__main__":
    main()
