#!/usr/bin/env python3
"""Best-effort direct bookmaker link enrichment for match_data.json.

Sportsbet already has structured event IDs in `sportsbet_odds`. The other AU
bookmakers often render event links from protected app APIs, so this helper only
writes a direct link when a trusted public API exposes a stable match URL.
Generic bookmaker landing pages are handled by the UI fallback.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import pathlib
import random
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from team_aliases import NATIONAL_TEAM_ALIASES

try:
    from curl_cffi import requests as curl_requests
except Exception:  # pragma: no cover - depends on local optional dependency
    curl_requests = None

try:
    import requests
except Exception:  # pragma: no cover - depends on local optional dependency
    requests = None


ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE_PATH = ROOT / "match_data.json"


def fixture_target_dates() -> set[str]:
    dates = set()
    for item in os.environ.get("SOCCER_FIXTURE_DATES", "").split(","):
        item = item.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
            dates.add(item)
    return dates


def match_in_target_dates(match: dict, target_dates: set[str]) -> bool:
    return not target_dates or match.get("date") in target_dates

BOOKMAKERS = {
    "ladbrokes": {
        "name": "Ladbrokes",
        "urls": [
            "https://www.ladbrokes.com.au/sports/soccer",
            "https://www.ladbrokes.com.au/sports",
        ],
    },
    "neds": {
        "name": "Neds",
        "urls": [
            "https://www.neds.com.au/sports/soccer",
            "https://www.neds.com.au/sports",
        ],
    },
}

NON_DIRECT_BOOKMAKERS = {"bet365", "tab"}

ENTAIN_BOOKMAKERS = {
    "ladbrokes": {
        "origin": "https://www.ladbrokes.com.au",
        "api": "https://api.ladbrokes.com.au/v2/sport/event-request?category_ids=%5B%5D",
    },
    "neds": {
        "origin": "https://www.neds.com.au",
        "api": "https://api.neds.com.au/v2/sport/event-request?category_ids=%5B%5D",
    },
}

ENTAIN_SOCCER_CATEGORY_ID = "71955b54-62f6-4ac5-abaa-df88cad0aeef"

PROFILE_CHOICES = ("chrome120", "chrome124", "chrome131", "edge101", "safari17_0")
SKIP_SCHEMES = ("javascript:", "mailto:", "tel:", "#")
GENERIC_PATHS = {
    "",
    "/",
    "/sports",
    "/sports/",
    "/sports/soccer",
    "/sports/soccer/",
    "/hub/en-au/sports-betting",
    "/hub/en-au/sports-betting/",
}

ABBREV = {
    "wolves": "wolverhampton",
    "manutd": "manchesterunited",
    "manunited": "manchesterunited",
    "mancity": "manchestercity",
    "spurs": "tottenham",
    "forest": "nottinghamforest",
    "boro": "middlesbrough",
    "atletico": "atleticomadrid",
    "atlmadrid": "atleticomadrid",
    "bayern": "bayernmunich",
    "leipzig": "rbleipzig",
    "frankfurt": "eintrachtfrankfurt",
    "gladbach": "borussiamonchengladbach",
    "mgladbach": "borussiamonchengladbach",
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


@dataclass(frozen=True)
class CandidateLink:
    url: str
    text: str


def fold(value: object) -> str:
    return unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")


def norm(value: object) -> str:
    normalized = re.sub(r"[^a-z0-9]", "", fold(value).lower())
    return normalized.replace("utd", "united").replace("fc", "")


def slug(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(value).lower()).strip("-")


def entain_slug(value: object) -> str:
    return (
        fold(value)
        .lower()
        .replace("&", "and")
        .replace("\u00a0", " ")
        .replace("'", "")
        .replace(".", "")
    )


def entain_path_slug(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", entain_slug(value)).strip("-")


def names_match(team: str, haystack: str) -> bool:
    team_norm = norm(team)
    hay_norm = norm(haystack)
    if not team_norm or not hay_norm:
        return False
    if team_norm in hay_norm:
        return True
    team_slug = slug(team)
    hay_slug = slug(haystack)
    if team_slug and team_slug in hay_slug:
        return True
    for token, expanded in ABBREV.items():
        if token in team_norm and expanded in hay_norm:
            return True
        if expanded in team_norm and token in hay_norm:
            return True
    return False


def is_generic_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    return path in GENERIC_PATHS or path.lower().endswith((".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".webp"))


def fetch_html(url: str, timeout: int = 20) -> str | None:
    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-AU,en;q=0.9",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
    }
    try:
        if curl_requests is not None:
            response = curl_requests.get(
                url,
                headers=headers,
                impersonate=random.choice(PROFILE_CHOICES),
                timeout=timeout,
            )
            if response.status_code < 400:
                return response.text
            return None
        if requests is not None:
            response = requests.get(url, headers=headers, timeout=timeout)
            if response.status_code < 400:
                return response.text
        request = Request(url, headers=headers)
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status >= 400:
                return None
            raw = response.read()
            content_type = response.headers.get("content-type", "")
            match = re.search(r"charset=([^;\s]+)", content_type, re.I)
            encoding = match.group(1) if match else "utf-8"
            return raw.decode(encoding, errors="replace")
    except Exception as exc:
        print(f"  fetch failed {url}: {exc}")
    return None


def fetch_json(url: str, origin: str, timeout: int = 30) -> dict | None:
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": origin,
        "referer": f"{origin}/sports/soccer",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
    }
    try:
        if curl_requests is not None:
            response = curl_requests.get(
                url,
                headers=headers,
                impersonate=random.choice(PROFILE_CHOICES),
                timeout=timeout,
            )
            if response.status_code < 400:
                return response.json()
            print(f"  fetch failed {url}: HTTP {response.status_code}")
            return None
        if requests is not None:
            response = requests.get(url, headers=headers, timeout=timeout)
            if response.status_code < 400:
                return response.json()
            print(f"  fetch failed {url}: HTTP {response.status_code}")
            return None
        request = Request(url, headers=headers)
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status >= 400:
                print(f"  fetch failed {url}: HTTP {status}")
                return None
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"  fetch failed {url}: {exc}")
    return None


def extract_anchor_candidates(html_text: str, base_url: str) -> list[CandidateLink]:
    candidates: list[CandidateLink] = []
    anchor_re = re.compile(r"<a\b[^>]*?\bhref=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
    for href, inner in anchor_re.findall(html_text):
        href = html.unescape(href).strip()
        if not href or href.lower().startswith(SKIP_SCHEMES):
            continue
        url = urljoin(base_url, href)
        text = re.sub(r"<[^>]+>", " ", inner)
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()
        candidates.append(CandidateLink(url=url, text=text))
    return candidates


def extract_raw_url_candidates(html_text: str, base_url: str) -> list[CandidateLink]:
    candidates: list[CandidateLink] = []
    url_re = re.compile(r"(?:https?://[^\"'\\\s<>]+|/[a-zA-Z0-9][^\"'\\\s<>]+)")
    for raw in url_re.findall(html_text):
        cleaned = html.unescape(raw).strip().rstrip(").,;")
        if not cleaned or cleaned.lower().startswith(SKIP_SCHEMES):
            continue
        url = urljoin(base_url, cleaned)
        candidates.append(CandidateLink(url=url, text=cleaned))
    return candidates


def unique_candidates(candidates: Iterable[CandidateLink]) -> list[CandidateLink]:
    seen: set[str] = set()
    unique: list[CandidateLink] = []
    for candidate in candidates:
        if candidate.url in seen:
            continue
        seen.add(candidate.url)
        unique.append(candidate)
    return unique


def match_link(candidates: Iterable[CandidateLink], home: str, away: str) -> str | None:
    for candidate in candidates:
        if is_generic_url(candidate.url):
            continue
        haystack = f"{candidate.url} {candidate.text}"
        if names_match(home, haystack) and names_match(away, haystack):
            return candidate.url
    return None


def iter_matches(store: dict, target_dates: set[str] | None = None) -> Iterable[tuple[dict, dict]]:
    target_dates = target_dates or set()
    for league in store.get("leagues", []):
        for match in league.get("matches", []):
            if not match_in_target_dates(match, target_dates):
                continue
            yield league, match


def mirror_sportsbet_links(store: dict, target_dates: set[str]) -> int:
    mirrored = 0
    for _, match in iter_matches(store, target_dates):
        event_url = ((match.get("sportsbet_odds") or {}).get("event_url") or "").strip()
        if not event_url:
            continue
        links = match.setdefault("bookmaker_links", {})
        if links.get("sportsbet") != event_url:
            links["sportsbet"] = event_url
            mirrored += 1
    return mirrored


def event_adelaide_date(event: dict) -> str:
    raw = event.get("advertised_start") or event.get("actual_start") or ""
    if not raw:
        return ""
    try:
        utc_dt = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
        offset_hours = 10.5 if utc_dt.month in {1, 2, 3, 10, 11, 12} else 9.5
        return (utc_dt + timedelta(hours=offset_hours)).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def entain_event_url(bookmaker_id: str, event: dict) -> str | None:
    config = ENTAIN_BOOKMAKERS.get(bookmaker_id)
    event_id = event.get("id")
    event_slug = event.get("slug") or entain_path_slug(event.get("name"))
    competition = event.get("competition") or {}
    competition_slug = entain_path_slug(competition.get("name"))
    region_slug = entain_path_slug(competition.get("region"))
    if not config or not event_id or not event_slug or not competition_slug:
        return None
    parts = [config["origin"], "sports", "soccer"]
    if region_slug:
        parts.append(region_slug)
    parts.extend([competition_slug, event_slug, str(event_id)])
    return "/".join(part.strip("/") for part in parts)


def entain_match_score(match: dict, event: dict) -> int:
    if event.get("category_id") != ENTAIN_SOCCER_CATEGORY_ID:
        return 0
    if (event.get("event_type") or {}).get("name") != "Match":
        return 0
    event_name = event.get("name") or event.get("slug") or ""
    home = (match.get("home") or {}).get("name") or ""
    away = (match.get("away") or {}).get("name") or ""
    if not names_match(home, event_name) or not names_match(away, event_name):
        return 0

    score = 10
    match_date = match.get("date") or ""
    event_date = event_adelaide_date(event)
    if match_date and event_date and event_date != match_date:
        return 0
    if match_date and event_date == match_date:
        score += 5
    league = match.get("league") or ""
    competition_name = ((event.get("competition") or {}).get("name") or "")
    if names_match(league, competition_name) or names_match(competition_name, league):
        score += 2
    return score


def clear_entain_links(store: dict, target_dates: set[str]) -> int:
    removed = 0
    for _, match in iter_matches(store, target_dates):
        links = match.get("bookmaker_links") or {}
        meta = match.get("bookmaker_meta") or {}
        for bookmaker_id in ENTAIN_BOOKMAKERS:
            if meta.get(bookmaker_id, {}).get("source") != "entain_event_request":
                continue
            if links.pop(bookmaker_id, None):
                removed += 1
            meta.pop(bookmaker_id, None)
        if not links and "bookmaker_links" in match:
            match.pop("bookmaker_links", None)
        if not meta and "bookmaker_meta" in match:
            match.pop("bookmaker_meta", None)
    return removed


def clear_non_direct_bookmaker_links(store: dict, target_dates: set[str]) -> int:
    removed = 0
    for _, match in iter_matches(store, target_dates):
        links = match.get("bookmaker_links") or {}
        meta = match.get("bookmaker_meta") or {}
        for bookmaker_id in NON_DIRECT_BOOKMAKERS:
            if links.pop(bookmaker_id, None):
                removed += 1
            if meta.pop(bookmaker_id, None):
                removed += 1
        if not links and "bookmaker_links" in match:
            match.pop("bookmaker_links", None)
        if not meta and "bookmaker_meta" in match:
            match.pop("bookmaker_meta", None)
    return removed


def enrich_entain_links(store: dict, dry_run: bool, target_dates: set[str]) -> dict[str, int]:
    counts = {bookmaker_id: 0 for bookmaker_id in ENTAIN_BOOKMAKERS}
    matches = [match for _, match in iter_matches(store, target_dates)]

    for bookmaker_id, config in ENTAIN_BOOKMAKERS.items():
        print(f"[{bookmaker_id}] scanning event-request API")
        payload = fetch_json(config["api"], config["origin"])
        events = list((payload or {}).get("events", {}).values())
        if not events:
            continue
        print(f"  events: {len(events)}")

        for match in matches:
            scored = [(entain_match_score(match, event), event) for event in events]
            scored = [(score, event) for score, event in scored if score > 0]
            if not scored:
                continue
            scored.sort(key=lambda item: item[0], reverse=True)
            event = scored[0][1]
            direct_url = entain_event_url(bookmaker_id, event)
            if not direct_url:
                continue
            counts[bookmaker_id] += 1
            if dry_run:
                continue
            match.setdefault("bookmaker_links", {})[bookmaker_id] = direct_url
            match.setdefault("bookmaker_meta", {})[bookmaker_id] = {
                "matched": True,
                "source": "entain_event_request",
                "event_id": event.get("id"),
                "event_name": event.get("name"),
            }

    return counts


def scrape_bookmaker_links(store: dict, dry_run: bool, target_dates: set[str]) -> dict[str, int]:
    counts = {bookmaker_id: 0 for bookmaker_id in BOOKMAKERS}
    matches = [match for _, match in iter_matches(store, target_dates)]

    for bookmaker_id, config in BOOKMAKERS.items():
        print(f"[{bookmaker_id}] scanning public soccer/sports pages")
        all_candidates: list[CandidateLink] = []
        for url in config["urls"]:
            page = fetch_html(url)
            if not page:
                continue
            candidates = extract_anchor_candidates(page, url)
            candidates.extend(extract_raw_url_candidates(page, url))
            all_candidates.extend(candidates)
            print(f"  {url} -> {len(candidates)} candidates")
            time.sleep(0.5)

        candidates = unique_candidates(all_candidates)
        if not candidates:
            continue

        for match in matches:
            home = (match.get("home") or {}).get("name") or ""
            away = (match.get("away") or {}).get("name") or ""
            direct_url = match_link(candidates, home, away)
            if not direct_url:
                continue
            counts[bookmaker_id] += 1
            if dry_run:
                continue
            match.setdefault("bookmaker_links", {})[bookmaker_id] = direct_url
            match.setdefault("bookmaker_meta", {})[bookmaker_id] = {
                "matched": True,
                "source": "public_page_link_scan",
            }

    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Scan without writing match_data.json")
    args = parser.parse_args()

    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    target_dates = fixture_target_dates()
    if target_dates:
        print(f"[target] dates: {','.join(sorted(target_dates))}")
    sportsbet_count = mirror_sportsbet_links(store, target_dates)
    entain_removed = 0 if args.dry_run else clear_entain_links(store, target_dates)
    non_direct_removed = 0 if args.dry_run else clear_non_direct_bookmaker_links(store, target_dates)
    entain_counts = enrich_entain_links(store, dry_run=args.dry_run, target_dates=target_dates)
    counts = scrape_bookmaker_links(store, dry_run=args.dry_run, target_dates=target_dates)

    if not args.dry_run:
        STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[sportsbet] mirrored direct links: {sportsbet_count}")
    if not args.dry_run:
        print(f"[entain] cleared generated links: {entain_removed}")
        print(f"[non-direct] cleared TAB/bet365 links: {non_direct_removed}")
    for bookmaker_id, count in entain_counts.items():
        print(f"[{bookmaker_id}] event API links found: {count}")
    for bookmaker_id, count in counts.items():
        print(f"[{bookmaker_id}] direct links found: {count}")
    if args.dry_run:
        print("[dry-run] match_data.json was not changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
