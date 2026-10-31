import unittest

import soccer_routine as sr
import soccer_fetch_sportsbet as sb
import soccer_fetch_bookmaker_links as bl
import soccer_phase2_odds as p2
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


# (our store name, Sportsbet name) pairs observed unmatched on 2026-10-31.
CLUB_PAIRS = [
    ("Sporting CP", "Sporting Lisbon"), ("Paris Saint-Germain", "Paris St-G"),
    ("Olympiacos", "Olympiakos"), ("RB Salzburg", "Red Bull Salzburg"),
    ("Jagiellonia Bialystok", "Jagiellonia Bialystock"), ("FC Cologne", "FC Koln"),
    ("Hamburg SV", "Hamburger SV"), ("Heart of Midlothian", "Hearts"),
    ("Red Star Belgrade", "Crvena Zvezda"), ("Inter D'Escaldes", "Inter Club Escaldes"),
    ("FC Nordsjælland", "FC Nordsjaelland"), ("CSU Craiova", "Universitatea Craiova"),
    ("F.C. København", "FC Copenhagen"), ("SC Cambuur", "Cambuur Leeuwarden"),
    ("Red Bull New York", "New York Red Bulls"), ("JEF United Ichihara-Chiba", "Jef Utd Chiba"),
    ("Queens Park Rangers", "QPR"), ("Sheffield United", "Sheff Utd"),
    ("Milton Keynes Dons", "MK Dons"), ("Hamarkameratene", "Ham-Kam"), ("LAFC", "Los Angeles FC"),
]


class ClubAliasTests(unittest.TestCase):
    def test_odds_matchers_reconcile_sportsbet_club_names(self):
        for ours, theirs in CLUB_PAIRS:
            for a, b in ((ours, theirs), (theirs, ours)):
                self.assertTrue(sb.names_match(a, b), f"sportsbet: {a} ~ {b}")
                self.assertTrue(sb.quick_bet_names_match(a, b), f"quick bets: {a} ~ {b}")
                self.assertGreaterEqual(p2.names_match(a, b)[0], 0.6, f"phase2: {a} ~ {b}")

    def test_short_exact_alias_is_not_used_as_a_substring(self):
        self.assertFalse(sb.quick_bet_names_match("Los Angeles FC", "LA Galaxy"))
        self.assertEqual(p2.names_match("Los Angeles FC", "Atlanta Utd")[0], 0.0)
        self.assertEqual(p2.names_match("Los Angeles FC", "LA Galaxy")[0], 0.0)
