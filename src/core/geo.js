// Geography helpers: distances, known airports, metro areas, zone guesses.

const R_KM = 6371.0088;
export const KM_PER_MILE = 1.609344;

/** Great-circle distance in km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** @param {unknown} v */
export function isCoord(v) {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0;
}

/**
 * Commercial airports, enough to catch most rideshare airport runs.
 * [IATA code, name, lat, lng, radius km]
 * @type {[string, string, number, number, number][]}
 */
export const AIRPORTS = [
  ['SFO', 'San Francisco Intl', 37.6213, -122.3790, 3.2],
  ['OAK', 'Oakland Intl', 37.7126, -122.2197, 2.5],
  ['SJC', 'San José Intl', 37.3639, -121.9289, 2.2],
  ['LAX', 'Los Angeles Intl', 33.9416, -118.4085, 3],
  ['BUR', 'Hollywood Burbank', 34.2007, -118.3587, 1.6],
  ['SAN', 'San Diego Intl', 32.7338, -117.1933, 1.8],
  ['SEA', 'Seattle–Tacoma Intl', 47.4502, -122.3088, 2.8],
  ['PDX', 'Portland Intl', 45.5898, -122.5951, 2.5],
  ['LAS', 'Las Vegas Harry Reid', 36.0840, -115.1537, 2.5],
  ['PHX', 'Phoenix Sky Harbor', 33.4352, -112.0101, 2.8],
  ['DEN', 'Denver Intl', 39.8561, -104.6737, 5],
  ['DFW', 'Dallas/Fort Worth', 32.8998, -97.0403, 5],
  ['AUS', 'Austin–Bergstrom', 30.1975, -97.6664, 2.5],
  ['IAH', 'Houston Bush', 29.9902, -95.3368, 4],
  ['ORD', "Chicago O'Hare", 41.9742, -87.9073, 4],
  ['MDW', 'Chicago Midway', 41.7868, -87.7522, 1.6],
  ['ATL', 'Atlanta Hartsfield–Jackson', 33.6407, -84.4277, 3.5],
  ['MIA', 'Miami Intl', 25.7959, -80.2870, 3],
  ['MCO', 'Orlando Intl', 28.4312, -81.3081, 3.5],
  ['IAD', 'Washington Dulles', 38.9531, -77.4565, 3.5],
  ['DCA', 'Washington National', 38.8512, -77.0402, 1.6],
  ['BOS', 'Boston Logan', 42.3656, -71.0096, 2.5],
  ['JFK', 'New York JFK', 40.6413, -73.7781, 3.5],
  ['LGA', 'New York LaGuardia', 40.7769, -73.8740, 2],
  ['EWR', 'Newark Liberty', 40.6895, -74.1745, 3],
  ['YYZ', 'Toronto Pearson', 43.6777, -79.6248, 3.5],
  ['YVR', 'Vancouver Intl', 49.1967, -123.1815, 3],
  ['MEX', 'Mexico City Intl', 19.4361, -99.0719, 3],
  ['LHR', 'London Heathrow', 51.4700, -0.4543, 4],
  ['LGW', 'London Gatwick', 51.1537, -0.1821, 2.5],
  ['CDG', 'Paris Charles de Gaulle', 49.0097, 2.5479, 4],
  ['AMS', 'Amsterdam Schiphol', 52.3105, 4.7683, 3.5],
  ['FRA', 'Frankfurt', 50.0379, 8.5622, 3.5],
  ['DXB', 'Dubai Intl', 25.2532, 55.3657, 3.5],
  ['SIN', 'Singapore Changi', 1.3644, 103.9915, 3.5],
  ['HKG', 'Hong Kong Intl', 22.3080, 113.9185, 3.5],
  ['NRT', 'Tokyo Narita', 35.7720, 140.3929, 3.5],
  ['HND', 'Tokyo Haneda', 35.5494, 139.7798, 3],
  ['SYD', 'Sydney Kingsford Smith', -33.9399, 151.1753, 3],
];

/** @returns {{code:string,name:string}|null} */
export function airportAt(lat, lng) {
  if (!isCoord(lat) || !isCoord(lng)) return null;
  for (const [code, name, alat, alng, r] of AIRPORTS) {
    if (Math.abs(lat - alat) > 0.1 || Math.abs(lng - alng) > 0.12) continue;
    if (haversineKm(lat, lng, alat, alng) <= r) return { code, name };
  }
  return null;
}

/** Match airport mentions in free text (addresses, receipt bodies). */
export function airportInText(text) {
  if (!text) return null;
  const s = String(text);
  for (const [code, name] of AIRPORTS) {
    if (new RegExp(`\\b${code}\\b`).test(s)) return { code, name };
  }
  if (/\bairport\b|\bterminal\s+\d|\binternational\s+airport\b/i.test(s)) return { code: '', name: 'Airport' };
  return null;
}

/**
 * Metro areas used to name cities when the export has no city column.
 * [name, lat, lng, radius km, IANA zone]
 * @type {[string, number, number, number, string][]}
 */
export const METROS = [
  ['San Francisco Bay Area', 37.65, -122.25, 70, 'America/Los_Angeles'],
  ['Los Angeles', 34.05, -118.25, 70, 'America/Los_Angeles'],
  ['San Diego', 32.8, -117.15, 40, 'America/Los_Angeles'],
  ['Seattle', 47.6, -122.3, 50, 'America/Los_Angeles'],
  ['Portland', 45.52, -122.68, 40, 'America/Los_Angeles'],
  ['Las Vegas', 36.15, -115.15, 40, 'America/Los_Angeles'],
  ['Phoenix', 33.45, -112.07, 60, 'America/Phoenix'],
  ['Denver', 39.74, -104.99, 60, 'America/Denver'],
  ['Austin', 30.27, -97.74, 45, 'America/Chicago'],
  ['Dallas', 32.78, -96.8, 60, 'America/Chicago'],
  ['Houston', 29.76, -95.37, 60, 'America/Chicago'],
  ['Chicago', 41.88, -87.63, 60, 'America/Chicago'],
  ['Atlanta', 33.75, -84.39, 50, 'America/New_York'],
  ['Miami', 25.76, -80.19, 50, 'America/New_York'],
  ['Washington, DC', 38.9, -77.04, 50, 'America/New_York'],
  ['New York', 40.73, -73.95, 50, 'America/New_York'],
  ['Boston', 42.36, -71.06, 40, 'America/New_York'],
  ['Toronto', 43.65, -79.38, 50, 'America/Toronto'],
  ['Vancouver', 49.26, -123.12, 40, 'America/Vancouver'],
  ['Mexico City', 19.43, -99.13, 50, 'America/Mexico_City'],
  ['London', 51.507, -0.128, 55, 'Europe/London'],
  ['Paris', 48.857, 2.352, 45, 'Europe/Paris'],
  ['Amsterdam', 52.37, 4.9, 35, 'Europe/Amsterdam'],
  ['Berlin', 52.52, 13.405, 40, 'Europe/Berlin'],
  ['Dubai', 25.2, 55.27, 50, 'Asia/Dubai'],
  ['Singapore', 1.35, 103.82, 35, 'Asia/Singapore'],
  ['Hong Kong', 22.32, 114.17, 35, 'Asia/Hong_Kong'],
  ['Tokyo', 35.68, 139.76, 60, 'Asia/Tokyo'],
  ['Sydney', -33.87, 151.21, 60, 'Australia/Sydney'],
];

/** @returns {{name:string, tz:string}|null} */
export function metroAt(lat, lng) {
  if (!isCoord(lat) || !isCoord(lng)) return null;
  let best = null; let bestD = Infinity;
  for (const [name, mlat, mlng, r, tz] of METROS) {
    const d = haversineKm(lat, lng, mlat, mlng);
    if (d <= r && d < bestD) { best = { name, tz }; bestD = d; }
  }
  return best;
}

/**
 * Best-effort IANA zone for a coordinate. Uses known metros first, then
 * coarse longitude bands for North America and Europe, then `fallback`.
 */
export function guessTimeZone(lat, lng, fallback = 'UTC') {
  const metro = metroAt(lat, lng);
  if (metro) return metro.tz;
  if (!isCoord(lat) || !isCoord(lng)) return fallback;
  if (lat > 24 && lat < 50 && lng > -125 && lng < -66) {
    if (lng < -114.5) return 'America/Los_Angeles';
    if (lng < -102) return 'America/Denver';
    if (lng < -87.5) return 'America/Chicago';
    return 'America/New_York';
  }
  if (lat > 49.8 && lat < 59 && lng > -8.5 && lng < 1.8) return 'Europe/London';
  if (lat > 36 && lat < 60 && lng >= 1.8 && lng < 20) return 'Europe/Paris';
  // Whole-hour offset from longitude as a last resort.
  const off = Math.round(lng / 15);
  if (off === 0) return 'UTC';
  return `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
}

/** Pull "City" out of "123 Main St, City, ST 94110, US" style addresses. */
export function cityFromAddress(address) {
  if (!address) return '';
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return '';
  // Walk back past country and "ST 12345" / postcode parts.
  for (let i = parts.length - 2; i >= 1; i--) {
    const p = parts[i];
    if (/^[A-Z]{2}(\s+\d{4,5}(-\d{4})?)?$/.test(p)) continue;
    if (/^\d/.test(p)) continue;
    if (/^(USA?|United States|UK|United Kingdom)$/i.test(p)) continue;
    return p;
  }
  return '';
}
