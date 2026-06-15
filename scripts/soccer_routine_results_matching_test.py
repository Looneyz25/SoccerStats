import unittest

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


if __name__ == "__main__":
    unittest.main()
