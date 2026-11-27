# Roadmap

## Phase 1: web prototype (now)

Ships as five small slices, each its own PR:

1. **Core.** Scaffold, tolerant Uber/Lyft CSV parsers, stats module, synthetic sample data, tests, CI.
2. **Stats UI.** Mobile-first stats screens: totals that count up, records, top routes, heatmap, months, years, price trend, product mix, place renaming.
3. **Map.** Every trip as an arc, brightness weighted by frequency. A "replay my year" animation with a date ticker. Click a place to see its stats.
4. **Share card.** A 1080×1920 "my year in rides" PNG rendered client-side, with a mini map. No names or addresses unless the user opts in to nicknames.
   - Done: optional MapLibre GL basemap (OpenFreeMap dark style) under the arc layer, loaded from unpkg at runtime with the canvas map as fallback. See `DECISIONS.md`. Next: add an SRI hash or vendor the library.
5. **Receipt import.** Parse Uber/Lyft receipt emails (`.eml`, `.mbox`) in the browser and merge them with export data without duplicates.

## Phase 2: email import by forwarding address

- A per-user forwarding address (for example `you@in.rides.app`) that accepts receipt emails.
- **Privacy design first:** emails are parsed on arrival, only the structured trip fields are kept, and the raw message is deleted right away. The parsed trips are encrypted to a key held on the user's device, so the server stores ciphertext only. Include a one-tap way to delete everything.
- Reuse `src/core/` parsers server-side so parsing stays identical across platforms.
- Sender verification (DKIM) so random mail can't inject trips.

## Phase 3: share card polish

- Several card layouts (year, single city, a single trip), and light/dark variants.
- Animated card (short video) for stories.
- A "redact" pass: snap map endpoints to a coarse grid on the card so home locations can't be read off it.

## Phase 4: SwiftUI iPhone app with MapKit

- Port `src/core/` to a Swift package (`RidesCore`): `Trip` struct, CSV parser, zone handling with `TimeZone`, clustering, `computeStats`. Port the tests too, and run them on the same `sample-trips.csv` so web and iOS agree to the cent.
- MapKit for the map: `MKPolyline` geodesic arcs, a custom overlay renderer for frequency-weighted glow, and a replay driven by `TimelineView`.
- Import through the Files app and a Share extension (share the export zip or a receipt email straight to Rides).
- All data stays in the app's sandbox (SwiftData), with optional iCloud sync through the user's own private database.
- Share card rendered with `ImageRenderer`, and widgets for "rides this month".
