import unittest

import soccer_model_calibration_agent as agent
import soccer_routine as routine


def store_match(match_id, raw, book, hg, ag, weight=0.7, result="hit", date="2026-11-10", source="pre_match_prefill", status="FT"):
    winner = {"result": result, "raw_probabilities": raw}
    if book is not None:
        winner["bookmaker_probabilities"] = book
        winner["bookmaker_blend_weight"] = weight
    return {
        "id": match_id,
        "date": date,
        "status": status,
        "home": {"goals": hg},
        "away": {"goals": ag},
        "predictions": {"winner": winner, "factors": {"source": source}},
    }


def store_of(matches):
    return {"leagues": [{"name": "Test League", "matches": matches}]}


def review_with_winner(hit_rate=0.4555, settled=2834):
    return {
        "market_summary": [
            {"market": "Winner", "settled": settled, "hit_rate": hit_rate},
            {"market": "BTTS", "settled": 2834, "hit_rate": 0.5656},
        ],
        "weak_spots": [],
    }


UNIFORM = {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3}


class WinnerBenchmarkRowsTest(unittest.TestCase):
    def test_keeps_only_settled_tracked_priced_rows(self):
        raw = {"home": 0.5, "draw": 0.3, "away": 0.2}
        book = {"home": 0.45, "draw": 0.3, "away": 0.25}
        store = store_of([
            store_match("kept", raw, book, 2, 1),
            store_match("unpriced", raw, None, 2, 1),
            store_match("before-tracking", raw, book, 2, 1, date="2026-04-21"),
            store_match("retro", raw, book, 2, 1, source="retro_snapshot"),
            store_match("void", raw, book, 2, 1, result="void"),
            store_match("not-ft", raw, book, 2, 1, status="upcoming"),
            store_match("bad-weight", raw, book, 2, 1, weight=1.5),
            store_match("bool-weight", raw, book, 2, 1, weight=True),
        ])

        rows = agent.winner_benchmark_rows(store)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["actual"], "home")
        self.assertAlmostEqual(rows[0]["weight"], 0.7)

    def test_actual_side_follows_final_score(self):
        raw = {"home": 0.4, "draw": 0.3, "away": 0.3}
        store = store_of([
            store_match("a", raw, raw, 0, 1, result="miss"),
            store_match("d", raw, raw, 1, 1, result="miss"),
        ])

        self.assertEqual([row["actual"] for row in agent.winner_benchmark_rows(store)], ["away", "draw"])


class PublishedProbabilityTest(unittest.TestCase):
    def test_matches_live_predictor_shrink_and_blend(self):
        raw = agent.three_way({"home": 0.5378, "draw": 0.2424, "away": 0.2199})
        odds = {"home": 1.45, "draw": 4.6, "away": 6.0}
        book = routine.bookmaker_three_way_probabilities(odds)
        trust = 0.7387
        for weight in (0.4, routine.WINNER_BOOKMAKER_BLEND):
            with self.subTest(weight=weight):
                shrunk = routine.normalize_three_way(*(routine.shrink_probability(raw[s], trust, 1 / 3) for s in agent.WINNER_SIDES))
                expected, _ = routine.blend_three_way_with_bookmaker(dict(zip(agent.WINNER_SIDES, shrunk)), odds, weight)
                actual = agent.published_winner_probabilities({"raw": raw, "book": book, "weight": weight}, trust)
                for side in agent.WINNER_SIDES:
                    self.assertAlmostEqual(actual[side], expected[side], places=12)


class FitWinnerTrustTest(unittest.TestCase):
    def test_well_calibrated_model_keeps_full_trust(self):
        raw = {"home": 0.6, "draw": 0.25, "away": 0.15}
        outcomes = ["home"] * 60 + ["draw"] * 25 + ["away"] * 15
        rows = [{"raw": raw, "book": UNIFORM, "weight": 0.7, "actual": side} for side in outcomes]

        self.assertEqual(agent.fit_winner_trust(rows)["trust_factor"], 1.0)

    def test_overconfident_model_is_shrunk_but_not_below_floor(self):
        raw = {"home": 0.8, "draw": 0.1, "away": 0.1}
        outcomes = ["home"] * 34 + ["draw"] * 33 + ["away"] * 33
        rows = [{"raw": raw, "book": UNIFORM, "weight": 0.0, "actual": side} for side in outcomes]

        fit = agent.fit_winner_trust(rows)

        self.assertEqual(fit["trust_factor"], agent.MIN_TRUST_FACTOR)
        self.assertLess(fit["published_log_loss"], fit["full_trust_log_loss"])

    def test_tie_keeps_the_higher_trust(self):
        rows = [{"raw": UNIFORM, "book": UNIFORM, "weight": 0.7, "actual": side} for side in ("home", "draw", "away") * 20]

        self.assertEqual(agent.fit_winner_trust(rows)["trust_factor"], 1.0)


class BuildCalibrationWinnerTest(unittest.TestCase):
    def test_winner_trust_ignores_sixty_percent_target_when_log_loss_prefers_full_trust(self):
        raw = {"home": 0.6, "draw": 0.25, "away": 0.15}
        outcomes = [(1, 0)] * 60 + [(1, 1)] * 25 + [(0, 1)] * 15
        store = store_of([store_match(str(i), raw, UNIFORM, hg, ag) for i, (hg, ag) in enumerate(outcomes)])

        calibration = agent.build_calibration(review_with_winner(), store)
        winner = calibration["market_adjustments"]["winner"]

        self.assertEqual(winner["trust_factor"], 1.0)
        self.assertEqual(winner["trust_rule"], "log_loss_fit")
        self.assertEqual(winner["benchmark_rows"], 100)
        self.assertEqual(winner["min_edge_delta"], 0.04)
        self.assertIn("bookmaker", winner["reason"])
        self.assertEqual(calibration["market_adjustments"]["btts"]["trust_factor"], 0.969)

    def test_winner_entry_is_omitted_at_full_trust_without_edge_delta(self):
        raw = {"home": 0.6, "draw": 0.25, "away": 0.15}
        outcomes = [(1, 0)] * 60 + [(1, 1)] * 25 + [(0, 1)] * 15
        store = store_of([store_match(str(i), raw, UNIFORM, hg, ag) for i, (hg, ag) in enumerate(outcomes)])

        calibration = agent.build_calibration(review_with_winner(hit_rate=0.61), store)

        self.assertNotIn("winner", calibration["market_adjustments"])

    def test_too_few_benchmark_rows_leave_full_trust_and_keep_edge_delta(self):
        raw = {"home": 0.8, "draw": 0.1, "away": 0.1}
        store = store_of([store_match(str(i), raw, UNIFORM, 0, 1) for i in range(agent.MIN_MARKET_SAMPLE - 1)])

        winner = agent.build_calibration(review_with_winner(), store)["market_adjustments"]["winner"]

        self.assertEqual(winner["trust_factor"], 1.0)
        self.assertEqual(winner["trust_rule"], "insufficient_benchmark")
        self.assertEqual(winner["min_edge_delta"], 0.04)


if __name__ == "__main__":
    unittest.main()
