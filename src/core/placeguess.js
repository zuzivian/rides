// Name a place from nearby map features in OpenMapTiles data: points of
// interest, house numbers, street names and neighbourhood labels. Pure: the
// caller supplies the features (from a decoded tile, or from MapLibre).
import { haversineKm } from './geo.js';

/**
 * @typedef {Object} MapFeature
 * @property {'poi'|'place'|'housenumber'|'street'} layer
 * @property {string} name           POI/place/street name, or the house number
 * @property {string} [cls]          OpenMapTiles `class`
 * @property {number} [rank]         Lower is more prominent
 * @property {number} lat            Points only
 * @property {number} lng
 * @property {[number, number][][]} [lines]  Streets: [lng, lat] polylines
 */

/**
 * @typedef {'poi'|'address'|'street'|'area'} NameKind
 * poi and address are exact enough to beat an export's street name; street
 * and area are not.
 */

export const POI_EXACT_M = 40;
export const POI_RADIUS_M = 120;
const HOUSE_M = 25;
const STREET_M = 35;
/** Place-label classes we use, with how far (metres) each may reach. */
const AREA_REACH = /** @type {Record<string, number>} */ ({ neighbourhood: 1500, quarter: 1500, suburb: 2500, hamlet: 2000, village: 3000, isolated_dwelling: 800, locality: 1500, town: 4000 });
/** POI classes that name nothing useful on their own. */
const VAGUE_POI = new Set(['bus', 'railway_halt', 'parking', 'bicycle_rental', 'toilets', 'atm', 'post', 'telephone', 'bench', 'waste_basket', 'drinking_water', 'fountain', 'information', 'charging_station', 'car', 'fuel', 'shelter', 'vending']);

/** Metres from point to segment, in a local flat projection around lat. */
function segDistM(lat, lng, a, b) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180); const ky = 110540;
  const ax = (a[0] - lng) * kx; const ay = (a[1] - lat) * ky;
  const bx = (b[0] - lng) * kx; const by = (b[1] - lat) * ky;
  const dx = bx - ax; const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * The most specific real name for the point at lat/lng, in this order:
 * a POI right there ("Whole Foods Market"), a street address ("1200 9th
 * Ave"), a POI nearby ("near Whole Foods Market"), an intersection ("9th
 * Ave & Irving St") or street, then the neighbourhood ("Inner Sunset").
 * @param {number} lat @param {number} lng
 * @param {MapFeature[]} features
 * @returns {{name: string, kind: NameKind, metres: number}|null}
 */
export function pickPlaceName(lat, lng, features) {
  let poi = null; let poiScore = Infinity; let poiD = 0;
  let house = null; let houseD = Infinity;
  let area = null; let areaScore = Infinity; let areaD = 0;
  /** @type {Map<string, number>} */
  const streets = new Map();
  for (const f of features) {
    const name = cleanName(f.name);
    if (!name) continue;
    if (f.layer === 'street') {
      let d = Infinity;
      for (const line of f.lines || []) for (let i = 1; i < line.length; i++) d = Math.min(d, segDistM(lat, lng, line[i - 1], line[i]));
      if (d <= STREET_M && d < (streets.get(name) ?? Infinity)) streets.set(name, d);
      continue;
    }
    const d = haversineKm(lat, lng, f.lat, f.lng) * 1000;
    if (f.layer === 'poi') {
      if (d > POI_RADIUS_M || VAGUE_POI.has(f.cls || '')) continue;
      const score = d + Math.min(f.rank ?? 30, 60) * 1.5; // prominence breaks near-ties
      if (score < poiScore) { poiScore = score; poi = name; poiD = d; }
    } else if (f.layer === 'housenumber') {
      if (d <= HOUSE_M && d < houseD) { houseD = d; house = name; }
    } else if (f.layer === 'place') {
      const reach = AREA_REACH[f.cls || ''];
      if (!reach || d > reach) continue;
      const score = d / reach;
      if (score < areaScore) { areaScore = score; area = name; areaD = d; }
    }
  }
  const byDist = [...streets].sort((a, b) => a[1] - b[1]);
  if (poi && poiD <= POI_EXACT_M) return { name: poi, kind: 'poi', metres: Math.round(poiD) };
  if (house && byDist.length) return { name: `${house} ${byDist[0][0]}`, kind: 'address', metres: Math.round(houseD) };
  if (poi) return { name: `near ${poi}`, kind: 'poi', metres: Math.round(poiD) };
  if (byDist.length >= 2) return { name: `${byDist[0][0]} & ${byDist[1][0]}`, kind: 'street', metres: Math.round(byDist[1][1]) };
  if (byDist.length === 1) return { name: byDist[0][0], kind: 'street', metres: Math.round(byDist[0][1]) };
  if (area) return { name: area, kind: 'area', metres: Math.round(areaD) };
  return null;
}

/** @param {unknown} s */
function cleanName(s) {
  const n = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  return n.length > 40 ? `${n.slice(0, 39)}…` : n;
}

const LAYER = /** @type {Record<string, MapFeature['layer']>} */ ({ poi: 'poi', place: 'place', housenumber: 'housenumber', transportation_name: 'street' });
export const TILE_LAYERS = Object.keys(LAYER);

/**
 * Turn GeoJSON-like features (MapLibre's querySourceFeatures, or readTile's
 * output) from one OpenMapTiles layer into MapFeatures. Prefers English names.
 * @param {any[]} raw
 * @param {string} layer  source layer name, e.g. "poi" or "transportation_name"
 * @returns {MapFeature[]}
 */
export function toMapFeatures(raw, layer) {
  const kind = LAYER[layer] || /** @type {any} */ (layer);
  /** @type {MapFeature[]} */
  const out = [];
  for (const f of raw || []) {
    const p = f?.properties || {};
    const name = kind === 'housenumber' ? String(p.housenumber ?? '') : (p.name_en || p['name:en'] || p.name || p['name:latin'] || '');
    if (!name) continue;
    const g = f.geometry;
    // MapLibre gives GeoJSON geometry; readTile gives [[lng, lat], …] parts.
    const parts = Array.isArray(g) ? g
      : g?.type === 'Point' ? [[g.coordinates]]
        : g?.type === 'MultiPoint' ? g.coordinates.map((c) => [c])
          : g?.type === 'LineString' ? [g.coordinates]
            : g?.type === 'MultiLineString' ? g.coordinates : null;
    if (!parts || !parts.length || !parts[0]?.length) continue;
    const base = { layer: kind, name: String(name), cls: p.class || p.subclass || '', rank: typeof p.rank === 'number' ? p.rank : undefined };
    if (kind === 'street') { out.push({ ...base, lat: parts[0][0][1], lng: parts[0][0][0], lines: parts }); continue; }
    const isPoint = Array.isArray(g) ? f.type === 1 : /Point/.test(g.type);
    if (!isPoint) continue;
    for (const part of parts) out.push({ ...base, lng: part[0][0], lat: part[0][1] });
  }
  return out;
}
