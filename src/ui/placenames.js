// Name places from OpenFreeMap vector tiles (Nat's decision, 26 Nov 2026:
// "just show the exact places"). For each place without a nickname, fetch the
// z14 tile that contains it, decode it on this device and pick the most
// specific name nearby. Requests carry only tile z/x/y numbers, to
// tiles.openfreemap.org only. No coordinates or ride data are sent.
import { readTile, tileFor } from '../core/mvt.js';
import { pickPlaceName, toMapFeatures, TILE_LAYERS } from '../core/placeguess.js';
import { pickStyle } from './basemap.js';

export const TILE_Z = 14;
const HOST = 'https://tiles.openfreemap.org/';

/** @type {Map<string, Promise<Record<string, any[]>|null>>} decoded tiles, per page */
const tiles = new Map();
/** @type {Promise<string>|null} */
let templatePromise = null;

/**
 * The tile URL template from the style's vector source (TileJSON).
 * @param {typeof fetch} f
 */
async function tileTemplate(f) {
  const picked = await pickStyle(f);
  if (!picked.style) throw new Error(picked.reason);
  const src = Object.values(picked.json.sources || {}).find((s) => s && s.type === 'vector');
  if (!src) throw new Error('style has no vector source');
  let list = src.tiles;
  if (!list && src.url) {
    if (!String(src.url).startsWith(HOST)) throw new Error('tile source on another host');
    const res = await f(src.url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`);
    list = (await res.json()).tiles;
  }
  const t = Array.isArray(list) ? String(list[0] || '') : '';
  if (!t.startsWith(HOST) || !/\{z\}.*\{x\}.*\{y\}/.test(t)) throw new Error('unexpected tile URL');
  return t;
}

/** @param {Uint8Array} bytes */
async function gunzipIfNeeded(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || typeof DecompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {typeof fetch} f @param {string} template @param {{z:number,x:number,y:number}} t
 * @returns {Promise<Record<string, any[]>|null>}
 */
function loadTile(f, template, t) {
  const key = `${t.z}/${t.x}/${t.y}`;
  let p = tiles.get(key);
  if (!p) {
    const url = template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
    p = f(url, { referrerPolicy: 'no-referrer', credentials: 'omit' })
      .then(async (res) => (res.ok ? readTile(await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer())), t, TILE_LAYERS) : null))
      .catch(() => null);
    tiles.set(key, p);
  }
  return p;
}

/**
 * Name every place that has no nickname and no cached tile name yet.
 * Calls onNames(ids) for places whose name changed. Never rejects.
 * @param {{id:string, lat:number, lng:number, nameSource:string}[]} places
 * @param {Record<string, {name: string, z: number, kind?: string}>} cache  updated in place
 * @param {{fetch?: typeof fetch, onNames: (ids: string[]) => void, concurrency?: number}} opts
 * @returns {Promise<{tiles: number, named: number, reason: string}>}
 */
export async function nameFromTiles(places, cache, opts) {
  if (typeof location !== 'undefined' && /[?&]nobasemap\b/.test(location.search)) return { tiles: 0, named: 0, reason: 'turned off (?nobasemap)' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tiles: 0, named: 0, reason: 'offline' };
  const f = opts.fetch || fetch.bind(globalThis);
  const todo = places.filter((p) => p.nameSource !== 'nickname' && p.nameSource !== 'kind' && !(cache[p.id]?.z >= TILE_Z));
  if (!todo.length) return { tiles: 0, named: 0, reason: '' };
  let template;
  try { template = await (templatePromise ||= tileTemplate(f).catch((e) => { templatePromise = null; throw e; })); } catch (e) {
    return { tiles: 0, named: 0, reason: String(/** @type {any} */ (e)?.message || e) };
  }
  /** @type {Map<string, {t: {z:number,x:number,y:number}, places: typeof todo}>} */
  const byTile = new Map();
  for (const p of todo) {
    const t = tileFor(p.lat, p.lng, TILE_Z);
    const k = `${t.x}/${t.y}`;
    const e = byTile.get(k) || { t, places: [] };
    e.places.push(p); byTile.set(k, e);
  }
  const queue = [...byTile.values()];
  let named = 0;
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const layers = await loadTile(f, /** @type {string} */ (template), job.t);
      if (!layers) continue;
      const feats = TILE_LAYERS.flatMap((l) => toMapFeatures(layers[l] || [], l));
      /** @type {string[]} */
      const changed = [];
      for (const p of job.places) {
        const g = pickPlaceName(p.lat, p.lng, feats);
        const prev = cache[p.id];
        // An empty name records "looked, nothing here" so the tile isn't fetched again.
        cache[p.id] = { name: g?.name || '', kind: g?.kind || '', z: TILE_Z };
        if (g && g.name !== prev?.name) { changed.push(p.id); named++; }
      }
      if (changed.length) opts.onNames(changed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker));
  return { tiles: byTile.size, named, reason: '' };
}
