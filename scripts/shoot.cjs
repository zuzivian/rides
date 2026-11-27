#!/usr/bin/env node
// UI check: serves the app, loads it at phone and desktop widths, fails on
// console errors, and saves screenshots.
// Usage: NODE_PATH=$(npm root -g) node scripts/shoot.cjs <name> [--sample] [--reduced]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const name = process.argv[2] || 'shot';
const sample = process.argv.includes('--sample');
const reduced = process.argv.includes('--reduced');
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const port = 5180 + Math.floor(Math.random() * 100);

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), 'dist', '--port', String(port)], { cwd: path.join(__dirname, '..') });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // The optional basemap may be unreachable (offline, sandbox); the browser logs that itself and the app falls back.
        const url = m.location()?.url || '';
        if (/^Failed to load resource/.test(m.text()) && /^https:\/\/(unpkg\.com\/maplibre-gl@4\.7\.1\/|tiles\.openfreemap\.org\/)/.test(url)) return;
        errors.push(`[${w}] ${m.text()} ${url}`);
      });
      page.on('pageerror', (e) => errors.push(`[${w}] ${e.message}`));
      await page.goto(`http://localhost:${port}/`);
      if (sample) {
        await page.getByRole('button', { name: /sample data/i }).first().click();
        await page.waitForSelector('[data-ready]', { timeout: 10000 });
        if (await page.locator('.story').count()) { await page.waitForTimeout(1200); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      }
      // Scroll through so scroll-triggered reveals fire, then return to top.
      const height = await page.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < height; y += Math.round(h * 0.7)) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(reduced ? 300 : 2000);
      const file = path.join(outDir, `${name}-${w}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`saved ${path.relative(process.cwd(), file)}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); process.exit(1); }
  console.log('no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
