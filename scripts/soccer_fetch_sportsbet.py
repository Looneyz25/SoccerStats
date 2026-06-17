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
import json, os, re, time, pathlib, unicodedata
import random
from curl_cffi import requests
from team_aliases import NATIONAL_TEAM_ALIASES

_PROFILES = ["chrome120","chrome124","chrome131","chrome116","edge101","safari17_0"]
def _profile(): return random.choice(_PROFILES)

# Folder = this script's parent's parent (i.e. scripts/.. = repo root)
FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = FOLDER / "match_data.json"


def fixture_target_dates():
    dates = []
    for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(","):
        item = item.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
            dates.append(item)
    return set(dates)


def match_in_target_dates(match, target_dates):
    return not target_dates or match.get("date") in target_dates

LEAGUE_PAGES = {
    "Premier League":         "united-kingdom/english-premier-league",
    "Championship":           "united-kingdom/english-championship",
    "League One":             "united-kingdom/english-league-one",
    "League Two":             "united-kingdom/english-league-two",
    "LaLiga":                 "spain/spanish-la-liga",
    "Serie A":                "italy/italian-serie-a",
    "Bundesliga":             "germany/german-bundesliga",
    "Ligue 1":                "france/french-ligue-1",
    "Eredivisie":             "rest-of-europe/dutch-eredivisie",
    "Primeira Liga":          "rest-of-europe/portuguese-primeira-liga",
    "UEFA Champions League":  "uefa-competitions/uefa-champions-league",
    "UEFA Europa League":     "uefa-competitions/uefa-europa-league",
    "UEFA Conference League": "uefa-competitions/uefa-europa-conference-league",
    "MLS":                    "north-america/usa-major-league-soccer",
    "A-League Men":           "australia/australian-a-league-men",
    "Scottish Premiership":   "united-kingdom/scottish-premiership",
    "J1 League":              "asia/japanese-j1-league",
    "Brasileirão Betano":     "americas/brazilian-serie-a",
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

def fetch_page_data(slug):
    url = "https://www.sportsbet.com.au/betting/soccer/" + slug
    try:
        r = requests.get(url, impersonate=_profile(), timeout=20)
        if r.status_code != 200: return None
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

def fetch_event_page_data(event_url):
    try:
        r = requests.get(event_url, impersonate=_profile(), timeout=20)
        if r.status_code != 200:
            return None
        return preloaded_state_from_html(r.text)
    except Exception:
        return None

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


def extract_event_markets(ev, markets, outcomes):
    """Normalize Sportsbet markets into SofaScore-shaped keys.

    Returns {market_key: {choice: decimal_price}} with keys:
        "Full time"          -> {"1","X","2"}
        "Both teams to score"-> {"Yes","No"}
        "Draw No Bet"        -> {"1","2"}
        "Match goals 2.5"    -> {"Over","Under"}
        "Cards in match 4.5" -> {"Over","Under"}
        "Corners 2-Way 9.5"  -> {"Over","Under"}
    """
    out = {}
    for mid in ev.get("marketIds", []):
        mk = markets.get(str(mid)) or markets.get(mid)
        if not mk:
            continue
        name = (mk.get("name") or "").strip()
        choices = {}
        for oid in mk.get("outcomeIds", []):
            oc = outcomes.get(str(oid)) or outcomes.get(oid)
            if not oc:
                continue
            price = _outcome_price(oc)
            if price is None or price <= 1.01:
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
            if name.lower() in ("draw no bet", "draw no bet 90 minutes"):
                if rt == "H":
                    choices["1"] = price
                elif rt == "A":
                    choices["2"] = price
                continue
        if not choices:
            continue
        if name in ("Win-Draw-Win", "Match Result", "1X2"):
            if all(k in choices for k in ("1", "X", "2")):
                out["Full time"] = choices
            continue
        if name == "Both Teams To Score":
            out["Both teams to score"] = choices
            continue
        if name.lower() in ("draw no bet", "draw no bet 90 minutes"):
            if "1" in choices and "2" in choices:
                out["Draw No Bet"] = choices
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
    return out


def fetch_event_markets(event_url):
    """Fetch a single event page and return its normalized market dict."""
    data = fetch_event_page_data(event_url)
    if not data:
        return {}
    sb = (data.get("entities") or {}).get("sportsbook") or {}
    events = sb.get("events", {})
    markets = sb.get("markets", {})
    outcomes = sb.get("outcomes", {})
    event_id = sportsbet_event_id_from_url(event_url)
    if event_id:
        ev = find_event(data, event_id=event_id)
        return extract_event_markets(ev, markets, outcomes) if ev else {}
    best = {}
    for ev in events.values():
        if not ev.get("marketIds"):
            continue
        markets_for_ev = extract_event_markets(ev, markets, outcomes)
        if len(markets_for_ev) > len(best):
            best = markets_for_ev
    return best

SPORTSBET_TERMINAL_STATUS_WORDS = ("postponed", "cancelled", "canceled", "abandoned")

def sportsbet_event_id_from_url(event_url):
    m = re.search(r"-(\d+)(?:[/?#].*)?$", event_url or "")
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
        else:
            out[key] = choices
    return out

def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    target_dates = fixture_target_dates()
    if target_dates:
        print("target_dates=" + ",".join(sorted(target_dates)))
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
            data = fetch_page_data(slug)
            cache[slug] = extract_odds(data, slug) if data else None
            print("  events with odds: " + str(len(cache[slug] or {})))
            time.sleep(1.0)
        idx = cache[slug]
        if not idx: continue
        for m in L["matches"]:
            if m.get("status") == "FT": continue
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
        markets_dict = fetch_event_markets(url)
        time.sleep(0.8)
        if not markets_dict:
            continue
        m["sportsbet_markets"] = markets_for_fixture(
            markets_dict,
            bool((m.get("sportsbet_odds") or {}).get("reversed_fixture"))
        )
        deep_hits += 1

    STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"=== matched: {matched} | deep_markets: {deep_hits} | unmatched: {len(no_match)}")
    for nm in no_match[:15]: print("  -", nm)

if __name__ == "__main__":
    main()
