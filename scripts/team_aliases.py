"""Shared national-team name aliases for cross-provider matching.

Our SofaScore store, Flashscore, LiveScore, Sportsbet and the bookmaker link feeds
sometimes name the same national side differently (e.g. "Cabo Verde" vs "Cape
Verde"). When the names don't reconcile, a fixture silently loses its result
settlement or its odds. Add a synonym here once and it applies everywhere:

- settlement result discovery   -> soccer_routine.team_names_match
- Sportsbet odds matching        -> soccer_fetch_sportsbet.names_match / find_match
- direct bookmaker link matching -> soccer_fetch_bookmaker_links.names_match

Keys and values are in the normalized form every matcher's norm()/team_norm()
produces: NFKD-folded to ASCII, lowercased, with all non-alphanumerics removed.
Matching is bidirectional in every consumer, so direction here is irrelevant.
Keep tokens long and distinctive to avoid accidental substring collisions.
"""

NATIONAL_TEAM_ALIASES = {
    "cotedivoire": "ivorycoast",      # Sportsbet/Flashscore/LiveScore use "Ivory Coast"
    "caboverde": "capeverde",         # Sportsbet uses "Cape Verde"
    "czechrepublic": "czechia",       # feeds use "Czech Republic"; SofaScore "Czechia"
    "korearepublic": "southkorea",    # FIFA "Korea Republic" vs feeds "South Korea"
    "unitedstates": "usa",            # ESPN uses "United States"; Sportsbet "USA"
}

# Club names where Sportsbet differs from our store (Sportsbet form first). Applied by the
# odds matchers: Sportsbet markets, phase-2 1X2 and direct bookmaker links. An unmatched
# name silently drops every market for that fixture. Values are norm() output, which drops
# non-ASCII letters such as ø and æ (København -> kbenhavn).
CLUB_TEAM_ALIASES = {
    "sportinglisbon": "sportingcp",
    "parisstg": "parissaintgermain",
    "olympiakos": "olympiacos",
    "redbullsalzburg": "rbsalzburg",
    "jagielloniabialystock": "jagielloniabialystok",
    "koln": "cologne",
    "hamburgersv": "hamburgsv",
    "hearts": "heartofmidlothian",
    "crvenazvezda": "redstarbelgrade",
    "interclubescaldes": "interdescaldes",
    "nordsjaelland": "nordsjlland",
    "universitateacraiova": "csucraiova",
    "copenhagen": "kbenhavn",
    "cambuurleeuwarden": "sccambuur",
    "newyorkredbulls": "redbullnewyork",
    "jefunitedchiba": "jefunitedichiharachiba",
    "qpr": "queensparkrangers",
    "sheffunited": "sheffieldunited",
    "mkdons": "miltonkeynesdons",
    "hamkam": "hamarkameratene",
}

# Aliases too short to use as substrings ("LAFC" normalizes to "la", which occurs inside
# "atlantaunited"); matchers compare these only on whole normalized names.
EXACT_TEAM_ALIASES = {
    "losangeles": "la",
}
