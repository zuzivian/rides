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
  assert.equal(g.find((p) => p.id === plain.id)?.nameSource, 'map');
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

// --- tiles: MVT reader, richer names, and the tile namer ---------------------
import { readTile, writeTile, tileFor, decodeGeometry } from '../src/core/mvt.js';
import { TILE_LAYERS } from '../src/core/placeguess.js';
import { nameFromTiles, TILE_Z } from '../src/ui/placenames.js';

const T = tileFor(P.lat, P.lng, 14);
/** A fixture tile around P: a POI, a house number on 9th Ave, two streets and a neighbourhood. */
function fixtureTile({ poiAt = 60 } = {}) {
  const pt = (dLat, dLng) => { const a = at(dLat, dLng); return [[[a.lng, a.lat]]]; };
  const line = (from, to) => { const a = at(...from); const b = at(...to); return [[[a.lng, a.lat], [b.lng, b.lat]]]; };
  return writeTile({
    poi: [{ type: 1, properties: { name: 'Whole Foods Market', class: 'grocery', rank: 5 }, geometry: pt(poiAt, 0) }],
    housenumber: [{ type: 1, properties: { housenumber: '1200' }, geometry: pt(5, 8) }],
    transportation_name: [
      { type: 2, properties: { name: '9th Avenue', class: 'secondary' }, geometry: line([-300, 10], [300, 10]) },
      { type: 2, properties: { name: 'Irving Street', class: 'secondary' }, geometry: line([20, -300], [20, 300]) },
    ],
    place: [{ type: 1, properties: { name: 'Inner Sunset', class: 'neighbourhood' }, geometry: pt(400, 300) }],
  }, T);
}

test('mvt: writeTile → readTile round-trips names, classes and lng/lat within a few metres', () => {
  const layers = readTile(fixtureTile(), T, TILE_LAYERS);
  assert.deepEqual(Object.keys(layers).sort(), ['housenumber', 'place', 'poi', 'transportation_name']);
  const poi = layers.poi[0];
  assert.equal(poi.properties.name, 'Whole Foods Market');
  assert.equal(poi.properties.rank, 5);
  const want = at(60, 0);
  assert.ok(Math.abs(poi.geometry[0][0][1] - want.lat) < 0.0001 && Math.abs(poi.geometry[0][0][0] - want.lng) < 0.0001);
  assert.equal(layers.transportation_name[0].geometry[0].length, 2);
  assert.deepEqual(decodeGeometry([9, 2, 4]), [[[1, 2]]]); // MoveTo(+1,+2) zigzag
});

test('pickPlaceName on a decoded tile: POI at the door > address > near POI > intersection > neighbourhood', () => {
  const feats = (bytes) => { const l = readTile(bytes, T, TILE_LAYERS); return TILE_LAYERS.flatMap((k) => toMapFeatures(l[k] || [], k)); };
  assert.equal(pickPlaceName(P.lat, P.lng, feats(fixtureTile({ poiAt: 20 })))?.name, 'Whole Foods Market');
  assert.deepEqual(pickPlaceName(P.lat, P.lng, feats(fixtureTile({ poiAt: 60 }))), { name: '1200 9th Avenue', kind: 'address', metres: 9 });
  const noHouse = feats(fixtureTile()).filter((f) => f.layer !== 'housenumber');
  assert.equal(pickPlaceName(P.lat, P.lng, noHouse)?.name, 'near Whole Foods Market');
  const streetsOnly = noHouse.filter((f) => f.layer !== 'poi');
  assert.deepEqual(pickPlaceName(P.lat, P.lng, streetsOnly), { name: '9th Avenue & Irving Street', kind: 'street', metres: 20 });
  assert.equal(pickPlaceName(P.lat, P.lng, streetsOnly.filter((f) => f.layer === 'place'))?.name, 'Inner Sunset');
});

test('priority: a map POI/address beats the export street; a map street or area does not', () => {
  const csv = readFileSync(new URL('../data/sample-trips.csv', import.meta.url), 'utf8');
  const { trips } = parseTripsCsv(csv);
  const p = clusterPlaces(trips).places.find((x) => x.nameSource === 'address');
  assert.ok(p);
  const with_ = (g) => clusterPlaces(trips, { guesses: { [p.id]: g } }).places.find((x) => x.id === p.id);
  assert.equal(with_({ name: 'Whole Foods Market', kind: 'poi' })?.name, 'Whole Foods Market');
  assert.equal(with_({ name: '1200 9th Avenue', kind: 'address' })?.nameSource, 'map');
  assert.equal(with_({ name: 'Inner Sunset', kind: 'area' })?.nameSource, 'address');
  assert.equal(with_({ name: '', kind: '', z: 14 })?.nameSource, 'address');
});

test('nameFromTiles: one request per tile, z/x/y only, cached; names flow back', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    const ok = (body, type) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
    if (url.endsWith('/styles/dark')) return ok({ version: 8, sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } } });
    if (url === 'https://tiles.openfreemap.org/planet') return ok({ tiles: ['https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'] });
    if (url === `https://tiles.openfreemap.org/planet/v1/14/${T.x}/${T.y}.pbf`) { const b = fixtureTile(); return ok(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const a = at(0, 0); const b = at(2, 3); const far = { lat: 51.5, lng: -0.12 };
  const places = [
    { id: 'c:a', lat: a.lat, lng: a.lng, nameSource: 'area' },
    { id: 'c:b', lat: b.lat, lng: b.lng, nameSource: 'address' },
    { id: 'c:far', lat: far.lat, lng: far.lng, nameSource: 'pattern' },
    { id: 'ap:SFO', lat: 37.62, lng: -122.38, nameSource: 'kind' },
    { id: 'c:nick', lat: a.lat, lng: a.lng, nameSource: 'nickname' },
  ];
  const cache = {};
  const seen = [];
  const r = await nameFromTiles(places, cache, { fetch: fakeFetch, onNames: (ids) => seen.push(...ids) });
  assert.deepEqual(r, { tiles: 2, named: 2, reason: '' });
  assert.deepEqual(seen.sort(), ['c:a', 'c:b']);
  assert.equal(cache['c:a'].name, '1200 9th Avenue');
  assert.equal(cache['c:far'], undefined, 'a failed tile records nothing, so a later visit can retry');
  assert.ok(!cache['ap:SFO'] && !cache['c:nick'], 'Home/Work/airports and nicknames are left alone');
  // Every request is to tiles.openfreemap.org and carries no coordinates.
  for (const u of urls) {
    assert.ok(u.startsWith('https://tiles.openfreemap.org/'), u);
    assert.ok(!/37\.7|122\.4|51\.5/.test(u), `no coordinates in ${u}`);
  }
  const before = urls.length;
  await nameFromTiles(places, cache, { fetch: fakeFetch, onNames: () => {} });
  assert.equal(urls.length, before, 'cached names are not fetched again');
});
