import unittest
from copy import deepcopy

import soccer_routine as sr
import soccer_phase4_predictions as phase4


class PreMatchPredictionRefreshTest(unittest.TestCase):
    def setUp(self):
        self._save_store = sr.save_store
        sr.save_store = lambda _store: None

    def tearDown(self):
        sr.save_store = self._save_store

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
