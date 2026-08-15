import unittest

import soccer_routine as sr


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
