// The night map: every ride as a soft arc on a canvas, places as lights,
// a "replay my year" animation, and tap-a-place details. Everything drawn on
// the canvas comes from the user's own rides. When it loads, an OpenFreeMap
// basemap (basemap.js) sits underneath and follows this camera; otherwise the
// canvas draws its own dark background and grid.
import { project, unproject, arcControl, quadAt, quadSplit, robustBounds, metresPerWorldUnit } from '../core/mercator.js';
import * as fmt from '../core/format.js';
import { reducedMotion } from './motion.js';
import { esc } from './esc.js';
import { startBasemap, ATTRIBUTION } from './basemap.js';

/** @typedef {import('../core/stats.js').Stats} Stats */
/** @typedef {import('../core/stats.js').TripView} TripView */

const AMBER = '255, 181, 71';
const HOT = '255, 220, 160';
const MAX_Z = 2 ** 25; // px per world unit (about street level)

// Survives re-renders of the dashboard (renames, unit switch).
const memo = {
  /** @type {{cx:number, cy:number, z:number}|null} */ cam: null,
  /** @type {string|null} */ selected: null,
  year: /** @type {string} */ ('all'),
  speed: 1,
};

/** @param {Stats} s @param {string} [overlay] HTML laid over the map (hero mode) */
export function mapSection(s, overlay = '') {
  const years = s.years.map((y) => y.year);
  const cities = s.cities.filter((c) => c.name !== 'Unknown');
  return `
  <section class="map-card${overlay ? ' map-hero' : ' card span-12'} reveal" aria-label="Map of every ride">
    <div class="map-stage">
      ${overlay ? `<div class="map-overlay">${overlay}</div>` : ''}
      <canvas class="map-canvas" tabindex="0" role="img" aria-label="Map of your rides. Drag to pan, scroll or pinch to zoom, tap a light for details. Arrow keys pan, plus and minus zoom."></canvas>
      <div class="ticker" aria-live="polite" hidden><div class="t-date"></div><div class="t-meta"></div></div>
      <div class="zoom" role="group" aria-label="Zoom">
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="fit" aria-label="Fit all rides">⤢</button>
      </div>
      <div class="attrib" hidden>${ATTRIBUTION}</div>
    </div>
    <div class="replay${overlay ? ' wrap' : ''}">
      <button type="button" class="btn btn-primary btn-small play" data-replay>▶ Replay ${years.length === 1 ? 'my year' : 'my rides'}</button>
      ${years.length > 1 ? `<div class="seg" role="group" aria-label="Replay period">
        <button type="button" data-year="all" aria-pressed="${memo.year === 'all'}">All</button>
        ${years.map((y) => `<button type="button" data-year="${y}" aria-pressed="${memo.year === String(y)}">${y}</button>`).join('')}
      </div>` : ''}
      <div class="seg" role="group" aria-label="Replay speed">
        <button type="button" data-speed="1" aria-pressed="${memo.speed === 1}">1×</button>
        <button type="button" data-speed="3" aria-pressed="${memo.speed === 3}">3×</button>
      </div>
      <input class="scrub" type="range" min="0" max="1000" value="1000" aria-label="Replay position">
      ${cities.length > 1 ? `<div class="chips" role="group" aria-label="Jump to city">${cities.map((c) => `<button type="button" class="chip" data-city="${esc(c.name)}">${esc(c.name)} <span>${c.count}</span></button>`).join('')}</div>` : ''}
    </div>
    <div class="place-panel${overlay ? ' wrap-inset' : ''}" aria-live="polite"></div>
    <p class="foot${overlay ? ' wrap' : ''}">Brighter arcs are routes you ride more often. Lights are your places, sized by visits. <span class="map-net">No map tiles are loaded, so the map makes no network requests at all.</span></p>
    <p class="map-status${overlay ? ' wrap' : ''}" aria-live="polite">Street map: <b>loading…</b></p>
  </section>`;
}

export class RideMap {
  /** @param {HTMLElement} root the .map-card section @param {Stats} stats */
  constructor(root, stats) {
    this.root = root;
    this.s = stats;
    this.canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('canvas'));
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.stage = /** @type {HTMLElement} */ (root.querySelector('.map-stage'));
    this.ticker = /** @type {HTMLElement} */ (root.querySelector('.ticker'));
    this.panel = /** @type {HTMLElement} */ (root.querySelector('.place-panel'));
    this.scrub = /** @type {HTMLInputElement} */ (root.querySelector('.scrub'));
    this.playBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-replay]'));
    this.w = 0; this.h = 0; this.dpr = 1;
    this.cam = memo.cam || { cx: 0.5, cy: 0.5, z: 1000 };
    /** @type {number|null} */ this.raf = null;
    this.intro = memo.cam ? 1 : 0; // arcs draw in on first show only
    this.replay = null;
    this.destroyed = false;

    this.placeById = new Map(stats.places.map((p) => [p.id, { ...p, w: project(p.lng, p.lat) }]));
    this.maxVisits = Math.max(1, ...stats.places.map((p) => p.visits));
    /** Trips the map can draw: both ends placed, distinct places. */
    this.trips = stats.views.filter((v) => v.from && v.to && v.from !== v.to);
    /** @type {Map<string, {from:string,to:string,count:number}>} */
    this.routes = new Map();
    for (const v of this.trips) {
      const k = `${v.from}>${v.to}`;
      const r = this.routes.get(k) || { from: /** @type {string} */ (v.from), to: /** @type {string} */ (v.to), count: 0 };
      r.count++; this.routes.set(k, r);
    }
    this.maxRoute = Math.max(1, ...[...this.routes.values()].map((r) => r.count));
    this.cityBounds = this.computeCityBounds();

    this.bind();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.stage);
    this.resize();
    if (!memo.cam) this.fitCity(stats.cities[0]?.name, false);
    if (memo.selected && !this.placeById.has(memo.selected)) memo.selected = null;
    this.renderPanel();
    this.startIntro();
    /** @type {import('./basemap.js').Basemap|null} */ this.basemap = null;
    const status = /** @type {HTMLElement} */ (root.querySelector('.map-status'));
    startBasemap(this.stage, this.cam).then(({ basemap: b, reason, styleId }) => {
      if (this.destroyed) { b?.remove(); return; }
      status.innerHTML = b ? `Street map: <b>on</b> (OpenFreeMap ${esc(styleId || '')})` : `Street map: <b>off</b>: ${esc(reason)}. Showing rides only.`;
      if (!b) return;
      this.basemap = b;
      this.stage.classList.add('has-basemap');
      /** @type {HTMLElement} */ (root.querySelector('.attrib')).hidden = false;
      const net = root.querySelector('.map-net');
      if (net) net.textContent = 'The street map comes from OpenFreeMap. Its server sees which map area you view, never your rides.';
      this.draw();
    });
  }

  /** Fly to a few trips (just added) so their arcs are in view. @param {import('../core/types.js').Trip[]} trips */
  focusTrips(trips) {
    /** @type {[number, number][]} */
    const pts = [];
    for (const t of trips) {
      if (t.fromLat != null && t.fromLng != null) pts.push(/** @type {[number, number]} */ (project(t.fromLng, t.fromLat)));
      if (t.toLat != null && t.toLng != null) pts.push(/** @type {[number, number]} */ (project(t.toLng, t.toLat)));
    }
    const b = robustBounds(pts, 0);
    if (b) this.flyTo(this.camFor(b), true);
  }

  /** New names, same rides: update labels and the panel without rebuilding the map. @param {Stats} stats */
  updateNames(stats) {
    this.s = stats;
    for (const p of stats.places) { const q = this.placeById.get(p.id); if (q) Object.assign(q, { name: p.name, nameSource: p.nameSource, topPartners: p.topPartners }); }
    this.renderPanel();
    this.draw();
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.basemap?.remove(); this.basemap = null;
    memo.cam = { ...this.cam };
  }

  // Geometry ---------------------------------------------------------------
  computeCityBounds() {
    /** @type {Map<string, [number,number][]>} */
    const byCity = new Map();
    for (const v of this.s.views) {
      const name = (v.trip.city || 'Unknown').replace(/\s+(Bay Area|Metro(politan)? Area|Area)$/i, '');
      const list = byCity.get(name) || [];
      for (const id of [v.from, v.to]) {
        const p = id ? this.placeById.get(id) : null;
        if (p) list.push(/** @type {[number,number]} */ (p.w));
      }
      byCity.set(name, list);
    }
    /** @type {Map<string, NonNullable<ReturnType<typeof robustBounds>>>} */
    const out = new Map();
    for (const [name, pts] of byCity) { const b = robustBounds(pts, 0.05); if (b) out.set(name, b); }
    return out;
  }

  /** @param {number} x @param {number} y */
  toScreen(x, y) { return [(x - this.cam.cx) * this.cam.z + this.w / 2, (y - this.cam.cy) * this.cam.z + this.h / 2]; }

  /** @param {{minX:number,maxX:number,minY:number,maxY:number}} b */
  camFor(b) {
    const hero = this.root.classList.contains('map-hero');
    const side = Math.min(56, this.w * 0.1);
    let top = hero ? Math.min(210, this.h * 0.3) : side; let bottom = hero ? 96 : side;
    if (hero) {
      // Keep the data clear of the overlay's header and chips, as laid out now.
      const sr = this.stage.getBoundingClientRect();
      const head = this.root.querySelector('.ov-head')?.getBoundingClientRect();
      const chips = this.root.querySelector('.ov-chips')?.getBoundingClientRect();
      if (head && head.height) top = Math.min(this.h * 0.45, Math.max(top, head.bottom - sr.top + 16));
      if (chips && chips.height) bottom = Math.min(this.h * 0.4, Math.max(bottom, sr.bottom - chips.top + 16));
    }
    const bw = Math.max(b.maxX - b.minX, 2e-6); const bh = Math.max(b.maxY - b.minY, 2e-6);
    const z = Math.min((this.w - side * 2) / bw, (this.h - top - bottom) / bh, MAX_Z / 4);
    // Shift the centre so the data sits in the clear area between the overlays.
    const cy = (b.minY + b.maxY) / 2 - ((top - bottom) / 2) / z;
    return { cx: (b.minX + b.maxX) / 2, cy, z };
  }

  /** @param {string|undefined} name @param {boolean} animate */
  fitCity(name, animate = true) {
    const b = (name && this.cityBounds.get(name)) || this.allBounds();
    if (!b) return;
    this.flyTo(this.camFor(b), animate);
    this.currentCity = name;
  }

  allBounds() {
    return robustBounds([...this.placeById.values()].map((p) => /** @type {[number,number]} */ (p.w)), 0);
  }

  /** @param {{cx:number,cy:number,z:number}} to @param {boolean} animate */
  flyTo(to, animate = true) {
    if (!animate || reducedMotion() || !this.w) { this.cam = { ...to }; this.draw(); return; }
    const from = { ...this.cam }; const t0 = performance.now(); const dur = 900;
    this.flight = (/** @type {number} */ now) => {
      const k = Math.min(1, (now - t0) / dur); const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      const lz = Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e;
      this.cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, z: Math.exp(lz) };
      if (k >= 1) this.flight = null;
    };
    this.loop();
  }

  /** @param {number} factor @param {number} [sx] @param {number} [sy] */
  zoomBy(factor, sx = this.w / 2, sy = this.h / 2) {
    const z = Math.max(200, Math.min(MAX_Z, this.cam.z * factor));
    const wx = this.cam.cx + (sx - this.w / 2) / this.cam.z; const wy = this.cam.cy + (sy - this.h / 2) / this.cam.z;
    this.cam = { cx: wx - (sx - this.w / 2) / z, cy: wy - (sy - this.h / 2) / z, z };
    this.draw();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width) return;
    const first = !this.w;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.basemap?.resize();
    if (first && !memo.cam) this.fitCity(this.s.cities[0]?.name, false);
    this.draw();
  }

  // Input ------------------------------------------------------------------
  bind() {
    const c = this.canvas;
    /** @type {Map<number, {x:number,y:number}>} */
    const pts = new Map();
    let moved = 0; let pinch = 0;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) { this.hover(e.offsetX, e.offsetY); return; }
      const dx = e.offsetX - p.x; const dy = e.offsetY - p.y;
      if (pts.size === 1) {
        this.cam.cx -= dx / this.cam.z; this.cam.cy -= dy / this.cam.z; moved += Math.abs(dx) + Math.abs(dy);
        this.flight = null; this.draw();
      }
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoomBy(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d; moved += 10;
      }
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (pts.has(e.pointerId) && pts.size === 1 && moved < 6) this.click(e.offsetX, e.offsetY);
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = 0; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.flight = null; this.zoomBy(Math.exp(-e.deltaY * 0.0022), e.offsetX, e.offsetY); }, { passive: false });
    c.addEventListener('dblclick', (e) => this.zoomBy(2, e.offsetX, e.offsetY));
    c.addEventListener('keydown', (e) => {
      const step = 60 / this.cam.z;
      const k = e.key;
      if (k === 'ArrowLeft') this.cam.cx -= step; else if (k === 'ArrowRight') this.cam.cx += step;
      else if (k === 'ArrowUp') this.cam.cy -= step; else if (k === 'ArrowDown') this.cam.cy += step;
      else if (k === '+' || k === '=') { this.zoomBy(1.5); e.preventDefault(); return; }
      else if (k === '-') { this.zoomBy(1 / 1.5); e.preventDefault(); return; }
      else return;
      e.preventDefault(); this.draw();
    });

    this.root.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null; if (!t) return;
      const z = t.closest('[data-zoom]')?.getAttribute('data-zoom');
      if (z === 'in') this.zoomBy(1.6); else if (z === 'out') this.zoomBy(1 / 1.6);
      else if (z === 'fit') this.fitCity(this.currentCity);
      const city = t.closest('[data-city]')?.getAttribute('data-city');
      if (city) this.fitCity(city);
      if (t.closest('[data-replay]')) this.toggleReplay();
      const year = t.closest('[data-year]')?.getAttribute('data-year');
      if (year) { memo.year = year; this.setPressed('[data-year]', year); this.stopReplay(true); }
      const speed = t.closest('[data-speed]')?.getAttribute('data-speed');
      if (speed) { memo.speed = Number(speed); this.setPressed('[data-speed]', speed); }
      const sel = t.closest('[data-select]')?.getAttribute('data-select');
      if (sel) { this.select(sel); const p = this.placeById.get(sel); if (p) this.flyTo({ cx: p.w[0], cy: p.w[1], z: Math.max(this.cam.z, 2 ** 18) }); }
      if (t.closest('[data-close-panel]')) this.select(null);
    });
    this.scrub.addEventListener('input', () => {
      if (!this.replay) this.startReplay(false);
      const r = /** @type {NonNullable<RideMap['replay']>} */ (this.replay);
      r.playing = false; r.t = (Number(this.scrub.value) / 1000) * r.duration; this.updatePlayLabel();
      this.loop();
    });
  }

  /** @param {string} sel @param {string} value */
  setPressed(sel, value) {
    this.root.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(sel.slice(1, -1)) === value)));
  }

  /** @param {number} x @param {number} y */
  hitPlace(x, y) {
    let best = null; let bestD = 16;
    for (const p of this.placeById.values()) {
      const [sx, sy] = this.toScreen(p.w[0], p.w[1]);
      const d = Math.hypot(sx - x, sy - y) - this.dotRadius(p.visits);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** @param {number} x @param {number} y */
  hover(x, y) { this.canvas.style.cursor = this.hitPlace(x, y) ? 'pointer' : 'grab'; }

  /** @param {number} x @param {number} y */
  click(x, y) {
    const p = this.hitPlace(x, y);
    this.select(p ? p.id : null);
  }

  /** @param {string|null} id */
  select(id) { memo.selected = id; this.renderPanel(); this.draw(); }

  renderPanel() {
    const p = memo.selected ? this.placeById.get(memo.selected) : null;
    if (!p) { this.panel.innerHTML = ''; return; }
    const cur = this.s.primaryCurrency;
    this.panel.innerHTML = `
      <div class="pp-head">
        <div><div class="eyebrow">${esc(p.kind === 'airport' ? 'Airport' : p.kind === 'home' ? 'Home base' : p.kind === 'work' ? 'Weekday mornings' : 'Place')}</div>
        <h3>${esc(p.name)}</h3></div>
        <div class="pp-actions">
          <button class="btn btn-small" type="button" data-rename="${esc(p.id)}">Rename</button>
          <button class="btn btn-small btn-ghost" type="button" data-close-panel aria-label="Close details">✕</button>
        </div>
      </div>
      <div class="facts pp-facts">
        <div class="fact"><div class="eyebrow">Visits</div><div class="v">${p.visits}</div><div class="d">${p.departures} pickups · ${p.arrivals} dropoffs</div></div>
        <div class="fact"><div class="eyebrow">Spent</div><div class="v">${cur ? esc(fmt.money(p.spend, cur, { compact: true })) : '—'}</div><div class="d">on rides to or from here</div></div>
        <div class="fact"><div class="eyebrow">Usual time</div><div class="v">${esc(fmt.hourLabel(p.peakHour))}</div><div class="d">most common hour</div></div>
        <div class="fact"><div class="eyebrow">First and last</div><div class="v" style="font-size:18px">${esc(dateOf(p.first))}</div><div class="d">to ${esc(dateOf(p.last))}</div></div>
      </div>
      ${p.topPartners.length ? `<div class="pp-links"><span class="eyebrow">Most often to and from</span>${p.topPartners.map((t) => `<button type="button" class="chip" data-select="${esc(t.id)}">${esc(t.name)} <span>${t.count}</span></button>`).join('')}</div>` : ''}`;
  }

  // Replay -----------------------------------------------------------------
  /** @param {boolean} play */
  startReplay(play) {
    const year = memo.year;
    const seq = this.trips.filter((v) => year === 'all' || String(v.local.year) === year);
    if (!seq.length) return;
    const t0 = seq[0].trip.start; const t1 = seq[seq.length - 1].trip.start;
    const spanDays = Math.max(1, (t1 - t0) / 86400000);
    const duration = Math.max(10000, Math.min(40000, spanDays * 60));
    this.replay = { seq, t0, t1, duration, t: 0, playing: play, last: performance.now(), city: '' };
    this.ticker.hidden = false; this.stage.classList.add('replaying');
    this.updatePlayLabel();
    this.loop();
  }

  /** @param {boolean} [reset] */
  stopReplay(reset = false) {
    if (!this.replay) return;
    if (reset) { this.replay = null; this.ticker.hidden = true; this.stage.classList.remove('replaying'); this.scrub.value = '1000'; this.updatePlayLabel(); this.draw(); return; }
    this.replay.playing = false; this.updatePlayLabel();
  }

  toggleReplay() {
    const r = this.replay;
    if (!r) { this.startReplay(true); return; }
    if (r.t >= r.duration) { r.t = 0; r.playing = true; } else r.playing = !r.playing;
    r.last = performance.now();
    this.updatePlayLabel(); this.loop();
  }

  updatePlayLabel() {
    const r = this.replay;
    const label = !r ? `▶ Replay ${this.s.years.length === 1 ? 'my year' : 'my rides'}` : r.playing ? '❚❚ Pause' : r.t >= r.duration ? '↺ Replay again' : '▶ Resume';
    this.playBtn.textContent = label;
  }

  /** Time (ms epoch) currently shown by the replay. */
  replayNow() {
    const r = /** @type {NonNullable<RideMap['replay']>} */ (this.replay);
    return r.t0 + (r.t1 - r.t0) * Math.min(1, r.t / r.duration) + (r.t >= r.duration ? 1 : 0);
  }

  // Drawing ----------------------------------------------------------------
  startIntro() {
    if (this.intro >= 1 || reducedMotion()) { this.intro = 1; this.draw(); return; }
    // Start once the map scrolls into view.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); const s = performance.now(); this.introAnim = (/** @type {number} */ now) => { this.intro = Math.min(1, (now - s) / 1800); if (this.intro >= 1) this.introAnim = null; }; this.loop(); } }, { threshold: 0.25 });
    io.observe(this.stage);
    this.draw();
  }

  loop() {
    if (this.raf || this.destroyed) return;
    const tick = (/** @type {number} */ now) => {
      this.raf = null;
      if (this.destroyed) return;
      this.flight?.(now);
      this.introAnim?.(now);
      const r = this.replay;
      if (r && r.playing) {
        r.t += (now - r.last) * memo.speed; r.last = now;
        if (r.t >= r.duration) { r.t = r.duration; r.playing = false; this.updatePlayLabel(); }
        this.scrub.value = String(Math.round((r.t / r.duration) * 1000));
      } else if (r) r.last = now;
      this.render();
      if (this.flight || this.introAnim || (r && r.playing)) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw() { if (!this.raf) this.loop(); }

  /** @param {number} visits */
  dotRadius(visits) { return 2 + Math.sqrt(visits / this.maxVisits) * 9; }

  render() {
    const { ctx, w, h, dpr } = this;
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (this.basemap) { ctx.clearRect(0, 0, w, h); this.basemap.sync(this.cam); } else {
      ctx.fillStyle = '#07090e'; ctx.fillRect(0, 0, w, h);
      this.drawGrid();
    }

    const r = this.replay;
    const now = r ? this.replayNow() : Infinity;
    // Route counts so far (replay) or in total.
    /** @type {Map<string, number>} */
    const counts = new Map();
    /** @type {TripView[]} */
    const flying = [];
    const FLIGHT_MS = r ? (r.t1 - r.t0) / r.duration * 900 : 0; // a flight lasts ~0.9 s on screen
    if (r) {
      for (const v of r.seq) {
        if (v.trip.start > now) break;
        if (now - v.trip.start < FLIGHT_MS) flying.push(v);
        const k = `${v.from}>${v.to}`; counts.set(k, (counts.get(k) || 0) + 1);
      }
    } else for (const [k, rt] of this.routes) counts.set(k, rt.count);

    // City lights: places glow by visits (so far, in replay).
    ctx.globalCompositeOperation = 'lighter';
    /** @type {Map<string, number>} */
    const seen = new Map();
    if (r) for (const [k, n] of counts) { const [a, b] = k.split('>'); seen.set(a, (seen.get(a) || 0) + n); seen.set(b, (seen.get(b) || 0) + n); }
    for (const p of this.placeById.values()) {
      const visits = r ? seen.get(p.id) || 0 : p.visits;
      if (!visits) continue;
      const [x, y] = this.toScreen(p.w[0], p.w[1]);
      if (x < -80 || y < -80 || x > w + 80 || y > h + 80) continue;
      const rad = 10 + Math.sqrt(visits / this.maxVisits) * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${AMBER}, ${0.16 + 0.22 * Math.sqrt(visits / this.maxVisits)})`);
      g.addColorStop(1, `rgba(${AMBER}, 0)`);
      ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }

    // Arcs.
    ctx.lineCap = 'round';
    let i = 0;
    const n = counts.size;
    for (const [k, count] of counts) {
      const rt = this.routes.get(k); if (!rt) continue;
      const a = this.placeById.get(rt.from); const b = this.placeById.get(rt.to);
      if (!a || !b) continue;
      const A = this.toScreen(a.w[0], a.w[1]); const B = this.toScreen(b.w[0], b.w[1]);
      if (Math.max(A[0], B[0]) < -50 || Math.min(A[0], B[0]) > w + 50 || Math.max(A[1], B[1]) < -50 || Math.min(A[1], B[1]) > h + 50) { i++; continue; }
      const C = arcControl(/** @type {[number,number]} */ (A), /** @type {[number,number]} */ (B), 0.2);
      // Intro: stagger arcs, busiest first.
      let t = 1;
      if (!r && this.intro < 1) t = Math.max(0, Math.min(1, (this.intro * 1.6) - (i / Math.max(1, n)) * 0.6));
      i++;
      if (t <= 0) continue;
      const f = Math.sqrt(count / this.maxRoute);
      const [s0, c0, e0] = t < 1 ? quadSplit(A, C, B, t) : [A, C, B];
      ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.quadraticCurveTo(c0[0], c0[1], e0[0], e0[1]);
      ctx.strokeStyle = `rgba(${AMBER}, ${0.05 + 0.14 * f})`; ctx.lineWidth = 3 + 5 * f; ctx.stroke();
      ctx.strokeStyle = `rgba(${f > 0.6 ? HOT : AMBER}, ${0.22 + 0.7 * f})`; ctx.lineWidth = 0.8 + 1.6 * f; ctx.stroke();
    }

    // Replay comets.
    if (r) {
      for (const v of flying) {
        const a = this.placeById.get(/** @type {string} */ (v.from)); const b = this.placeById.get(/** @type {string} */ (v.to));
        if (!a || !b) continue;
        const A = this.toScreen(a.w[0], a.w[1]); const B = this.toScreen(b.w[0], b.w[1]);
        const C = arcControl(/** @type {[number,number]} */ (A), /** @type {[number,number]} */ (B), 0.2);
        const k = Math.min(1, (now - v.trip.start) / FLIGHT_MS);
        const tail = Math.max(0, k - 0.35);
        for (let s = 0; s < 8; s++) {
          const tt = tail + ((k - tail) * s) / 7;
          const [px, py] = quadAt(A, C, B, tt);
          ctx.fillStyle = `rgba(${HOT}, ${0.08 + 0.12 * s})`;
          ctx.beginPath(); ctx.arc(px, py, 1 + s * 0.45, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Place dots and labels.
    ctx.globalCompositeOperation = 'source-over';
    const labels = [];
    for (const p of this.placeById.values()) {
      const visits = r ? seen.get(p.id) || 0 : p.visits;
      if (!visits && p.id !== memo.selected) continue;
      const [x, y] = this.toScreen(p.w[0], p.w[1]);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      const rad = this.dotRadius(Math.max(visits, 1)) * 0.55;
      ctx.fillStyle = p.kind === 'airport' ? '#07090e' : `rgb(${HOT})`;
      ctx.strokeStyle = `rgb(${HOT})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); if (p.kind === 'airport') ctx.stroke();
      if (p.id === memo.selected) { ctx.strokeStyle = '#ece7df'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 6, 0, Math.PI * 2); ctx.stroke(); }
      labels.push({ p, x, y, rad, visits });
    }
    labels.sort((a, b) => (b.p.id === memo.selected ? 1 : 0) - (a.p.id === memo.selected ? 1 : 0) || b.visits - a.visits);
    ctx.font = '600 11px ui-monospace, SF Mono, Menlo, monospace';
    ctx.textBaseline = 'middle';
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const boxes = [];
    for (const l of labels.slice(0, 14)) {
      const text = l.p.name.toUpperCase();
      const tw = ctx.measureText(text).width + 12; const th = 20;
      let bx = l.x + l.rad + 6; const by = l.y - th / 2;
      if (bx + tw > w - 52) bx = l.x - l.rad - 6 - tw; // flip left near the zoom buttons / edge
      if (bx < 4 || by < 4 || by + th > h - 4) continue;
      if (boxes.some((b) => bx < b.x + b.w && bx + tw > b.x && by < b.y + b.h && by + th > b.y)) continue;
      if (boxes.length >= 7 && l.p.id !== memo.selected) continue;
      boxes.push({ x: bx, y: by, w: tw, h: th });
      ctx.fillStyle = 'rgba(7, 9, 14, .78)'; roundRect(ctx, bx, by, tw, th, 6); ctx.fill();
      ctx.fillStyle = l.p.id === memo.selected ? '#ffffff' : '#d9d3c8'; ctx.fillText(text, bx + 6, l.y + 0.5);
    }

    this.drawScale();
    if (r) this.updateTicker(now, r);
  }

  drawGrid() {
    const { ctx, w, h } = this;
    // Pick a lat/lng spacing that gives lines ~90px apart.
    const degPerPx = 360 / this.cam.z;
    const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    const step = steps.find((s) => s / degPerPx >= 90) || 10;
    const [lng0, lat0] = unproject(this.cam.cx - w / 2 / this.cam.z, this.cam.cy - h / 2 / this.cam.z);
    const [lng1, lat1] = unproject(this.cam.cx + w / 2 / this.cam.z, this.cam.cy + h / 2 / this.cam.z);
    ctx.strokeStyle = 'rgba(255, 255, 255, .045)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = Math.floor(lng0 / step) * step; g <= lng1; g += step) { const [x] = this.toScreen(project(g, 0)[0], 0); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let g = Math.floor(lat1 / step) * step; g <= lat0; g += step) { const [, y] = this.toScreen(0, project(0, g)[1]); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
  }

  drawScale() {
    const { ctx, h } = this;
    const lat = unproject(this.cam.cx, this.cam.cy)[1];
    const mpp = metresPerWorldUnit(lat) / this.cam.z;
    const mi = this.s.unit === 'mi';
    const unitM = mi ? 1609.344 : 1000;
    const target = (90 * mpp) / unitM;
    const nice = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
    const px = (nice * unitM) / mpp;
    const x = this.w - px - 60; const y = h - 16 - (this.basemap ? 34 : 0); // clear the attribution
    ctx.strokeStyle = 'rgba(236, 231, 223, .5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
    ctx.fillStyle = 'rgba(236, 231, 223, .65)'; ctx.font = '10px ui-monospace, SF Mono, Menlo, monospace'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${nice} ${mi ? 'mi' : 'km'}`, x + 4, y - 4);
  }

  /** @param {number} now @param {NonNullable<RideMap['replay']>} r */
  updateTicker(now, r) {
    let idx = 0; let lastV = null;
    for (const v of r.seq) { if (v.trip.start > now) break; idx++; lastV = v; }
    const ref = lastV || r.seq[0];
    const dayMs = Math.min(now, r.t1);
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: ref.trip.tz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(dayMs));
    /** @type {HTMLElement} */ (this.ticker.querySelector('.t-date')).textContent = p.replace(/,/g, '').toUpperCase();
    const route = lastV ? `${this.placeById.get(/** @type {string} */ (lastV.from))?.name} → ${this.placeById.get(/** @type {string} */ (lastV.to))?.name}` : '';
    /** @type {HTMLElement} */ (this.ticker.querySelector('.t-meta')).textContent = `Ride ${idx} of ${r.seq.length}${route ? ` · ${route}` : ''}`;
    // Follow the action between cities.
    const city = lastV ? (lastV.trip.city || '').replace(/\s+(Bay Area|Metro(politan)? Area|Area)$/i, '') : '';
    if (city && city !== r.city && r.playing) {
      r.city = city;
      if (city !== this.currentCity && this.cityBounds.has(city)) this.fitCity(city);
    }
  }
}

/** @param {number} ms */
function dateOf(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : '—'; }

/** @param {CanvasRenderingContext2D} ctx */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
