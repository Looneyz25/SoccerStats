import contextlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import soccer_backtest_confidence_filter as confidence_filter
import soccer_backtest_walkforward as walkforward
import soccer_backtest_winner_models as winner_models


def synthetic_match(match_id, odds, date="2026-04-22", hg=2, ag=1):
    return {
        "id": match_id,
        "league": "Test League",
        "date": date,
        "time": "12:00",
        "h_id": "home-team",
        "a_id": "away-team",
        "h_name": "Home",
        "a_name": "Away",
        "hg": hg,
        "ag": ag,
        "odds": odds,
        "cards_total": 6,
    }


def deterministic_probs(_state, _match, *_args):
    return {"home": 0.6, "draw": 0.25, "away": 0.15}


@contextlib.contextmanager
def deterministic_winner_models(**overrides):
    names = (
        "model_status_quo",
        "model_elo_two_way_with_draw",
        "model_elo_strong",
        "model_elo_max",
        "model_opp_adj_form",
        "model_logistic_elo_book",
    )
    with contextlib.ExitStack() as stack:
        for name in names:
            replacement = overrides.get(name, deterministic_probs)
            stack.enter_context(mock.patch.object(winner_models, name, side_effect=replacement))
        yield


class BookmakerOddsValidationTests(unittest.TestCase):
    def test_accepts_complete_decimal_1x2_market(self):
        probs = winner_models.no_vig_probs({"home": 2.0, "draw": 4.0, "away": 4.0})

        self.assertEqual(probs, {"home": 0.5, "draw": 0.25, "away": 0.25})

    def test_rejects_missing_non_finite_non_numeric_and_sentinel_odds(self):
        invalid = [
            None,
            {"home": 2.0, "draw": 3.0},
            {"home": 1.0, "draw": 1.0, "away": 1.0},
            {"home": 2.0, "draw": math.inf, "away": 3.0},
            {"home": "2.0", "draw": 3.0, "away": 4.0},
        ]

        for odds in invalid:
            with self.subTest(odds=odds):
                self.assertIsNone(winner_models.no_vig_probs(odds))

    def test_bookmaker_model_does_not_substitute_uniform_probabilities(self):
        self.assertIsNone(winner_models.model_bookmaker_only({"no_vig": None}, {}))


class WinnerLeaderboardRunTests(unittest.TestCase):
    def test_invalid_odds_are_filtered_equally_and_still_update_form(self):
        captured_home_attack = []

        def capture_status(state, _match):
            captured_home_attack.append(state["h_att"])
            return deterministic_probs(state, _match)

        matches = [
            synthetic_match("missing", None, hg=3, ag=0),
            synthetic_match("incomplete", {"home": 2.0, "draw": 3.0}, hg=2, ag=0),
            synthetic_match("sentinel", {"home": 1.0, "draw": 1.0, "away": 1.0}, hg=1, ag=0),
            synthetic_match("valid", {"home": 2.0, "draw": 3.5, "away": 4.0}),
        ]

        with tempfile.TemporaryDirectory() as tmp, deterministic_winner_models(
            model_status_quo=capture_status
        ):
            output = Path(tmp) / "winner.json"
            report = winner_models.run(matches=matches, out_path=output)
            emitted = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(captured_home_attack, [2.0])
        self.assertEqual(report, emitted)
        self.assertEqual(report["evaluated"], 4)
        self.assertEqual(report["valid_odds_candidates"], 1)
        self.assertEqual(report["skipped_invalid_or_missing_1x2_odds"], 3)
        self.assertEqual(report["common_scored_matches"], 1)
        self.assertEqual(report["paired_matches"], 1)
        self.assertEqual(report["paired_comparison"]["n"], 1)
        self.assertTrue(all(row["n"] == 1 for row in report["models"].values()))

    def test_model_failure_skips_the_row_atomically(self):
        def fail_second(state, match):
            if match["id"] == "second":
                raise RuntimeError("injected failure")
            return deterministic_probs(state, match)

        matches = [
            synthetic_match("first", {"home": 2.0, "draw": 3.5, "away": 4.0}),
            synthetic_match("second", {"home": 2.1, "draw": 3.4, "away": 3.8}),
        ]

        with tempfile.TemporaryDirectory() as tmp, deterministic_winner_models(
            model_elo_strong=fail_second
        ):
            report = winner_models.run(
                matches=matches,
                out_path=Path(tmp) / "winner.json",
            )

        self.assertEqual(report["evaluated"], 2)
        self.assertEqual(report["valid_odds_candidates"], 2)
        self.assertEqual(report["skipped_incomplete_model_rows"], 1)
        self.assertEqual(report["common_scored_matches"], 1)
        self.assertEqual(report["paired_matches"], report["paired_comparison"]["n"])
        self.assertTrue(all(row["n"] == 1 for row in report["models"].values()))

    def test_paired_bootstrap_is_deterministic(self):
        rows = [
            {
                "model": {"hit_rate": 0.0, "log_loss": 1.2, "brier": 0.8},
                "bookmaker": {"hit_rate": 1.0, "log_loss": 0.8, "brier": 0.5},
            },
            {
                "model": {"hit_rate": 1.0, "log_loss": 0.9, "brier": 0.6},
                "bookmaker": {"hit_rate": 1.0, "log_loss": 0.7, "brier": 0.4},
            },
        ]

        first = winner_models.paired_bootstrap_differences(rows, samples=200, seed=7)
        second = winner_models.paired_bootstrap_differences(rows, samples=200, seed=7)

        self.assertEqual(first, second)
        self.assertEqual(first["n"], 2)
        self.assertEqual(
            first["differences_model_minus_bookmaker"]["log_loss"]["estimate"],
            0.3,
        )


class WalkForwardAggregateBoundaryTests(unittest.TestCase):
    def test_only_winner_buckets_use_full_multiclass_brier(self):
        store = {
            "leagues": [{
                "name": "Test League",
                "matches": [{
                    "id": "one",
                    "status": "FT",
                    "date": "2026-04-22",
                    "time": "12:00",
                    "home": {"team_id": "home-team", "name": "Home", "goals": 2},
                    "away": {"team_id": "away-team", "name": "Away", "goals": 1},
                    "odds": {"home": 2.0, "draw": 3.5, "away": 4.0},
                    "actuals": {"cards_total": 6},
                }],
            }],
        }
        prediction = {
            "winner": {
                "type": "home",
                "pick": "Home",
                "probability": 0.6,
                "probabilities": {"home": 0.6, "draw": 0.3, "away": 0.1},
            },
            "btts": {"pick": "Yes", "probability": 0.7},
            "ou_goals": {"pick": "Over", "line": 2.5, "probability": 0.8},
            "ou_cards": {"pick": "Over", "line": 4.5, "over_probability": 0.65},
        }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "match_data.json").write_text(json.dumps(store), encoding="utf-8")
            outputs = root / "outputs"
            with (
                mock.patch.object(walkforward, "ROOT", root),
                mock.patch.object(walkforward, "OUT_DIR", outputs),
                mock.patch.object(walkforward, "SUMMARY_PATH", outputs / "summary.json"),
                mock.patch.object(walkforward, "MD_PATH", outputs / "summary.md"),
                mock.patch.object(walkforward, "ROWS_PATH", outputs / "rows.csv"),
                mock.patch.object(walkforward.sr, "predict_enhanced", return_value=prediction),
            ):
                summary = walkforward.run(start_date="2026-04-22")

        self.assertEqual(summary["by_market"]["Winner"]["brier"], 0.26)
        self.assertEqual(summary["by_league_market"]["Test League"]["Winner"]["brier"], 0.26)
        self.assertEqual(summary["overall"]["brier"], 0.1031)
        self.assertEqual(summary["by_league"]["Test League"]["brier"], 0.1031)


class ConfidenceFilterRunTests(unittest.TestCase):
    def test_invalid_odds_reduce_only_with_odds_and_all_rows_advance_chronology(self):
        matches = [
            synthetic_match("missing", None),
            synthetic_match("incomplete", {"home": 2.0, "draw": 3.0}),
            synthetic_match("nonfinite", {"home": 2.0, "draw": math.inf, "away": 3.0}),
            synthetic_match("sentinel", {"home": 1.0, "draw": 1.0, "away": 1.0}),
            synthetic_match("valid", {"home": 2.0, "draw": 3.5, "away": 4.0}),
        ]

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(
            confidence_filter,
            "update_elo",
            wraps=confidence_filter.update_elo,
        ) as update:
            report = confidence_filter.run(
                matches=matches,
                out_path=Path(tmp) / "confidence.json",
            )

        self.assertEqual(report["evaluated"], 5)
        self.assertEqual(report["with_odds"], 1)
        self.assertEqual([call.args[1]["id"] for call in update.call_args_list], [m["id"] for m in matches])


if __name__ == "__main__":
    unittest.main()
