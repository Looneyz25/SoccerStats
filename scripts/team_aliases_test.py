import unittest

import soccer_routine as sr
import soccer_fetch_sportsbet as sb
import soccer_fetch_bookmaker_links as bl
from team_aliases import NATIONAL_TEAM_ALIASES


# Each pair is (our SofaScore store name, a provider's name) that must reconcile.
SYNONYM_PAIRS = [
    ("Côte d'Ivoire", "Ivory Coast"),
    ("Cabo Verde", "Cape Verde"),
    ("Czechia", "Czech Republic"),
    ("South Korea", "Korea Republic"),
]


class NationalTeamAliasTests(unittest.TestCase):
    def test_shared_map_applied_to_every_matcher(self):
        # The shared national aliases must be merged into all three matcher maps.
        for key, value in NATIONAL_TEAM_ALIASES.items():
            self.assertEqual(sr.TEAM_ALIASES.get(key), value)
            self.assertEqual(sb.ABBREV.get(key), value)
            self.assertEqual(bl.ABBREV.get(key), value)

    def test_settlement_matcher_reconciles_synonyms(self):
        for ours, theirs in SYNONYM_PAIRS:
            self.assertTrue(sr.team_names_match(ours, theirs), f"settlement: {ours} ~ {theirs}")
            self.assertTrue(sr.team_names_match(theirs, ours), f"settlement (rev): {ours} ~ {theirs}")

    def test_sportsbet_matcher_reconciles_synonyms(self):
        for ours, theirs in SYNONYM_PAIRS:
            self.assertTrue(sb.names_match(ours, theirs), f"sportsbet: {ours} ~ {theirs}")
            self.assertTrue(sb.names_match(theirs, ours), f"sportsbet (rev): {ours} ~ {theirs}")

    def test_bookmaker_matcher_reconciles_synonyms(self):
        for ours, theirs in SYNONYM_PAIRS:
            self.assertTrue(bl.names_match(ours, theirs), f"bookmaker: {ours} ~ {theirs}")
            self.assertTrue(bl.names_match(theirs, ours), f"bookmaker (rev): {ours} ~ {theirs}")

    def test_no_false_positive_against_real_opponent(self):
        self.assertFalse(sr.team_names_match("Spain", "Cape Verde"))
        self.assertFalse(sb.names_match("Spain", "Cape Verde"))
        self.assertFalse(bl.names_match("Spain", "Cape Verde"))


if __name__ == "__main__":
    unittest.main()
