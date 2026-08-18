import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import soccer_routine as sr


class LiveScoreResultMatchingTests(unittest.TestCase):
    def test_overdue_match_can_fall_back_to_unique_team_match_across_stages(self):
        match = {
            "date": "2026-06-12",
            "time": "01:30",
            "status": "upcoming",
            "home": {"name": "FC Elva"},
            "away": {"name": "FC Maardu"},
        }

        payload = {
            "Stages": [
                {
                    "Cnm": "Estonia",
                    "CompN": "Esiliiga",
                    "Events": [
                        {
                            "T1": [{"Nm": "FC Elva"}],
                            "T2": [{"Nm": "Maardu Linnameeskond"}],
                            "Eps": "FT",
                            "Tr1": "4",
                            "Tr2": "3",
                            "Eid": "1743666",
                        }
                    ],
                }
            ]
        }

        original_payload = sr.livescore_date_payload
        original_due_check = sr.match_due_for_result_check
        try:
            sr.livescore_date_payload = lambda *_args, **_kwargs: payload
            sr.match_due_for_result_check = lambda *_args, **_kwargs: True

            found = sr.find_livescore_event("Eliteserien", match)

            self.assertIsNotNone(found)
            stage, event = found
            self.assertEqual(stage.get("CompN"), "Esiliiga")
            self.assertEqual(event.get("Tr1"), "4")
            self.assertEqual(event.get("Tr2"), "3")
        finally:
            sr.livescore_date_payload = original_payload
            sr.match_due_for_result_check = original_due_check

    def test_non_overdue_match_does_not_cross_league_fallback(self):
        match = {
            "date": "2026-06-12",
            "time": "01:30",
            "status": "upcoming",
            "home": {"name": "FC Elva"},
            "away": {"name": "FC Maardu"},
        }

        payload = {
            "Stages": [
                {
                    "Cnm": "Estonia",
                    "CompN": "Esiliiga",
                    "Events": [
                        {
                            "T1": [{"Nm": "FC Elva"}],
                            "T2": [{"Nm": "Maardu Linnameeskond"}],
                            "Eps": "NS",
                            "Tr1": None,
                            "Tr2": None,
                            "Eid": "1743666",
                        }
                    ],
                }
            ]
        }

        original_payload = sr.livescore_date_payload
        original_due_check = sr.match_due_for_result_check
        try:
            sr.livescore_date_payload = lambda *_args, **_kwargs: payload
            sr.match_due_for_result_check = lambda *_args, **_kwargs: False

            found = sr.find_livescore_event("Eliteserien", match)

            self.assertIsNone(found)
        finally:
            sr.livescore_date_payload = original_payload
            sr.match_due_for_result_check = original_due_check


class ResultsOnlyDueScopeTests(unittest.TestCase):
    def setUp(self):
        # ESPN is now the primary results source and is tried first in settle_due. Stub it
        # to None so these tests exercise the SofaScore/Flashscore/LiveScore fallbacks
        # deterministically without a live network call.
        self._original_espn = sr.espn_state_for_match
        sr.espn_state_for_match = lambda *_args, **_kwargs: None

    def tearDown(self):
        sr.espn_state_for_match = self._original_espn

    def test_due_settlement_fetches_only_target_sofascore_ids(self):
        fetched = []
        targets = [
            {
                "league": {"name": "Test League"},
                "event_id": 111,
                "match": {
                    "id": 111,
                    "date": sr.TODAY.isoformat(),
                    "time": "10:00",
                    "status": "upcoming",
                    "home": {"name": "Home A"},
                    "away": {"name": "Away A"},
                    "predictions": {},
                },
            }
        ]

        original_fetch = sr.fetch
        original_flashscore = sr.load_flashscore_result_events
        original_livescore = sr.livescore_result_for_match
        original_cards = sr.cards_count
        try:
            def fake_fetch(path, *args, **kwargs):
                fetched.append(path)
                return {
                    "event": {
                        "id": 111,
                        "status": {"type": "finished"},
                        "homeScore": {"current": 2},
                        "awayScore": {"current": 1},
                    }
                }

            sr.fetch = fake_fetch
            sr.load_flashscore_result_events = lambda: ([], "")
            sr.livescore_result_for_match = lambda *_args, **_kwargs: None
            sr.cards_count = lambda *_args, **_kwargs: None

            result = sr.settle_due_matches_by_sofascore_id(targets)

            # Settlement now also enriches stat actuals (statistics/incidents) for the target,
            # so assert the contract that matters: every SofaScore call is scoped to the target
            # event id 111 and the base event endpoint was hit — no other ids are fetched.
            self.assertIn("/api/v1/event/111", fetched)
            self.assertTrue(
                all(path.startswith("/api/v1/event/111") for path in fetched),
                f"unexpected non-target SofaScore fetch: {fetched}",
            )
            self.assertEqual(len(result["settled"]), 1)
            self.assertEqual(targets[0]["match"]["status"], "FT")
            self.assertEqual(targets[0]["match"]["home"]["goals"], 2)
            self.assertEqual(targets[0]["match"]["away"]["goals"], 1)
        finally:
            sr.fetch = original_fetch
            sr.load_flashscore_result_events = original_flashscore
            sr.livescore_result_for_match = original_livescore
            sr.cards_count = original_cards

    def test_due_settlement_does_not_call_sofascore_with_sportsbet_id(self):
        targets = [
            {
                "league": {"name": "Test League"},
                "event_id": "sportsbet:10582372",
                "match": {
                    "id": "sportsbet:10582372",
                    "date": sr.TODAY.isoformat(),
                    "time": "10:00",
                    "status": "upcoming",
                    "home": {"name": "Home C"},
                    "away": {"name": "Away C"},
                    "predictions": {},
                },
            }
        ]

        original_fetch = sr.fetch
        original_flashscore = sr.load_flashscore_result_events
        original_livescore = sr.livescore_result_for_match
        original_sportsbet = sr.sportsbet_result_for_match
        try:
            sr.fetch = lambda *_args, **_kwargs: self.fail("sportsbet ids must not be sent to SofaScore")
            sr.load_flashscore_result_events = lambda: ([], "")
            sr.livescore_result_for_match = lambda *_args, **_kwargs: None
            sr.sportsbet_result_for_match = lambda *_args, **_kwargs: None

            result = sr.settle_due_matches_by_sofascore_id(targets)

            self.assertEqual(result["skipped"], 1)
            self.assertIn("Non-SofaScore event id", targets[0]["match"]["result_check_note"])
            self.assertEqual(targets[0]["match"]["status"], "upcoming")
        finally:
            sr.fetch = original_fetch
            sr.load_flashscore_result_events = original_flashscore
            sr.livescore_result_for_match = original_livescore
            sr.sportsbet_result_for_match = original_sportsbet

    def test_due_sportsbet_postponed_match_is_closed_and_voided(self):
        targets = [
            {
                "league": {"name": "International Friendly Games"},
                "event_id": "sportsbet:10582372",
                "match": {
                    "id": "sportsbet:10582372",
                    "date": sr.TODAY.isoformat(),
                    "time": "02:45",
                    "status": "upcoming",
                    "home": {"name": "Zanzibar"},
                    "away": {"name": "Uganda"},
                    "sportsbet_odds": {"event_id": 10582372},
                    "predictions": {
                        "winner": {"type": "away"},
                        "btts": {"pick": "No"},
                    },
                },
            }
        ]

        original_fetch = sr.fetch
        original_flashscore = sr.load_flashscore_result_events
        original_livescore = sr.livescore_result_for_match
        original_sportsbet = sr.sportsbet_result_for_match
        try:
            sr.fetch = lambda *_args, **_kwargs: self.fail("sportsbet ids must not be sent to SofaScore")
            sr.load_flashscore_result_events = lambda: ([], "")
            sr.livescore_result_for_match = lambda *_args, **_kwargs: None
            sr.sportsbet_result_for_match = lambda *_args, **_kwargs: {
                "event": {"id": 10582372},
                "status": "postponed_or_cancelled",
                "state": "postponed",
                "status_text": "Postponed",
                "source_match_id": 10582372,
            }

            result = sr.settle_due_matches_by_sofascore_id(targets)
            match = targets[0]["match"]

            self.assertEqual(result["closed"], 1)
            self.assertEqual(result["skipped"], 0)
            self.assertEqual(match["status"], "postponed_or_cancelled")
            self.assertEqual(match["time"], "Postponed")
            self.assertEqual(match["settled_source"], "Sportsbet")
            self.assertEqual(match["predictions"]["winner"]["result"], "void")
            self.assertEqual(match["predictions"]["btts"]["result"], "void")
            self.assertIn("Sportsbet postponed", result["settled"][0])
        finally:
            sr.fetch = original_fetch
            sr.load_flashscore_result_events = original_flashscore
            sr.livescore_result_for_match = original_livescore
            sr.sportsbet_result_for_match = original_sportsbet

    def test_results_only_does_not_run_broad_backfill_or_prune_phases(self):
        store = {
            "leagues": [
                {
                    "name": "Test League",
                    "matches": [
                        {
                            "id": 222,
                            "date": sr.TODAY.isoformat(),
                            "time": "10:00",
                            "status": "upcoming",
                            "home": {"name": "Home B"},
                            "away": {"name": "Away B"},
                        }
                    ],
                }
            ]
        }
        target = {"league": store["leagues"][0], "match": store["leagues"][0]["matches"][0], "event_id": 222}
        schedule_summary = {}

        original_load = sr.load_store
        original_due_targets = sr.due_result_targets
        original_settle_due = sr.settle_due_matches_by_sofascore_id
        original_phase_a5 = sr.phase_a5_backfill_enrich
        original_calibration = sr.populate_today_new_league_calibration_predictions
        original_phase_a6 = sr.phase_a6_retro
        original_prune = sr.prune_stale_pending_matches
        original_sort = sr.sort_store
        original_save = sr.save_store
        original_write_schedule = sr.write_result_schedule_log
        original_tally = sr.print_final_tally
        original_quick_bets = sr.update_quick_bet_history
        try:
            sr.load_store = lambda: store
            sr.due_result_targets = lambda _store: [target]
            sr.settle_due_matches_by_sofascore_id = lambda _targets: {
                "settled": ["Test League: Home B 1-0 Away B"],
                "skipped": 0,
                "not_due": 0,
                "flashscore_settled": 0,
                "livescore_settled": 0,
                "closed": 0,
            }
            sr.phase_a5_backfill_enrich = lambda *_args, **_kwargs: self.fail("broad backfill should not run")
            sr.populate_today_new_league_calibration_predictions = lambda *_args, **_kwargs: self.fail("calibration should not run")
            sr.phase_a6_retro = lambda *_args, **_kwargs: self.fail("broad protection should not run")
            sr.prune_stale_pending_matches = lambda *_args, **_kwargs: self.fail("broad prune should not run")
            sr.sort_store = lambda _store: None
            sr.save_store = lambda _store: None
            sr.write_result_schedule_log = lambda _store, summary: schedule_summary.update(summary) or {"markdown": "schedule.md"}
            sr.print_final_tally = lambda _store: None
            sr.update_quick_bet_history = lambda _store: {"live": 0, "settled": 0, "unresolved": 0}

            sr.run_results_only()

            self.assertEqual(schedule_summary["settled"], ["Test League: Home B 1-0 Away B"])
            self.assertEqual(schedule_summary["backfilled"], 0)
            self.assertEqual(schedule_summary["enriched"], 0)
            self.assertEqual(schedule_summary["pruned"], [])
        finally:
            sr.load_store = original_load
            sr.due_result_targets = original_due_targets
            sr.settle_due_matches_by_sofascore_id = original_settle_due
            sr.phase_a5_backfill_enrich = original_phase_a5
            sr.populate_today_new_league_calibration_predictions = original_calibration
            sr.phase_a6_retro = original_phase_a6
            sr.prune_stale_pending_matches = original_prune
            sr.sort_store = original_sort
            sr.save_store = original_save
            sr.write_result_schedule_log = original_write_schedule
            sr.print_final_tally = original_tally
            sr.update_quick_bet_history = original_quick_bets


class ExtraTimeSettlementTests(unittest.TestCase):
    def test_confirmed_ft_uses_regulation_score_for_full_time_market(self):
        match = {
            "id": "espn:760493",
            "date": "2026-07-02",
            "time": "06:30",
            "status": "live",
            "home": {"name": "Belgium"},
            "away": {"name": "Senegal"},
            "predictions": {
                "winner": {"type": "home"},
                "btts": {"pick": "Yes"},
                "ou_goals": {"pick": "Under", "line": 2.5},
            },
        }
        summary = {
            "header": {
                "competitions": [
                    {
                        "status": {
                            "type": {
                                "name": "STATUS_FINAL_AET",
                                "detail": "AET",
                                "description": "Final Score - After Extra Time",
                            }
                        },
                        "competitors": [
                            {
                                "homeAway": "home",
                                "score": "3",
                                "linescores": [{"displayValue": "0"}, {"displayValue": "2"}, {"displayValue": "0"}, {"displayValue": "1"}],
                            },
                            {
                                "homeAway": "away",
                                "score": "2",
                                "linescores": [{"displayValue": "1"}, {"displayValue": "1"}, {"displayValue": "0"}, {"displayValue": "0"}],
                            },
                        ],
                    }
                ]
            }
        }

        original_fetch_summary = sr._fetch_espn_summary
        original_actuals = sr.espn_actuals_for_match
        try:
            sr._fetch_espn_summary = lambda _slug, _event_id: summary
            sr.espn_actuals_for_match = lambda *_args, **_kwargs: {}

            settled = sr.settle_confirmed_ft(match, "FIFA World Cup", 3, 2, "ESPN FT")

            self.assertTrue(settled)
            self.assertEqual(match["home"]["goals"], 2)
            self.assertEqual(match["away"]["goals"], 2)
            self.assertEqual(match["after_extra_time_score"], {"home": 3, "away": 2, "source": "ESPN FT"})
            self.assertEqual(match["settlement_score"]["basis"], "regulation_time")
            self.assertEqual(match["predictions"]["winner"]["result"], "miss")
            self.assertEqual(match["predictions"]["btts"]["result"], "hit")
            self.assertEqual(match["predictions"]["ou_goals"]["actual"], 4)
            self.assertEqual(match["predictions"]["ou_goals"]["result"], "miss")
        finally:
            sr._fetch_espn_summary = original_fetch_summary
            sr.espn_actuals_for_match = original_actuals


class QuickBetLifecycleMatchingTests(unittest.TestCase):
    @staticmethod
    def flash_event(home="Home", away="Away", event_id="one"):
        return {"id": event_id, "ts": int(datetime(2026, 8, 18, 2, 30, tzinfo=timezone.utc).timestamp()),
                "home": home, "away": away, "home_score": "1", "away_score": "0", "status": "2"}

    def test_flashscore_requires_one_ordered_team_match(self):
        row = {"date": "2026-08-18", "home": "Home", "away": "Away"}
        self.assertIsNone(sr.flashscore_state_for_quick_bet([
            self.flash_event(event_id="one"), self.flash_event(event_id="two")
        ], row))
        self.assertIsNone(sr.flashscore_state_for_quick_bet([
            self.flash_event(home="Away", away="Home")
        ], row))
        state = sr.flashscore_state_for_quick_bet([self.flash_event()], row)
        self.assertEqual((state["status"], state["home_score"], state["away_score"]), ("live", 1, 0))

    def test_espn_is_mapped_unique_non_mutating_and_uses_regulation_score(self):
        row = {"league": "FIFA World Cup", "date": "2026-08-18", "home": "Home", "away": "Away"}
        source_before = dict(row)
        event = {"event_id": "espn-1", "date": "2026-08-17T15:30:00Z", "home": "Home", "away": "Away",
                 "home_score": "3", "away_score": "2", "state": "post", "completed": True, "detail": "AET"}
        summary = {"header": {"competitions": [{"status": {"type": {"name": "STATUS_FINAL_AET"}}, "competitors": [
            {"homeAway": "home", "score": "3", "linescores": [{"value": 1}, {"value": 1}, {"value": 1}]},
            {"homeAway": "away", "score": "2", "linescores": [{"value": 1}, {"value": 1}, {"value": 0}]},
        ]}]}}
        old_events, old_summary = sr.espn_scoreboard_events, sr._fetch_espn_summary
        try:
            sr.espn_scoreboard_events = lambda _league: [event]
            sr._fetch_espn_summary = lambda _slug, _event_id: summary
            state = sr.espn_state_for_quick_bet(row)
            self.assertEqual((state["status"], state["home_score"], state["away_score"]), ("FT", 2, 2))
            self.assertEqual(row, source_before)
            self.assertIsNone(sr.espn_state_for_quick_bet({**row, "league": "Unmapped League"}))
            sr.espn_scoreboard_events = lambda _league: [event, {**event, "event_id": "espn-2"}]
            self.assertIsNone(sr.espn_state_for_quick_bet(row))
        finally:
            sr.espn_scoreboard_events, sr._fetch_espn_summary = old_events, old_summary

    def test_espn_rejects_same_teams_on_adjacent_adelaide_date(self):
        row = {"league": "FIFA World Cup", "date": "2026-08-18", "home": "Home", "away": "Away"}
        adjacent = {"event_id": "espn-next", "date": "2026-08-18T15:30:00Z",
                    "home": "Home", "away": "Away", "home_score": "1", "away_score": "0",
                    "state": "post", "completed": True}
        old_events, old_summary = sr.espn_scoreboard_events, sr._fetch_espn_summary
        try:
            sr.espn_scoreboard_events = lambda _league: [adjacent]
            sr._fetch_espn_summary = lambda _slug, _event_id: None
            self.assertIsNone(sr.espn_state_for_quick_bet(row))
        finally:
            sr.espn_scoreboard_events, sr._fetch_espn_summary = old_events, old_summary

    def test_history_prefers_unique_canonical_sportsbet_id_without_provider_id_leak(self):
        import soccer_fetch_sportsbet as sportsbet
        now = datetime(2026, 8, 18, 12, 0, tzinfo=sr.ADL)
        payload = {"schema_version": 2, "events": [{
            "event_id": "701", "league": "Cup", "date": "2026-08-18", "time": "12:00",
            "home": "Home", "away": "Away", "markets": {"winner": [{"key": "home", "label": "Home", "odds": 1.2}]},
        }], "history": []}
        store = {"leagues": [{"name": "Cup", "matches": [{
            "id": "espn:foreign", "status": "FT", "sportsbet_odds": {"event_id": 701},
            "home": {"name": "Home", "goals": 2}, "away": {"name": "Away", "goals": 1},
            "settlement_score": {"home": 2, "away": 1, "basis": "regulation_time"},
        }]}]}
        old_path = sportsbet.QUICK_BETS_PATH
        old_results, old_live, old_espn = sr.load_flashscore_result_events, sr.get_flashscore_live_events, sr.espn_state_for_quick_bet
        try:
            with tempfile.TemporaryDirectory() as temp:
                sportsbet.QUICK_BETS_PATH = Path(temp) / "sportsbet_quick_bets.json"
                sportsbet.atomic_write_json(sportsbet.QUICK_BETS_PATH, payload)
                sr.load_flashscore_result_events = lambda: ([], "")
                sr.get_flashscore_live_events = lambda: []
                sr.espn_state_for_quick_bet = lambda _row: None
                summary = sr.update_quick_bet_history(store, now, sportsbet.QUICK_BETS_PATH)
                written = json.loads(sportsbet.QUICK_BETS_PATH.read_text(encoding="utf-8"))
                row = written["history"][0]
                self.assertEqual(summary["settled"], 1)
                self.assertEqual((row["status"], row["home_score"], row["away_score"]), ("FT", 2, 1))
                self.assertEqual(row["result_source"], "canonical")
                self.assertNotIn("espn_event_id", row)
                self.assertNotIn("source_match_id", row)
        finally:
            sportsbet.QUICK_BETS_PATH = old_path
            sr.load_flashscore_result_events, sr.get_flashscore_live_events, sr.espn_state_for_quick_bet = old_results, old_live, old_espn

    def test_unresolved_ambiguous_history_is_atomically_retained_without_provider_ids(self):
        import soccer_fetch_sportsbet as sportsbet
        now = datetime(2026, 8, 18, 12, 0, tzinfo=sr.ADL)
        payload = {"schema_version": 2, "events": [{
            "event_id": "702", "league": "Cup", "date": "2026-08-18", "time": "12:00",
            "home": "Home", "away": "Away", "markets": {"winner": [{"key": "home", "label": "Home", "odds": 1.2}]},
        }], "history": []}
        ambiguous = [
            {**self.flash_event(event_id="flash-one"), "source_match_id": "source-one", "espn_event_id": "espn-one"},
            {**self.flash_event(event_id="flash-two"), "source_match_id": "source-two", "espn_event_id": "espn-two"},
        ]
        original_atomic = sportsbet.atomic_write_json
        old_results, old_live = sr.load_flashscore_result_events, sr.get_flashscore_live_events
        old_espn, old_terminal = sr.espn_state_for_quick_bet, sr.sportsbet_result_for_match
        try:
            with tempfile.TemporaryDirectory() as temp:
                target = Path(temp) / "sportsbet_quick_bets.json"
                original_atomic(target, payload)
                atomic_calls = []

                def tracked_atomic(path, data):
                    atomic_calls.append(Path(path))
                    original_atomic(path, data)

                sportsbet.atomic_write_json = tracked_atomic
                sr.load_flashscore_result_events = lambda: ([], "")
                sr.get_flashscore_live_events = lambda: ambiguous
                sr.espn_state_for_quick_bet = lambda _row: None
                sr.sportsbet_result_for_match = lambda *_args, **_kwargs: None

                summary = sr.update_quick_bet_history({"leagues": []}, now, target)
                written = json.loads(target.read_text(encoding="utf-8"))
                row = written["history"][0]

                self.assertEqual(summary, {"live": 0, "settled": 0, "unresolved": 1})
                self.assertEqual(atomic_calls, [target])
                self.assertFalse(target.with_suffix(target.suffix + ".tmp").exists())
                self.assertEqual(written["events"], [])
                self.assertEqual((row["event_id"], row["status"]), ("702", "started"))
                self.assertNotIn("result_source", row)
                for key in ("espn_event_id", "flashscore_event_id", "source_match_id"):
                    self.assertNotIn(key, row)
        finally:
            sportsbet.atomic_write_json = original_atomic
            sr.load_flashscore_result_events, sr.get_flashscore_live_events = old_results, old_live
            sr.espn_state_for_quick_bet, sr.sportsbet_result_for_match = old_espn, old_terminal


if __name__ == "__main__":
    unittest.main()
