# SoccerStats

Soccer stats, fixture, odds, and prediction dashboard.

## Live Site

The dashboard is designed to stay on the same GitHub Pages URL:

https://looneyz25.github.io/SoccerStats/

GitHub Pages should use the `Deploy Next.js Dashboard` workflow. That workflow builds the static Next.js export and publishes the `out/` folder.

## Frontend

- `app/` - Next.js dashboard
- `public/data/` - generated static JSON data, created during build
- `next.config.js` - static export config for GitHub Pages
- `.github/workflows/deploy-pages.yml` - builds and deploys the static site

Build locally:

```powershell
npm.cmd install --cache .\.npm-cache
npm.cmd run build --cache .\.npm-cache
```

## Data Pipeline

- `scripts/soccer_phase1_fixtures.py` - Phase 1 fixture slate and Excel handoff
- `scripts/soccer_routine.py` - daily data routine
- `scripts/soccer_prepare_next_data.py` - copies JSON into `public/data/` for the static frontend
- `match_data.json` - current app data
- `predictions_*.json` - dated snapshots

## Legacy Files

- `Soccer_Stats_Dashboard.xlsx` - source workbook
- `PL_Matchday_*.xlsx` - matchday fixtures
- `PL_Round*_Preview_*.xlsx` - matchday previews
- `PL_Round*_Cards_*.xlsx` - match cards
- `PL_Predictions_vs_Outcomes.xlsx` - prediction accuracy tracker
- `Match_Card_Template.xlsx` - blank match card template
