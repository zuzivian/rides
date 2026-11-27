// Tolerant parsers for Uber and Lyft data exports. Pure functions.
import { parseCsv } from './csv.js';
import { parseTimestamp, zonedToUtc, defaultTimeZone } from './time.js';
import { guessTimeZone, isCoord, KM_PER_MILE, cityFromAddress, metroAt, METROS } from './geo.js';

/** @typedef {import('./types.js').Trip} Trip */
/** @typedef {import('./types.js').ParseResult} ParseResult */

export class ParseError extends Error {
  /** @param {string} message @param {string[]} [headers] */
  constructor(message, headers = []) {
    super(message);
    this.name = 'ParseError';
    this.headers = headers;
  }
}

/** Lower-case and strip everything but letters and digits. */
export const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Header aliases per field, already normalised. Order = preference.
 * Covers Uber's classic and newer "Download your data" exports, Lyft's
 * export, and generic hand-made spreadsheets.
 */
export const ALIASES = {
  requested: ['requesttime', 'requesttimestamplocal', 'requesttimestamputc', 'requesttimestamp', 'requestedat', 'requestedtime', 'requestedattime', 'requestdate', 'requestdatetime'],
  start: ['begintriptime', 'begintriptimestamplocal', 'begintriptimestamputc', 'begintriptimestamp', 'begintimestamp', 'pickuptime', 'pickuptimestamp', 'pickedupat', 'pickupdatetime', 'starttime', 'tripstarttime', 'ridestarttime', 'begintime', 'startedat', 'datetime', 'date', 'ridedate', 'tripdate'],
  end: ['dropofftime', 'dropofftimestamplocal', 'dropofftimestamputc', 'dropofftimestamp', 'droppedoffat', 'dropoffdatetime', 'endtime', 'tripendtime', 'rideendtime', 'arrivaltime', 'endedat', 'completedat'],
  fromLat: ['begintriplat', 'begintriplatitude', 'beginlat', 'pickuplat', 'pickuplatitude', 'originlat', 'originlatitude', 'startlat', 'startlatitude', 'fromlat', 'fromlatitude'],
  fromLng: ['begintriplng', 'begintriplon', 'begintriplong', 'begintriplongitude', 'beginlng', 'pickuplng', 'pickuplon', 'pickuplong', 'pickuplongitude', 'originlng', 'originlon', 'originlong', 'originlongitude', 'startlng', 'startlon', 'startlong', 'startlongitude', 'fromlng', 'fromlon', 'fromlongitude'],
  toLat: ['dropofflat', 'dropofflatitude', 'destinationlat', 'destinationlatitude', 'destlat', 'endlat', 'endlatitude', 'tolat', 'tolatitude'],
  toLng: ['dropofflng', 'dropofflon', 'dropofflong', 'dropofflongitude', 'destinationlng', 'destinationlon', 'destinationlong', 'destinationlongitude', 'destlng', 'destlon', 'endlng', 'endlon', 'endlong', 'endlongitude', 'tolng', 'tolon', 'tolongitude'],
  fromAddress: ['begintripaddress', 'pickupaddress', 'pickuplocation', 'pickup', 'originaddress', 'origin', 'startaddress', 'startlocation', 'from', 'fromaddress'],
  toAddress: ['dropoffaddress', 'dropofflocation', 'dropoff', 'destinationaddress', 'destination', 'endaddress', 'endlocation', 'to', 'toaddress'],
  distanceMi: ['distancemiles', 'distancemi', 'tripdistancemiles', 'miles', 'distanceinmiles'],
  distanceKm: ['distancekm', 'distancekilometers', 'distancekilometres', 'tripdistancekm', 'km', 'kilometers', 'kilometres'],
  distance: ['distance', 'tripdistance', 'ridedistance'],
  fare: ['fareamount', 'originalfarelocal', 'farelocal', 'totalfare', 'total', 'totalcharged', 'totalamount', 'totalcost', 'fare', 'amount', 'cost', 'price', 'ridecost', 'charge', 'farepaid'],
  currency: ['farecurrency', 'currencycode', 'currency', 'farecurrencycode', 'localcurrency'],
  product: ['producttype', 'producttypename', 'productname', 'product', 'ridetype', 'vehicletype', 'servicetype', 'ridemode', 'service', 'ridecategory'],
  status: ['triporderstatus', 'tripstatus', 'ridestatus', 'status', 'orderstatus', 'state'],
  city: ['city', 'cityname', 'region', 'market'],
};

/**
 * Map each field to a column index using the alias table.
 * @param {string[]} headers
 * @returns {Partial<Record<keyof typeof ALIASES, number>>}
 */
export function detectColumns(headers) {
  const norm = headers.map(normHeader);
  /** @type {Partial<Record<keyof typeof ALIASES, number>>} */
  const cols = {};
  const used = new Set();
  for (const field of /** @type {(keyof typeof ALIASES)[]} */ (Object.keys(ALIASES))) {
    for (const alias of ALIASES[field]) {
      const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
      if (idx !== -1) { cols[field] = idx; used.add(idx); break; }
    }
  }
  return cols;
}

/** @param {string[]} headers */
export function detectSource(headers) {
  const n = new Set(headers.map(normHeader));
  if (n.has('begintriptime') || n.has('begintriplat') || n.has('begintriptimestamplocal') || n.has('triporderstatus') || n.has('producttypename')) return 'uber';
  if (n.has('ridetype') || [...n].some((h) => h.includes('lyft'))) return 'lyft';
  return 'generic';
}

const SYMBOLS = [
  ['S$', 'SGD'], ['HK$', 'HKD'], ['A$', 'AUD'], ['AU$', 'AUD'], ['C$', 'CAD'], ['CA$', 'CAD'],
  ['NZ$', 'NZD'], ['MX$', 'MXN'], ['R$', 'BRL'], ['£', 'GBP'], ['€', 'EUR'], ['¥', 'JPY'],
  ['₹', 'INR'], ['₩', 'KRW'], ['₱', 'PHP'], ['฿', 'THB'], ['$', 'USD'],
];

/**
 * "$23.45", "£12.30", "USD 23.45", "23,45 €", "1,234.50" → {amount, currency}
 * @param {string|undefined} raw
 */
export function parseMoney(raw) {
  if (raw == null) return { amount: null, currency: '' };
  const s = String(raw).trim();
  if (!s) return { amount: null, currency: '' };
  let currency = '';
  const iso = s.match(/\b([A-Z]{3})\b/);
  if (iso) currency = iso[1];
  else for (const [sym, code] of SYMBOLS) if (s.includes(sym)) { currency = code; break; }
  let num = s.replace(/[^0-9.,-]/g, '');
  if (!num || !/\d/.test(num)) return { amount: null, currency };
  // Decide decimal separator: last of [.,] followed by 1–2 digits at end.
  const lastComma = num.lastIndexOf(','); const lastDot = num.lastIndexOf('.');
  if (lastComma > lastDot && /,\d{1,2}$/.test(num)) num = num.replace(/\./g, '').replace(',', '.');
  else num = num.replace(/,/g, '');
  const amount = parseFloat(num);
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

/** @param {string|undefined} v */
function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Tidy product names: "UberX" stays, "uberx" → "UberX", "lyft_standard" → "Lyft Standard". */
export function normalizeProduct(raw, source) {
  const s = String(raw || '').trim();
  if (!s) return source === 'lyft' ? 'Lyft' : 'Unknown';
  const k = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  /** @type {Record<string,string>} */
  const known = {
    uberx: 'UberX', x: 'UberX', uberxl: 'UberXL', xl: 'UberXL', comfort: 'Comfort', ubercomfort: 'Comfort',
    uberpool: 'Pool', pool: 'Pool', expresspool: 'Pool', uberxshare: 'UberX Share', share: 'UberX Share', ubershare: 'UberX Share',
    black: 'Black', uberblack: 'Black', blacksuv: 'Black SUV', uberblacksuv: 'Black SUV', suv: 'Black SUV',
    green: 'Green', ubergreen: 'Green', comfortelectric: 'Comfort Electric', uberpet: 'Uber Pet', pet: 'Uber Pet',
    wav: 'WAV', taxi: 'Taxi', ubertaxi: 'Taxi', priority: 'UberX Priority',
    lyft: 'Lyft', standard: 'Lyft', lyftstandard: 'Lyft', classic: 'Lyft', lyftxl: 'Lyft XL', lyftshared: 'Lyft Shared',
    shared: 'Lyft Shared', line: 'Lyft Shared', lyftline: 'Lyft Shared', lux: 'Lyft Lux', luxblack: 'Lux Black',
    lyftlux: 'Lyft Lux', extracomfort: 'Extra Comfort', preferred: 'Lyft Preferred', lyftpreferred: 'Lyft Preferred',
    waitandsave: 'Wait & Save', prioritypickup: 'Priority Pickup',
  };
  if (known[k]) return known[k];
  if (k === 'uberxpriority') return 'UberX Priority';
  return s.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const CANCELED = /cancel|fail|unfulfilled|no[\s_-]?show|declined|refund/i;
const NON_RIDE = /eats|delivery|courier|connect|package|scooter|bike|jump|rental/i;

/**
 * Resolve a timestamp cell to UTC ms using `tz` for zone-less wall times.
 * @param {string|undefined} cell
 * @param {string} tz
 */
function toMs(cell, tz) {
  const t = parseTimestamp(cell);
  if (!t) return null;
  if ('ms' in t) return t.ms;
  return zonedToUtc(t.wall, tz);
}

/**
 * Parse a CSV export (Uber, Lyft or a generic sheet) into trips.
 * @param {string} text
 * @param {{defaultTz?: string, idPrefix?: string}} [opts]
 * @returns {ParseResult}
 */
export function parseTripsCsv(text, opts = {}) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ParseError('That file is empty.');
  // Some exports have a title line above the header. Pick the first row that looks like headers.
  let headerRow = 0;
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const c = detectColumns(rows[r]);
    if (c.start != null || c.requested != null) { headerRow = r; break; }
  }
  const headers = rows[headerRow].map((h) => h.trim());
  const cols = detectColumns(headers);
  const source = detectSource(headers);

  if (cols.start == null && cols.requested == null && cols.end == null) {
    throw new ParseError(
      `Couldn't find a trip time column. Expected something like "Begin Trip Time", "Request Time" or "Pickup Time". Headers found: ${headers.map((h) => `"${h}"`).join(', ') || '(none)'}.`,
      headers,
    );
  }

  const defaultTz = opts.defaultTz || defaultTimeZone();
  const prefix = opts.idPrefix || source;
  /** @type {Trip[]} */
  const trips = [];
  const skipped = { canceled: 0, invalid: 0, nonRide: 0 };
  /** @type {string[]} */
  const warnings = [];
  /** @param {string[]} row @param {keyof typeof ALIASES} f */
  const get = (row, f) => (cols[f] == null ? undefined : row[/** @type {number} */ (cols[f])]?.trim());

  let distanceUnit = cols.distanceKm != null ? 'km' : 'mi';
  if (cols.distanceMi == null && cols.distanceKm == null && cols.distance != null) {
    const h = headers[/** @type {number} */ (cols.distance)].toLowerCase();
    distanceUnit = /\bkm\b|kilomet/.test(h) ? 'km' : 'mi';
    if (!/mile|\bmi\b|km|kilomet/.test(h)) warnings.push(`Assumed "${headers[/** @type {number} */ (cols.distance)]}" is in miles.`);
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((v) => !v.trim())) continue;
    const status = get(row, 'status') || '';
    if (status && CANCELED.test(status)) { skipped.canceled++; continue; }
    const productRaw = get(row, 'product') || '';
    if (NON_RIDE.test(productRaw)) { skipped.nonRide++; continue; }

    const fromLat = num(get(row, 'fromLat')); const fromLng = num(get(row, 'fromLng'));
    const toLat = num(get(row, 'toLat')); const toLng = num(get(row, 'toLng'));
    const okFrom = isCoord(fromLat) && isCoord(fromLng);
    const okTo = isCoord(toLat) && isCoord(toLng);
    let cityRaw = get(row, 'city') || '';
    const fromAddress = get(row, 'fromAddress') || '';
    const toAddress = get(row, 'toAddress') || '';

    let tz = defaultTz;
    if (okFrom) tz = guessTimeZone(/** @type {number} */ (fromLat), /** @type {number} */ (fromLng), defaultTz);
    else if (okTo) tz = guessTimeZone(/** @type {number} */ (toLat), /** @type {number} */ (toLng), defaultTz);
    else if (cityRaw) {
      const m = METROS.find(([name]) => name.toLowerCase().includes(cityRaw.toLowerCase()) || cityRaw.toLowerCase().includes(name.toLowerCase()));
      if (m) tz = m[4];
    }

    const requested = toMs(get(row, 'requested'), tz);
    const startCell = toMs(get(row, 'start'), tz);
    const end = toMs(get(row, 'end'), tz);
    const start = startCell ?? requested ?? end;
    if (start == null || !Number.isFinite(start)) { skipped.invalid++; continue; }
    // Uber marks canceled rows with a 1970 begin time in some exports.
    if (start < Date.UTC(2009, 0, 1)) { skipped.canceled++; continue; }

    let km = null;
    const dMi = num(get(row, 'distanceMi')); const dKm = num(get(row, 'distanceKm')); const d = num(get(row, 'distance'));
    if (dKm != null) km = dKm; else if (dMi != null) km = dMi * KM_PER_MILE;
    else if (d != null) km = distanceUnit === 'km' ? d : d * KM_PER_MILE;

    const money = parseMoney(get(row, 'fare'));
    const currency = (get(row, 'currency') || money.currency || '').toUpperCase().slice(0, 3);

    if (!cityRaw) {
      const metro = okFrom ? metroAt(/** @type {number} */ (fromLat), /** @type {number} */ (fromLng)) : null;
      cityRaw = metro?.name || cityFromAddress(fromAddress) || '';
    }

    trips.push({
      id: `${prefix}-${r}`,
      source,
      start,
      end: end != null && end >= start ? end : null,
      requested: requested != null && requested <= start ? requested : null,
      tz,
      fromLat: okFrom ? fromLat : null, fromLng: okFrom ? fromLng : null,
      toLat: okTo ? toLat : null, toLng: okTo ? toLng : null,
      fromAddress, toAddress,
      km: km != null && km >= 0 ? km : null,
      fare: money.amount,
      currency,
      product: normalizeProduct(productRaw, source),
      city: cityRaw,
    });
  }

  if (trips.length === 0) {
    const why = skipped.canceled || skipped.nonRide || skipped.invalid
      ? ` (${skipped.canceled} canceled, ${skipped.nonRide} non-ride, ${skipped.invalid} unreadable rows skipped)` : '';
    throw new ParseError(`No completed rides found in that file${why}. Headers found: ${headers.map((h) => `"${h}"`).join(', ')}.`, headers);
  }
  trips.sort((a, b) => a.start - b.start);
  return { trips, source, headers, skipped, warnings };
}

/**
 * Merge trip lists from several files, dropping duplicates (same start
 * within 3 minutes and same fare or same pickup point).
 * @param {Trip[][]} lists
 * @returns {Trip[]}
 */
export function mergeTrips(lists) {
  const all = lists.flat().sort((a, b) => a.start - b.start);
  /** @type {Trip[]} */
  const out = [];
  for (const t of all) {
    const dup = out.slice(-8).find((o) => Math.abs(o.start - t.start) < 180000 && (
      (o.fare != null && t.fare != null && Math.abs(o.fare - t.fare) < 0.01) ||
      (o.fromLat != null && t.fromLat != null && Math.abs(o.fromLat - t.fromLat) < 0.002 && Math.abs(/** @type {number} */ (o.fromLng) - /** @type {number} */ (t.fromLng)) < 0.002)
    ));
    if (dup) fillGaps(dup, t); else out.push({ ...t });
  }
  return out;
}

/**
 * The same ride from two sources (say an export with coordinates but blank
 * addresses, and a receipt with addresses): keep the first, fill its blanks.
 * @param {Trip} keep @param {Trip} other
 */
function fillGaps(keep, other) {
  const k = /** @type {Record<string, any>} */ (keep); const o = /** @type {Record<string, any>} */ (other);
  for (const f of ['fromAddress', 'toAddress', 'product', 'city', 'currency']) if (!k[f] && o[f]) k[f] = o[f];
  for (const f of ['end', 'requested', 'km', 'fare']) if (k[f] == null && o[f] != null) k[f] = o[f];
  if (k.fromLat == null && o.fromLat != null) { k.fromLat = o.fromLat; k.fromLng = o.fromLng; }
  if (k.toLat == null && o.toLat != null) { k.toLat = o.toLat; k.toLng = o.toLng; }
}
