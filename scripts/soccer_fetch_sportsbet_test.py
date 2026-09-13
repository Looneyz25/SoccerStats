import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import soccer_fetch_sportsbet as sportsbet
import soccer_fetch_pred_odds as pred_odds


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
        "Full time": {"1": 1.2, "X": 4.5, "2": 7.0},
        "Both teams to score": {"No": 1.4},
        "Match goals 3.5": {"Under": 1.3},
    }, [], True


class SportsbetDoubleChanceTests(unittest.TestCase):
    def extract(self, labels, market_name="Double Chance", include_empty=False):
        event = {"participant1": "Arsenal", "participant2": "Chelsea", "marketIds": [1]}
        outcomes = dict(price_outcome(index, label, price) for index, (label, price) in enumerate(labels))
        market = {"1": {"name": market_name, "outcomeIds": list(outcomes)}}
        return sportsbet.extract_event_markets(event, market, outcomes, include_empty)[0]

    def test_normalizes_all_double_chance_aliases(self):
        for labels in [("1X", "X2", "12"), ("Home or Draw", "Draw or Away", "Home or Away"),
                       ("Arsenal or Draw", "Chelsea or Draw", "Arsenal or Chelsea"),
                       ("Arsenal And Draw", "Chelsea And Draw", "Arsenal And Chelsea"),
                       ("Draw or Arsenal", "Draw or Chelsea", "Chelsea or Arsenal")]:
            with self.subTest(labels=labels):
                self.assertEqual(self.extract(zip(labels, (20, 30, 40))),
                                 {"Double chance": {"1X": 1.2, "X2": 1.3, "12": 1.4}})

    def test_excludes_dnb_and_non_regular_time_markets(self):
        for name in ("Draw No Bet", "Draw No Bet 90 Minutes", "First Half Double Chance",
                     "Double Chance Including Extra Time", "Double Chance Extra Time"):
            with self.subTest(name=name):
                self.assertEqual(self.extract([("1X", 20), ("X2", 30), ("12", 40)], name, True), {})
        self.assertEqual(self.extract([("1X", 20)], "Double Chance 90 Minutes"),
                         {"Double chance": {"1X": 1.2}})

    def test_partial_missing_and_invalid_prices_or_labels(self):
        for bad in (None, 0, -100, float("inf"), float("nan"), "suspended"):
            with self.subTest(bad=bad):
                self.assertEqual(self.extract([("1X", 20), ("X2", bad)]), {"Double chance": {"1X": 1.2}})
        malformed = [("Yes", 20), ("No", 30), ("Over 2.5", 40), ("Under 2.5", 50)]
        self.assertEqual(self.extract(malformed), {})
        self.assertEqual(self.extract(malformed, include_empty=True), {"Double chance": {}})
        self.assertEqual(self.extract([], include_empty=True), {"Double chance": {}})

    def test_reversed_fixture_swaps_double_chance_and_preserves_other_markets(self):
        markets = {"Double chance": {"1X": 1.2, "X2": 1.3, "12": 1.4},
                   "Both teams to score": {"Yes": 1.6}, "Full time": {"1": 2.0, "X": 3.0, "2": 4.0}}
        original = copy.deepcopy(markets)
        self.assertIs(sportsbet.markets_for_fixture(markets), markets)
        reversed_markets = sportsbet.markets_for_fixture(markets, True)
        self.assertEqual(reversed_markets["Double chance"], {"1X": 1.3, "X2": 1.2, "12": 1.4})
        self.assertEqual(reversed_markets["Both teams to score"], markets["Both teams to score"])
        self.assertEqual(reversed_markets["Full time"], {"1": 4.0, "X": 3.0, "2": 2.0})
        self.assertEqual(markets, original)

    def test_attachment_ignores_new_dnb_and_preserves_existing_markets(self):
        match = {"sportsbet_markets": {"Double chance": {"X2": 1.6}, "Draw No Bet": {"1": 1.8, "2": 2.2},
                                       "Both teams to score": {"Yes": 1.9}}}
        self.assertEqual(pred_odds.attach_pred_odds(match, {"Double Chance": {"1X": 1.3, "12": 1.4},
                                                          "Draw No Bet": {"1": 1.1, "2": 9.0}}), 2)
        self.assertEqual(match["sportsbet_markets"], {"Double chance": {"1X": 1.3, "X2": 1.6, "12": 1.4},
                                                    "Draw No Bet": {"1": 1.8, "2": 2.2},
                                                    "Both teams to score": {"Yes": 1.9}})
        empty = {}
        self.assertEqual(pred_odds.attach_pred_odds(empty, {"Draw No Bet": {"1": 1.1, "2": 9.0}}), 0)
        self.assertNotIn("sportsbet_markets", empty)

    def test_attachment_rejects_invalid_prices_and_unknown_choices(self):
        for bad in (None, 1.0, -1, float("inf"), float("nan"), "suspended"):
            with self.subTest(bad=bad):
                match = {}
                self.assertEqual(pred_odds.attach_double_chance_odds(match,
                                 {"Double chance": {"1X": 1.2, "X2": bad, "Yes": 1.5}}), 1)
                self.assertEqual(match["sportsbet_markets"], {"Double chance": {"1X": 1.2}})


class SportsbetQuickBetsTests(unittest.TestCase):
    def test_production_capture_uses_completion_clock_and_preserves_started_decisions(self):
        start = datetime(2026, 9, 4, 9, 0, tzinfo=ADL)
        completion = start + timedelta(hours=1, minutes=1)
        payload = root_payload(start, (101, 102, 103))
        for event in payload["entities"]["sportsbook"]["events"].values():
            event["startTime"]["milliseconds"] = int((start + timedelta(hours=1)).timestamp() * 1000)
        decisions = {str(event_id): {"version": 1, "state": "captured", "starred": starred,
            "capturedAt": "2026-09-03T23:20:00Z", "label": "Prior star" if starred else "", "leagueLabel": "",
            "evidence": {"home": f"Home {event_id}"}, "recoveredFrom": {"source": "saved-feed"}}
            for event_id, starred in [(101, True), (102, False)]}
        previous = {"events": [], "history": [], "star_snapshots": {
            f"event:{event_id}": {"fixture": f"2026-09-04||home {event_id}|away {event_id}", "selections": {"winner|home": decision}}
            for event_id, decision in decisions.items()}}
        real_run = sportsbet.subprocess.run
        captures = []

        def computed_after_collection(command, **kwargs):
            captured = json.loads(kwargs["input"])
            captures.append(copy.deepcopy(captured))
            self.assertNotIn("now", captured, "production must leave the helper to read its real computation clock")
            captured["now"] = completion.isoformat()
            kwargs["input"] = json.dumps(captured)
            return real_run(command, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sportsbet_quick_bets.json"
            path.write_text(json.dumps(previous), encoding="utf-8")
            with patch.object(sportsbet, "datetime", wraps=datetime) as clock, patch.object(sportsbet.subprocess, "run", side_effect=computed_after_collection):
                clock.now.return_value = start
                result, _ = sportsbet.refresh_quick_bets(payload, path=path, fetcher=deep_snapshot, sleep_seconds=0)
            self.assertEqual(len(captures), 1)
            for event_id, decision in decisions.items():
                self.assertEqual(result["star_snapshots"][f"event:{event_id}"]["selections"]["winner|home"], decision)
            self.assertEqual(result["star_snapshots"]["event:103"]["selections"]["winner|home"], {"version": 1, "state": "unknown"})
            explicit = start + timedelta(minutes=30)
            refreshed, _ = sportsbet.refresh_quick_bets(payload, now=explicit, path=path, fetcher=deep_snapshot, sleep_seconds=0)
            snapshot = refreshed["star_snapshots"]["event:103"]["selections"]["winner|home"]
            self.assertEqual(snapshot["state"], "captured")
            self.assertEqual(datetime.fromisoformat(snapshot["capturedAt"].replace("Z", "+00:00")), explicit)


    def test_star_capture_failure_leaves_existing_atomic_sidecar_unchanged(self):
        now = datetime(2026, 9, 4, 9, 0, tzinfo=ADL)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sportsbet_quick_bets.json"
            previous = {"events": [], "history": [], "star_snapshots": {"fixture:kept": {"fixture": "kept", "selections": {}}}}
            original = json.dumps(previous).encode("utf-8")
            path.write_bytes(original)
            with patch.object(sportsbet, "capture_quick_bet_stars", side_effect=RuntimeError("snapshot helper unavailable")):
                with self.assertRaisesRegex(RuntimeError, "snapshot helper unavailable"):
                    sportsbet.refresh_quick_bets(root_payload(now), now=now, path=path, fetcher=deep_snapshot, sleep_seconds=0)
            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_event_results_fetch_requires_numeric_exact_id_and_markets_array(self):
        calls = []
        original_get = sportsbet.requests.get

        class Response:
            def __init__(self, payload=None, status_code=200):
                self.payload = payload
                self.status_code = status_code

            def json(self):
                return self.payload

        try:
            sportsbet.requests.get = lambda url, **kwargs: (
                calls.append((url, kwargs)) or Response({"id": 101, "markets": []})
            )
            for invalid in (None, "", "abc", "12x", "-1"):
                self.assertIsNone(sportsbet.fetch_event_results(invalid))
            self.assertEqual(calls, [], "invalid ids must not make a request")

            accepted = sportsbet.fetch_event_results("101")
            self.assertEqual(accepted, {"id": 101, "markets": []})
            self.assertTrue(calls[0][0].endswith("/Events/101/Results"))
            self.assertEqual(calls[0][1]["timeout"], 20)

            for response in (
                Response({"id": 102, "markets": []}),
                Response({"id": 101}),
                Response({"id": 101, "markets": {}}),
                Response([], 200),
                Response({"id": 101, "markets": []}, 503),
            ):
                sportsbet.requests.get = lambda *_args, _response=response, **_kwargs: _response
                self.assertIsNone(sportsbet.fetch_event_results("101"))
        finally:
            sportsbet.requests.get = original_get

    def test_result_markets_grade_captured_selections_without_a_score(self):
        captured = {
            "winner": [{"key": "home", "label": "Home", "odds": 1.2}],
            "btts": [{"key": "yes", "label": "Yes", "odds": 1.3}],
            "goalsOver": [
                {"key": "over:1.5", "side": "over", "line": 1.5, "label": "Over 1.5", "odds": 1.2},
                {"key": "over:2.5", "side": "over", "line": 2.5, "label": "Over 2.5", "odds": 1.3},
            ],
            "goalsUnder": [],
        }
        result_event = {"id": 101, "markets": [
            {"name": "Win-Draw-Win", "selections": [{"name": "Home", "resultType": "H", "statusCode": "W"}]},
            {"name": "Both Teams To Score", "selections": [{"name": "Yes", "statusCode": "W"}]},
            {"name": "Over/Under 1.5 Goals", "selections": [{"name": "Over 1.5 Goals", "statusCode": "W"}]},
            {"name": "Over/Under 2.5 Goals", "selections": [{"name": "Under 2.5 Goals", "statusCode": "W"}]},
        ]}

        settled, graded, total = sportsbet.settle_quick_bet_markets(captured, result_event, "Home", "Away")

        self.assertEqual((graded, total), (4, 4))
        self.assertEqual(settled["winner"][0]["result"], "hit")
        self.assertEqual(settled["btts"][0]["result"], "hit")
        self.assertEqual([item["result"] for item in settled["goalsOver"]], ["hit", "miss"])
        self.assertNotIn("result", captured["winner"][0], "settlement must not mutate the frozen capture")

    def test_result_markets_fail_closed_for_partial_or_malformed_captures(self):
        event = {"markets": [{"name": "Over/Under 1.5 Goals", "selections": [
            {"name": "Over 1.5 Goals", "statusCode": "W"},
        ]}]}
        captured = {"winner": [], "btts": [], "goalsOver": [
            {"key": "over:1.5", "side": "over", "line": 1.5, "label": "Over 1.5", "odds": 1.2},
            {"key": "over:2.5", "side": "over", "line": 2.5, "label": "Over 2.5", "odds": 1.3},
            {"label": "Missing stable key", "odds": 1.2},
            {"key": "over:1.5", "side": "over", "line": 1.5, "label": "Missing odds"},
            {"key": "over:1.5", "side": "over", "line": 1.5, "label": "Non-finite odds", "odds": "nan"},
            "malformed",
        ], "goalsUnder": []}

        settled, graded, total = sportsbet.settle_quick_bet_markets(captured, event, "Home", "Away")

        self.assertEqual((graded, total), (1, 6))
        self.assertEqual(settled["goalsOver"][0]["result"], "hit")
        self.assertNotIn("result", settled["goalsOver"][1])

        _settled, graded, total = sportsbet.settle_quick_bet_markets(
            {"winner": None}, {"markets": []}, "Home", "Away",
        )
        self.assertEqual((graded, total), (0, 1), "a malformed captured family must block closure")

    def test_result_markets_reject_conflicting_winners_for_the_same_family_or_line(self):
        captured = {"winner": [{"key": "home", "odds": 1.2}], "btts": [], "goalsOver": [
            {"key": "over:1.5", "side": "over", "line": 1.5, "odds": 1.2},
        ], "goalsUnder": []}
        event = {"markets": [
            {"name": "Win-Draw-Win", "selections": [{"resultType": "H", "statusCode": "W"}]},
            {"name": "Win-Draw-Win", "selections": [{"resultType": "A", "statusCode": "W"}]},
            {"name": "Over/Under 1.5 Goals", "selections": [{"name": "Over 1.5 Goals", "statusCode": "W"}]},
            {"name": "Over/Under 1.5 Goals", "selections": [{"name": "Under 1.5 Goals", "statusCode": "W"}]},
        ]}

        settled, graded, total = sportsbet.settle_quick_bet_markets(captured, event, "Home", "Away")

        self.assertEqual((graded, total), (0, 2))
        self.assertNotIn("result", settled["winner"][0])
        self.assertNotIn("result", settled["goalsOver"][0])

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

    def test_bounded_refresh_converges_and_reuses_fresh_inspections(self):
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
            self.assertEqual(rollover["deep"]["generation"], 1)
            self.assertTrue(rollover["deep"]["complete"])
            self.assertEqual(rollover["deep"]["attempted_events"], 0)
            self.assertEqual(rollover["deep"]["stale_events"], 0)
            self.assertFalse(path.with_suffix(".json.tmp").exists())
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), rollover)

    def test_membership_changes_preserve_progress_and_zero_budget_fetches_nothing(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        calls = []
        fetcher = lambda url: (calls.append(url) or deep_snapshot(url))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sportsbet_quick_bets.json"
            first, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 102)), now, 60, 1, fetcher, 0, path)
            inserted, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 102, 103)), now, 0, 3, fetcher, 0, path)
            self.assertEqual(inserted["deep"]["generation"], first["deep"]["generation"])
            self.assertTrue(inserted["deep"]["membership_changed"])
            self.assertEqual(inserted["deep"]["attempted_events"], 0)
            self.assertEqual(len(calls), 1)
            self.assertFalse(inserted["deep"]["complete"])
            self.assertEqual(inserted["deep"]["next_event_id"], "102")
            self.assertFalse(inserted["events"][0]["deep_stale"])

            removed, _ = sportsbet.refresh_quick_bets(root_payload(now, (101, 103)), now, 0, 2, fetcher, 0, path)
            self.assertEqual(removed["deep"]["generation"], inserted["deep"]["generation"])
            self.assertEqual(removed["deep"]["next_event_id"], "103")
            self.assertTrue(removed["deep"]["membership_changed"])

    def test_root_failure_and_root_redirect_keep_prior_markets_stale_and_incomplete(self):
        now = datetime(2026, 8, 18, 12, 0, tzinfo=ADL)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sportsbet_quick_bets.json"
            initial, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 1, deep_snapshot, 0, path)
            prior_btts = initial["events"][0]["markets"]["btts"]
            initial["events"][0]["deep_stale"] = True
            sportsbet.atomic_write_json(path, initial)

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

    def test_forecast_includes_plus_six_absent_root_and_excludes_plus_seven(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        kickoff = now + timedelta(days=6, hours=1)
        league_page = root_payload(kickoff - timedelta(hours=1), (501,), "English Premier League")
        fixture = {"date": kickoff.date().isoformat(), "time": kickoff.strftime("%H:%M"), "status": "upcoming",
                   "home": {"id": 1, "name": "Home 501"}, "away": {"id": 2, "name": "Away 501"}}
        outside = {**fixture, "date": (now + timedelta(days=7)).date().isoformat()}
        pages, calls = [], []
        def page_fetcher(slug):
            pages.append(slug)
            return league_page
        def fetcher(url):
            calls.append(sportsbet.sportsbet_event_id_from_url(url))
            return deep_snapshot(url)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "quick.json"
            cache = {}
            result, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 5, fetcher, 0, path,
                leagues=[{"name": "Premier League", "matches": [fixture, dict(fixture), outside]}],
                page_fetcher=page_fetcher, page_cache=cache)
            self.assertEqual(set(calls), {"101", "501"})
            self.assertEqual(pages, [sportsbet.LEAGUE_PAGES["Premier League"]])
            self.assertIn(pages[0], cache)
            self.assertEqual(result["coverage"]["totalFixtures"], 1)
            self.assertEqual(result["coverage"]["checkedFixtures"], 1)
            captured = next(row for row in result["events"] if row["event_id"] == "501")
            self.assertEqual(captured["canonical"]["home_id"], 1)
            self.assertEqual(set(captured["market_coverage"]), set(sportsbet.QUICK_BET_COVERAGE_MARKETS))

    def test_market_coverage_distinguishes_high_prices_unpriced_unoffered_and_failure(self):
        normalized = {name: {choice: 2.0 for choice in choices}
                      for name, choices in sportsbet.QUICK_BET_COVERAGE_MARKETS.values()}
        self.assertEqual(set(sportsbet.quick_bet_market_coverage(normalized).values()), {"no_selection"})
        normalized["Both teams to score"] = {}
        del normalized["Match goals 3.5"]
        states = sportsbet.quick_bet_market_coverage(normalized)
        self.assertEqual(states["btts"], "no_price")
        self.assertEqual(states["goals:3.5"], "not_offered")
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "quick.json"
            success, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 1,
                lambda _: (normalized, [], True), 0, path)
            self.assertFalse(any(success["events"][0]["markets"].values()))
            retained, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 1,
                lambda _: self.fail('fresh detail should be reused'), 0, path)
            self.assertFalse(any(retained["events"][0]["markets"].values()), "root summary must not resurrect a rejected short price")
            _events, history = sportsbet.roll_quick_bet_history(success, [], now + timedelta(hours=2))
            self.assertEqual(len(history), 1)
            self.assertTrue(history[0]["inspection_only"], "withdrawal evidence must survive kickoff")
            success["events"][0]["deep_captured_at"] = (now - timedelta(minutes=61)).isoformat()
            sportsbet.atomic_write_json(path, success)
            failure, _ = sportsbet.refresh_quick_bets(root_payload(now, (101,)), now, 60, 1,
                lambda _: ({}, [], False), 0, path)
            self.assertEqual(set(failure["events"][0]["market_coverage"].values()), {"fetch_failed"})
            self.assertFalse(failure["deep"]["complete"])

    def test_forecast_mapping_requires_same_kickoff_and_handles_reversed_order(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        events = sportsbet.discover_quick_bet_events(root_payload(now, (101,)), now)
        fixture = {**events[0], "home": "Away 101", "away": "Home 101"}
        hit, reverse = sportsbet.quick_bet_forecast_match(fixture, events)
        self.assertEqual(hit["event_id"], "101")
        self.assertTrue(reverse)
        self.assertEqual(sportsbet.quick_bet_forecast_match({**fixture, "time": "16:00"}, events), (None, False))
        self.assertEqual(sportsbet.quick_bet_forecast_match(fixture, events + [{**events[0], "event_id": "102"}]), (None, True))

    def test_failed_missing_and_unmapped_forecast_pages_remain_pending(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        fixture = {"date": "2026-09-09", "time": "20:00", "status": "upcoming",
                   "home": {"name": "Alpha"}, "away": {"name": "Beta"}}
        for page, league, expected in ((None, "Premier League", "page_failed"),
                (root_payload(now, ()), "Premier League", "unmatched"), (None, "Unknown League", "unmapped_league")):
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temp:
                result, _ = sportsbet.refresh_quick_bets(root_payload(now, ()), now, 0, 0,
                    path=Path(temp) / "quick.json", sleep_seconds=0,
                    leagues=[{"name": league, "matches": [fixture]}], page_fetcher=lambda _: page)
                self.assertEqual(result["coverage"]["pendingFixtures"], 1)
                self.assertEqual(result["coverage"]["fixtures"][0]["status"], expected)
                self.assertEqual(set(result["coverage"]["fixtures"][0]["markets"].values()), {"not_checked"})
                self.assertEqual(result["status"], "partial")

    def test_exact_forecast_identity_preserves_qualifiers_and_aliases(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        fixture = {"date": "2026-09-09", "time": "20:00", "home": "England", "away": "France"}
        for suffix in (" U21", " Reserves", " Women", " B", " II"):
            event = {**fixture, "home": "England" + suffix, "away": "France" + suffix, "event_id": "101"}
            self.assertEqual(sportsbet.quick_bet_forecast_match(fixture, [event]), (None, False))
        self.assertTrue(sportsbet.quick_bet_names_match("Man Utd", "Manchester United"))
        self.assertTrue(sportsbet.quick_bet_names_match("Cabo Verde", "Cape Verde"))
        self.assertTrue(sportsbet.quick_bet_names_match("Bosnia & Herzegovina", "Bosnia-Herzegovina"))
        self.assertFalse(sportsbet.quick_bet_names_match("Man Utd", "Manchester United Women"))

    def test_legacy_and_incomplete_captures_are_pending_until_reinspected(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        root = root_payload(now, (101,))
        for coverage in (None, {"winner": "selection"}):
            with self.subTest(coverage=coverage), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "quick.json"
                prior = sportsbet.discover_quick_bet_events(root, now)[0]
                prior.update(deep_stale=False, deep_captured_at=now.isoformat(), market_coverage=coverage)
                sportsbet.atomic_write_json(path, {"events": [prior]})
                result, _ = sportsbet.refresh_quick_bets(root, now, 60, 1, lambda _: ({}, [], False), 0, path)
                self.assertEqual(result["deep"]["attempted_events"], 1)
                self.assertTrue(result["events"][0]["deep_stale"])
                self.assertEqual(set(result["events"][0]["market_coverage"].values()), {"fetch_failed"})
                result, _ = sportsbet.refresh_quick_bets(root, now, 60, 1, deep_snapshot, 0, path)
                self.assertFalse(result["events"][0]["deep_stale"])
                result, _ = sportsbet.refresh_quick_bets(root, now, 60, 1,
                    lambda _: self.fail("complete fresh six-market inspection must be reused"), 0, path)
                self.assertEqual(result["deep"]["attempted_events"], 0)

    def test_withdrawal_survives_failure_discovery_omission_kickoff_and_retention(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        root = root_payload(now, (101,))
        fixture = {"date": "2026-09-03", "time": "13:00", "status": "upcoming",
                   "home": {"id": 1, "name": "Home 101"}, "away": {"id": 2, "name": "Away 101"}}
        leagues = [{"name": "Test", "matches": [fixture]}]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "quick.json"
            result, _ = sportsbet.refresh_quick_bets(root, now, 60, 1, lambda _: ({}, [], True), 0, path, leagues)
            later = now + timedelta(minutes=61)
            # Keep kickoff future for the expiry probe, then roll the actual kickoff explicitly.
            event = result["events"][0]
            event["deep_captured_at"] = (now - timedelta(minutes=61)).isoformat()
            sportsbet.atomic_write_json(path, result)
            failed, _ = sportsbet.refresh_quick_bets(root, now, 60, 1, lambda _: ({}, [], False), 0, path, leagues)
            self.assertTrue(sportsbet.quick_bet_inspection_authoritative(failed["events"][0]))
            self.assertFalse(any(failed["events"][0]["markets"].values()))
            omitted, _ = sportsbet.refresh_quick_bets(root_payload(now, ()), now, 60, 1,
                lambda *args, **kwargs: ({}, [], False), 0, path, leagues)
            self.assertEqual(len(omitted["events"]), 1)
            self.assertFalse(any(omitted["events"][0]["markets"].values()))
            events, history = sportsbet.roll_quick_bet_history(omitted, [], later, leagues)
            self.assertEqual(events, [])
            self.assertTrue(history[0]["inspection_only"])
            _events, retained = sportsbet.roll_quick_bet_history({"history": history}, [], later + timedelta(days=31), leagues)
            self.assertEqual(retained, history, "canonical fixture still needs its withdrawal evidence")
            _events, pruned = sportsbet.roll_quick_bet_history({"history": history}, [], later + timedelta(days=31), [])
            self.assertEqual(pruned, [])

    def test_known_forecast_url_checks_absent_plus_six_fixture_within_budget(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        detail = root_payload(now + timedelta(days=6), (701,))
        event = sportsbet.discover_quick_bet_events(detail, now)[0]
        fixture = {"date": event["date"], "time": event["time"], "status": "upcoming",
                   "home": {"name": event["home"]}, "away": {"name": event["away"]},
                   "sportsbet_odds": {"event_id": "701", "event_url": event["event_url"]}}
        leagues = [{"name": "Premier League", "matches": [fixture]}]
        for fault in (None, "id", "teams", "date", "redirect", "failure", "reverse"):
            response = copy.deepcopy(detail)
            provider_event = response["entities"]["sportsbook"]["events"]["701"]
            final_url = event["event_url"]
            if fault == "id": provider_event["id"] = 702
            if fault == "teams": provider_event["participant1"] += " U21"
            if fault == "date": provider_event["startTime"]["milliseconds"] += 86400000
            if fault == "redirect": final_url = final_url.replace("home-701-v-away-701", "other-event")
            if fault == "failure": response = None
            if fault == "reverse":
                provider_event["participant1"], provider_event["participant2"] = provider_event["participant2"], provider_event["participant1"]
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temp, patch.object(
                    sportsbet, "fetch_event_page_snapshot", return_value=(response, final_url)) as fetch:
                path = Path(temp) / "quick.json"
                queued, _ = sportsbet.refresh_quick_bets(root_payload(now, ()), now, 0, 0,
                    sportsbet.fetch_event_markets_snapshot, 0, path, leagues, page_fetcher=lambda _: root_payload(now, ()))
                self.assertEqual(queued["coverage"]["pendingFixtures"], 1)
                fetch.assert_not_called()
                result, _ = sportsbet.refresh_quick_bets(root_payload(now, ()), now, 60, 1,
                    sportsbet.fetch_event_markets_snapshot, 0, path, leagues, page_fetcher=lambda _: root_payload(now, ()))
                self.assertEqual(result["deep"]["attempted_events"], 1)
                self.assertEqual(result["coverage"]["checkedFixtures"], int(fault in (None, "reverse")))
                if fault == "reverse":
                    self.assertEqual(result["events"][0]["home"], fixture["away"]["name"])
                    self.assertTrue(result["events"][0]["canonical"]["reversed"])
                    self.assertEqual(result["events"][0]["markets"]["winner"][0]["key"], "home")
                if fault not in (None, "reverse"):
                    self.assertIsNone(result["coverage"]["fixtures"][0]["event_id"])
                    self.assertNotIn("canonical", result["events"][0])
                    self.assertFalse(any(result["events"][0]["markets"].values()))

    def test_event_inventory_requires_explicit_typed_entities(self):
        now = datetime(2026, 9, 3, 12, 0, tzinfo=ADL)
        original = root_payload(now, (101,))
        url = sportsbet.discover_quick_bet_events(original, now)[0]["event_url"]
        for fault in ("missing_markets", "wrong_markets", "bad_market_id", "missing_market", "missing_outcomes", "wrong_outcomes", "bad_outcome_id", "missing_outcome"):
            data = copy.deepcopy(original)
            sb = data["entities"]["sportsbook"]
            event, market = sb["events"]["101"], sb["markets"]["200"]
            if fault == "missing_markets": del event["marketIds"]
            if fault == "wrong_markets": event["marketIds"] = {}
            if fault == "bad_market_id": event["marketIds"] = [{}]
            if fault == "missing_market": sb["markets"] = {}
            if fault == "missing_outcomes": del market["outcomeIds"]
            if fault == "wrong_outcomes": market["outcomeIds"] = {}
            if fault == "bad_outcome_id": market["outcomeIds"] = [{}]
            if fault == "missing_outcome": sb["outcomes"] = {}
            with self.subTest(fault=fault), patch.object(sportsbet, "fetch_event_page_snapshot", return_value=(data, url)):
                self.assertFalse(sportsbet.fetch_event_markets_snapshot(url)[2])
        data = copy.deepcopy(original)
        data["entities"]["sportsbook"]["events"]["101"]["marketIds"] = []
        with patch.object(sportsbet, "fetch_event_page_snapshot", return_value=(data, url)):
            markets, _, ok = sportsbet.fetch_event_markets_snapshot(url)
            self.assertTrue(ok)
            self.assertEqual(set(sportsbet.quick_bet_market_coverage(markets).values()), {"not_offered"})
        for outcome in original["entities"]["sportsbook"]["outcomes"].values(): outcome.pop("winPrice")
        with patch.object(sportsbet, "fetch_event_page_snapshot", return_value=(original, url)):
            markets, _, ok = sportsbet.fetch_event_markets_snapshot(url)
            self.assertTrue(ok)
            self.assertEqual(sportsbet.quick_bet_market_coverage(markets)["winner"], "no_price")


if __name__ == "__main__":
    unittest.main()
