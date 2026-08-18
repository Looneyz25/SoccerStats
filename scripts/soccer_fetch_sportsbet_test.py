import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import soccer_fetch_sportsbet as sportsbet


ADL = ZoneInfo("Australia/Adelaide")


def price_outcome(outcome_id, name, num, result_type=""):
    return str(outcome_id), {
        "name": name,
        "resultType": result_type,
        "winPrice": {"num": num, "den": 100},
    }


def root_payload(now, event_ids=(101, 102), competition="Argentinian Primera Division"):
    events = {}
    markets = {}
    outcomes = {}
    for index, event_id in enumerate(event_ids):
        market_id = 200 + index
        home_id, draw_id, away_id = 300 + index * 3, 301 + index * 3, 302 + index * 3
        events[str(event_id)] = {
            "id": event_id,
            "competitionId": 900,
            "name": f"Home {event_id} v Away {event_id}",
            "participant1": f"Home {event_id}",
            "participant2": f"Away {event_id}",
            "startTime": {"milliseconds": int((now + timedelta(hours=index + 1)).timestamp() * 1000)},
            "marketIds": [market_id],
        }
        markets[str(market_id)] = {"name": "Win-Draw-Win", "outcomeIds": [home_id, draw_id, away_id]}
        outcomes.update(dict([
            price_outcome(home_id, f"Home {event_id}", 20, "H"),
            price_outcome(draw_id, "Draw", 350, "D"),
            price_outcome(away_id, f"Away {event_id}", 600, "A"),
        ]))
    return {"entities": {"sportsbook": {
        "events": events,
        "markets": markets,
        "outcomes": outcomes,
        "competitions": {"900": {"name": competition, "regionId": "americas"}},
    }}}


def deep_snapshot(_url):
    return {
        "Both teams to score": {"No": 1.4},
        "Match goals 3.5": {"Under": 1.3},
    }, [], True


class SportsbetQuickBetsTests(unittest.TestCase):
    def test_kickoff_roll_freezes_capture_dedupes_and_prunes_history(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        frozen = {
            "event_id": "101", "league": "Test League", "date": "2026-08-18", "time": "12:00",
            "home": "Home", "away": "Away", "event_url": "https://www.sportsbet.com.au/betting/soccer/a/b/home-away-101",
            "markets": {"winner": [{"key": "home", "label": "Home", "odds": 1.2}]},
        }
        previous = {
            "events": [frozen],
            "history": [
                {**frozen, "status": "live", "home_score": 1, "away_score": 0},
                {**frozen, "event_id": "old", "date": "2026-07-18", "time": "11:00"},
            ],
        }

        events, history = sportsbet.roll_quick_bet_history(previous, [], now)

        self.assertEqual(events, [])
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["event_id"], "101")
        self.assertEqual(history[0]["status"], "live")
        self.assertEqual(history[0]["markets"]["winner"][0]["odds"], 1.2)
        self.assertEqual(previous["events"][0], frozen, "pure roll must not mutate its input")

    def test_root_discovery_adds_unconfigured_competitions_inside_adelaide_window(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        payload = root_payload(now)
        payload["entities"]["sportsbook"]["events"]["past"] = {
            "id": 99, "competitionId": 900, "name": "Past v Match", "participant1": "Past",
            "participant2": "Match", "startTime": {"milliseconds": int(now.timestamp() * 1000)}, "marketIds": [],
        }
        payload["entities"]["sportsbook"]["events"]["day8"] = {
            "id": 108, "competitionId": 900, "name": "Late v Match", "participant1": "Late",
            "participant2": "Match", "startTime": {"milliseconds": int((now + timedelta(days=7)).timestamp() * 1000)}, "marketIds": [],
        }

        events = sportsbet.discover_quick_bet_events(payload, now)

        self.assertEqual([row["event_id"] for row in events], ["101", "102"])
        self.assertEqual(events[0]["league"], "Argentinian Primera Division")
        self.assertIn("/americas/argentinian-primera-division/", events[0]["event_url"])
        self.assertEqual(events[0]["markets"]["winner"], [
            {"key": "home", "label": "Home 101", "odds": 1.2},
        ])
        self.assertFalse(events[0]["root_stale"])

    def test_market_filter_uses_stable_keys_and_excludes_numeric_under_4_5_spellings(self):
        markets = sportsbet.quick_markets_from_normalized({
            "Full time": {"1": 1.49, "X": 1.5, "2": "1.2"},
            "Both teams to score": {"Yes": 1.3, "No": 1.0},
            "Match goals 3.5": {"Over": 1.2, "Under": 1.4},
            "Match goals 4.50": {"Over": 1.3, "Under": 1.1},
        }, "Home", "Away")

        self.assertEqual(markets["winner"], [{"key": "home", "label": "Home", "odds": 1.49}])
        self.assertEqual(markets["btts"], [{"key": "yes", "label": "Yes", "odds": 1.3}])
        self.assertEqual(markets["goalsOver"], [
            {"key": "over:3.5", "side": "over", "line": 3.5, "label": "Over 3.5", "odds": 1.2},
            {"key": "over:4.5", "side": "over", "line": 4.5, "label": "Over 4.5", "odds": 1.3},
        ])
        self.assertEqual(markets["goalsUnder"], [
            {"key": "under:3.5", "side": "under", "line": 3.5, "label": "Under 3.5", "odds": 1.4},
        ])

    def test_bounded_generation_converges_across_failures_and_rolls_only_after_complete(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        calls = []
        failed_once = {"102": False}

        def fetcher(url):
            event_id = sportsbet.sportsbet_event_id_from_url(url)
            calls.append(event_id)
            if event_id == "102" and not failed_once["102"]:
                failed_once["102"] = True
                return {}, [], False
            return deep_snapshot(url)

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sportsbet_quick_bets.json"
            payload = root_payload(now, event_ids=(101, 102, 103, 104))
            first, _ = sportsbet.refresh_quick_bets(payload, now, 60, 2, fetcher, 0, path)
            self.assertEqual(first["deep"]["generation"], 1)
            self.assertEqual(first["deep"]["next_event_id"], "103")
            self.assertEqual(first["deep"]["stale_events"], 3)
            self.assertFalse(first["deep"]["complete"])

            second, _ = sportsbet.refresh_quick_bets(payload, now + timedelta(minutes=1), 60, 2, fetcher, 0, path)
            self.assertEqual(second["deep"]["generation"], 1)
            self.assertFalse(second["events"][0]["deep_stale"])
            self.assertEqual(second["deep"]["next_event_id"], "102")
            self.assertEqual(second["deep"]["stale_events"], 1)

            third, _ = sportsbet.refresh_quick_bets(payload, now + timedelta(minutes=2), 60, 2, fetcher, 0, path)
            self.assertTrue(third["deep"]["complete"])
            self.assertEqual(third["status"], "complete")
            self.assertTrue(all(not row["deep_stale"] for row in third["events"]))
            self.assertEqual(calls, ["101", "102", "103", "104", "102"])

            rollover, _ = sportsbet.refresh_quick_bets(payload, now + timedelta(minutes=3), 60, 1, fetcher, 0, path)
            self.assertEqual(rollover["deep"]["generation"], 2)
            self.assertFalse(rollover["deep"]["complete"])
            self.assertEqual(rollover["deep"]["stale_events"], 3)
            self.assertFalse(path.with_suffix(".json.tmp").exists())
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), rollover)

    def test_membership_changes_start_a_new_generation_and_zero_budget_fetches_nothing(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        calls = []
        fetcher = lambda url: (calls.append(url) or deep_snapshot(url))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sportsbet_quick_bets.json"
            first, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 102)), now, 60, 1, fetcher, 0, path)
            inserted, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 102, 103)), now, 0, 3, fetcher, 0, path)
            self.assertEqual(inserted["deep"]["generation"], first["deep"]["generation"] + 1)
            self.assertTrue(inserted["deep"]["membership_changed"])
            self.assertEqual(inserted["deep"]["attempted_events"], 0)
            self.assertEqual(len(calls), 1)
            self.assertFalse(inserted["deep"]["complete"])
            self.assertEqual(inserted["deep"]["next_event_id"], "101")

            removed, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 103)), now, 0, 2, fetcher, 0, path)
            self.assertEqual(removed["deep"]["generation"], inserted["deep"]["generation"] + 1)
            self.assertTrue(removed["deep"]["membership_changed"])

    def test_root_failure_and_root_redirect_keep_prior_markets_stale_and_incomplete(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sportsbet_quick_bets.json"
            initial, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 1, deep_snapshot, 0, path)
            prior_btts = initial["events"][0]["markets"]["btts"]

            old_snapshot = sportsbet.fetch_event_page_snapshot
            try:
                sportsbet.fetch_event_page_snapshot = lambda _url: (root_payload(now, (101,)), sportsbet.SPORTSBET_SOCCER_URL)
                redirected, _ = sportsbet.refresh_quick_bets(
                    root_payload(now, (101,)), now + timedelta(minutes=1), 60, 1,
                    sportsbet.fetch_event_markets_snapshot, 0, path,
                )
            finally:
                sportsbet.fetch_event_page_snapshot = old_snapshot
            self.assertEqual(redirected["deep"]["failed_events"], 1)
            self.assertFalse(redirected["deep"]["complete"])
            self.assertTrue(redirected["events"][0]["deep_stale"])
            self.assertEqual(redirected["events"][0]["markets"]["btts"], prior_btts)

            stale, _ = sportsbet.refresh_quick_bets(None, now + timedelta(minutes=2), path=path)
            self.assertEqual(stale["status"], "stale")
            self.assertEqual(stale["captured_at"], redirected["captured_at"])
            self.assertTrue(stale["events"][0]["root_stale"])
            self.assertTrue(stale["events"][0]["deep_stale"])
            self.assertFalse(stale["deep"]["complete"])

            kicked_off, _ = sportsbet.refresh_quick_bets(None, now + timedelta(hours=2), path=path)
            self.assertEqual(kicked_off["schema_version"], 2)
            self.assertEqual(kicked_off["events"], [])
            self.assertEqual([row["event_id"] for row in kicked_off["history"]], ["101"])
            self.assertEqual(kicked_off["history"][0]["status"], "started")


if __name__ == "__main__":
    unittest.main()
