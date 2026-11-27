// Rides the user adds by hand: one tap for pickup, one for dropoff. Pure.
// Distance and time are estimates from the straight line, and are marked so.
import { haversineKm, guessTimeZone, metroAt, airportAt, isCoord } from './geo.js';
import { localParts, zonedToUtc } from './time.js';

/** @typedef {import('./types.js').Trip} Trip */

/**
 * @typedef {Object} Stop
 * @property {number} lat
 * @property {number} lng
 * @property {string} [name]  "near Whole Foods Market", "Home", "SFO"
 */

/** Roads are longer than the straight line: a typical city detour factor. */
export const ROAD_FACTOR = 1.3;
/** Average door-to-door city speed for the time estimate, km/h. */
export const CITY_KMH = 24;

/** Estimated road km and minutes for a straight-line distance. @param {number} lineKm */
export function estimate(lineKm) {
  const km = lineKm * ROAD_FACTOR;
  const minutes = Math.max(4, Math.round(3 + (km / CITY_KMH) * 60));
  return { km, minutes };
}

/**
 * Build a Trip from two stops.
 * @param {{from: Stop, to: Stop, start: number, fare?: number|null, currency?: string, id?: string, series?: string}} o
 * @returns {Trip & {estimated: true, series?: string}}
 */
export function makeManualTrip(o) {
  const { from, to } = o;
  if (![from?.lat, from?.lng, to?.lat, to?.lng].every(isCoord)) throw new Error('Both stops need a map position.');
  if (!Number.isFinite(o.start)) throw new Error('A ride needs a time.');
  const { km, minutes } = estimate(haversineKm(from.lat, from.lng, to.lat, to.lng));
  const tz = guessTimeZone(from.lat, from.lng, 'UTC');
  const metro = metroAt(from.lat, from.lng) || metroAt(to.lat, to.lng);
  const fare = o.fare != null && Number.isFinite(o.fare) && o.fare >= 0 ? Math.round(o.fare * 100) / 100 : null;
  return {
    id: o.id || `m-${Math.round(o.start / 1000).toString(36)}-${Math.round((from.lat + to.lng) * 1e4).toString(36)}`,
    source: 'manual', start: o.start, end: o.start + minutes * 60000, requested: null, tz,
    fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng,
    fromAddress: stopLabel(from), toAddress: stopLabel(to),
    km, fare, currency: fare != null ? (o.currency || '') : '', product: '',
    city: metro?.name || '',
    estimated: true, ...(o.series ? { series: o.series } : {}),
  };
}

/** @param {Stop} s */
function stopLabel(s) {
  const ap = airportAt(s.lat, s.lng);
  if (ap) return `${ap.code} airport`;
  return (s.name || '').slice(0, 60);
}

/**
 * A usual commute from one entry: Home → Work in the morning and back in the
 * evening, on the chosen weekdays, for the past `weeks` weeks (never in the
 * future). Every ride carries the same `series` id so they can be removed
 * together.
 * @param {{home: Stop, work: Stop, now: number, tz?: string, weeks?: number, weekdays?: number[], out?: [number, number], back?: [number, number], series?: string}} o
 *   weekdays: 0 = Monday … 6 = Sunday (default Mon–Fri). out/back: [hour, minute] local.
 * @returns {Trip[]}
 */
export function commuteTrips(o) {
  const tz = o.tz || guessTimeZone(o.home.lat, o.home.lng, 'UTC');
  const weeks = Math.max(1, Math.min(52, o.weeks ?? 4));
  const days = new Set(o.weekdays ?? [0, 1, 2, 3, 4]);
  const out = o.out || [8, 30]; const back = o.back || [17, 45];
  const series = o.series || `commute-${Math.round(o.now / 1000).toString(36)}`;
  const today = localParts(o.now, tz);
  /** @type {Trip[]} */
  const trips = [];
  for (let d = weeks * 7; d >= 0; d--) {
    // Walk back by calendar day in the local zone (noon avoids DST edges).
    const noon = zonedToUtc({ year: today.year, month: today.month, day: today.day - d, hour: 12 }, tz);
    const p = localParts(noon, tz);
    if (!days.has(p.weekday)) continue;
    for (const [from, to, [h, m], leg] of /** @type {const} */ ([[o.home, o.work, out, 'am'], [o.work, o.home, back, 'pm']])) {
      const start = zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: h, minute: m }, tz);
      if (start > o.now) continue;
      trips.push(makeManualTrip({ from, to, start, series, id: `${series}-${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}-${leg}` }));
    }
  }
  return trips;
}

/**
 * Check and clean trips read back from storage. Drops anything malformed.
 * @param {unknown} raw
 * @returns {Trip[]}
 */
export function readManual(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Trip[]} */
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = /** @type {any} */ (t);
    if (r.source !== 'manual' || typeof r.id !== 'string' || !Number.isFinite(r.start)) continue;
    try {
      out.push(makeManualTrip({
        id: r.id.slice(0, 80), start: r.start, series: typeof r.series === 'string' ? r.series.slice(0, 60) : undefined,
        from: { lat: r.fromLat, lng: r.fromLng, name: String(r.fromAddress || '') },
        to: { lat: r.toLat, lng: r.toLng, name: String(r.toAddress || '') },
        fare: typeof r.fare === 'number' ? r.fare : null, currency: typeof r.currency === 'string' ? r.currency.slice(0, 3) : '',
      }));
    } catch { /* skip */ }
  }
  return out.sort((a, b) => a.start - b.start);
}
