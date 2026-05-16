#!/usr/bin/env python3
"""Best-effort direct bookmaker link enrichment for match_data.json.

Sportsbet already has structured event IDs in `sportsbet_odds`. The other AU
bookmakers often render event links from protected app APIs, so this helper only
writes a direct link when a public soccer/sports page exposes a URL containing
both teams. Generic bookmaker landing pages are handled by the UI fallback.
"""
from __future__ import annotations

import argparse
import html
import json
import pathlib
import random
import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

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

BOOKMAKERS = {
    "bet365": {
        "name": "bet365",
        "urls": [
            "https://www.bet365.com.au/hub/en-au/sports-betting",
            "https://www.bet365.com.au/",
        ],
    },
    "tab": {
        "name": "TAB",
        "urls": [
            "https://www.tab.com.au/sports/betting/Soccer",
            "https://www.tab.com.au/sports",
        ],
    },
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


def iter_open_matches(store: dict) -> Iterable[tuple[dict, dict]]:
    for league in store.get("leagues", []):
        for match in league.get("matches", []):
            if match.get("status") == "FT":
                continue
            yield league, match


def mirror_sportsbet_links(store: dict) -> int:
    mirrored = 0
    for _, match in iter_open_matches(store):
        event_url = ((match.get("sportsbet_odds") or {}).get("event_url") or "").strip()
        if not event_url:
            continue
        links = match.setdefault("bookmaker_links", {})
        if links.get("sportsbet") != event_url:
            links["sportsbet"] = event_url
            mirrored += 1
    return mirrored


def scrape_bookmaker_links(store: dict, dry_run: bool) -> dict[str, int]:
    counts = {bookmaker_id: 0 for bookmaker_id in BOOKMAKERS}
    open_matches = list(iter_open_matches(store))

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

        for _, match in open_matches:
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
    sportsbet_count = mirror_sportsbet_links(store)
    counts = scrape_bookmaker_links(store, dry_run=args.dry_run)

    if not args.dry_run:
        STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[sportsbet] mirrored direct links: {sportsbet_count}")
    for bookmaker_id, count in counts.items():
        print(f"[{bookmaker_id}] direct links found: {count}")
    if args.dry_run:
        print("[dry-run] match_data.json was not changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
