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
