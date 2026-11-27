// Optional basemap: MapLibre GL with an OpenFreeMap style, drawn under the
// canvas arcs. It is loaded lazily when the map mounts. If anything fails
// (offline, blocked, slow, a bad style, no WebGL), startBasemap resolves with
// basemap: null and a plain reason, and the canvas map carries on alone,
// which is the default state anyway. The reason is shown under the map.
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
/**
 * Styles to try, in order. "dark" is preferred. If it isn't served (the agent
 * couldn't confirm the id from its sandbox), "positron", a documented light
 * style, is shown inverted so it still reads as a night map.
 */
export const STYLES = [
  { id: 'dark', url: 'https://tiles.openfreemap.org/styles/dark', invert: false },
  { id: 'positron', url: 'https://tiles.openfreemap.org/styles/positron', invert: true },
];
export const STYLE_URL = STYLES[0].url;
export const TIMEOUT_MS = 6000;
export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">© OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';

/** @type {Promise<any>|null} */
let libPromise = null;

/**
 * Load the MapLibre script and stylesheet once per page. Rejects with an
 * Error whose message is a reason fit to show the user.
 * @param {number} timeoutMs
 * @returns {Promise<any>} the maplibregl namespace
 */
export function loadMapLibre(timeoutMs = TIMEOUT_MS) {
  const w = /** @type {any} */ (window);
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MapLibre didn't load within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = `${MAPLIBRE_BASE}maplibre-gl.css`; css.referrerPolicy = 'no-referrer';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = `${MAPLIBRE_BASE}maplibre-gl.js`; s.async = true; s.referrerPolicy = 'no-referrer';
      s.onload = () => { clearTimeout(timer); w.maplibregl ? resolve(w.maplibregl) : reject(new Error('MapLibre script ran but defined nothing')); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('MapLibre script blocked or failed to load (unpkg.com)')); };
      document.head.appendChild(s);
    });
    // Let a later mount retry (for example after coming back online).
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

/**
 * Fetch the first style that the server returns. Never rejects.
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchFn
 * @param {number} timeoutMs
 * @returns {Promise<{style: typeof STYLES[number], json: any, reason: ''}|{style: null, json: null, reason: string}>}
 */
export async function pickStyle(fetchFn, timeoutMs = TIMEOUT_MS) {
  const tried = [];
  for (const style of STYLES) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    try {
      const res = await fetchFn(style.url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal: ctl?.signal });
      if (!res.ok) { tried.push(`${style.id} ${res.status}`); continue; }
      const json = await res.json();
      if (!json || json.version !== 8 || !json.sources) { tried.push(`${style.id} isn't a map style`); continue; }
      return { style, json, reason: '' };
    } catch (e) {
      const aborted = /** @type {any} */ (e)?.name === 'AbortError';
      // A network or CSP failure would fail every style the same way: stop here.
      return { style: null, json: null, reason: aborted ? `style request timed out (${style.id})` : `style request blocked or failed (tiles.openfreemap.org, ${style.id})` };
    } finally { clearTimeout(timer); }
  }
  return { style: null, json: null, reason: `no usable style (${tried.join(', ')})` };
}

/**
 * Create a non-interactive MapLibre map and wait until it has drawn tiles.
 * Never rejects. `map` is null on any failure or after the timeout.
 * @param {any} lib the maplibregl namespace
 * @param {HTMLElement} container
 * @param {any} style a style URL or style JSON
 * @param {{cx:number, cy:number, z:number}} cam
 * @param {number} [timeoutMs]
 * @returns {Promise<{map: any, reason: string}>}
 */
export function initMap(lib, container, style, cam, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    /** @type {any} */ let map = null;
    let done = false;
    let stage = 'style';
    const finish = (/** @type {string} */ reason) => {
      if (done) return; done = true; clearTimeout(timer);
      if (!reason) { resolve({ map, reason: '' }); return; }
      try { map?.remove(); } catch { /* already gone */ }
      resolve({ map: null, reason });
    };
    const timer = setTimeout(() => finish(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${stage}`), timeoutMs);
    try {
      const view = camToMapLibre(cam);
      map = new lib.Map({
        container, style, center: view.center, zoom: view.zoom,
        minZoom: -2, interactive: false, attributionControl: false,
        renderWorldCopies: true, fadeDuration: 0,
      });
    } catch (e) { finish(`map couldn't start: ${errText(e) || 'unknown error'}`); return; }
    // A listener stops MapLibre logging errors to the console. Before the
    // first full draw an error means fall back; after it, a missing tile just
    // leaves a gap under the arcs.
    map.on('error', (/** @type {any} */ e) => finish(`${stage === 'style' ? 'style' : 'tile'} error: ${errText(e?.error) || 'unknown'}`));
    map.once('load', () => { stage = 'tiles'; map.once('idle', () => finish('')); });
  });
}

/** @param {any} e */
function errText(e) {
  if (!e) return '';
  const status = e.status ? `HTTP ${e.status}` : '';
  const msg = String(e.message || e).slice(0, 120);
  return [status, msg].filter(Boolean).join(' ');
}

/**
 * Lazily start the basemap inside `stage`. Never rejects.
 * @param {HTMLElement} stage the .map-stage element
 * @param {{cx:number, cy:number, z:number}} cam
 * @param {{load?: (ms:number) => Promise<any>, fetch?: typeof fetch, timeoutMs?: number}} [opts]
 * @returns {Promise<{basemap: Basemap|null, reason: string, styleId?: string}>}
 */
export async function startBasemap(stage, cam, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  if (typeof location !== 'undefined' && /[?&]nobasemap\b/.test(location.search)) return { basemap: null, reason: 'turned off (?nobasemap)' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { basemap: null, reason: 'offline' };

  // Note CSP blocks while we try, so the reason can name the directive.
  /** @type {string[]} */ const csp = [];
  const onCsp = (/** @type {any} */ e) => {
    const uri = String(e.blockedURI || '');
    if (/unpkg\.com|openfreemap\.org|^blob/.test(uri)) csp.push(`${e.effectiveDirective || e.violatedDirective} ${uri.replace(/^https?:\/\//, '').slice(0, 60)}`);
  };
  document.addEventListener('securitypolicyviolation', onCsp);
  const withCsp = (/** @type {string} */ r) => (csp.length ? `blocked by CSP (${csp[0]})` : r);
  try {
    const t0 = Date.now();
    const left = () => Math.max(500, timeoutMs - (Date.now() - t0));
    const [libResult, styleResult] = await Promise.all([
      (opts.load || loadMapLibre)(timeoutMs).then((lib) => ({ lib, reason: '' }), (e) => ({ lib: null, reason: errText(e) || 'MapLibre failed to load' })),
      pickStyle(opts.fetch || fetch.bind(globalThis), timeoutMs),
    ]);
    if (!libResult.lib?.Map) return { basemap: null, reason: withCsp(libResult.reason || 'MapLibre failed to load') };
    if (!styleResult.style) return { basemap: null, reason: withCsp(styleResult.reason) };

    const host = document.createElement('div');
    host.className = `basemap${styleResult.style.invert ? ' basemap-invert' : ''}`; host.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.className = 'basemap-gl';
    host.appendChild(inner);
    stage.prepend(host);
    const { map, reason } = await initMap(libResult.lib, inner, styleResult.style.url, cam, left()); // by URL so relative sprite/glyph paths resolve
    if (!map) { host.remove(); return { basemap: null, reason: withCsp(reason) }; }
    // MapLibre's stylesheet sets its container to position: relative; if our
    // sizing rule lost, the map would be drawn 0 px tall and look "missing".
    if (!inner.clientHeight || !inner.clientWidth) {
      try { map.remove(); } catch { /* ignore */ }
      host.remove();
      return { basemap: null, reason: 'map container has no size (stylesheet conflict)' };
    }
    return { basemap: new Basemap(map, host), reason: '', styleId: styleResult.style.id };
  } finally {
    document.removeEventListener('securitypolicyviolation', onCsp);
  }
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
