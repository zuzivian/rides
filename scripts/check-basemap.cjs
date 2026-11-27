#!/usr/bin/env node
// Basemap check (Playwright). Serves dist/, loads the sample at 390 and 1280,
// and checks three cases:
//   blocked  unpkg and tiles.openfreemap.org are blocked → canvas fallback, attribution hidden
//   tiles    the library loads (a stub at the real unpkg URL) but the style fetch fails → fallback
//   wired    the dark style is served and the stub map reports load + idle → basemap mode: canvas
//            cleared, attribution shown, the map fills the stage, and it follows the camera
//   nodark   /styles/dark is a 404 → falls back to positron, shown inverted
// Each case also checks the "Street map: …" status line under the map.
//   names    the sample with addresses removed; OpenFreeMap tile requests are answered with
//            fixture MVT tiles holding a POI at a few places → those places are named
//            "Stub Market N" in Places and Routes, tile URLs carry only z/x/y, each tile is
//            fetched once, and the localStorage cache holds names only
// Saves docs/screenshots/place-names-{390,1280}.png for the names case.
// The stub is not MapLibre and draws nothing. It checks our wiring and the CSP, not the real map.
// Fails on any console error except the browser's own "Failed to load resource" line for a blocked host.
// Usage: npm run build && node scripts/check-basemap.cjs [--reduced]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reduced = process.argv.includes('--reduced');
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const port = 5280 + Math.floor(Math.random() * 100);
const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/';
const TILES = 'https://tiles.openfreemap.org/';

const STYLE_JSON = JSON.stringify({ version: 8, name: 'stub', sources: {}, layers: [] });
const stub = (mode) => `window.maplibregl = { Map: class {
  constructor(o) { this.o = o; this.h = {}; window.__stub = { opts: o, jumps: [] }; o.container.classList.add('maplibregl-map');
    setTimeout(() => ${mode === 'wired'
    ? "{ this.emit('load'); setTimeout(() => this.emit('idle'), 50); }"
    : "this.emit('error', { error: new Error('stub: should not get here') })"}, 50); }
  on(e, f) { (this.h[e] ||= []).push(f); return this; }
  once(e, f) { const g = (x) => { this.h[e] = this.h[e].filter((k) => k !== g); f(x); }; return this.on(e, g); }
  emit(e, x = {}) { (this.h[e] || []).slice().forEach((f) => f(x)); }
  jumpTo(v) { window.__stub.jumps.push(v); clearTimeout(this.it); this.it = setTimeout(() => this.emit('idle'), 30); } redraw() {} resize() {} remove() { window.__stub.removed = true; }
  getStyle() { return { sources: { openmaptiles: { type: 'vector' } } }; }
  getZoom() { return 14; }
  querySourceFeatures(id, q) { return (window.__features || {})[q.sourceLayer] || []; }
} };`;

// Sample rider with every address blanked, so places need names from the map.
function noAddressCsv() {
  const lines = readFileSync(path.join(__dirname, '..', 'data', 'sample-trips.csv'), 'utf8').trim().split('\n');
  const quoted = /"[^"]*"/g; // addresses are the only quoted fields in the sample
  const out = [lines[0], ...lines.slice(1).map((l) => l.replace(quoted, '""'))].join('\n');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rides-'));
  const file = path.join(dir, 'no-addresses.csv');
  writeFileSync(file, out);
  // Label spots a little way down the list of common dropoffs (past Home and Work).
  const h = lines[0].split(',');
  const counts = new Map();
  for (const l of lines.slice(1)) {
    const c = l.replace(quoted, '').split(',');
    const k = `${Number(c[h.indexOf('Dropoff Lat')]).toFixed(3)},${Number(c[h.indexOf('Dropoff Lng')]).toFixed(3)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const top2 = new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k));
  // Ends of the busiest routes that aren't Home or Work, so Routes shows them.
  const routes = new Map();
  for (const l of lines.slice(1)) {
    const c = l.replace(quoted, '').split(',');
    const f = `${Number(c[h.indexOf('Begin Trip Lat')]).toFixed(3)},${Number(c[h.indexOf('Begin Trip Lng')]).toFixed(3)}`;
    const t = `${Number(c[h.indexOf('Dropoff Lat')]).toFixed(3)},${Number(c[h.indexOf('Dropoff Lng')]).toFixed(3)}`;
    routes.set(`${f}>${t}`, (routes.get(`${f}>${t}`) || 0) + 1);
  }
  const ends = [...routes].sort((a, b) => b[1] - a[1]).slice(0, 8).flatMap(([k]) => k.split('>')).filter((k) => !top2.has(k));
  const spots = [...new Set(ends)].slice(0, 4).map((k) => k.split(',').map(Number));
  return { file, spots };
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), 'dist', '--port', String(port)], { cwd: path.join(__dirname, '..') });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const mode of ['blocked', 'tiles', 'wired', 'nodark']) {
      for (const [w, h] of [[390, 844], [1280, 800]]) {
        const tag = `${mode}@${w}`;
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const url = m.location()?.url || '';
          if (/^Failed to load resource/.test(m.text()) && (url.startsWith(LIB) || url.startsWith(TILES))) return;
          failures.push(`[${tag}] console: ${m.text()} ${url}`);
        });
        page.on('pageerror', (e) => failures.push(`[${tag}] pageerror: ${e.message}`));
        await page.route(`${TILES}**`, (r) => {
          const url = r.request().url();
          if (mode === 'wired' && url.endsWith('/styles/dark')) return r.fulfill({ contentType: 'application/json', body: STYLE_JSON });
          if (mode === 'nodark' && url.endsWith('/styles/dark')) return r.fulfill({ status: 404, body: 'not found' });
          if (mode === 'nodark' && url.endsWith('/styles/positron')) return r.fulfill({ contentType: 'application/json', body: STYLE_JSON });
          return r.abort();
        });
        await page.route(`${LIB}**`, (r) => {
          if (mode === 'blocked') return r.abort();
          // The real maplibre-gl.css rule for the map container, which loads after our stylesheet.
          if (r.request().url().endsWith('.css')) return r.fulfill({ contentType: 'text/css', body: '.maplibregl-map{overflow:hidden;position:relative}' });
          return r.fulfill({ contentType: 'application/javascript', body: stub(mode === 'nodark' ? 'wired' : mode) });
        });
        await page.goto(`http://localhost:${port}/?sample&nostory`);
        await page.waitForSelector('[data-ready]', { timeout: 10000 });
        await page.locator('.map-stage').scrollIntoViewIfNeeded();
        await page.waitForTimeout(mode === 'blocked' ? 7000 : 1500); // past the 6 s timeout for the blocked case
        const st = await page.evaluate(() => {
          const stage = document.querySelector('.map-stage');
          const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.map-canvas'));
          const px = c.getContext('2d').getImageData(2, 2, 1, 1).data;
          return {
            basemap: stage.classList.contains('has-basemap'),
            host: !!document.querySelector('.basemap'),
            attrib: !document.querySelector('.attrib').hidden,
            cornerAlpha: px[3],
            foot: document.querySelector('.map-net')?.textContent || '',
            glH: document.querySelector('.basemap-gl')?.getBoundingClientRect().height ?? -1,
            stageH: stage.clientHeight,
            status: document.querySelector('.map-status')?.textContent || '',
            invert: !!document.querySelector('.basemap-invert'),
          };
        });
        const expectOn = mode === 'wired' || mode === 'nodark';
        const check = (ok, msg) => { if (!ok) failures.push(`[${tag}] ${msg} ${JSON.stringify(st)}`); };
        check(st.basemap === expectOn, `has-basemap should be ${expectOn}`);
        check(st.host === expectOn, `basemap host element should ${expectOn ? '' : 'not '}exist`);
        check(st.attrib === expectOn, `attribution should be ${expectOn ? 'shown' : 'hidden'}`);
        check(expectOn ? st.cornerAlpha === 0 : st.cornerAlpha === 255, 'canvas background should be cleared only in basemap mode');
        check(expectOn ? /OpenFreeMap/.test(st.foot) : /no network requests/.test(st.foot), 'privacy line');
        if (expectOn) check(Math.abs(st.glH - st.stageH) < 1, 'MapLibre container must fill the map stage');
        const wantStatus = { blocked: /^Street map: off: MapLibre script blocked or failed to load/, tiles: /^Street map: off: style request blocked or failed/, wired: /^Street map: on \(OpenFreeMap dark\)/, nodark: /^Street map: on \(OpenFreeMap positron\)/ }[mode];
        check(wantStatus.test(st.status), `status line should match ${wantStatus}`);
        check(st.invert === (mode === 'nodark'), 'positron fallback is inverted, dark is not');
        if (expectOn) {
          const before = await page.evaluate(() => window.__stub.jumps.length);
          await page.locator('[data-zoom="in"]').click();
          await page.waitForTimeout(200);
          const s = await page.evaluate(() => ({ n: window.__stub.jumps.length, last: window.__stub.jumps.at(-1), opts: window.__stub.opts }));
          check(s.n > before, 'stub map should follow a zoom');
          check(s.opts.interactive === false && s.opts.style === `https://tiles.openfreemap.org/styles/${mode === 'nodark' ? 'positron' : 'dark'}`, 'map options');
        }
        if (mode === 'blocked' || (mode === 'wired' && w === 1280)) {
          const name = mode === 'blocked' ? `maplibre-fallback${reduced ? '-reduced' : ''}-${w}.png` : null;
          if (name) {
            const box = await page.locator('.map-card').boundingBox();
            await page.screenshot({ path: path.join(outDir, name), clip: box ? { x: 0, y: box.y, width: w, height: Math.min(box.height, 1400) } : undefined, fullPage: !!box });
            console.log(`saved docs/screenshots/${name}`);
          }
        }
        console.log(`${tag}: ${expectOn ? 'basemap mode' : 'canvas fallback'} ok · ${st.status}`);
        await page.close();
      }
    }
    // names: places named from OpenFreeMap tiles (fixture MVT tiles built with our own writer).
    const { writeTile } = await import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'src', 'core', 'mvt.js')).href);
    const na = noAddressCsv();
    const STYLE_VEC = JSON.stringify({ version: 8, name: 'stub', sources: { openmaptiles: { type: 'vector', url: `${TILES}planet` } }, layers: [] });
    const TILEJSON = JSON.stringify({ tiles: [`${TILES}planet/test/{z}/{x}/{y}.pbf`] });
    const poiTile = (z, x, y) => Buffer.from(writeTile({
      poi: na.spots.map(([lat, lng], i) => ({ type: 1, properties: { name: `Stub Market ${i + 1}`, class: 'grocery', rank: 5 }, geometry: [[[lng, lat]]] })),
    }, { z, x, y }));
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const tag = `names@${w}`;
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) failures.push(`[${tag}] console: ${m.text()}`); });
      page.on('pageerror', (e) => failures.push(`[${tag}] pageerror: ${e.message}`));
      const tileReqs = [];
      await page.route(`${TILES}**`, (r) => {
        const url = r.request().url(); tileReqs.push(url);
        if (url.endsWith('/styles/dark')) return r.fulfill({ contentType: 'application/json', body: STYLE_VEC });
        if (url === `${TILES}planet`) return r.fulfill({ contentType: 'application/json', body: TILEJSON });
        const m = url.match(/\/planet\/test\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
        if (m) return r.fulfill({ contentType: 'application/x-protobuf', body: poiTile(+m[1], +m[2], +m[3]) });
        return r.abort();
      });
      await page.route(`${LIB}**`, (r) => (r.request().url().endsWith('.css')
        ? r.fulfill({ contentType: 'text/css', body: '.maplibregl-map{overflow:hidden;position:relative}' })
        : r.fulfill({ contentType: 'application/javascript', body: stub('wired') })));
      await page.goto(`http://localhost:${port}/?nostory`);
      await page.setInputFiles('input[type=file]', na.file);
      await page.waitForSelector('[data-ready]', { timeout: 10000 });
      await page.waitForFunction(() => [...document.querySelectorAll('.places .name')].some((b) => /Stub Market/.test(b.textContent || '')), null, { timeout: 8000 }).catch(() => {});
      const st = await page.evaluate(() => ({
        places: [...document.querySelectorAll('.places .name')].map((b) => b.textContent),
        routes: [...document.querySelectorAll('.routes li')].some((li) => /Stub Market/.test(li.getAttribute('data-tip') || '')),
        cache: localStorage.getItem('rides.guesses.v1'),
        basemap: document.querySelector('.map-stage')?.classList.contains('has-basemap'),
        note: [...document.querySelectorAll('.foot')].some((p) => /Place names come from OpenFreeMap map tiles for the areas you ride in; your rides never leave your device\./.test(p.textContent || '')),
      }));
      const check = (ok, msg) => { if (!ok) failures.push(`[${tag}] ${msg} ${JSON.stringify(st).slice(0, 400)}`); };
      check(st.basemap, 'basemap mode should survive the name refresh');
      check(st.places.some((t) => /^Stub Market \d/.test(t || '')), 'a place should be named plainly from the tile POI (no ~)');
      check(st.routes, 'Routes should use the tile name');
      check(st.note, 'privacy line about place names');
      const cache = JSON.parse(st.cache || '{}');
      check(Object.keys(cache).length > 0 && Object.values(cache).every((v) => Object.keys(v).sort().join() === 'kind,name,z'), 'cache holds only {name, kind, z} per place');
      const tileUrls = tileReqs.filter((u) => /\.pbf$/.test(u));
      check(tileUrls.length > 0 && tileUrls.every((u) => /^https:\/\/tiles\.openfreemap\.org\/planet\/test\/14\/\d+\/\d+\.pbf$/.test(u)), `tile requests are z/x/y only: ${tileUrls.slice(0, 3).join(' ')}`);
      check(new Set(tileUrls).size === tileUrls.length, 'each tile is fetched once');
      const card = page.locator('#h-places').locator('xpath=..');
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: path.join(outDir, `place-names-${w}.png`) });
      console.log(`${tag}: ${st.places.filter((t) => /Stub/.test(t || '')).length} places named from ${tileUrls.length} tiles · saved docs/screenshots/place-names-${w}.png`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) { console.error('FAILED:\n' + failures.join('\n')); process.exit(1); }
  console.log('all basemap checks passed, no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
