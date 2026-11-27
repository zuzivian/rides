import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, camToMapLibre } from '../src/core/mercator.js';
import { initMap, pickStyle, Basemap, MAPLIBRE_BASE, STYLE_URL, STYLES, ATTRIBUTION } from '../src/ui/basemap.js';

test('camToMapLibre: centre round-trips and zoom matches 512px tiles', () => {
  const [cx, cy] = project(-122.4194, 37.7749);
  const v = camToMapLibre({ cx, cy, z: 512 * 2 ** 12 });
  assert.ok(Math.abs(v.center[0] + 122.4194) < 1e-9);
  assert.ok(Math.abs(v.center[1] - 37.7749) < 1e-9);
  assert.ok(Math.abs(v.zoom - 12) < 1e-12);
  assert.equal(camToMapLibre({ cx: 0.5, cy: 0.5, z: 512 }).zoom, 0);
});

test('basemap: only the pinned hosts, and the required attribution', () => {
  assert.equal(MAPLIBRE_BASE, 'https://unpkg.com/maplibre-gl@4.7.1/dist/');
  for (const st of STYLES) assert.ok(st.url.startsWith('https://tiles.openfreemap.org/styles/'), st.url);
  assert.equal(STYLE_URL, 'https://tiles.openfreemap.org/styles/dark');
  for (const s of ['© OpenFreeMap', '© OpenMapTiles', '© OpenStreetMap contributors']) assert.ok(ATTRIBUTION.includes(s), s);
});

/** A tiny stand-in for maplibregl.Map: records options and lets tests fire events. */
function fakeLib() {
  const made = [];
  class Map {
    constructor(opts) { this.opts = opts; this.handlers = {}; this.removed = false; this.jumps = []; made.push(this); }
    on(ev, fn) { (this.handlers[ev] ||= []).push({ fn, once: false }); return this; }
    once(ev, fn) { (this.handlers[ev] ||= []).push({ fn, once: true }); return this; }
    fire(ev, e = {}) { const hs = this.handlers[ev] || []; this.handlers[ev] = hs.filter((h) => !h.once); hs.forEach((h) => h.fn(e)); }
    remove() { this.removed = true; }
    jumpTo(v) { this.jumps.push(v); }
    redraw() {}
    resize() {}
  }
  return { lib: { Map }, made };
}
const CAM = { cx: 0.5, cy: 0.5, z: 512 * 2 ** 10 };

test('initMap: resolves the map after load + idle, with no interaction and no default attribution', async () => {
  const { lib, made } = fakeLib();
  const p = initMap(lib, /** @type {any} */ ({}), STYLE_URL, CAM, 1000);
  const m = made[0];
  assert.equal(m.opts.style, STYLE_URL);
  assert.equal(m.opts.interactive, false);
  assert.equal(m.opts.attributionControl, false);
  assert.equal(m.opts.zoom, 10);
  m.fire('load'); m.fire('idle');
  assert.deepEqual(await p, { map: m, reason: '' });
  // Errors after the first draw are swallowed, not a fallback.
  m.fire('error', { error: new Error('tile 404') });
  assert.equal(m.removed, false);
});

test('initMap: an error before the first draw falls back (null) and removes the map', async () => {
  const { lib, made } = fakeLib();
  const p = initMap(lib, /** @type {any} */ ({}), STYLE_URL, CAM, 1000);
  made[0].fire('error', { error: Object.assign(new Error('Not Found'), { status: 404 }) });
  assert.deepEqual(await p, { map: null, reason: 'style error: HTTP 404 Not Found' });
  assert.equal(made[0].removed, true);
});

test('initMap: times out to null when tiles never arrive', async () => {
  const { lib, made } = fakeLib();
  const t0 = Date.now();
  const p = initMap(lib, /** @type {any} */ ({}), STYLE_URL, CAM, 60);
  made[0].fire('load'); // style loaded, but never idle
  assert.deepEqual(await p, { map: null, reason: 'timed out after 0 s waiting for tiles' });
  assert.ok(Date.now() - t0 >= 55);
  assert.equal(made[0].removed, true);
});

test('initMap: a throwing constructor falls back to null', async () => {
  const lib = { Map: class { constructor() { throw new Error('no WebGL'); } } };
  assert.deepEqual(await initMap(lib, /** @type {any} */ ({}), STYLE_URL, CAM, 1000), { map: null, reason: "map couldn't start: no WebGL" });
});

test('Basemap.sync: follows the camera, skipping unchanged frames', () => {
  const { lib } = fakeLib();
  const map = new lib.Map({});
  const b = new Basemap(map, /** @type {any} */ ({ remove() {} }));
  b.sync(CAM); b.sync(CAM); b.sync({ ...CAM, z: CAM.z * 2 });
  assert.equal(map.jumps.length, 2);
  assert.equal(map.jumps[1].zoom, 11);
});

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const STYLE = { version: 8, sources: { openmaptiles: {} }, layers: [] };

test('pickStyle: dark when served', async () => {
  const r = await pickStyle(async (url) => res(200, STYLE));
  assert.equal(r.style?.id, 'dark');
});

test('pickStyle: a 404 on dark falls through to positron (inverted)', async () => {
  const r = await pickStyle(async (url) => (url.endsWith('/dark') ? res(404, null) : res(200, STYLE)));
  assert.equal(r.style?.id, 'positron');
  assert.equal(r.style?.invert, true);
});

test('pickStyle: reasons for every failure', async () => {
  assert.equal((await pickStyle(async () => res(404, null))).reason, 'no usable style (dark 404, positron 404)');
  assert.equal((await pickStyle(async () => res(200, { hello: 1 }))).reason, "no usable style (dark isn't a map style, positron isn't a map style)");
  assert.equal((await pickStyle(async () => { throw new TypeError('Failed to fetch'); })).reason, 'style request blocked or failed (tiles.openfreemap.org, dark)');
  const slow = await pickStyle((url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), 30);
  assert.equal(slow.reason, 'style request timed out (dark)');
});
