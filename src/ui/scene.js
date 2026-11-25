// A reusable "night scene": arcs between places on a dark canvas, framed on
// one city. Used by story cards and the share card. Every option is a
// visual filter on the same data, so cards can light only night rides, one
// route, or rides into airports.
import { project, arcControl, quadSplit, robustBounds } from '../core/mercator.js';

/** @typedef {import('../core/stats.js').Stats} Stats */
/** @typedef {import('../core/stats.js').TripView} TripView */

const AMBER = '255, 181, 71';
const HOT = '255, 222, 165';
const COOL = '120, 150, 210';

const cityKey = (/** @type {string} */ c) => (c || 'Unknown').replace(/\s+(Bay Area|Metro(politan)? Area|Area)$/i, '');

/** @param {Stats} s */
export function makeScene(s) {
  const places = new Map(s.places.map((p) => [p.id, { ...p, w: /** @type {[number,number]} */ (project(p.lng, p.lat)) }]));
  const maxVisits = Math.max(1, ...s.places.map((p) => p.visits));
  const drawable = s.views.filter((v) => v.from && v.to && v.from !== v.to);

  /** @type {Map<string, [number,number][]>} */
  const cityPts = new Map();
  for (const v of drawable) {
    const k = cityKey(v.trip.city);
    const list = cityPts.get(k) || [];
    list.push(/** @type {any} */ (places.get(/** @type {string} */ (v.from))).w, /** @type {any} */ (places.get(/** @type {string} */ (v.to))).w);
    cityPts.set(k, list);
  }

  /** @param {string|undefined} city @param {number} trim */
  const boundsFor = (city, trim = 0.05) => robustBounds(cityPts.get(city || cityKey(s.cities[0]?.name)) || [], trim);

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w @param {number} h
   * @param {{
   *   city?: string, bounds?: ReturnType<typeof robustBounds>, pad?: number,
   *   lit?: (v: TripView) => boolean,    // trips drawn bright; others dimmed
   *   dim?: number,                      // alpha for unlit trips (0 hides them)
   *   progress?: number,                 // 0..1 arc draw-in
   *   cool?: boolean,                    // blue-ish night palette for lit arcs
   *   lights?: boolean, scale?: number,
   * }} o
   */
  function draw(ctx, w, h, o = {}) {
    const b = o.bounds || boundsFor(o.city);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07090e'; ctx.fillRect(0, 0, w, h);
    if (!b) { ctx.restore(); return; }
    const pad = o.pad ?? Math.min(w, h) * 0.12;
    const bw = Math.max(b.maxX - b.minX, 1e-6); const bh = Math.max(b.maxY - b.minY, 1e-6);
    const z = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const cx = (b.minX + b.maxX) / 2; const cy = (b.minY + b.maxY) / 2;
    const toS = (/** @type {[number,number]} */ p) => /** @type {[number,number]} */ ([w / 2 + (p[0] - cx) * z, h / 2 + (p[1] - cy) * z]);
    const k = o.scale ?? Math.max(0.6, Math.min(w, h) / 420);
    const progress = o.progress ?? 1;
    const lit = o.lit;
    const dim = o.dim ?? 0.12;

    // Aggregate routes into lit and unlit counts.
    /** @type {Map<string, {a:string,b:string,lit:number,unlit:number}>} */
    const routes = new Map();
    /** @type {Map<string, number>} */
    const litVisits = new Map();
    for (const v of drawable) {
      const key = `${v.from}>${v.to}`;
      const r = routes.get(key) || { a: /** @type {string} */ (v.from), b: /** @type {string} */ (v.to), lit: 0, unlit: 0 };
      const isLit = lit ? lit(v) : true;
      if (isLit) { r.lit++; for (const id of [v.from, v.to]) litVisits.set(/** @type {string} */ (id), (litVisits.get(/** @type {string} */ (id)) || 0) + 1); } else r.unlit++;
      routes.set(key, r);
    }
    const maxLit = Math.max(1, ...[...routes.values()].map((r) => r.lit));
    const maxAll = Math.max(1, ...[...routes.values()].map((r) => r.lit + r.unlit));

    ctx.globalCompositeOperation = 'lighter';
    if (o.lights !== false) {
      for (const p of places.values()) {
        const vis = lit ? litVisits.get(p.id) || 0 : p.visits;
        if (!vis) continue;
        const [x, y] = toS(p.w); const f = Math.sqrt(vis / (lit ? Math.max(1, ...litVisits.values()) : maxVisits));
        const r = (14 + f * 60) * k;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${o.cool ? COOL : AMBER}, ${(0.12 + 0.26 * f) * progress})`); g.addColorStop(1, `rgba(${AMBER}, 0)`);
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.lineCap = 'round';
    let i = 0; const n = routes.size;
    for (const r of [...routes.values()].sort((a, b2) => (b2.lit + b2.unlit) - (a.lit + a.unlit))) {
      const A = toS(/** @type {any} */ (places.get(r.a)).w); const B = toS(/** @type {any} */ (places.get(r.b)).w);
      const C = arcControl(A, B, 0.2);
      const t = Math.max(0, Math.min(1, progress * 1.5 - (i++ / Math.max(1, n)) * 0.5));
      if (t <= 0) continue;
      const [s0, c0, e0] = t < 1 ? quadSplit(A, C, B, t) : [A, C, B];
      const path = () => { ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.quadraticCurveTo(c0[0], c0[1], e0[0], e0[1]); };
      if (r.unlit && dim > 0) {
        const f = Math.sqrt((r.unlit) / maxAll);
        path(); ctx.strokeStyle = `rgba(150, 160, 185, ${dim * (0.3 + 0.7 * f)})`; ctx.lineWidth = (0.6 + 1.2 * f) * k; ctx.stroke();
      }
      if (r.lit) {
        const f = Math.sqrt(r.lit / maxLit);
        const col = o.cool ? COOL : AMBER;
        path(); ctx.strokeStyle = `rgba(${col}, ${0.05 + 0.14 * f})`; ctx.lineWidth = (3 + 6 * f) * k; ctx.stroke();
        path(); ctx.strokeStyle = `rgba(${f > 0.6 ? (o.cool ? '200, 215, 255' : HOT) : col}, ${0.25 + 0.7 * f})`; ctx.lineWidth = (0.9 + 1.8 * f) * k; ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of places.values()) {
      const vis = lit ? litVisits.get(p.id) || 0 : p.visits;
      if (!vis) continue;
      const [x, y] = toS(p.w);
      ctx.fillStyle = `rgba(${o.cool ? '210, 222, 255' : HOT}, ${progress})`;
      ctx.beginPath(); ctx.arc(x, y, (1.6 + Math.sqrt(vis / maxVisits) * 5) * k, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return { toS, places };
  }

  return { draw, places, boundsFor, cities: [...cityPts.keys()] };
}

/**
 * Size a canvas to its box at device pixel ratio and return a 2D context
 * already scaled to CSS pixels.
 * @param {HTMLCanvasElement} canvas
 */
export function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, r.width); const h = Math.max(1, r.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * Animate 0→1 over `ms`, calling `frame(t)`. Returns a cancel function.
 * Under reduced motion it calls frame(1) once.
 * @param {(t:number)=>void} frame @param {number} ms
 */
export function tween(frame, ms = 1600) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { frame(1); return () => {}; }
  let raf = 0; const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const k = Math.min(1, (now - t0) / ms);
    frame(1 - Math.pow(1 - k, 3));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
