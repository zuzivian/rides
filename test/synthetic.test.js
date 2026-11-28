// Generated (synthetic) ride data in many export shapes: parsers, merging,
// place naming and the manual-ride flow. Deterministic: a seeded PRNG, no
// real data, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/core/csv.js';
import { parseTripsCsv, parseMoney, mergeTrips, ParseError } from '../src/core/parse.js';
import { parseTimestamp, localParts, zonedToUtc } from '../src/core/time.js';
import { computeStats } from '../src/core/stats.js';
import { clusterPlaces, shortAddress } from '../src/core/places.js';
import { pickPlaceName, toMapFeatures, TILE_LAYERS } from '../src/core/placeguess.js';
import { readTile, writeTile, tileFor } from '../src/core/mvt.js';
import { makeManualTrip, commuteTrips, readManual, estimate } from '../src/core/manual.js';
import { haversineKm } from '../src/core/geo.js';

/** Mulberry32: small, fast, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const LA = 'America/Los_Angeles';
const SPOTS = [
  { lat: 37.7599, lng: -122.4148, addr: '3000 24th St, San Francisco, CA 94110, US' },
  { lat: 37.7898, lng: -122.3942, addr: '415 Mission St, San Francisco, CA 94105, US' },
  { lat: 37.7765, lng: -122.4172, addr: '1355 Market St, San Francisco, CA 94103, US' },
  { lat: 37.8024, lng: -122.4058, addr: '1 Telegraph Hill Blvd, San Francisco, CA 94133, US' },
  { lat: 37.6152, lng: -122.3900, addr: 'San Francisco International Airport (SFO), San Francisco, CA 94128, US' },
];

/** Synthetic rides between the spots, with ground truth. */
function synthRides(n, seed) {
  const r = rng(seed);
  const out = [];
  let t = Date.UTC(2025, 4, 1, 15);
  for (let i = 0; i < n; i++) {
    t += Math.round((6 + r() * 60) * 3600e3);
    const a = SPOTS[Math.floor(r() * SPOTS.length)];
    let b = SPOTS[Math.floor(r() * SPOTS.length)];
    if (b === a) b = SPOTS[(SPOTS.indexOf(a) + 1) % SPOTS.length];
    const jit = () => (r() - 0.5) * 0.0008; // ±45 m
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.3;
    out.push({ start: t, mins: 8 + Math.round(km * 2.4), from: { ...a, lat: a.lat + jit(), lng: a.lng + jit() }, to: { ...b, lat: b.lat + jit(), lng: b.lng + jit() }, km, fare: Math.round((6 + km * 2.1) * 100) / 100, canceled: r() < 0.05 });
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000 UTC');
/** Wall clock in LA as "MM/DD/YYYY h:mm AM". */
const usWall = (ms) => { const p = localParts(ms, LA); const h = p.hour % 12 || 12; return `${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')}/${p.year} ${h}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`; };

/** Uber-style export (UTC timestamps, miles). */
function uberCsv(rides) {
  const rows = [['City', 'Product Type', 'Trip or Order Status', 'Request Time', 'Begin Trip Time', 'Begin Trip Lat', 'Begin Trip Lng', 'Begin Trip Address', 'Dropoff Time', 'Dropoff Lat', 'Dropoff Lng', 'Dropoff Address', 'Distance (miles)', 'Fare Amount', 'Fare Currency']];
  for (const x of rides) rows.push(['San Francisco', 'UberX', x.canceled ? 'CANCELED' : 'COMPLETED', iso(x.start - 300e3), iso(x.start), String(x.from.lat), String(x.from.lng), x.from.addr, iso(x.start + x.mins * 60e3), String(x.to.lat), String(x.to.lng), x.to.addr, (x.km / 1.609344).toFixed(2), x.fare.toFixed(2), 'USD']);
  return toCsv(rows);
}
/** Lyft-style export (local wall times, $ amounts, title row, shuffled column order). */
function lyftCsv(rides) {
  const head = ['Ride Status', 'Fare', 'Pickup Location', 'Dropoff Location', 'Requested At', 'Distance', 'Ride Type'];
  const rows = [['Lyft ride history'], head];
  for (const x of rides) rows.push([x.canceled ? 'Canceled' : 'Completed', `$${x.fare.toFixed(2)}`, x.from.addr, x.to.addr, usWall(x.start), `${(x.km / 1.609344).toFixed(1)} mi`, 'lyft_standard']);
  return toCsv(rows);
}

test('synthetic: CSV writer/reader round-trips random cells (quotes, commas, newlines, unicode)', () => {
  const r = rng(7);
  const alphabet = ['a', 'Z', ' ', ',', '"', '\n', '\r\n', ';', 'é', '東', '😀', '0', '-', '\t'];
  for (let k = 0; k < 50; k++) {
    const rows = Array.from({ length: 1 + Math.floor(r() * 6) }, () => Array.from({ length: 1 + Math.floor(r() * 5) }, () => Array.from({ length: Math.floor(r() * 8) }, () => alphabet[Math.floor(r() * alphabet.length)]).join('') || 'x'));
    const width = rows[0].length; for (const row of rows) while (row.length < width) row.push('x');
    assert.deepEqual(parseCsv(toCsv(rows)), rows, `case ${k}`);
  }
});

test('regression: Uber\'s "Trip or Order Status" column is found, so canceled rides are skipped', () => {
  const rides = synthRides(40, 99);
  const r = parseTripsCsv(uberCsv(rides));
  assert.ok(rides.some((x) => x.canceled));
  assert.equal(r.skipped.canceled, rides.filter((x) => x.canceled).length);
  assert.equal(r.source, 'uber');
});

test('synthetic: Uber-style export parses to the ground truth', () => {
  const rides = synthRides(120, 1);
  const { trips, skipped } = parseTripsCsv(uberCsv(rides));
  const done = rides.filter((x) => !x.canceled);
  assert.equal(trips.length, done.length);
  assert.equal(skipped.canceled, rides.length - done.length);
  trips.forEach((t, i) => {
    const x = done[i];
    assert.equal(t.start, Math.floor(x.start / 1000) * 1000);
    assert.equal(t.tz, LA);
    assert.ok(Math.abs((t.km ?? 0) - x.km) < 0.02, `km ${t.km} vs ${x.km}`);
    assert.equal(t.fare, x.fare);
    assert.equal(t.currency, 'USD');
  });
});

test('synthetic: Lyft-style export (local times, $ fares, title row) matches the same rides', () => {
  const rides = synthRides(80, 2);
  // No coordinates in a Lyft export, so wall times use the rider's zone (here LA).
  const { trips, source } = parseTripsCsv(lyftCsv(rides), { defaultTz: LA });
  assert.equal(source, 'lyft');
  const done = rides.filter((x) => !x.canceled);
  assert.equal(trips.length, done.length);
  trips.forEach((t, i) => {
    const want = Math.floor(done[i].start / 60000) * 60000; // minute precision in the export
    assert.equal(t.start, want, `ride ${i}`);
    assert.equal(t.fare, done[i].fare);
    assert.equal(t.product, 'Lyft');
  });
});

test('synthetic: the same rides from Uber + Lyft files merge to one copy each', () => {
  const rides = synthRides(60, 3).filter((x) => !x.canceled);
  const a = parseTripsCsv(uberCsv(rides)).trips;
  const b = parseTripsCsv(lyftCsv(rides), { defaultTz: LA }).trips;
  const merged = mergeTrips([b, a]);
  assert.equal(merged.length, rides.length);
  // The copy with coordinates fills gaps either way round.
  assert.ok(merged.every((t) => t.fromLat != null));
});

test('synthetic: timestamps in every supported shape agree on the instant', () => {
  const r = rng(11);
  for (let k = 0; k < 40; k++) {
    const ms = Date.UTC(2024 + Math.floor(r() * 3), Math.floor(r() * 12), 1 + Math.floor(r() * 28), Math.floor(r() * 24), Math.floor(r() * 60));
    const p = localParts(ms, LA);
    const pad = (n) => String(n).padStart(2, '0');
    const shapes = [
      iso(ms),
      new Date(ms).toISOString(),
      String(ms / 1000),
      String(ms),
    ];
    for (const s of shapes) assert.equal(/** @type {any} */ (parseTimestamp(s)).ms, ms, s);
    const wall = /** @type {any} */ (parseTimestamp(`${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`)).wall;
    assert.equal(zonedToUtc(wall, LA), ms);
    const us = /** @type {any} */ (parseTimestamp(usWall(ms))).wall;
    assert.equal(zonedToUtc(us, LA), ms);
  }
});

test('synthetic: money strings in many locales', () => {
  const r = rng(5);
  for (let k = 0; k < 60; k++) {
    const v = Math.round(r() * 500000) / 100;
    const [int, dec] = v.toFixed(2).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const eu = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    assert.deepEqual(parseMoney(`$${grouped}.${dec}`), { amount: v, currency: 'USD' });
    assert.deepEqual(parseMoney(`${eu},${dec} €`), { amount: v, currency: 'EUR' });
    assert.deepEqual(parseMoney(`GBP ${grouped}.${dec}`), { amount: v, currency: 'GBP' });
  }
  assert.deepEqual(parseMoney(''), { amount: null, currency: '' });
  assert.deepEqual(parseMoney('free'), { amount: null, currency: '' });
});

test('synthetic: headers in any case/punctuation, junk rows and a non-ride file', () => {
  const rides = synthRides(10, 9).filter((x) => !x.canceled);
  const shouty = uberCsv(rides).replace(/^[^\n]+/, (h) => h.toUpperCase().replace(/ /g, '_'));
  assert.equal(parseTripsCsv(shouty).trips.length, rides.length);
  const withJunk = `${uberCsv(rides)}\n,,,,,,,,,,,,,,\nnot,a,ride\n`;
  assert.equal(parseTripsCsv(withJunk).trips.length, rides.length);
  assert.throws(() => parseTripsCsv('name,email\nA,b@example.com\n'), ParseError);
});

test('synthetic: places cluster the jittered pickups back to the five spots, named by street', () => {
  const rides = synthRides(200, 4);
  const { trips } = parseTripsCsv(uberCsv(rides));
  const { places } = clusterPlaces(trips);
  assert.equal(places.length, SPOTS.length);
  assert.ok(places.some((p) => p.kind === 'airport' && p.autoName === 'SFO'));
  const streets = places.filter((p) => p.nameSource === 'address' || p.kind !== 'airport').map((p) => p.autoName);
  for (const s of ['24th St', 'Mission St', 'Market St', 'Telegraph Hill Blvd']) assert.ok(streets.some((n) => n === s || n === 'Home' || n === 'Work'), `${s} in ${streets}`);
  assert.equal(shortAddress(SPOTS[3].addr), 'Telegraph Hill Blvd');
});

test('synthetic: stats totals equal the ground truth sums', () => {
  const rides = synthRides(150, 8).filter((x) => !x.canceled);
  const s = computeStats(parseTripsCsv(uberCsv(rides)).trips, { unit: 'km' });
  assert.equal(s?.count, rides.length);
  const km = rides.reduce((t, x) => t + x.km, 0);
  assert.ok(Math.abs((s?.km ?? 0) - km) < rides.length * 0.01, `km ${s?.km} vs ${km}`);
  const fare = Math.round(rides.reduce((t, x) => t + x.fare, 0) * 100) / 100;
  assert.equal(Math.round((s?.spend[0].total ?? 0) * 100) / 100, fare);
});

// --- placeguess on generated tiles -------------------------------------------

test('synthetic: random POIs in a generated tile; the pick is always the best-scoring candidate', () => {
  const r = rng(21);
  const P = { lat: 37.7700, lng: -122.4300 };
  const T = tileFor(P.lat, P.lng, 14);
  for (let k = 0; k < 25; k++) {
    const pois = Array.from({ length: 12 }, (_, i) => {
      const d = 5 + r() * 200; const a = r() * Math.PI * 2;
      return { name: `Place ${k}-${i}`, rank: Math.floor(r() * 60), lat: P.lat + (Math.sin(a) * d) / 111_000, lng: P.lng + (Math.cos(a) * d) / 88_000 };
    });
    const bytes = writeTile({ poi: pois.map((p) => ({ type: 1, properties: { name: p.name, class: 'shop', rank: p.rank }, geometry: [[[p.lng, p.lat]]] })) }, T);
    const layers = readTile(bytes, T, TILE_LAYERS);
    const feats = TILE_LAYERS.flatMap((l) => toMapFeatures(layers[l] || [], l));
    assert.equal(feats.length, pois.length);
    const g = pickPlaceName(P.lat, P.lng, feats);
    const cands = pois.map((p) => ({ ...p, d: haversineKm(P.lat, P.lng, p.lat, p.lng) * 1000 })).filter((p) => p.d <= 120);
    if (!cands.length) { assert.equal(g, null); continue; }
    const exact = cands.filter((p) => p.d <= 30);
    const pool = exact.length ? cands : cands; // exact ones also compete on score
    const best = pool.reduce((b, p) => (p.d + Math.min(p.rank, 60) * 1.5 < b.d + Math.min(b.rank, 60) * 1.5 ? p : b));
    assert.equal(g?.name, best.name, `case ${k}`);
    assert.equal(g?.kind, 'poi');
  }
});

test('synthetic: polygons and unnamed features in a tile are ignored', () => {
  const P = { lat: 40.73, lng: -73.99 };
  const T = tileFor(P.lat, P.lng, 14);
  const sq = (d) => [[[P.lng - d, P.lat - d], [P.lng + d, P.lat - d], [P.lng + d, P.lat + d], [P.lng - d, P.lat + d]]];
  const bytes = writeTile({
    poi: [{ type: /** @type {any} */ (3), properties: { name: 'Big Park' }, geometry: sq(0.0005) }, { type: 1, properties: { class: 'cafe' }, geometry: [[[P.lng, P.lat]]] }],
    place: [{ type: 1, properties: { name: 'Greenwich Village', class: 'neighbourhood' }, geometry: [[[P.lng + 0.004, P.lat]]] }],
  }, T);
  const layers = readTile(bytes, T, TILE_LAYERS);
  const feats = TILE_LAYERS.flatMap((l) => toMapFeatures(layers[l] || [], l));
  assert.deepEqual(pickPlaceName(P.lat, P.lng, feats)?.name, 'Greenwich Village');
});

// --- manual rides ------------------------------------------------------------

test('synthetic: manual rides between random points: estimates scale with distance, ids are stable', () => {
  const r = rng(31);
  let prev = 0;
  const lens = [];
  for (let k = 0; k < 30; k++) {
    const a = { lat: 37.7 + r() * 0.1, lng: -122.5 + r() * 0.1 };
    const b = { lat: 37.7 + r() * 0.1, lng: -122.5 + r() * 0.1 };
    const start = Date.UTC(2026, 9, 1 + k, 18);
    const t = makeManualTrip({ from: a, to: b, start });
    const line = haversineKm(a.lat, a.lng, b.lat, b.lng);
    assert.ok(Math.abs((t.km ?? 0) - line * 1.3) < 1e-9);
    assert.equal((t.end ?? 0) - t.start, estimate(line).minutes * 60000);
    assert.deepEqual(makeManualTrip({ from: a, to: b, start }), t, 'same input → same trip');
    lens.push([line, estimate(line).minutes]);
    prev = t.start;
  }
  lens.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < lens.length; i++) assert.ok(lens[i][1] >= lens[i - 1][1], 'time never shrinks with distance');
  assert.ok(prev > 0);
});

test('synthetic: commute over many weeks and weekday sets, in several zones', () => {
  const zones = [
    { tz: LA, home: { lat: 37.76, lng: -122.41 }, work: { lat: 37.79, lng: -122.39 } },
    { tz: 'Europe/London', home: { lat: 51.53, lng: -0.1 }, work: { lat: 51.51, lng: -0.09 } },
    { tz: 'Asia/Tokyo', home: { lat: 35.66, lng: 139.7 }, work: { lat: 35.68, lng: 139.76 } },
  ];
  const r = rng(41);
  for (const z of zones) {
    for (let k = 0; k < 6; k++) {
      const weeks = 1 + Math.floor(r() * 12);
      const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.6);
      if (!weekdays.length) weekdays.push(2);
      const now = Date.UTC(2026, 10, 1 + Math.floor(r() * 25), Math.floor(r() * 24));
      const trips = commuteTrips({ home: z.home, work: z.work, now, weeks, weekdays });
      assert.ok(trips.every((t) => t.start <= now && t.tz === z.tz && weekdays.includes(localParts(t.start, z.tz).weekday)));
      assert.ok(trips.length <= (weeks + 1) * weekdays.length * 2);
      assert.equal(new Set(trips.map((t) => t.id)).size, trips.length);
      assert.deepEqual(readManual(JSON.parse(JSON.stringify(trips))), trips, 'storage round-trip');
    }
  }
});

test('synthetic: readManual survives tampered storage', () => {
  const good = makeManualTrip({ from: SPOTS[0], to: SPOTS[1], start: Date.UTC(2026, 10, 2, 17) });
  const r = rng(51);
  const keys = Object.keys(good);
  for (let k = 0; k < 40; k++) {
    const bad = { ...good, [keys[Math.floor(r() * keys.length)]]: [null, 'x', -1, {}, [], 1e308, '<script>'][Math.floor(r() * 7)] };
    const out = readManual([bad]);
    assert.ok(out.length <= 1);
    for (const t of out) {
      assert.equal(t.source, 'manual');
      assert.ok(Number.isFinite(t.start) && Number.isFinite(t.km));
      assert.ok(t.fare == null || (Number.isFinite(t.fare) && t.fare >= 0));
    }
  }
});

test('synthetic: manual rides plus an import of the same rides count once', () => {
  const rides = synthRides(30, 61).filter((x) => !x.canceled);
  const manual = rides.slice(0, 10).map((x) => makeManualTrip({ from: x.from, to: x.to, start: x.start + 60e3 }));
  const imported = parseTripsCsv(uberCsv(rides)).trips;
  const merged = mergeTrips([imported, manual]);
  assert.equal(merged.length, rides.length);
  assert.ok(merged.every((t) => t.source !== 'manual'), 'the imported copy wins');
});
