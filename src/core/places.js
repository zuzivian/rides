// Cluster pickup/dropoff points into named places. Pure.
import { haversineKm, airportAt, airportInText, isCoord } from './geo.js';
import { localParts } from './time.js';

/** @typedef {import('./types.js').Trip} Trip */

/**
 * @typedef {Object} Place
 * @property {string} id         Stable key from the rounded centroid; used for renames.
 * @property {string} name       Display name (user rename > auto name).
 * @property {string} autoName
 * @property {'home'|'work'|'airport'|'place'} kind
 * @property {number} lat
 * @property {number} lng
 * @property {number} visits     Pickups + dropoffs.
 * @property {number} pickups
 * @property {number} dropoffs
 * @property {string} airportCode
 */

const RADIUS_KM = 0.25;

/**
 * Leader clustering with centroid refinement. Airport points snap to the
 * airport so every terminal counts as one place.
 * @param {Trip[]} trips
 * @param {{names?: Record<string,string>, radiusKm?: number}} [opts]
 * @returns {{places: Place[], fromPlace: (string|null)[], toPlace: (string|null)[]}}
 */
export function clusterPlaces(trips, opts = {}) {
  const radius = opts.radiusKm ?? RADIUS_KM;
  /** @type {{lat:number,lng:number,sumLat:number,sumLng:number,n:number,airport:string,addresses:Map<string,number>,pickups:number,dropoffs:number,members:{trip:number,end:'from'|'to'}[]}[]} */
  const clusters = [];
  /** @type {Map<string, number>} */
  const airportIdx = new Map();

  /** @param {number} lat @param {number} lng @param {string} address */
  const assign = (lat, lng, address) => {
    const ap = airportAt(lat, lng) || (address ? airportInText(address) : null);
    if (ap && ap.code) {
      let idx = airportIdx.get(ap.code);
      if (idx == null) {
        idx = clusters.length;
        clusters.push({ lat, lng, sumLat: 0, sumLng: 0, n: 0, airport: ap.code, addresses: new Map(), pickups: 0, dropoffs: 0, members: [] });
        airportIdx.set(ap.code, idx);
      }
      return idx;
    }
    let best = -1; let bestD = radius;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (c.airport) continue;
      if (Math.abs(c.lat - lat) > 0.01 || Math.abs(c.lng - lng) > 0.013) continue;
      const d = haversineKm(lat, lng, c.lat, c.lng);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best === -1) {
      best = clusters.length;
      clusters.push({ lat, lng, sumLat: 0, sumLng: 0, n: 0, airport: '', addresses: new Map(), pickups: 0, dropoffs: 0, members: [] });
    }
    return best;
  };

  /** @type {(number|null)[]} */
  const fromIdx = new Array(trips.length).fill(null);
  /** @type {(number|null)[]} */
  const toIdx = new Array(trips.length).fill(null);

  trips.forEach((t, i) => {
    for (const end of /** @type {const} */ (['from', 'to'])) {
      const lat = end === 'from' ? t.fromLat : t.toLat;
      const lng = end === 'from' ? t.fromLng : t.toLng;
      if (!isCoord(lat) || !isCoord(lng)) continue;
      const address = end === 'from' ? t.fromAddress : t.toAddress;
      const ci = assign(/** @type {number} */ (lat), /** @type {number} */ (lng), address);
      const c = clusters[ci];
      c.sumLat += /** @type {number} */ (lat); c.sumLng += /** @type {number} */ (lng); c.n++;
      if (!c.airport) { c.lat = c.sumLat / c.n; c.lng = c.sumLng / c.n; }
      if (end === 'from') { c.pickups++; fromIdx[i] = ci; } else { c.dropoffs++; toIdx[i] = ci; }
      c.members.push({ trip: i, end });
      if (address) c.addresses.set(address, (c.addresses.get(address) || 0) + 1);
    }
  });
  for (const c of clusters) if (c.airport) { c.lat = c.sumLat / c.n; c.lng = c.sumLng / c.n; }

  // Score Home / Work from time-of-day patterns.
  const homeScore = new Array(clusters.length).fill(0);
  const workScore = new Array(clusters.length).fill(0);
  trips.forEach((t, i) => {
    const p = localParts(t.start, t.tz);
    const weekday = p.weekday < 5;
    const f = fromIdx[i]; const to = toIdx[i];
    if (f != null && p.hour >= 5 && p.hour < 11) homeScore[f] += 1;
    if (to != null && (p.hour >= 18 || p.hour < 5)) homeScore[to] += 1;
    if (to != null && weekday && p.hour >= 6 && p.hour < 11) workScore[to] += 1;
    if (f != null && weekday && p.hour >= 15 && p.hour < 21) workScore[f] += 1;
  });
  let home = -1; let work = -1;
  clusters.forEach((c, i) => {
    if (c.airport) return;
    if (home === -1 || homeScore[i] > homeScore[home]) home = i;
  });
  if (home !== -1 && homeScore[home] < 3) home = -1;
  clusters.forEach((c, i) => {
    if (c.airport || i === home) return;
    if (work === -1 || workScore[i] > workScore[work]) work = i;
  });
  if (work !== -1 && workScore[work] < 6) work = -1;

  const names = opts.names || {};
  /** @type {Map<string, number>} */
  const used = new Map();
  /** @type {Place[]} */
  const places = clusters.map((c, i) => {
    const id = c.airport ? `ap:${c.airport}` : `c:${c.lat.toFixed(3)},${c.lng.toFixed(3)}`;
    /** @type {Place['kind']} */
    let kind = 'place';
    let autoName = '';
    if (c.airport) { kind = 'airport'; autoName = c.airport; }
    else if (i === home) { kind = 'home'; autoName = 'Home'; }
    else if (i === work) { kind = 'work'; autoName = 'Work'; }
    else autoName = nameFromAddresses(c.addresses) || `Spot ${i + 1}`;
    const n = (used.get(autoName) || 0) + 1; used.set(autoName, n);
    if (n > 1) autoName = `${autoName} (${n})`;
    return {
      id, kind, autoName, name: names[id] || autoName,
      lat: c.lat, lng: c.lng, visits: c.n, pickups: c.pickups, dropoffs: c.dropoffs, airportCode: c.airport,
    };
  });
  const ids = places.map((p) => p.id);
  return {
    places,
    fromPlace: fromIdx.map((i) => (i == null ? null : ids[i])),
    toPlace: toIdx.map((i) => (i == null ? null : ids[i])),
  };
}

/**
 * Turn the most common address into a short label: "1234 Valencia St, San
 * Francisco, CA" → "Valencia St". Venue names (no leading number) are kept.
 * @param {Map<string, number>} addresses
 */
export function nameFromAddresses(addresses) {
  let best = ''; let bestN = 0;
  for (const [a, n] of addresses) if (n > bestN) { best = a; bestN = n; }
  if (!best) return '';
  const first = best.split(',')[0].trim();
  const street = first.replace(/^\d+[A-Za-z]?(-\d+)?\s+/, '').replace(/^(unit|apt|suite)\s+\S+\s+/i, '');
  return street.length > 28 ? `${street.slice(0, 27)}…` : street;
}
