---
name: ui-polish
description: UI/UX design and polish for the Looneyz Predictions soccer-stats dashboard (index.html). Use when the user asks to redesign, polish, refine, modernize, restyle, or critique the UI/UX, or wants visual hierarchy, motion, data viz, or component-level work on match cards, score blocks, odds rows, prediction cards, streak tables, summary bars, or the master-detail layout.
---

# UI Polish — Looneyz Predictions

This skill owns visual and interaction design for `index.html`. The page is a single-file SofaScore-inspired dark dashboard with a master-detail layout: matches list on the left, detail card on the right.

## Before changing anything

1. **Ask scope first** when the user says vague things like "polish" or "looks basic". Offer the six axes below and pick one or two — do not redesign the whole page in one pass.
2. **Open the page in a browser** (`start "" index.html` on Windows) and look at the live render before editing. CSS changes that read fine in the diff often break alignment in the layout.
3. **Respect the data**: most of the file's 340KB is inline embedded data. Never rewrite the file end-to-end — edit the `<style>` block and targeted markup only.

## The six polish axes

When the user asks for polish, identify which of these they actually mean:

1. **Hierarchy & density** — typographic scale, spacing rhythm, what the eye lands on first
2. **Motion** — transitions, skeleton loaders, state-change animations, micro-interactions
3. **Data viz** — sparklines, donut charts, bars (form, goal distribution, H2H) replacing text-only stats
4. **Surface treatment** — shadows, glassmorphism, accent gradients on hero cards
5. **Branding** — header, league crests, hero imagery, logo treatment
6. **Information architecture** — section reordering, sticky pick summary, tabs, comparison view

Confirm one or two before implementing.

## Design system (current canon)

Source of truth is the `:root` block at the top of `index.html`. Keep additions consistent.

### Color tokens

| Token | Value | Use |
|---|---|---|
| `--sofa-bg` | `#14181f` | Page background |
| `--sofa-bg-2` | `#1a1f2e` | Side panels, main card surface |
| `--sofa-panel` | `#242938` | Inner cards (odd-card, pred, stat-cell) |
| `--sofa-line` | `#3a4055` | All borders, dividers |
| `--sofa-accent` | `#2eb360` | Primary green — wins, hits, brand dot |
| `--sofa-text` | `#fff` | Primary text |
| `--sofa-muted` | `#9aa3b2` | Secondary text, labels |
| `--sofa-hit` | `#2eb360` | Correct prediction |
| `--sofa-miss` | `#e5444b` | Wrong prediction |
| `--sofa-pend` | `#f2a93b` | Pending / draw / odds emphasis |
| `--sofa-blue` | `#3478f6` | Upcoming, neutral pick state |

Translucent variants follow the pattern `rgba(46,179,96,.18)` for backgrounds and `.10`–`.25` for emphasis layers. Don't hardcode new hexes — extend `:root` if you need a new role.

### Typography

- Family: `IBM Plex Sans` body, `IBM Plex Mono` for tabular numbers (already loaded from Google Fonts)
- Numbers in odds, scores, and stats should use `font-variant-numeric: tabular-nums` so they don't jitter
- Eyebrow/label pattern: `font-size:11–13px; text-transform:uppercase; letter-spacing:.5–1px; color:var(--sofa-muted)`
- Display numbers (scoreline, summary `.v`): `font-weight:800` and `letter-spacing:1px`

### Surfaces

- Outer panels: `border-radius:12px`, `1px solid var(--sofa-line)`
- Inner cards: `border-radius:8px`
- Pills/chips: `border-radius:999px` (status badges, who-tags, results pills)
- Hero card uses a top-down gradient `linear-gradient(180deg,#1c2233 0%,#1a1f2e 100%)` — match this for any new "elevated" surface

### Motion

The current file has almost no motion. Safe defaults to add:

- Hover transitions: `transition: background .15s ease, border-color .15s ease, transform .15s ease`
- Card lift on hover: `transform: translateY(-1px)` plus a subtle accent border
- Active match row already uses border-color change — keep that idiom
- Skeleton shimmer: `@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }` with `background: linear-gradient(90deg, var(--sofa-panel) 0%, var(--sofa-line) 50%, var(--sofa-panel) 100%); background-size:200% 100%`

Never add motion that delays the user reading scores or picks.

## Anti-patterns to flag and avoid

- **Don't introduce a "favourite" outline on odds cards.** Line 90 of `index.html` is an explicit rule comment: `no "favourite" outline highlights anywhere — odds boxes show value only`. Respect it.
- **Don't replace the green/red/amber/blue semantic colors** with a new palette. They map to hit/miss/pending/upcoming and the user reads them at a glance.
- **Don't add gray-on-gray text.** The `--sofa-muted` token at `#9aa3b2` against `--sofa-panel` at `#242938` is the floor — don't push lower.
- **Don't break tabular alignment** in odds rows or streak tables by switching off `tabular-nums` for "design" reasons.
- **Light theme exists** via `[data-theme="light"]` on `<html>`, toggled by `#themeToggle` in the header and persisted in `localStorage` under `looneyz-theme`. Initial value follows `prefers-color-scheme`. When adding new surface colors, extend the token alias list (`--sofa-header-bg`, `--sofa-hero-bg`, `--sofa-tint`, `--sofa-tint-strong`, `--sofa-pulse-ring`, `--sofa-summary-tint`, `--sofa-panel-2`) instead of hardcoding hex/rgba — both themes must override the token.
- **Don't introduce a new font family.** IBM Plex is the canon.
- **Don't add emoji glyphs as decoration** in the markup — the existing icon idiom is the colored dot/pill, not emoji.
- **Don't add framework dependencies.** This is one HTML file with vanilla CSS/JS. No Tailwind, no React, no chart libs unless the user explicitly asks.

## Polish recipes

### Hierarchy pass

- Increase scoreline weight contrast: hero scoreline is already 48/800 — make `.team-block .name` 22/700 if it feels weak
- Tighten card stack rhythm: `.section` padding `22px` is tight; bump to `26px 22px` for breathing room without changing the grid
- Pull the summary bar's headline number forward with a thin accent underline using `border-bottom:2px solid var(--sofa-accent)` on `.sum-card.primary`

### Motion pass

- Add `transition: all .2s ease` to `.match-row`, `.odd-card`, `.pred`, `.stat-cell`
- On `.match-row:hover`, add `transform: translateX(2px)` so the row visibly responds to selection intent
- Fade in the detail card on selection with a 150ms opacity+translateY transition

### Data viz pass

When replacing text stats with viz, prefer inline SVG over a chart lib:

- Form strip: 5 colored squares (win/draw/loss) at 16×16, gap 4px
- Goal distribution: horizontal bar with two segments (home/away) using `--sofa-blue` and `--sofa-miss`
- H2H donut: SVG `circle` with `stroke-dasharray` — three arcs in hit/pend/miss colors

Keep viz under 60px tall in stat cells; the page is dense.

### Surface pass

- Add `box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 4px 12px rgba(0,0,0,.25)` to the hero card for depth
- Subtle accent gradient on the active `.match-row`: `background: linear-gradient(90deg, rgba(46,179,96,.10) 0%, var(--sofa-panel) 40%)`
- Replace flat `.odd-card` borders with a gradient border using the `border-image` trick only on the picked outcome — but only if the user asks for "favourite"-style emphasis (see anti-patterns)

## Workflow

1. **Confirm scope** — which of the six axes, and which sections (hero, list, odds, preds, streaks, summary)
2. **Read the relevant CSS rules** before editing (use offset/limit on `index.html` — file is 978 lines but token-heavy)
3. **Edit only the `<style>` block and targeted markup** via the Edit tool
4. **Open the file in the browser and verify** — describe what you see; don't claim "looks great" without looking
5. **Check responsive at 720px and 420px breakpoints** — the file has explicit rules for both, your changes need to respect them
6. **Show before/after** by describing the visual change in one or two sentences when reporting back

## Quick visual audit checklist

When asked "what should we polish?", scan for these:

- [ ] Are eyebrows/labels visually distinct from values? (case, weight, color)
- [ ] Is the hit/miss/pending color system used consistently in every state?
- [ ] Does any number in a row use proportional digits instead of tabular?
- [ ] Are there any hover states that don't transition smoothly?
- [ ] Is the active match row visually anchored (not just border color)?
- [ ] Does the hero card feel elevated above the sections below it?
- [ ] Are the streak tables readable at 720px width?
- [ ] Is there any decorative element that adds noise without info?
