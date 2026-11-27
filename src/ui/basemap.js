// Optional basemap: MapLibre GL with the OpenFreeMap dark style, drawn under
// the canvas arcs. It is loaded lazily when the map mounts. If anything fails
// (offline, blocked, slow, or a style or tile error), it resolves to null and
// the canvas map carries on alone, which is the default state anyway.
//
// Privacy: the only requests made here are the MapLibre files (unpkg) and the
// style, tiles, glyphs and sprites (tiles.openfreemap.org). Tile URLs carry
// z/x/y tile numbers for the area on screen, never ride data.
//
// No SRI hash: the library is loaded from unpkg at runtime. The agent that
// wrote this couldn't fetch the file to hash it, so there is no `integrity`
// attribute yet. See DECISIONS.md. Pinning the exact version in both the URL
// and the CSP path is the guard for now.
import { camToMapLibre } from '../core/mercator.js';

export const MAPLIBRE_BASE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/';
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
export const TIMEOUT_MS = 6000;
export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">© OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';

/** @type {Promise<any>|null} */
let libPromise = null;

/**
 * Load the MapLibre script and stylesheet once per page.
 * @param {number} timeoutMs
 * @returns {Promise<any>} the maplibregl namespace
 */
export function loadMapLibre(timeoutMs = TIMEOUT_MS) {
  const w = /** @type {any} */ (window);
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = `${MAPLIBRE_BASE}maplibre-gl.css`; css.referrerPolicy = 'no-referrer';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = `${MAPLIBRE_BASE}maplibre-gl.js`; s.async = true; s.referrerPolicy = 'no-referrer';
      s.onload = () => { clearTimeout(timer); w.maplibregl ? resolve(w.maplibregl) : reject(new Error('no maplibregl')); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    // Let a later mount retry (for example after coming back online).
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

/**
 * Create a non-interactive MapLibre map and wait until it has drawn tiles.
 * Resolves to null on any failure or after the timeout; never rejects.
 * @param {any} lib the maplibregl namespace
 * @param {HTMLElement} container
 * @param {{cx:number, cy:number, z:number}} cam
 * @param {number} [timeoutMs]
 * @returns {Promise<any|null>}
 */
export function initMap(lib, container, cam, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    /** @type {any} */ let map = null;
    let done = false;
    const finish = (/** @type {boolean} */ ok) => {
      if (done) return; done = true; clearTimeout(timer);
      if (ok) { resolve(map); return; }
      try { map?.remove(); } catch { /* already gone */ }
      resolve(null);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const view = camToMapLibre(cam);
      map = new lib.Map({
        container, style: STYLE_URL, center: view.center, zoom: view.zoom,
        minZoom: -2, interactive: false, attributionControl: false,
        renderWorldCopies: true, fadeDuration: 0,
      });
    } catch { finish(false); return; }
    // A listener stops MapLibre logging errors to the console. Before the
    // first full draw an error means fall back; after it, a missing tile just
    // leaves a gap under the arcs.
    map.on('error', () => finish(false));
    map.once('load', () => map.once('idle', () => finish(true)));
  });
}

/**
 * Lazily start the basemap inside `stage`. Resolves to a handle or null.
 * @param {HTMLElement} stage the .map-stage element
 * @param {{cx:number, cy:number, z:number}} cam
 * @param {{load?: (ms:number) => Promise<any>, timeoutMs?: number}} [opts]
 */
export async function startBasemap(stage, cam, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (typeof location !== 'undefined' && /[?&]nobasemap\b/.test(location.search)) return null;
  const t0 = Date.now();
  let lib;
  try { lib = await (opts.load || loadMapLibre)(timeoutMs); } catch { return null; }
  if (!lib?.Map) return null;
  const host = document.createElement('div');
  host.className = 'basemap'; host.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('div');
  inner.className = 'basemap-gl';
  host.appendChild(inner);
  stage.prepend(host);
  const map = await initMap(lib, inner, cam, Math.max(500, timeoutMs - (Date.now() - t0)));
  if (!map) { host.remove(); return null; }
  return new Basemap(map, host);
}

export class Basemap {
  /** @param {any} map @param {HTMLElement} host */
  constructor(map, host) { this.map = map; this.host = host; this.key = ''; }

  /** Follow the RideMap camera, redrawing in the same frame as the arcs. @param {{cx:number, cy:number, z:number}} cam */
  sync(cam) {
    const v = camToMapLibre(cam);
    const key = `${v.center[0]},${v.center[1]},${v.zoom}`;
    if (key === this.key) return;
    this.key = key;
    try { this.map.jumpTo(v); this.map.redraw?.(); } catch { /* keep drawing arcs */ }
  }

  resize() { try { this.map.resize(); this.key = ''; } catch { /* ignore */ } }

  remove() { try { this.map.remove(); } catch { /* ignore */ } this.host.remove(); }
}
