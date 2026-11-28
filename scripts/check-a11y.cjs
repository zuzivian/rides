#!/usr/bin/env node
// Accessibility check (Playwright). Covers:
// - colour contrast (WCAG AA: 4.5:1, or 3:1 for large text) and accessible
//   names on the landing page, the add-ride sheet and the dashboard;
// - the keyboard-only path through onboarding: Tab to "Add your first ride",
//   set points from the keyboard (with the map via "Use the map centre",
//   without it via coordinates) plus the SFO quick pick, then add the ride;
// - a focus trap in the sheet, and focus returning to the opener on Escape.
// Runs at 390 and 1280 with reduced motion. All network is blocked except a
// stub MapLibre in the "map" run.
// Usage: npm run build && node scripts/check-a11y.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 5480 + Math.floor(Math.random() * 100);
const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/';
const TILES = 'https://tiles.openfreemap.org/';
const STUB = `window.maplibregl = { Map: class {
  constructor(o) { this.o = o; this.h = {}; this.c = { lng: o.center[0], lat: o.center[1] }; this.z = o.zoom; o.container.classList.add('maplibregl-map');
    setTimeout(() => { this.emit('load'); setTimeout(() => this.emit('idle'), 30); }, 40); }
  on(e, f) { (this.h[e] ||= []).push(f); return this; }
  once(e, f) { const g = (x) => { this.h[e] = this.h[e].filter((k) => k !== g); f(x); }; return this.on(e, g); }
  emit(e, x = {}) { (this.h[e] || []).slice().forEach((f) => f(x)); }
  project() { return { x: 50, y: 50 }; } getCenter() { return { ...this.c }; } getZoom() { return this.z; }
  jumpTo(v) { if (v.center) this.c = { lng: v.center[0], lat: v.center[1] }; } flyTo(v) { this.jumpTo(v); } redraw() {} resize() {} remove() {}
} };`;

/** Runs in the page: contrast failures and controls without a name. */
const AUDIT = () => {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const bgOf = (el) => {
    let base = [7, 9, 14]; const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    for (const c of stack.reverse()) base = base.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
    return base;
  };
  const contrast = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    // Decorative text inside role="img" visuals has its own accessible label.
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden],[aria-hidden="true"],svg,[role="img"]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const a = fg[3] * (+cs.opacity || 1);
    const f = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const L1 = lum(f); const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) contrast.push(`${ratio.toFixed(2)} < ${need}: ${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 40)}"`);
  }
  const unnamed = [];
  for (const el of document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [tabindex="0"]')) {
    if (el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') continue;
    const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && [...el.labels].map((l) => l.textContent).join('').trim()) || el.textContent.trim() || el.getAttribute('title');
    if (!name) unnamed.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}.${el.className}`);
  }
  return { contrast: [...new Set(contrast)], unnamed };
};

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), 'dist', '--port', String(port)], { cwd: path.join(__dirname, '..') });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      for (const mode of ['map', 'nomap']) {
        const tag = `${mode}@${w}`;
        const check = (ok, msg) => { if (!ok) failures.push(`[${tag}] ${msg}`); };
        const audit = async (page, where) => {
          const r = await page.evaluate(AUDIT);
          for (const c of r.contrast) failures.push(`[${tag}] ${where}: contrast ${c}`);
          for (const u of r.unnamed) failures.push(`[${tag}] ${where}: no accessible name: ${u}`);
        };
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' });
        const page = await ctx.newPage();
        page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) failures.push(`[${tag}] console: ${m.text()}`); });
        page.on('pageerror', (e) => failures.push(`[${tag}] pageerror: ${e.message}`));
        await page.route(/^https:\/\//, (r) => {
          const url = r.request().url();
          if (mode === 'map' && url.startsWith(LIB)) return r.fulfill({ contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript', body: url.endsWith('.css') ? '' : STUB });
          if (mode === 'map' && url === `${TILES}styles/dark`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) });
          return r.abort();
        });
        const sheetReady = () => (mode === 'map'
          ? page.waitForFunction(() => document.querySelector('.sheet-mapnote')?.hidden, null, { timeout: 8000 })
          : page.waitForFunction(() => document.querySelector('.sheet')?.classList.contains('no-map'), null, { timeout: 9000 }));
        const focusOn = async (pred, label, max = 40) => {
          for (let i = 0; i < max; i++) {
            if (await page.evaluate(pred)) return true;
            await page.keyboard.press('Tab');
          }
          failures.push(`[${tag}] the keyboard can't reach ${label}`);
          return false;
        };

        await page.goto(`http://localhost:${port}/`);
        await audit(page, 'landing');

        // Keyboard only from here on.
        const opener = await focusOn(() => (document.activeElement?.tagName === 'BUTTON' && /Add your first ride/.test(document.activeElement.textContent || '')), '"Add your first ride"', 12);
        check(opener && await page.evaluate(() => { const cs = getComputedStyle(/** @type {Element} */ (document.activeElement)); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; }), 'the focused button shows a focus outline');
        check(await focusOn(() => (document.activeElement?.tagName === 'BUTTON' && /Import your history/.test(document.activeElement.textContent || '')), '"Import your history"', 6), 'import is reachable by keyboard');
        await page.keyboard.press('Shift+Tab');
        await focusOn(() => (document.activeElement?.tagName === 'BUTTON' && /Add your first ride/.test(document.activeElement.textContent || '')), '"Add your first ride" again', 12);
        await page.keyboard.press('Enter');
        await page.locator('.sheet').waitFor();
        await sheetReady();
        await audit(page, 'sheet');
        check(await page.evaluate(() => { const s = document.querySelector('.sheet'); return s?.getAttribute('role') === 'dialog' && s.getAttribute('aria-modal') === 'true' && !!s.getAttribute('aria-labelledby'); }), 'the sheet is a labelled modal dialog');
        let escaped = false;
        for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('.sheet')))) escaped = true; }
        for (let i = 0; i < 10; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('.sheet')))) escaped = true; }
        check(!escaped, 'Tab and Shift+Tab stay inside the sheet');
        await page.keyboard.press('Escape');
        check(await page.locator('.sheet').count() === 0, 'Escape closes the sheet');
        check(await page.evaluate(() => (document.activeElement?.tagName === 'BUTTON' && /Add your first ride/.test(document.activeElement.textContent || ''))), 'focus returns to the button that opened the sheet');

        await page.keyboard.press('Enter');
        await page.locator('.sheet').waitFor({ timeout: 4000 }).catch(() => failures.push(`[${tag}] Enter on the refocused opener didn't reopen the sheet (focus: ${'${'}''})`));
        if (!(await page.locator('.sheet').count())) { console.error(failures.join('\n')); console.error(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))); process.exit(1); }
        await sheetReady();
        if (mode === 'map') {
          if (await focusOn(() => document.activeElement?.hasAttribute('data-use-centre'), '"Use the map centre"')) await page.keyboard.press('Enter');
        } else if (await focusOn(() => document.activeElement?.hasAttribute('data-lat'), 'the latitude input')) {
          await page.keyboard.type('37.7599'); await page.keyboard.press('Tab'); await page.keyboard.type('-122.4148');
          await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
        }
        check(await page.locator('#sheet-title').textContent() === 'Where did it end?', 'step 2 after setting the pickup by keyboard');
        if (await focusOn(() => document.activeElement?.getAttribute('data-quick') === 'ap:SFO', 'the SFO quick pick')) await page.keyboard.press('Enter');
        check(await page.locator('#sheet-title').textContent() === 'When was it?', 'step 3 after the dropoff');
        if (await focusOn(() => document.activeElement?.hasAttribute('data-fare'), 'the fare input')) { await page.keyboard.type('42'); await page.keyboard.press('Enter'); }
        await page.waitForSelector('[data-ready]', { timeout: 8000 }).catch(() => failures.push(`[${tag}] submitting by keyboard didn't add the ride`));
        await page.waitForTimeout(500);
        for (let y = 0; y < 6000; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(50); }
        await audit(page, 'dashboard (1 ride)');
        check(await page.evaluate(() => JSON.parse(localStorage.getItem('rides.manual.v1') || '[]').length === 1), 'the ride is saved');

        await page.goto(`http://localhost:${port}/?sample&nostory`);
        await page.waitForSelector('[data-ready]');
        for (let y = 0; y < 9000; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(50); }
        await page.waitForTimeout(400);
        await audit(page, 'dashboard (sample)');
        console.log(`${tag}: done`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) { console.error(`FAILED:\n${[...new Set(failures)].join('\n')}`); process.exit(1); }
  console.log('a11y checks passed: contrast, names, keyboard paths, focus trap');
})().catch((e) => { console.error(e); process.exit(1); });
