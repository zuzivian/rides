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

## 26 Nov 2026: Name every place from its OpenFreeMap tile, automatically

**Decision (Nat, 26 Nov 2026, relayed by Sinny, verbatim):** "just show the exact places. the user has exported the data, so trust them to know what youre doing". After places are computed, the app fetches the z14 tile containing each place that has no nickname and isn't Home, Work or an airport. It decodes the tile on the device (`src/core/mvt.js`, a small pure MVT reader) and names the place with `pickPlaceName` (`src/core/placeguess.js`):
1. a POI within 40 m ("Whole Foods Market");
2. a house number within 25 m on the nearest street ("1200 9th Avenue");
3. a POI within 120 m ("near Whole Foods Market");
4. an intersection or street ("9th Avenue & Irving Street");
5. the neighbourhood ("Inner Sunset").

A POI or address beats the export's street name; a street or neighbourhood doesn't. Nicknames win, as always. Names are shown plainly, with no "~". The distance fallback ("0.5 mi NW of Home") is used only when a tile has no usable name.

**Privacy.** Requests go only to tiles.openfreemap.org and carry only `z/x/y` (checked in unit tests and in the Playwright `names` case). The tile host learns which roughly 2 km tiles are involved, with the user's IP, which can include the tiles around Home and Work. The README says this, and the app shows: "Place names come from OpenFreeMap map tiles for the areas you ride in; your rides never leave your device." AGENTS.md rule 1 is amended to allow it.

**Caching.** Decoded tiles are cached in memory for the page, one request per tile. Names are cached in localStorage (`rides.guesses.v1`: `{name, kind, z}` per place id, with no coordinates), so repeat visits make no tile requests. "Looked, nothing here" is stored as an empty name, and a failed request is retried on a later visit.

**Superseded:** the on-screen-only approach below, which read labels via `querySourceFeatures`. It was removed because the tile fetch covers every place.

## 2026-11: Guess place names from map labels, using tiles already on screen

**Decision.** Places without an address are named from OpenMapTiles `poi` and `place` labels near their centre. The closest prominent POI within 120 m gives "near Whole Foods", or "Whole Foods" within 30 m. Otherwise the closest neighbourhood or suburb label within its reach gives "Mission District". The features come from `map.querySourceFeatures`, which reads only tiles MapLibre already loaded for the view. Guesses are made from z11 up, and a guess read at a higher zoom replaces one read lower down.

**Privacy.** This adds no network requests, so the tile host learns nothing beyond the areas the user looks at. The cache (`rides.guesses.v1` in localStorage) holds `{name, z}` per place id. Ids are the same rounded centroids nicknames already use, so it stores no new coordinates.

**Not done: fetching tiles to name every place.** Fetching the z14 tile around each place up front would name everything at once. It would also tell the tile host, along with the user's IP, which roughly 2 km tiles they ride to, Home and Work included, without their looking there. That conflicts with AGENTS.md rule 1 ("tile numbers for the area on screen"). It's waiting for Nat's decision on an explicit "Guess names for all places" button.

**Priority.** Nickname, then Home/Work/airport, then street address, then map-label guess, then pattern and distance ("Late nights · 2.5 mi E of Home"). When the basemap is off, nothing changes from before.
