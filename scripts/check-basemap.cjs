#!/usr/bin/env node
// Basemap check (Playwright). Serves dist/, loads the sample at 390 and 1280,
// and checks three cases:
//   blocked  unpkg and tiles.openfreemap.org are blocked → canvas fallback, attribution hidden
//   tiles    the library loads (a stub at the real unpkg URL) but the style fetch fails → fallback
//   wired    the dark style is served and the stub map reports load + idle → basemap mode: canvas
//            cleared, attribution shown, the map fills the stage, and it follows the camera
//   nodark   /styles/dark is a 404 → falls back to positron, shown inverted
// Each case also checks the "Street map: …" status line under the map.
// The stub is not MapLibre and draws nothing. It checks our wiring and the CSP, not the real map.
// Fails on any console error except the browser's own "Failed to load resource" line for a blocked host.
// Usage: npm run build && node scripts/check-basemap.cjs [--reduced]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
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
  jumpTo(v) { window.__stub.jumps.push(v); } redraw() {} resize() {} remove() { window.__stub.removed = true; }
} };`;

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
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) { console.error('FAILED:\n' + failures.join('\n')); process.exit(1); }
  console.log('all basemap checks passed, no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
