# AGENTS.md

A guide for anyone, human or agent, working in this repo.

## What this is

Rides is a client-only web app that parses a person's own Uber or Lyft export and shows stats, a map and a share card. The README covers the product and the privacy model. Read it first.

## Hard rules

1. **No network calls with user data.** No server, no analytics, no remote fonts. The CSP in `index.html` enforces this. The only third-party requests allowed are for the optional basemap: the MapLibre script and stylesheet (see rule 3) and the style, tiles, glyphs and sprites from `tiles.openfreemap.org`. Tile URLs carry tile numbers for the area on screen, never ride data.
2. **Never commit real ride data.** Use `data/sample-trips.csv` (synthetic, generated) or files under `private/` (git-ignored).
3. **No runtime dependencies from CDNs, with one exception.** If a library is needed, vendor a pinned copy into `public/vendor/` with its licence. The exception is MapLibre GL, loaded lazily from `https://unpkg.com/maplibre-gl@4.7.1/` (exact version, see `DECISIONS.md`). The map must keep working without it. `npm run build` fails on any other remote script, stylesheet or CSP host.
4. **`src/core/` stays pure.** It has no DOM, no `fetch`, no `localStorage` and no Node APIs, so it runs in the browser, in `node --test`, and can be ported to Swift one file at a time.

## Layout

```
index.html            app shell (CSP lives here)
src/core/             pure logic: parsing and stats (port this to Swift)
  csv.js              CSV reader/writer
  time.js             timestamp parsing and zone maths (Intl only)
  geo.js              distances, airports, metros, zone guesses
  parse.js            export → Trip[]; header-alias detection; ParseError
  places.js           cluster endpoints into named places (Home/Work/airports)
  stats.js            computeStats(trips, {names, unit}) → everything the UI shows
  format.js           number, money and date formatting
  types.js            JSDoc typedefs (Trip, ParseResult)
  email.js            .eml/.mbox → MIME → receipt text → Trip[] (Uber/Lyft heuristics)
  story.js            rider type (rule-based personality) and real-world distance comparisons
  mercator.js         Web Mercator, arc control points, Bézier split, robust bounds
  placeguess.js       name a place from nearby map labels (POIs, neighbourhoods)
src/ui/               DOM: main.js (controller), views.js (HTML), map.js (canvas map + replay), basemap.js (optional MapLibre basemap), story.js (full-screen story), scene.js (arc scenes),
                      visuals.js (SVG globe/dials/clock/calendar/etc.), card.js (share card PNG),
                      motion.js (count-ups, reveals, tooltip), store.js (localStorage), styles.css
data/sample-trips.csv synthetic rider, about 300 trips, May 2025 – Oct 2026
scripts/              gen-sample, serve (static dev server), build (copy and verify)
test/                 node:test suites and fixtures
```

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (port 5173, `--port N` to change) |
| Unit tests | `npm test` |
| Type check | `npm run typecheck` (JSDoc via `tsc`; CI uses `npx -p typescript@5.9.3`) |
| Build | `npm run build` (writes `dist/`, fails on broken references or remote scripts) |
| Serve the build | `npm run preview` |
| Regenerate sample | `npm run sample` (deterministic; CI checks it matches the committed file) |
| Basemap check (Playwright, fallback + wiring with a stub) | `npm run build && node scripts/check-basemap.cjs` |
| Everything | `npm run check` |

There are no npm dependencies, so there's no `npm install`.

## Checking UI changes

Use Playwright (preinstalled in the cloud environment; `require('playwright')`). Serve the app, load it at **390×844** and **1280×800**, click "Try with sample data" (the story opens; add `?sample&nostory` to the URL to skip it), fail on any console error, and save screenshots to `docs/screenshots/`. Also check with `reducedMotion: 'reduce'`.

## Conventions

- Plain ES modules with JSDoc types. There's no bundler on purpose.
- Stats wording is plain and specific. Say "rides on your account", never imply complete coverage.
- Times: exports mix UTC and local timestamps. Every `Trip` carries `tz` (guessed from coordinates). Local-time stats always use the trip's zone, never the machine's.
- Commits: one vertical slice per PR, CI green before merge.
