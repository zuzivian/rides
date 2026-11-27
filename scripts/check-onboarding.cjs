#!/usr/bin/env node
// First-run check (Playwright): landing → "Add your first ride" → tap pickup
// and dropoff → time and fare → payoff card and arc → usual commute → import
// nudge, at 390 and 1280. Also the fallback with the street map blocked,
// where the keyboard path is used instead (coordinates under "Advanced" and an
// airport quick pick).
// MapLibre is a stub served at the real unpkg URL. It draws nothing, but it
// takes clicks, projects points and fires load/idle. OpenFreeMap tile requests
// are answered with fixture MVT tiles that hold a POI at each tapped spot.
// Fails on any console error except the browser's own "Failed to load resource"
// line for a blocked host. Saves docs/screenshots/onboarding-*.png.
// Usage: npm run build && node scripts/check-onboarding.cjs [--reduced]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const reduced = process.argv.includes('--reduced');
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const port = 5380 + Math.floor(Math.random() * 100);
const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/';
const TILES = 'https://tiles.openfreemap.org/';
const HOME = { lat: 37.7599, lng: -122.4148 };
const WORK = { lat: 37.7898, lng: -122.3942 };

const STYLE = JSON.stringify({ version: 8, name: 'stub', sources: { openmaptiles: { type: 'vector', url: `${TILES}planet` } }, layers: [] });
const TILEJSON = JSON.stringify({ tiles: [`${TILES}planet/test/{z}/{x}/{y}.pbf`] });

// A stand-in for maplibregl.Map: Web Mercator project/unproject, events, camera.
const STUB = `window.maplibregl = { Map: class {
  constructor(o) { this.o = o; this.h = {}; this.c = { lng: o.center[0], lat: o.center[1] }; this.z = o.zoom;
    o.container.classList.add('maplibregl-map'); (window.__maps ||= []).push(this);
    setTimeout(() => { this.emit('load'); setTimeout(() => this.emit('idle'), 30); }, 40); }
  on(e, f) { (this.h[e] ||= []).push(f); return this; }
  once(e, f) { const g = (x) => { this.h[e] = this.h[e].filter((k) => k !== g); f(x); }; return this.on(e, g); }
  emit(e, x = {}) { (this.h[e] || []).slice().forEach((f) => f(x)); }
  w() { const r = this.o.container.getBoundingClientRect(); return [r.width, r.height]; }
  wx(lng, lat) { const s = Math.sin(lat * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; }
  project([lng, lat]) { const W = 512 * 2 ** this.z; const [x, y] = this.wx(lng, lat); const [cx, cy] = this.wx(this.c.lng, this.c.lat); const [w, h] = this.w(); return { x: (x - cx) * W + w / 2, y: (y - cy) * W + h / 2 }; }
  getCenter() { return { ...this.c }; } getZoom() { return this.z; }
  jumpTo(v) { if (v.center) this.c = { lng: v.center[0], lat: v.center[1] }; if (v.zoom != null) this.z = v.zoom; this.emit('move'); clearTimeout(this.it); this.it = setTimeout(() => this.emit('idle'), 30); }
  flyTo(v) { this.jumpTo(v); } redraw() {} resize() {} remove() {}
} };`;

(async () => {
  const { writeTile } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'core', 'mvt.js')).href);
  const tile = (z, x, y) => Buffer.from(writeTile({
    poi: [
      { type: 1, properties: { name: 'Mission Dolores Park', class: 'park', rank: 2 }, geometry: [[[HOME.lng, HOME.lat]]] },
      { type: 1, properties: { name: 'Salesforce Transit Center', class: 'bus_station', rank: 1 }, geometry: [[[WORK.lng, WORK.lat]]] },
    ],
  }, { z, x, y }));

  const server = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), 'dist', '--port', String(port)], { cwd: path.join(__dirname, '..') });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();
  const failures = [];
  const shot = async (page, name, el) => {
    const file = path.join(outDir, `onboarding-${name}${reduced ? '-reduced' : ''}.png`);
    if (el) await el.screenshot({ path: file }); else await page.screenshot({ path: file });
    console.log(`saved ${path.relative(process.cwd(), file)}`);
  };
  try {
    for (const mode of ['map', 'blocked']) {
      for (const [w, h] of [[390, 844], [1280, 800]]) {
        if (mode === 'blocked' && w !== 390) continue;
        const tag = `${mode}@${w}`;
        const check = (ok, msg) => { if (!ok) failures.push(`[${tag}] ${msg}`); };
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', timezoneId: 'America/Los_Angeles' });
        const page = await ctx.newPage();
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const url = m.location()?.url || '';
          if (/^Failed to load resource/.test(m.text()) && (url.startsWith(LIB) || url.startsWith(TILES))) return;
          failures.push(`[${tag}] console: ${m.text()} ${url}`);
        });
        page.on('pageerror', (e) => failures.push(`[${tag}] pageerror: ${e.message}`));
        await page.route(`${TILES}**`, (r) => {
          const url = r.request().url();
          if (mode === 'blocked') return r.abort();
          if (url.endsWith('/styles/dark')) return r.fulfill({ contentType: 'application/json', body: STYLE });
          if (url === `${TILES}planet`) return r.fulfill({ contentType: 'application/json', body: TILEJSON });
          const m = url.match(/\/planet\/test\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
          if (m) return r.fulfill({ contentType: 'application/x-protobuf', body: tile(+m[1], +m[2], +m[3]) });
          return r.abort();
        });
        await page.route(`${LIB}**`, (r) => {
          if (mode === 'blocked') return r.abort();
          return r.request().url().endsWith('.css')
            ? r.fulfill({ contentType: 'text/css', body: '.maplibregl-map{overflow:hidden;position:relative}' })
            : r.fulfill({ contentType: 'application/javascript', body: STUB });
        });

        await page.goto(`http://localhost:${port}/`);
        const add = page.getByRole('button', { name: /Add your first ride/ });
        check(await add.isVisible(), 'landing shows "Add your first ride" as the main action');
        check(await page.getByText('Import your history').isVisible(), 'import is a secondary link');
        if (mode === 'map') await shot(page, `landing-${w}`);
        await add.click();
        const sheet = page.locator('.sheet');
        await sheet.waitFor();
        check(await page.locator('#sheet-title').textContent() === 'Where did it start?', 'step 1 title');

        if (mode === 'map') {
          await page.waitForFunction(() => window.__maps?.length && document.querySelector('.sheet-mapnote')?.hidden, null, { timeout: 8000 });
          const tap = (p) => page.evaluate((pt) => { const m = window.__maps[window.__maps.length - 1]; m.emit('click', { lngLat: pt }); }, p);
          await tap(HOME);
          await page.waitForFunction(() => /Dolores/.test(document.querySelector('[data-stop="0"]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
          check(/Mission Dolores Park/.test(await page.locator('[data-stop="0"]').textContent() || ''), 'pickup named from the tile POI');
          await tap(WORK);
          await page.waitForFunction(() => /Salesforce/.test(document.querySelector('[data-stop="1"]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
          check(/Salesforce Transit Center/.test(await page.locator('[data-stop="1"]').textContent() || ''), 'dropoff named from the tile POI');
          check(!(await page.locator('.pin-a').isHidden()) && !(await page.locator('.pin-b').isHidden()), 'both pins shown');
        } else {
          await page.waitForFunction(() => document.querySelector('.sheet')?.classList.contains('no-map'), null, { timeout: 9000 });
          check(/Street map unavailable/.test(await page.locator('.sheet-mapnote').textContent() || ''), 'says the map is unavailable and why');
          // Keyboard path: coordinates for the pickup, an airport quick pick for the dropoff.
          await page.locator('[data-lat]').focus();
          await page.keyboard.type(String(HOME.lat));
          await page.keyboard.press('Tab');
          await page.keyboard.type(String(HOME.lng));
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          check(/37\.7599/.test(await page.locator('[data-stop="0"]').textContent() || ''), 'pickup set from coordinates');
          await page.getByRole('button', { name: '✈ SFO' }).click();
          check(await page.locator('[data-stop="1"]').textContent() === 'SFO', 'airport quick pick');
          await shot(page, `fallback-sheet-${w}`, page.locator('.sheet-frame'));
        }
        check(await page.locator('#sheet-title').textContent() === 'When was it?', 'step 3 after two points');
        await page.locator('[data-fare]').fill('18.40');
        if (mode === 'map') await shot(page, `sheet-${w}`, page.locator('.sheet-frame'));
        await page.getByRole('button', { name: 'Add ride' }).click();
        await page.waitForSelector('[data-ready]');
        await page.waitForTimeout(reduced ? 400 : 2200);

        const st = await page.evaluate(() => {
          const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.map-canvas'));
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let lit = 0; for (let i = 0; i < d.length; i += 4 * 7) if (d[i] > 150 && d[i + 1] > 100 && d[i + 3] > 0) lit++;
          return {
            payoff: document.querySelector('.added-card')?.textContent || '',
            locked: document.querySelector('.ov-type.locked')?.textContent || '',
            lit,
            stored: JSON.parse(localStorage.getItem('rides.manual.v1') || '[]'),
          };
        });
        check(/Your first ride on Rides/.test(st.payoff), 'payoff card title');
        check(/≈ [\d.]+ mi/.test(st.payoff) && /≈ \d+ min/.test(st.payoff) && /CO₂/.test(st.payoff), 'payoff shows distance, time and CO₂');
        check(/Add 3 more rides to unlock your rider type/.test(st.locked), 'rider type is locked until 4 rides');
        check(st.lit > 20, `the arc is drawn on the map (${st.lit} lit samples)`);
        check(st.stored.length === 1 && st.stored[0].source === 'manual' && st.stored[0].estimated === true, 'stored on this device as an estimated manual ride');
        check(st.stored[0].fare === 18.4, 'fare saved');
        await shot(page, `first-ride-${mode === 'blocked' ? 'fallback-' : ''}${w}`);

        if (mode === 'map') {
          // Usual commute from one entry.
          await page.getByRole('button', { name: /Add your usual commute/ }).click();
          await page.locator('.sheet').waitFor();
          await page.waitForFunction(() => document.querySelector('.sheet-mapnote')?.hidden, null, { timeout: 8000 });
          await page.getByRole('button', { name: 'Home', exact: true }).first().click().catch(async () => {
            await page.evaluate((pt) => window.__maps[window.__maps.length - 1].emit('click', { lngLat: pt }), HOME);
          });
          await page.evaluate((pt) => window.__maps[window.__maps.length - 1].emit('click', { lngLat: pt }), WORK);
          await page.getByRole('button', { name: 'Add my commute' }).click();
          await page.waitForTimeout(reduced ? 300 : 1200);
          const c = await page.evaluate(() => ({ text: document.querySelector('.added-card')?.textContent || '', stored: JSON.parse(localStorage.getItem('rides.manual.v1') || '[]') }));
          check(/Commute added/.test(c.text), 'commute payoff');
          check(c.stored.filter((t) => t.series).length >= 20, `commute generated (${c.stored.filter((t) => t.series).length} rides)`);
          check(/Import your full history/.test(c.text), 'import nudge after 5+ rides');
          check(!(await page.locator('.ov-type.locked').count()), 'rider type unlocked');
          await shot(page, `commute-${w}`, page.locator('.added-card'));
          // Persisted: reload lands on the dashboard; delete the commute.
          await page.reload();
          await page.waitForSelector('[data-ready]');
          check(await page.locator('.added-card').count() === 1, 'rides survive a reload');
          await page.locator('.added-list summary').click();
          await page.getByRole('button', { name: 'Remove all' }).click();
          const left = await page.evaluate(() => JSON.parse(localStorage.getItem('rides.manual.v1') || '[]').length);
          check(left === 1, `commute removed, first ride kept (${left})`);
        }
        console.log(`${tag}: ok`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) { console.error('FAILED:\n' + failures.join('\n')); process.exit(1); }
  console.log('onboarding checks passed, no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
