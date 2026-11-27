# Decisions

## 2026-11: MapLibre basemap loaded from unpkg at runtime

**Decision.** The optional basemap uses MapLibre GL 4.7.1, loaded lazily from `https://unpkg.com/maplibre-gl@4.7.1/dist/`, with the OpenFreeMap dark style from `https://tiles.openfreemap.org`. Nat chose this ("option B") over vendoring a copy into `public/vendor/`, and approved changing AGENTS.md rules 1 and 3 to allow it.

**Why.** The agent's build environment can't reach npm, jsDelivr or unpkg, so it couldn't vendor the files, and there was no other approved way to fetch them.

**No SRI hash.** The `<script>` tag has no `integrity` attribute, because the agent couldn't download the file to hash it. What limits the risk instead:
- The exact version is pinned in the URL and in the CSP path (`script-src https://unpkg.com/maplibre-gl@4.7.1/`), so no other unpkg path can run.
- The library loads only when the map mounts, and the app works without it.
- Requests go out with no referrer.
- `npm run build` fails if any other remote script, stylesheet or CSP host appears.

**Follow-up.** Add an SRI hash once someone can fetch the file (`openssl dgst -sha384 -binary maplibre-gl.js | openssl base64 -A`), or vendor it into `public/vendor/maplibre-gl/` and drop unpkg from the CSP.

**Privacy.** Only map style, tiles, glyphs and sprites are requested from tiles.openfreemap.org. Those requests reveal the map area being viewed, never ride data. Ride coordinates are never put in a URL.

**Fallback.** The canvas map runs on its own, exactly as before, in any of these cases: the script, the style or the first tiles don't load within 6 seconds; any error occurs before the first full draw; the browser is offline; or `?nobasemap` is in the URL.

**Live map unverified by the agent.** The agent couldn't reach either host from its container. The real basemap has to be checked on the Vercel preview.

## 2026-11: Basemap style fallback and a visible status line

**Problem.** On the live site Nat saw no street map, and nobody could load the live site from a sandbox to find out why.

**Likely cause, fixed.** `maplibre-gl.css` loads after our stylesheet and sets `.maplibregl-map { position: relative }`. That rule is quoted from memory of MapLibre 4's stylesheet, because the agent couldn't fetch it to confirm. That beat our single-class `.basemap-gl { position: absolute; inset: 0 }`, so the map container was 0 px tall. MapLibre still fired `load` and `idle`, so the app switched to basemap mode and cleared its own background, but drew the map at zero height. `scripts/check-basemap.cjs` now serves that exact rule and asserts the map fills the stage. It failed before the fix and passes after it. `startBasemap` also falls back if the container has no size.

**Style id unconfirmed.** The agent couldn't reach openfreemap.org to confirm that `styles/dark` exists. The app now fetches the style first. If `dark` doesn't return a valid style, it tries `positron`, a documented light style, and shows it inverted. The reason is reported either way.

**Status line.** Under the map: "Street map: on (OpenFreeMap dark)", or "Street map: off: <reason>". The reasons are the script being blocked or timing out, a style HTTP status, a CSP directive, a tile error, a timeout, or the container having no size.
