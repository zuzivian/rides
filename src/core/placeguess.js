// Guess a real-world name for a place from nearby map features (points of
// interest and neighbourhood labels from the basemap's vector tiles). Pure:
// the caller supplies the features. No network, no DOM.
import { haversineKm } from './geo.js';

/**
 * @typedef {Object} MapFeature
 * @property {'poi'|'place'} layer   OpenMapTiles source layer
 * @property {string} name
 * @property {string} [cls]          OpenMapTiles `class` (e.g. "cafe", "neighbourhood")
 * @property {number} [rank]         Lower is more prominent
 * @property {number} lat
 * @property {number} lng
 */

/** How far a point of interest may be from a place's centre to name it. */
export const POI_RADIUS_M = 120;
/** Place-label classes we use, with how far (metres) each may reach. */
const AREA_REACH = /** @type {Record<string, number>} */ ({ neighbourhood: 1500, quarter: 1500, suburb: 2500, hamlet: 2000, village: 3000, isolated_dwelling: 800, locality: 1500, town: 4000 });
/** POI classes that name nothing useful on their own. */
const VAGUE_POI = new Set(['bus', 'railway_halt', 'parking', 'bicycle_rental', 'toilets', 'atm', 'post', 'telephone', 'bench', 'waste_basket', 'drinking_water', 'fountain', 'information', 'charging_station', 'car', 'fuel']);

/**
 * Pick a name for the point at lat/lng: the closest, most prominent point of
 * interest within POI_RADIUS_M ("near Whole Foods", or the name itself when
 * it's right there), else the closest neighbourhood or suburb label.
 * @param {number} lat @param {number} lng
 * @param {MapFeature[]} features
 * @returns {{name: string, kind: 'poi'|'area', metres: number}|null}
 */
export function pickPlaceName(lat, lng, features) {
  let poi = null; let poiScore = Infinity; let poiD = 0;
  let area = null; let areaScore = Infinity; let areaD = 0;
  for (const f of features) {
    const name = cleanName(f.name);
    if (!name) continue;
    const d = haversineKm(lat, lng, f.lat, f.lng) * 1000;
    if (f.layer === 'poi') {
      if (d > POI_RADIUS_M || VAGUE_POI.has(f.cls || '')) continue;
      const score = d + Math.min(f.rank ?? 30, 60) * 1.5; // prominence breaks near-ties
      if (score < poiScore) { poiScore = score; poi = name; poiD = d; }
    } else if (f.layer === 'place') {
      const reach = AREA_REACH[f.cls || ''];
      if (!reach || d > reach) continue;
      const score = d / reach;
      if (score < areaScore) { areaScore = score; area = name; areaD = d; }
    }
  }
  if (poi) return { name: poiD <= 30 ? poi : `near ${poi}`, kind: 'poi', metres: Math.round(poiD) };
  if (area) return { name: area, kind: 'area', metres: Math.round(areaD) };
  return null;
}

/** @param {unknown} s */
function cleanName(s) {
  const n = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 40) return n.length > 40 ? `${n.slice(0, 39)}…` : '';
  return n;
}

/**
 * Turn raw vector-tile features (as MapLibre's querySourceFeatures returns
 * them, GeoJSON-like) into MapFeatures. Prefers English names.
 * @param {any[]} raw
 * @param {'poi'|'place'} layer
 * @returns {MapFeature[]}
 */
export function toMapFeatures(raw, layer) {
  /** @type {MapFeature[]} */
  const out = [];
  for (const f of raw || []) {
    const g = f?.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    const p = f.properties || {};
    const name = p.name_en || p['name:en'] || p.name || p['name:latin'] || '';
    if (!name) continue;
    out.push({ layer, name, cls: p.class || p.subclass || '', rank: typeof p.rank === 'number' ? p.rank : undefined, lng: g.coordinates[0], lat: g.coordinates[1] });
  }
  return out;
}
