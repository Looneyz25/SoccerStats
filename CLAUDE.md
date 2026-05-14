# Soccer Stats — Project Instructions

## ⚠️ Active app is Next.js + Tailwind, NOT `index.html`

The frontend lives in [app/page.jsx](app/page.jsx) (App Router) with Tailwind styling. Make all UI changes there.

**Do NOT edit `index.html`** for UI/UX work. It is the legacy static GitHub Pages dashboard; the Next.js app has replaced it.

The Python pipeline (`scripts/soccer_routine.py` Phase C) still splices `DATA_SOCCER` into `index.html` and the data file `match_data.json` is consumed by the Next.js app at runtime. Leave `index.html` and the splicer alone.

## Where to make changes

| Task | File / area |
|---|---|
| UI / layout / styles | [app/page.jsx](app/page.jsx), [app/globals.css](app/globals.css), [app/layout.jsx](app/layout.jsx) |
| Data pipeline / settlement / forecasts | [scripts/soccer_routine.py](scripts/soccer_routine.py) |
| Match data source of truth | [match_data.json](match_data.json) (auto-generated) |
| PWA assets | [public/](public/) (manifest, icons) |

## Deploy

Next.js app — confirm the deploy target before adding routes (static export vs server). Hash routes are safer for static export.
