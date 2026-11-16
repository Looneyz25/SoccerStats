import unittest
from copy import deepcopy

import soccer_routine as sr
import soccer_phase4_predictions as phase4


class PreMatchPredictionRefreshTest(unittest.TestCase):
    def setUp(self):
        self._save_store = sr.save_store
        sr.save_store = lambda _store: None
        self._team_elo = dict(sr._TEAM_ELO)
        self._team_identity = dict(sr._TEAM_IDENTITY)
        sr._TEAM_ELO.clear()
        sr._TEAM_IDENTITY.clear()

    def tearDown(self):
        sr.save_store = self._save_store
        sr._TEAM_ELO.clear(); sr._TEAM_ELO.update(self._team_elo)
        sr._TEAM_IDENTITY.clear(); sr._TEAM_IDENTITY.update(self._team_identity)

    @staticmethod
    def ft(match_id, day, home, away, hg, ag, home_id=None, away_id=None):
        return {"id": match_id, "date": day, "time": "15:00", "status": "FT",
                "home": {"name": home, "team_id": home_id, "goals": hg},
                "away": {"name": away, "team_id": away_id, "goals": ag}}

    @staticmethod
    def upcoming_without_odds(home, away, home_id=None, away_id=None, predictions=None):
        return {"id": "future-no-odds", "date": "2099-08-01", "time": "15:00", "status": "upcoming",
                "home": {"name": home, "team_id": home_id}, "away": {"name": away, "team_id": away_id},
                "predictions": predictions or {}}

    def test_missing_odds_never_blend_the_seed_price(self):
        match = self.upcoming_without_odds("Home FC", "Away FC")
        sr.populate_pre_match_predictions({"leagues": [{"name": "Premier League", "matches": [match]}]})
        winner = match["predictions"]["winner"]
        self.assertNotIn("bookmaker_probabilities", winner)
        self.assertEqual(winner["probabilities"], winner["model_probabilities"])
        self.assertEqual(match["predictions"]["factors"]["winner_bookmaker_blend"], 0)
        self.assertIsNone(winner["odds"])

    def test_seed_blended_prefill_refreshes_before_kickoff(self):
        seed = sr.bookmaker_three_way_probabilities({"home": 3.0, "draw": 3.2, "away": 3.0})
        match = self.upcoming_without_odds("Home FC", "Away FC", predictions={
            "winner": {"pick": "Home FC", "type": "home", "probability": .36, "bookmaker_probabilities": seed,
                       "bookmaker_blend_weight": sr.WINNER_BOOKMAKER_BLEND},
            "btts": {"pick": "Yes", "probability": .55}, "ou_goals": {"pick": "Over", "probability": .55, "line": 2.5},
            "ou_cards": {"pick": "Under", "probability": .7, "line": 4.5},
            "factors": {"source": "pre_match_prefill", "data_quality": "Data weak",
                        "model_seed_odds": {"home": 3.0, "draw": 3.2, "away": 3.0}}})
        store = {"leagues": [{"name": "Premier League", "matches": [match]}]}
        self.assertEqual(sr.populate_pre_match_predictions(store)["refreshed"], 1)
        self.assertEqual(match["predictions"]["factors"]["refresh_reason"], "seed_odds_blend_removed")
        self.assertNotIn("bookmaker_probabilities", match["predictions"]["winner"])
        self.assertEqual(sr.populate_pre_match_predictions(store)["refreshed"], 0)

    def test_team_identity_merges_relabels_but_not_distinct_clubs(self):
        store = {"leagues": [
            {"name": "Premier League", "matches": [
                self.ft(1, "2026-04-01", "Brighton", "Chelsea", 1, 0, 30, 38),
                self.ft(2, "2026-04-08", "Brighton & Hove Albion", "Chelsea", 1, 0, 30, 38),
                self.ft(3, "2026-04-15", "Bournemouth", "Chelsea", 1, 0, 26, 38),
                self.ft(4, "2026-09-01", "AFC Bournemouth", "Chelsea", 1, 0, "349", "363"),
            ]},
            {"name": "Scottish Premiership", "matches": [
                self.ft(5, "2026-09-01", "Dundee", "Dundee United", 1, 0, 1, 2),
            ]},
            {"name": "Championship", "matches": [
                self.ft(6, "2026-09-01", "Millwall", "Leeds", 1, 0, 25, 9),
                self.ft(7, "2026-09-08", "Port Vale", "Leeds", 1, 0, 25, 9),
            ]},
            {"name": "International Friendly Games", "matches": [
                self.ft(8, "2026-06-01", "Guinea", "Mali", 1, 0, 1, 2),
                self.ft(9, "2026-09-01", "Papua New Guinea", "Mali", 1, 0, 3, 2),
            ]},
        ]}
        identity = sr.build_team_identity(store)
        same = lambda a, b: identity[sr.team_identity_norm(a)] == identity[sr.team_identity_norm(b)]
        self.assertTrue(same("Brighton", "Brighton & Hove Albion"))
        self.assertTrue(same("Bournemouth", "AFC Bournemouth"))
        self.assertFalse(same("Dundee", "Dundee United"))
        self.assertFalse(same("Millwall", "Port Vale"))
        self.assertFalse(same("Guinea", "Papua New Guinea"))

    def test_elo_carries_across_a_provider_team_id_change(self):
        history = [self.ft(i, f"2026-05-{i:02d}", "Arsenal", "Chelsea", 2, 0, 42, 38) for i in range(1, 9)]
        upcoming = self.upcoming_without_odds("Arsenal", "Chelsea", "359", "363")
        sr.rebuild_team_elo({"leagues": [{"name": "Premier League", "matches": history + [upcoming]}]})
        self.assertGreater(sr.team_elo_rating("359", "Arsenal"), sr.ELO_INIT + 50)
        self.assertLess(sr.team_elo_rating("363", "Chelsea"), sr.ELO_INIT - 50)
        self.assertEqual(sr.team_elo_rating("999", "Unknown FC"), sr.ELO_INIT)

    def test_prefill_uses_each_teams_recent_form(self):
        history = []
        for i in range(1, 6):
            history.append(self.ft(f"s{i}", f"2026-05-{i:02d}", "Strong FC", f"Rival {i}", 3, 0))
            history.append(self.ft(f"w{i}", f"2026-05-{i:02d}", f"Other {i}", "Weak FC", 3, 0))
        neutral = self.upcoming_without_odds("Fresh A", "Fresh B")
        neutral["id"] = "future-neutral"
        formed = self.upcoming_without_odds("Strong FC", "Weak FC")
        store = {"leagues": [{"name": "Premier League", "matches": history + [neutral, formed]}]}
        sr.populate_pre_match_predictions(store)
        neutral_home = neutral["predictions"]["winner"]["model_probabilities"]["home"]
        formed_home = formed["predictions"]["winner"]["model_probabilities"]["home"]
        self.assertGreater(formed_home, neutral_home + 0.2)
        index = sr.build_team_form_index(store)
        self.assertEqual(sr.team_recent_form(index, {"name": "Strong FC"}, "2026-05-04"), (3.0, 0.0))
        self.assertIsNone(sr.team_recent_form(index, {"name": "Strong FC"}, "2026-05-03"))

    def test_team_identity_never_merges_a_name_holding_two_concurrent_clubs(self):
        store = {"leagues": [{"name": "LaLiga", "matches": [
            self.ft(1, "2026-05-03", "Deportivo Alavés", "Sevilla", 1, 0, 2885, 2833),
            self.ft(2, "2026-05-24", "Deportivo Alavés", "Getafe", 1, 0, 2885, 2859),
            self.ft(3, "2026-08-18", "Deportivo", "Sevilla", 1, 0, "90", "88"),
            self.ft(4, "2026-08-19", "Alavés", "Getafe", 1, 0, "96", "87"),
            self.ft(5, "2026-11-21", "Deportivo", "Alavés", 1, 0, "90", "96"),
        ]}]}
        identity = sr.build_team_identity(store)
        same = lambda a, b: identity[sr.team_identity_norm(a)] == identity[sr.team_identity_norm(b)]
        self.assertFalse(same("Deportivo", "Deportivo Alavés"))
        self.assertFalse(same("Deportivo", "Alavés"))

    def test_real_bookmaker_blend_survives_missing_odds(self):
        real = sr.bookmaker_three_way_probabilities({"home": 1.8, "draw": 3.6, "away": 4.5})
        predictions = {
            "winner": {"pick": "Home FC", "type": "home", "probability": .5, "bookmaker_probabilities": real,
                       "bookmaker_blend_weight": sr.WINNER_BOOKMAKER_BLEND},
            "factors": {"source": "pre_match_prefill", "model_seed_odds": None}}
        match = self.upcoming_without_odds("Home FC", "Away FC", predictions=predictions)
        reason = sr.pre_match_prediction_refresh_reason(match, predictions, None, None)
        self.assertNotEqual(reason, "seed_odds_blend_removed")

    def test_prefill_rebuilds_identity_and_elo_from_the_passed_store(self):
        sr._TEAM_ELO["unrelated"] = 1234.0
        history = [self.ft(f"b{i}", f"2026-04-{i:02d}", "Bournemouth", f"Rival {i}", 3, 0) for i in range(1, 9)]
        neutral = self.upcoming_without_odds("Fresh A", "Fresh C")
        neutral["id"] = "future-neutral"
        relabelled = self.upcoming_without_odds("AFC Bournemouth", "Fresh B")
        store = {"leagues": [{"name": "Premier League", "matches": history + [neutral, relabelled]}]}
        sr.populate_pre_match_predictions(store)
        self.assertNotIn("unrelated", sr._TEAM_ELO)
        self.assertGreater(sr.team_elo_rating(None, "AFC Bournemouth"), sr.ELO_INIT + 50)
        neutral_home = neutral["predictions"]["winner"]["model_probabilities"]["home"]
        relabelled_home = relabelled["predictions"]["winner"]["model_probabilities"]["home"]
        self.assertGreater(relabelled_home, neutral_home + 0.2)

    def test_refreshes_stale_prefill_with_two_way_bookmaker_markets(self):
        store = {
            "leagues": [{
                "name": "FIFA World Cup",
                "matches": [{
                    "id": "future-1",
                    "date": "2099-07-01",
                    "time": "20:00",
                    "status": "upcoming",
                    "home": {"name": "Home FC", "team_id": "h1"},
                    "away": {"name": "Away FC", "team_id": "a1"},
                    "sportsbet_odds": {"home": 2.1, "draw": 3.2, "away": 3.5},
                    "sportsbet_markets": {
                        "Both teams to score": {"Yes": 2.5, "No": 1.5},
                        "Match goals 2.5": {"Over": 2.8, "Under": 1.42},
                    },
                    "predictions": {
                        "winner": {"pick": "Home FC", "type": "home", "probability": 0.45},
                        "btts": {"pick": "Yes", "probability": 0.65, "raw_probability": 0.65},
                        "ou_goals": {"pick": "Over", "line": 2.5, "probability": 0.65, "raw_probability": 0.65},
                        "ou_cards": {"pick": "Under", "line": 4.5, "probability": 0.7},
                        "factors": {
                            "source": "pre_match_prefill",
                            "data_quality": "Data weak",
                            "model_seed_odds": {"home": 3.0, "draw": 3.2, "away": 3.0},
                            "bookmaker_odds_available": False,
                        },
                    },
                }],
            }],
        }

        result = sr.populate_pre_match_predictions(store)
        predictions = store["leagues"][0]["matches"][0]["predictions"]

        self.assertEqual(result["refreshed"], 1)
        self.assertEqual(predictions["winner"]["odds"], 2.1)
        self.assertEqual(predictions["btts"]["pick"], "No")
        self.assertEqual(predictions["ou_goals"]["pick"], "Under")
        self.assertGreaterEqual(predictions["ou_goals"]["probability"], 0.5)
        self.assertEqual(predictions["ou_goals"]["odds"], 1.42)
        self.assertEqual(predictions["factors"]["refresh_reason"], "bookmaker_odds_arrived")
        self.assertEqual(predictions["factors"]["goal_market_bookmaker_blend"], sr.GOAL_MARKET_BOOKMAKER_BLEND)

    def future_match(self):
        odds = {"home": 2.6, "draw": 3.5, "away": 2.55}
        return {"id": "future-fener", "date": "2099-09-11", "time": "02:15", "status": "upcoming",
                "home": {"name": "Fenerbahce"}, "away": {"name": "AS Roma"},
                "bookmaker_context": {"home": {"rank": 2}, "away": {"rank": 4}},
                "sportsbet_odds": {"home": 3.9, "draw": 3.5, "away": 1.95},
                "predictions": {"winner": {"type": "home", "pick": "Fenerbahce", "probability": .4081,
                    "odds": 2.6, "bookmaker_blend_weight": .4, "bookmaker_probabilities": sr.bookmaker_three_way_probabilities(odds)},
                    "btts": {"pick": "Yes", "probability": .61}, "ou_goals": {"pick": "Over", "probability": .58, "line": 2.5},
                    "ou_cards": {"pick": "Under", "probability": .775, "line": 4.5},
                    "factors": {"source": "pre_match_prefill", "data_quality": "Data usable"}}}

    def test_suppressed_corners_republish_from_same_run_sportsbet_corner_market(self):
        match = {
            "status": "upcoming",
            "sportsbet_markets": {"Corners 2-Way 10.5": {"Over": 2.5, "Under": 1.46}},
            "predictions": {"ou_corners": {
                "pick": None, "line": 10.5, "probability": None, "model_probability": 0.55,
                "suppressed_pick": "Under", "suppressed_probability": 0.55,
                "insufficient_evidence": True, "no_sportsbet_corner_odds": True,
            }},
        }
        self.assertEqual(sr.corner_odds_for_prediction(match, 10.5, "Under"), 1.46)
        self.assertTrue(sr.apply_corner_probability_cap_to_existing_prediction(match))
        corners = match["predictions"]["ou_corners"]
        self.assertEqual(corners["pick"], "Under")
        self.assertIsNotNone(corners["probability"])
        self.assertNotIn("insufficient_evidence", corners)
        self.assertIsNone(sr.corner_odds_for_prediction(match, 9.5, "Under"))

    def test_winner_weight_uses_normalized_bookmaker_probabilities(self):
        model = {"home": .4388, "draw": .2523, "away": .3089}
        blended, book = sr.blend_three_way_with_bookmaker(model, self.future_match()["sportsbet_odds"])
        self.assertEqual(sr.WINNER_BOOKMAKER_BLEND, .7)
        for side in model:
            self.assertAlmostEqual(blended[side], .3 * model[side] + .7 * book[side])
        phase4_blended, phase4_book = phase4.blend_with_bookmaker(
            {f"p_{side}": probability for side, probability in model.items()}, self.future_match()["sportsbet_odds"])
        self.assertEqual(phase4.WINNER_BOOKMAKER_BLEND, sr.WINNER_BOOKMAKER_BLEND)
        self.assertEqual(phase4_book, book)
        for side in model:
            self.assertAlmostEqual(phase4_blended[f"p_{side}"], blended[side])
        self.assertAlmostEqual(sum(blended.values()), 1)
        self.assertEqual(sr.blend_three_way_with_bookmaker(model, None), (model, None))

    def test_refresh_reason_detects_calibration_and_any_side_price_drift(self):
        match = self.future_match()
        pred = match["predictions"]
        odds = match["sportsbet_odds"]
        reason = lambda: sr.pre_match_prediction_refresh_reason(match, pred, odds, {})
        self.assertEqual(reason(), "winner_calibration_changed")
        pred["winner"]["bookmaker_blend_weight"] = sr.WINNER_BOOKMAKER_BLEND
        self.assertEqual(reason(), "winner_bookmaker_price_changed")
        pred["winner"]["bookmaker_probabilities"] = sr.bookmaker_three_way_probabilities(odds)
        self.assertIsNone(reason())
        odds["away"] = 1.6
        self.assertEqual(reason(), "winner_bookmaker_price_changed")
        pred["winner"]["bookmaker_probabilities"]["home"] = float("nan")
        self.assertEqual(reason(), "winner_bookmaker_snapshot_missing")

    def test_future_refresh_replaces_old_bookmaker_snapshot(self):
        match = self.future_match()
        store = {"leagues": [{"name": "UEFA Champions League", "matches": [match]}]}
        self.assertEqual(sr.populate_pre_match_predictions(store)["refreshed"], 1)
        winner = match["predictions"]["winner"]
        self.assertEqual(winner["bookmaker_blend_weight"], .7)
        current = sr.bookmaker_three_way_probabilities(match["sportsbet_odds"])
        for side in current:
            self.assertAlmostEqual(winner["bookmaker_probabilities"][side], current[side], places=3)
        self.assertEqual(winner["odds"], match["sportsbet_odds"][winner["type"]])

        self.assertEqual(match["predictions"]["factors"]["data_quality"], "Data usable")
        before = deepcopy(match["predictions"])
        self.assertEqual(sr.populate_pre_match_predictions(store)["refreshed"], 0)
        self.assertEqual(match["predictions"], before)

    def test_new_refresh_reasons_require_readable_kickoff(self):
        for overrides in ({"date": None}, {"time": None}, {"date": "bad-date"}, {"time": "TBD"}):
            for weight in (.4, sr.WINNER_BOOKMAKER_BLEND):
                with self.subTest(overrides=overrides, weight=weight):
                    match = self.future_match()
                    match.update(overrides)
                    match["predictions"]["winner"]["bookmaker_blend_weight"] = weight
                    self.assertIsNone(sr.pre_match_prediction_refresh_reason(
                        match, match["predictions"], match["sportsbet_odds"], {}))

    def test_started_resulted_and_locked_predictions_are_unchanged(self):
        for overrides in ({"status": "live"}, {"status": "FT"}, {"prediction_locked": True}, {"date": "2000-01-01"}):
            with self.subTest(overrides=overrides):
                match = self.future_match()
                match.update(overrides)
                before = deepcopy(match)
                store = {"leagues": [{"name": "UEFA Champions League", "matches": [match]}]}
                self.assertEqual(sr.populate_pre_match_predictions(store)["refreshed"], 0)
                self.assertEqual(match, before)

    def test_goal_blend_keeps_stronger_side_between_50_and_55(self):
        predictions = {
            "ou_goals": {
                "pick": "Over",
                "line": 2.5,
                "probability": 0.56,
                "raw_probability": 0.56,
            },
            "factors": {},
        }
        match = {
            "sportsbet_markets": {
                "Match goals 2.5": {"Over": 1.85, "Under": 1.95},
            },
        }

        sr.apply_bookmaker_goal_market_blend(match, predictions)

        self.assertEqual(predictions["ou_goals"]["pick"], "Over")
        self.assertGreaterEqual(predictions["ou_goals"]["probability"], 0.5)
        self.assertEqual(predictions["ou_goals"]["odds"], 1.85)

    def test_refreshes_prefill_when_winner_price_is_missing(self):
        store = {
            "leagues": [{
                "name": "FIFA World Cup",
                "matches": [{
                    "id": "future-2",
                    "date": "2099-07-02",
                    "time": "20:00",
                    "status": "upcoming",
                    "home": {"name": "Home FC", "team_id": "h2"},
                    "away": {"name": "Away FC", "team_id": "a2"},
                    "sportsbet_odds": {"home": 1.4, "draw": 4.2, "away": 7.5},
                    "predictions": {
                        "winner": {"pick": "Home FC", "type": "home", "probability": 0.55},
                        "btts": {"pick": "No", "probability": 0.58, "raw_probability": 0.58},
                        "ou_goals": {"pick": "Over", "line": 2.5, "probability": 0.58, "raw_probability": 0.58},
                        "ou_cards": {"pick": "Under", "line": 4.5, "probability": 0.7},
                        "factors": {
                            "source": "pre_match_prefill",
                            "data_quality": "Data usable",
                            "model_seed_odds": None,
                            "bookmaker_odds_available": True,
                            "goal_market_bookmaker_blend": sr.GOAL_MARKET_BOOKMAKER_BLEND,
                        },
                    },
                }],
            }],
        }

        result = sr.populate_pre_match_predictions(store)
        predictions = store["leagues"][0]["matches"][0]["predictions"]

        self.assertEqual(result["refreshed"], 1)
        self.assertEqual(predictions["winner"]["type"], "home")
        self.assertEqual(predictions["winner"]["odds"], 1.4)
        self.assertEqual(predictions["factors"]["refresh_reason"], "winner_odds_missing")


if __name__ == "__main__":
    unittest.main()
