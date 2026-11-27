// Cluster pickup/dropoff points into named places. Pure.
import { haversineKm, airportAt, airportInText, isCoord, metroAt, METROS } from './geo.js';
import { localParts } from './time.js';

/** @typedef {import('./types.js').Trip} Trip */

/**
 * @typedef {Object} Place
 * @property {string} id         Stable key from the rounded centroid; used for renames.
 * @property {string} name       Display name (user rename > auto name).
 * @property {string} autoName
 * @property {'nickname'|'kind'|'map'|'address'|'pattern'|'area'} nameSource  Where `name` came from: 'map' is from OpenFreeMap tile data near the place; 'pattern' and 'area' are guesses worth renaming.
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
 * @param {{names?: Record<string,string>, guesses?: Record<string, string|{name: string, kind?: string}>, radiusKm?: number, unit?: 'mi'|'km'}} [opts]
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

  // Reference points for area labels: Home when it's in the same metro, else the
  // visit-weighted centre of this rider's places in that metro.
  const metroOf = clusters.map((c) => metroAt(c.lat, c.lng)?.name || '');
  /** @type {Map<string, {lat:number, lng:number, w:number}>} */
  const centres = new Map();
  clusters.forEach((c, i) => {
    if (!metroOf[i]) return;
    const m = centres.get(metroOf[i]) || { lat: 0, lng: 0, w: 0 };
    m.lat += c.lat * c.n; m.lng += c.lng * c.n; m.w += c.n; centres.set(metroOf[i], m);
  });
  /** @param {number} i */
  const refFor = (i) => {
    const metro = metroOf[i];
    if (!metro) return null;
    if (home !== -1 && metroOf[home] === metro) return { lat: clusters[home].lat, lng: clusters[home].lng, label: 'of Home' };
    const m = /** @type {{lat:number,lng:number,w:number}} */ (centres.get(metro));
    return { lat: m.lat / m.w, lng: m.lng / m.w, label: '' };
  };

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
    /** @type {Place['nameSource']} */
    let source = 'kind';
    if (!autoName) {
      // Map names: a POI or street address beats the export's street; a
      // street or neighbourhood only fills in where the export has nothing.
      const g = opts.guesses?.[id];
      const guess = typeof g === 'string' ? { name: g, kind: 'street' } : g;
      if (guess?.name && (guess.kind === 'poi' || guess.kind === 'address')) { autoName = guess.name; source = 'map'; }
      if (!autoName) { autoName = nameFromAddresses(c.addresses); source = 'address'; }
      if (!autoName && guess?.name) { autoName = guess.name; source = 'map'; }
      if (!autoName) {
        const pattern = patternLabel(c.members.map((m) => ({ trip: trips[m.trip], end: m.end })));
        const area = areaLabel(c.lat, c.lng, opts.unit || 'mi', refFor(i));
        autoName = pattern ? `${pattern} · ${area}` : area;
        source = pattern ? 'pattern' : 'area';
      }
    }
    if (source === 'map' && used.has(autoName)) {
      // Several places in one neighbourhood: tell them apart by when you go.
      const pattern = patternLabel(c.members.map((m) => ({ trip: trips[m.trip], end: m.end })));
      if (pattern) autoName = `${autoName} · ${pattern}`;
    }
    const n = (used.get(autoName) || 0) + 1; used.set(autoName, n);
    if (n > 1) autoName = `${autoName} (${n})`;
    return {
      id, kind, autoName, name: names[id] || autoName, nameSource: names[id] ? 'nickname' : source,
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

/** Address text that names nothing: blanks, placeholders, bare coordinates. */
const JUNK_ADDRESS = /^\s*(|-|n\/?a|null|none|unknown|undefined|\(?-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\)?)\s*$/i;

/**
 * Short label for one address: "1234 Valencia St, San Francisco, CA" →
 * "Valencia St"; "9th Ave & Irving St, SF" → "9th Ave & Irving St"; venue
 * names ("Salesforce Tower, 415 Mission St") are kept. '' if nothing usable.
 * @param {string} address
 */
export function shortAddress(address) {
  const a = String(address || '').replace(/\s+/g, ' ').trim();
  if (JUNK_ADDRESS.test(a)) return '';
  const parts = a.split(/\s*[,\n;]\s*/).filter(Boolean);
  for (const part of parts.slice(0, 2)) {
    let p = part
      .replace(/^(unit|apt|suite|ste|#)\s*\S+\s+/i, '')
      .replace(/^\d+[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?\s+/, '') // house number or range
      .replace(/\s+(#|unit|apt|suite|ste)\s*\S+$/i, '')
      .trim();
    if (!p || /^\d+[A-Za-z]?$/.test(p) || JUNK_ADDRESS.test(p)) continue; // "1200" alone, then try the next part
    if (/^[A-Z]{2}\s+\d{4,5}/.test(p)) continue; // "CA 94110"
    return p.length > 28 ? `${p.slice(0, 27)}…` : p;
  }
  return '';
}

/**
 * The most common short label among a place's addresses, so "500 Howard St"
 * and "510 Howard St" both count towards "Howard St".
 * @param {Map<string, number>} addresses
 */
export function nameFromAddresses(addresses) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const [a, n] of addresses) {
    const s = shortAddress(a);
    if (s) counts.set(s, (counts.get(s) || 0) + n);
  }
  let best = ''; let bestN = 0;
  for (const [s, n] of counts) if (n > bestN) { best = s; bestN = n; }
  return best;
}

/**
 * A guess from when rides start or end here, for places without addresses.
 * Needs at least 3 visits and a clear majority, otherwise ''.
 * @param {{trip: Trip, end: 'from'|'to'}[]} members
 */
export function patternLabel(members) {
  const n = members.length;
  if (n < 3) return '';
  let work = 0; let late = 0; let weekend = 0; let gym = 0;
  for (const { trip, end } of members) {
    const t = end === 'to' && trip.end != null ? trip.end : trip.start;
    const p = localParts(t, trip.tz);
    const weekday = p.weekday < 5;
    if (weekday && ((end === 'to' && p.hour >= 7 && p.hour < 10) || (end === 'from' && p.hour >= 16 && p.hour < 19))) work++;
    if (p.hour >= 22 || p.hour < 3) late++;
    if (!weekday) weekend++;
    if (p.hour >= 5 && p.hour < 8 && trip.km != null && trip.km < 5) gym++;
  }
  if (gym / n >= 0.5) return 'Gym?';
  if (work / n >= 0.5) return 'Work?';
  if (late / n >= 0.5) return 'Late nights';
  if (weekend / n >= 0.7) return 'Weekends';
  return '';
}

const SHORT_METRO = /** @type {Record<string, string>} */ ({ 'San Francisco Bay Area': 'SF', 'Los Angeles': 'LA', 'New York': 'NYC', 'Washington, DC': 'DC', 'Mexico City': 'CDMX', 'Hong Kong': 'HK' });
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Where a place sits: "0.8 mi NE of Home" when Home is in the same metro,
 * otherwise "London · 1.2 mi SW" from the centre of the rider's places there
 * (or from the metro centre when no reference is given). Outside known
 * metros, a rounded coordinate.
 * @param {number} lat @param {number} lng @param {'mi'|'km'} [unit]
 * @param {{lat:number, lng:number, label:string}|null} [ref]
 */
export function areaLabel(lat, lng, unit = 'mi', ref = null) {
  const metro = metroAt(lat, lng);
  const row = metro && METROS.find((m) => m[0] === metro.name);
  if (!row) return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
  const city = SHORT_METRO[row[0]] || row[0];
  const o = ref || { lat: row[1], lng: row[2], label: '' };
  const km = haversineKm(o.lat, o.lng, lat, lng);
  const dist = unit === 'km' ? km : km / 1.609344;
  if (dist < 0.15) return o.label ? `Next to Home` : `${city} · centre`;
  const y = lat - o.lat; const x = (lng - o.lng) * Math.cos((lat * Math.PI) / 180);
  const dir = COMPASS[Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 / 45) % 8];
  const d = dist < 10 ? dist.toFixed(1) : String(Math.round(dist));
  return o.label ? `${d} ${unit} ${dir} ${o.label}` : `${city} · ${d} ${unit} ${dir}`;
}
