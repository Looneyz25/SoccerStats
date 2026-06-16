import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const ESPN_LEAGUE_SLUGS = {
  'FIFA World Cup': 'fifa.world',
  'International Friendly Games': 'fifa.friendly',
  'Premier League': 'eng.1',
  'Championship': 'eng.2',
  'League One': 'eng.3',
  'League Two': 'eng.4',
  'LaLiga': 'esp.1',
  'Bundesliga': 'ger.1',
  'Serie A': 'ita.1',
  'Ligue 1': 'fra.1',
  'Eredivisie': 'ned.1',
  'Primeira Liga': 'por.1',
  'A-League Men': 'aus.1',
  'Scottish Premiership': 'sco.1',
  'J1 League': 'jpn.1',
  'UEFA Champions League': 'uefa.champions',
  'UEFA Europa League': 'uefa.europa',
  'UEFA Conference League': 'uefa.europa.conf',
  'MLS': 'usa.1',
  'Brasileirão Betano': 'bra.1',
  'CONMEBOL Libertadores': 'conmebol.libertadores',
  'Allsvenskan': 'swe.1',
  'Eliteserien': 'nor.1',
};

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  const tokA = na.split(' ').filter((t) => t.length > 2);
  const tokB = new Set(nb.split(' ').filter((t) => t.length > 2));
  const overlap = tokA.filter((t) => tokB.has(t)).length;
  return overlap >= Math.min(2, Math.min(tokA.length, tokB.size));
}

async function espnFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function competitorStat(competitor, statName) {
  for (const stat of (competitor?.statistics) || []) {
    if (stat.name === statName) {
      const v = parseFloat(stat.displayValue);
      return isNaN(v) ? stat.displayValue : v;
    }
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const home = searchParams.get('home') || '';
  const away = searchParams.get('away') || '';
  const date = searchParams.get('date') || '';
  const league = searchParams.get('league') || '';

  const slug = ESPN_LEAGUE_SLUGS[league];
  if (!slug) {
    return NextResponse.json({ found: false, reason: 'league_not_mapped' });
  }

  const scoreboard = await espnFetch(`${ESPN_BASE}/${slug}/scoreboard`);
  if (!scoreboard) {
    return NextResponse.json({ found: false, reason: 'scoreboard_fetch_failed' });
  }

  let matchedEvent = null;
  for (const event of scoreboard.events || []) {
    const comp = (event.competitions || [{}])[0];
    const competitors = comp.competitors || [];
    const homeComp = competitors.find((c) => c.homeAway === 'home') || {};
    const awayComp = competitors.find((c) => c.homeAway === 'away') || {};
    const homeTeam = homeComp.team?.displayName || homeComp.team?.name || '';
    const awayTeam = awayComp.team?.displayName || awayComp.team?.name || '';
    const eventDate = (event.date || '').slice(0, 10);
    const dateClose = !date || Math.abs(new Date(eventDate) - new Date(date)) <= 86400 * 2 * 1000;
    if (dateClose && namesMatch(home, homeTeam) && namesMatch(away, awayTeam)) {
      matchedEvent = { event, comp, homeComp, awayComp };
      break;
    }
  }

  if (!matchedEvent) {
    return NextResponse.json({ found: false, reason: 'event_not_found' });
  }

  const { event, homeComp, awayComp } = matchedEvent;
  const eventId = event.id;
  const statusType = (event.status || {}).type || {};
  const state = statusType.state;
  const completed = !!statusType.completed;

  const summary = await espnFetch(`${ESPN_BASE}/${slug}/summary?event=${eventId}`);

  const boxscoreTeams = summary?.boxscore?.teams || [];
  const bsHome = boxscoreTeams.find((t) => (t.homeAway || '').toLowerCase() === 'home') || null;
  const bsAway = boxscoreTeams.find((t) => (t.homeAway || '').toLowerCase() === 'away') || null;

  const stats =
    bsHome && bsAway
      ? {
          possession: {
            home: competitorStat(bsHome, 'possessionPct'),
            away: competitorStat(bsAway, 'possessionPct'),
          },
          shots: {
            home: competitorStat(bsHome, 'totalShots'),
            away: competitorStat(bsAway, 'totalShots'),
          },
          shotsOnTarget: {
            home: competitorStat(bsHome, 'shotsOnTarget'),
            away: competitorStat(bsAway, 'shotsOnTarget'),
          },
          corners: {
            home: competitorStat(bsHome, 'wonCorners'),
            away: competitorStat(bsAway, 'wonCorners'),
          },
          fouls: {
            home: competitorStat(bsHome, 'foulsCommitted'),
            away: competitorStat(bsAway, 'foulsCommitted'),
          },
          yellowCards: {
            home: competitorStat(bsHome, 'yellowCards'),
            away: competitorStat(bsAway, 'yellowCards'),
          },
          redCards: {
            home: competitorStat(bsHome, 'redCards'),
            away: competitorStat(bsAway, 'redCards'),
          },
          saves: {
            home: competitorStat(bsHome, 'saves'),
            away: competitorStat(bsAway, 'saves'),
          },
          offsides: {
            home: competitorStat(bsHome, 'offsides'),
            away: competitorStat(bsAway, 'offsides'),
          },
        }
      : null;

  const plays = summary?.keyEvents || summary?.scoringPlays || [];
  const keyEvents = plays
    .map((p) => ({
      type: p.type?.text || p.type?.id || '',
      clock: p.clock?.displayValue || p.period?.displayValue || '',
      text: p.text || p.shortText || '',
      team: p.team?.displayName || p.team?.name || '',
      participant: p.participants?.[0]?.athlete?.displayName || '',
    }))
    .filter((e) => e.text || e.participant);

  const h2h = (summary?.headToHeadGames || []).slice(0, 5).map((g) => ({
    date: (g.date || '').slice(0, 10),
    homeTeam: g.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'home')?.team?.displayName || '',
    awayTeam: g.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'away')?.team?.displayName || '',
    homeScore: g.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'home')?.score,
    awayScore: g.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'away')?.score,
  }));

  const lastFiveHome = (summary?.lastFiveGames || [])
    .filter((g) => {
      const comps = g.competitions?.[0]?.competitors || [];
      return comps.some((c) => namesMatch(c.team?.displayName || '', home));
    })
    .slice(0, 5)
    .map((g) => {
      const comps = g.competitions?.[0]?.competitors || [];
      const myComp = comps.find((c) => namesMatch(c.team?.displayName || '', home));
      const won = myComp?.winner === true;
      const drew = !myComp?.winner && comps.every((c) => !c.winner);
      return { result: won ? 'W' : drew ? 'D' : 'L', score: `${myComp?.score ?? '?'}` };
    });

  const lastFiveAway = (summary?.lastFiveGames || [])
    .filter((g) => {
      const comps = g.competitions?.[0]?.competitors || [];
      return comps.some((c) => namesMatch(c.team?.displayName || '', away));
    })
    .slice(0, 5)
    .map((g) => {
      const comps = g.competitions?.[0]?.competitors || [];
      const myComp = comps.find((c) => namesMatch(c.team?.displayName || '', away));
      const won = myComp?.winner === true;
      const drew = !myComp?.winner && comps.every((c) => !c.winner);
      return { result: won ? 'W' : drew ? 'D' : 'L', score: `${myComp?.score ?? '?'}` };
    });

  return NextResponse.json({
    found: true,
    state,
    completed,
    eventId,
    homeName: homeComp.team?.displayName || homeComp.team?.name || home,
    awayName: awayComp.team?.displayName || awayComp.team?.name || away,
    stats,
    keyEvents,
    h2h,
    lastFiveHome,
    lastFiveAway,
  });
}
