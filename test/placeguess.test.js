import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickPlaceName, toMapFeatures, POI_RADIUS_M } from '../src/core/placeguess.js';
import { clusterPlaces } from '../src/core/places.js';
import { parseTripsCsv } from '../src/core/parse.js';
import { computeStats } from '../src/core/stats.js';

// Offsets in degrees at SF's latitude: 0.0009° lat ≈ 100 m.
const P = { lat: 37.7650, lng: -122.4200 };
const at = (dLatM, dLngM) => ({ lat: P.lat + dLatM / 111_000, lng: P.lng + dLngM / 88_000 });

/** Fixture tile features, as MapLibre's querySourceFeatures returns them. */
const raw = (layer, name, dLatM, dLngM, props = {}) => {
  const p = at(dLatM, dLngM);
  return { layer, f: { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name, ...props } } };
};
const feats = (...rs) => [
  ...toMapFeatures(rs.filter((r) => r.layer === 'poi').map((r) => r.f), 'poi'),
  ...toMapFeatures(rs.filter((r) => r.layer === 'place').map((r) => r.f), 'place'),
];

test('pickPlaceName: closest prominent POI within the radius, as "near …"', () => {
  const f = feats(
    raw('poi', 'Whole Foods Market', 60, 0, { class: 'grocery', rank: 5 }),
    raw('poi', 'Tiny Cafe', 50, 10, { class: 'cafe', rank: 40 }),
    raw('poi', 'Far Gym', 400, 0, { class: 'fitness' }),
    raw('place', 'Mission District', 300, 200, { class: 'neighbourhood' }),
  );
  const g = pickPlaceName(P.lat, P.lng, f);
  assert.equal(g?.kind, 'poi');
  assert.equal(g?.name, 'near Whole Foods Market'); // rank breaks the near-tie with the closer, minor cafe
});

test('pickPlaceName: a POI right at the spot is named plainly', () => {
  const g = pickPlaceName(P.lat, P.lng, feats(raw('poi', 'Equinox', 10, 5, { class: 'fitness', rank: 10 })));
  assert.deepEqual(g, { name: 'Equinox', kind: 'poi', metres: 11 });
});

test('pickPlaceName: neighbourhood when no POI is close; vague POIs and towns too far are ignored', () => {
  const f = feats(
    raw('poi', 'Muni stop', 20, 0, { class: 'bus' }),
    raw('poi', 'Faraway Bakery', POI_RADIUS_M + 60, 0, { class: 'bakery' }),
    raw('place', 'Wicker Park', 700, -300, { class: 'neighbourhood' }),
    raw('place', 'San Francisco', 1500, 0, { class: 'city' }),
  );
  assert.deepEqual(pickPlaceName(P.lat, P.lng, f), { name: 'Wicker Park', kind: 'area', metres: 763 });
});

test('pickPlaceName: nothing named nearby → null; English names preferred', () => {
  assert.equal(pickPlaceName(P.lat, P.lng, feats(raw('place', 'Somewhere', 9000, 0, { class: 'suburb' }))), null);
  assert.equal(pickPlaceName(P.lat, P.lng, []), null);
  const f = feats(raw('poi', '東京タワー', 10, 0, { name_en: 'Tokyo Tower', class: 'attraction' }));
  assert.equal(pickPlaceName(P.lat, P.lng, f)?.name, 'Tokyo Tower');
});

test('toMapFeatures: skips non-points and unnamed features', () => {
  const out = toMapFeatures([
    { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Road' } },
    { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
    { geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'Ok', class: 'cafe', rank: 3 } },
  ], 'poi');
  assert.deepEqual(out, [{ layer: 'poi', name: 'Ok', cls: 'cafe', rank: 3, lng: 1, lat: 2 }]);
});

test('guesses name address-less places; addresses, Home/Work and nicknames still win', () => {
  const csv = readFileSync(new URL('../data/sample-trips.csv', import.meta.url), 'utf8');
  const { trips } = parseTripsCsv(csv);
  const bare = trips.map((t) => ({ ...t, fromAddress: '', toAddress: '' }));
  const base = clusterPlaces(bare).places;
  const plain = base.find((p) => p.nameSource === 'pattern' || p.nameSource === 'area');
  const home = base.find((p) => p.kind === 'home');
  assert.ok(plain && home);
  const guesses = { [plain.id]: 'near Whole Foods', [home.id]: 'Should not win' };
  const g = clusterPlaces(bare, { guesses }).places;
  assert.equal(g.find((p) => p.id === plain.id)?.name, 'near Whole Foods');
  assert.equal(g.find((p) => p.id === plain.id)?.nameSource, 'guess');
  assert.equal(g.find((p) => p.id === home.id)?.name, 'Home');
  const nick = clusterPlaces(bare, { guesses, names: { [plain.id]: 'Groceries' } }).places.find((p) => p.id === plain.id);
  assert.equal(nick?.name, 'Groceries');
  assert.equal(nick?.nameSource, 'nickname');
  // With addresses, the street name beats a guess.
  const withAddr = clusterPlaces(trips).places.find((p) => p.nameSource === 'address');
  assert.ok(withAddr);
  assert.equal(clusterPlaces(trips, { guesses: { [withAddr.id]: 'Guess' } }).places.find((p) => p.id === withAddr.id)?.nameSource, 'address');
});

test('basemap off (no guesses): distance/direction fallback, and guessed names flow into routes', () => {
  const csv = readFileSync(new URL('../data/sample-trips.csv', import.meta.url), 'utf8');
  const bare = parseTripsCsv(csv).trips.map((t) => ({ ...t, fromAddress: '', toAddress: '' }));
  const off = computeStats(bare, { unit: 'mi' });
  assert.ok(off?.places.some((p) => / of Home$/.test(p.name)));
  const target = off?.routes.find((r) => !/^(Home|Work)$/.test(r.toName))?.to;
  assert.ok(target);
  const on = computeStats(bare, { unit: 'mi', guesses: { [/** @type {string} */ (target)]: 'Mission District' } });
  assert.ok(on?.routes.some((r) => r.toName === 'Mission District' || r.fromName === 'Mission District'));
});
