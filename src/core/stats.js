// All stats, computed from normalised trips. Pure: same input, same output.
import { localParts, dayKey, monthKey, dayNumber } from './time.js';
import { KM_PER_MILE, airportAt, airportInText, haversineKm, isCoord } from './geo.js';
import { clusterPlaces } from './places.js';
import * as fmt from './format.js';

/** @typedef {import('./types.js').Trip} Trip */
/** @typedef {import('./places.js').Place} Place */

/**
 * @typedef {Object} TripView  Trip plus derived local fields.
 * @property {Trip} trip
 * @property {number} index
 * @property {ReturnType<typeof localParts>} local
 * @property {string} day
 * @property {string} month
 * @property {number|null} minutes  In-car minutes.
 * @property {string|null} from     Place id.
 * @property {string|null} to       Place id.
 * @property {string} airport       Airport code if either end is an airport.
 */

const EARTH_KM = 40075;

/**
 * @param {Trip[]} trips
 * @param {{names?: Record<string,string>, unit?: 'mi'|'km'}} [opts]
 */
export function computeStats(trips, opts = {}) {
  const unit = opts.unit || 'mi';
  const sorted = [...trips].sort((a, b) => a.start - b.start);
  const { places, fromPlace, toPlace } = clusterPlaces(sorted, { names: opts.names });
  const placeById = new Map(places.map((p) => [p.id, p]));

  /** @type {TripView[]} */
  const views = sorted.map((trip, index) => {
    const local = localParts(trip.start, trip.tz);
    const minutes = trip.end != null ? (trip.end - trip.start) / 60000 : null;
    const fromP = fromPlace[index] ? placeById.get(/** @type {string} */ (fromPlace[index])) : null;
    const toP = toPlace[index] ? placeById.get(/** @type {string} */ (toPlace[index])) : null;
    const airport = fromP?.airportCode || toP?.airportCode
      || (trip.fromLat == null ? airportInText(trip.fromAddress)?.code || '' : '')
      || (trip.toLat == null ? airportInText(trip.toAddress)?.code || '' : '')
      || (isAirportText(trip.fromAddress) || isAirportText(trip.toAddress) ? 'Airport' : '');
    return {
      trip, index, local, day: dayKey(local), month: monthKey(local),
      minutes: minutes != null && minutes > 0 && minutes < 600 ? minutes : null,
      from: fromPlace[index], to: toPlace[index], airport,
    };
  });

  const count = views.length;
  if (count === 0) return null;

  // Totals --------------------------------------------------------------
  let km = 0; let kmKnown = 0; let minutes = 0; let minutesKnown = 0;
  /** @type {Map<string, {currency:string,total:number,count:number}>} */
  const spendMap = new Map();
  for (const v of views) {
    const kmV = tripKm(v.trip);
    if (kmV != null) { km += kmV; kmKnown++; }
    if (v.minutes != null) { minutes += v.minutes; minutesKnown++; }
    if (v.trip.fare != null && v.trip.fare > 0) {
      const c = v.trip.currency || '';
      const s = spendMap.get(c) || { currency: c, total: 0, count: 0 };
      s.total += v.trip.fare; s.count++; spendMap.set(c, s);
    }
  }
  const spend = [...spendMap.values()].sort((a, b) => b.count - a.count || b.total - a.total);
  const primaryCurrency = spend[0]?.currency || '';
  const inPrimary = (/** @type {TripView} */ v) => v.trip.fare != null && v.trip.fare > 0 && (v.trip.currency || '') === primaryCurrency;

  // Records -------------------------------------------------------------
  const byKm = views.filter((v) => tripKm(v.trip) != null);
  const longest = maxBy(byKm, (v) => /** @type {number} */ (tripKm(v.trip)));
  const longestTime = maxBy(views.filter((v) => v.minutes != null), (v) => /** @type {number} */ (v.minutes));
  const priced = views.filter(inPrimary);
  const mostExpensive = maxBy(priced, (v) => /** @type {number} */ (v.trip.fare));
  const cheapest = maxBy(priced, (v) => -(/** @type {number} */ (v.trip.fare)));

  // Routes ----------------------------------------------------------------
  /** @type {Map<string, {from:string,to:string,count:number,km:number,spend:number,minutes:number[],last:number}>} */
  const routeMap = new Map();
  for (const v of views) {
    if (!v.from || !v.to || v.from === v.to) continue;
    const key = `${v.from}>${v.to}`;
    const r = routeMap.get(key) || { from: v.from, to: v.to, count: 0, km: 0, spend: 0, minutes: [], last: 0 };
    r.count++; r.km += tripKm(v.trip) || 0; if (inPrimary(v)) r.spend += /** @type {number} */ (v.trip.fare);
    if (v.minutes != null) r.minutes.push(v.minutes);
    r.last = v.trip.start;
    routeMap.set(key, r);
  }
  const routes = [...routeMap.values()].sort((a, b) => b.count - a.count || b.km - a.km).map((r) => ({
    from: r.from, to: r.to, count: r.count,
    fromName: placeById.get(r.from)?.name || '?', toName: placeById.get(r.to)?.name || '?',
    avgKm: r.km / r.count, spend: r.spend,
    medianMinutes: r.minutes.length ? median(r.minutes) : null,
  }));

  // Airports --------------------------------------------------------------
  const airportViews = views.filter((v) => v.airport);
  /** @type {Map<string, number>} */
  const apCounts = new Map();
  for (const v of airportViews) apCounts.set(v.airport, (apCounts.get(v.airport) || 0) + 1);
  const airports = {
    count: airportViews.length,
    toAirport: airportViews.filter((v) => placeById.get(v.to || '')?.kind === 'airport' || (!v.to && isAirportText(v.trip.toAddress))).length,
    fromAirport: airportViews.filter((v) => placeById.get(v.from || '')?.kind === 'airport' || (!v.from && isAirportText(v.trip.fromAddress))).length,
    byCode: [...apCounts].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count),
    spend: airportViews.filter(inPrimary).reduce((s, v) => s + /** @type {number} */ (v.trip.fare), 0),
  };

  // Late night -------------------------------------------------------------
  const late = views.filter((v) => v.local.hour < 5);
  const latest = maxBy(late, (v) => v.local.hour * 60 + v.local.minute);
  const lateNight = { count: late.length, share: late.length / count, latest };

  // Heatmap: [weekday 0=Mon][hour] ----------------------------------------
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const v of views) heatmap[v.local.weekday][v.local.hour]++;
  let peak = { weekday: 0, hour: 0, count: -1 };
  heatmap.forEach((row, d) => row.forEach((n, h) => { if (n > peak.count) peak = { weekday: d, hour: h, count: n }; }));
  const byHour = new Array(24).fill(0); const byWeekday = new Array(7).fill(0);
  for (const v of views) { byHour[v.local.hour]++; byWeekday[v.local.weekday]++; }

  // Months -----------------------------------------------------------------
  /** @type {Map<string, {key:string,count:number,spend:number,km:number}>} */
  const monthMap = new Map();
  const firstMonth = views[0].month; const lastMonth = views[count - 1].month;
  for (let k = firstMonth; k <= lastMonth; k = nextMonth(k)) monthMap.set(k, { key: k, count: 0, spend: 0, km: 0 });
  for (const v of views) {
    const m = /** @type {{key:string,count:number,spend:number,km:number}} */ (monthMap.get(v.month));
    m.count++; m.km += tripKm(v.trip) || 0; if (inPrimary(v)) m.spend += /** @type {number} */ (v.trip.fare);
  }
  const months = [...monthMap.values()];
  const busiestMonth = maxBy(months, (m) => m.count);
  // Quietest: ignore partial first/last months when there are enough months.
  const inner = months.length > 3 ? months.slice(1, -1) : months;
  const quietestMonth = maxBy(inner, (m) => -m.count);

  // Cities -------------------------------------------------------------------
  /** @type {Map<string, {name:string,count:number,first:number,last:number}>} */
  const cityMap = new Map();
  for (const v of views) {
    const name = cleanCity(v.trip.city) || 'Unknown';
    const c = cityMap.get(name) || { name, count: 0, first: v.trip.start, last: v.trip.start };
    c.count++; c.last = v.trip.start; cityMap.set(name, c);
  }
  const cities = [...cityMap.values()].sort((a, b) => b.count - a.count);

  // Wait times ---------------------------------------------------------------
  /** @type {number[]} */
  const waits = [];
  for (const v of views) {
    if (v.trip.requested == null) continue;
    const w = (v.trip.start - v.trip.requested) / 60000;
    if (w >= 0 && w < 60) waits.push(w);
  }
  const wait = waits.length >= 3 ? {
    avgMinutes: waits.reduce((a, w) => a + w, 0) / waits.length,
    medianMinutes: median(waits),
    count: waits.length,
  } : null;

  // Streaks --------------------------------------------------------------
  const days = [...new Set(views.map((v) => v.day))].sort();
  const dayNums = days.map(dayNumber);
  let best = { length: 1, start: days[0], end: days[0] }; let run = 1; let runStart = 0;
  let longestGap = { days: 0, start: days[0], end: days[0] };
  for (let i = 1; i < dayNums.length; i++) {
    const gap = dayNums[i] - dayNums[i - 1];
    if (gap === 1) { run++; } else { run = 1; runStart = i; }
    if (run > best.length) best = { length: run, start: days[runStart], end: days[i] };
    if (gap - 1 > longestGap.days) longestGap = { days: gap - 1, start: days[i - 1], end: days[i] };
  }
  // Weekly streak: consecutive ISO-ish weeks (Mon-start) with at least one ride.
  const weekNums = [...new Set(views.map((v) => Math.floor((dayNumber(v.day) + 3) / 7)))].sort((a, b) => a - b);
  let bestWeeks = 1; let wRun = 1;
  for (let i = 1; i < weekNums.length; i++) {
    wRun = weekNums[i] - weekNums[i - 1] === 1 ? wRun + 1 : 1;
    bestWeeks = Math.max(bestWeeks, wRun);
  }
  /** @type {Map<string, number>} */
  const perDay = new Map();
  for (const v of views) perDay.set(v.day, (perDay.get(v.day) || 0) + 1);
  let busiestDay = { day: days[0], count: 0 };
  for (const [d, n] of perDay) if (n > busiestDay.count) busiestDay = { day: d, count: n };
  const streaks = { longestDays: best, longestWeeks: bestWeeks, longestGap, activeDays: days.length, busiestDay };

  // Years -------------------------------------------------------------------
  /** @type {Map<number, {year:number,count:number,km:number,minutes:number,spend:number,lateNight:number,airport:number}>} */
  const yearMap = new Map();
  for (const v of views) {
    const y = yearMap.get(v.local.year) || { year: v.local.year, count: 0, km: 0, minutes: 0, spend: 0, lateNight: 0, airport: 0 };
    y.count++; y.km += tripKm(v.trip) || 0; y.minutes += v.minutes || 0;
    if (inPrimary(v)) y.spend += /** @type {number} */ (v.trip.fare);
    if (v.local.hour < 5) y.lateNight++;
    if (v.airport) y.airport++;
    yearMap.set(v.local.year, y);
  }
  const years = [...yearMap.values()].sort((a, b) => a.year - b.year).map((y) => ({
    ...y, monthsCovered: months.filter((m) => m.key.startsWith(`${y.year}-`)).length,
  }));

  // Price per distance ---------------------------------------------------
  const perUnit = (/** @type {number} */ fare, /** @type {number} */ k) => fare / (unit === 'mi' ? k / KM_PER_MILE : k);
  const ppmViews = views.filter((v) => inPrimary(v) && (tripKm(v.trip) || 0) > 0.3);
  /** @type {Map<string, {fare:number,km:number,count:number}>} */
  const ppmMonths = new Map();
  for (const v of ppmViews) {
    const p = ppmMonths.get(v.month) || { fare: 0, km: 0, count: 0 };
    p.fare += /** @type {number} */ (v.trip.fare); p.km += /** @type {number} */ (tripKm(v.trip)); p.count++;
    ppmMonths.set(v.month, p);
  }
  const ppmSeries = [...ppmMonths].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, p]) => ({ key, value: perUnit(p.fare, p.km), count: p.count }));
  const ppmTotal = ppmViews.reduce((s, v) => ({ fare: s.fare + /** @type {number} */ (v.trip.fare), km: s.km + /** @type {number} */ (tripKm(v.trip)) }), { fare: 0, km: 0 });
  const edge = (/** @type {typeof ppmSeries} */ arr) => {
    const f = arr.reduce((s, p) => s + p.value * p.count, 0); const n = arr.reduce((s, p) => s + p.count, 0);
    return n ? f / n : null;
  };
  const firstQ = edge(ppmSeries.slice(0, 3)); const lastQ = edge(ppmSeries.slice(-3));
  const pricePerDistance = {
    unit, currency: primaryCurrency,
    overall: ppmTotal.km > 0 ? perUnit(ppmTotal.fare, ppmTotal.km) : null,
    series: ppmSeries,
    change: firstQ && lastQ && ppmSeries.length >= 6 ? (lastQ - firstQ) / firstQ : null,
  };

  // Products ------------------------------------------------------------------
  /** @type {Map<string, number>} */
  const prodMap = new Map();
  for (const v of views) prodMap.set(v.trip.product, (prodMap.get(v.trip.product) || 0) + 1);
  const products = [...prodMap].map(([name, n]) => ({ name, count: n, share: n / count })).sort((a, b) => b.count - a.count);

  // Per-place stats (for map clicks) --------------------------------------
  /** @type {Map<string, {arrivals:number,departures:number,spend:number,first:number,last:number,hours:number[],partners:Map<string,number>}>} */
  const placeStats = new Map();
  for (const v of views) {
    for (const [id, other] of /** @type {[string|null,string|null][]} */ ([[v.from, v.to], [v.to, v.from]])) {
      if (!id) continue;
      const s = placeStats.get(id) || { arrivals: 0, departures: 0, spend: 0, first: v.trip.start, last: v.trip.start, hours: new Array(24).fill(0), partners: new Map() };
      if (id === v.from) s.departures++; if (id === v.to) s.arrivals++;
      if (inPrimary(v)) s.spend += /** @type {number} */ (v.trip.fare);
      s.last = v.trip.start; s.hours[v.local.hour]++;
      if (other && other !== id) s.partners.set(other, (s.partners.get(other) || 0) + 1);
      placeStats.set(id, s);
    }
  }
  const placeDetails = places.map((p) => {
    const s = placeStats.get(p.id);
    const topPartners = s ? [...s.partners].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, n]) => ({ id, name: placeById.get(id)?.name || '?', count: n })) : [];
    const peakHour = s ? s.hours.indexOf(Math.max(...s.hours)) : 0;
    return { ...p, arrivals: s?.arrivals || 0, departures: s?.departures || 0, spend: s?.spend || 0, first: s?.first || 0, last: s?.last || 0, peakHour, topPartners };
  }).sort((a, b) => b.visits - a.visits);

  const stats = {
    unit, count,
    first: views[0].trip.start, last: views[count - 1].trip.start,
    firstDay: views[0].day, lastDay: views[count - 1].day,
    spanDays: dayNumber(views[count - 1].day) - dayNumber(views[0].day) + 1,
    km, kmKnown, minutes, minutesKnown,
    spend, primaryCurrency,
    longest, longestTime, mostExpensive, cheapest,
    places: placeDetails, routes, airports, lateNight,
    heatmap, peak, byHour, byWeekday,
    months, busiestMonth, quietestMonth,
    cities, wait, streaks, years, pricePerDistance, products,
    views,
    /** @type {string[]} */
    lines: [],
  };
  stats.lines = playfulLines(stats, placeById);
  return stats;
}

/** @typedef {NonNullable<ReturnType<typeof computeStats>>} Stats */

/**
 * Short, plain sentences about the data. Each is only included if true and
 * interesting for this dataset.
 * @param {Stats} s
 * @param {Map<string, Place>} placeById
 */
export function playfulLines(s, placeById) {
  /** @type {string[]} */
  const lines = [];
  const hours = s.minutes / 60;
  if (hours >= 48) lines.push(`You spent ${(hours / 24).toFixed(1)} days in the back seat.`);
  else if (hours >= 2) lines.push(`You spent ${Math.round(hours)} hours in the back seat.`);

  const top = s.routes[0];
  if (top && top.count >= 3) lines.push(`Your most loyal route: ${top.fromName} → ${top.toName}, ${top.count} times.`);

  if (s.km > 0) {
    const laps = s.km / EARTH_KM;
    if (laps >= 1) lines.push(`Your rides add up to ${laps.toFixed(1)} trips around the Earth.`);
    else if (laps >= 0.02) lines.push(`Your rides add up to ${Math.round(laps * 100)}% of the way around the Earth.`);
  }

  if (s.lateNight.count >= 3) lines.push(`${fmt.plural(s.lateNight.count, 'ride')} started between midnight and 5 am.`);

  const { peak } = s;
  if (peak.count >= 3) lines.push(`Your busiest hour: ${fmt.WEEKDAY_NAMES[peak.weekday]}s around ${fmt.hourLabel(peak.hour)}.`);

  if (s.streaks.longestDays.length >= 3) lines.push(`Longest streak: rides on ${s.streaks.longestDays.length} days in a row.`);

  if (s.airports.count >= 2) {
    const ap = s.airports.byCode[0];
    lines.push(ap && ap.code !== 'Airport'
      ? `${fmt.plural(s.airports.count, 'airport run')}. ${ap.code} saw you ${fmt.plural(ap.count, 'time')}.`
      : `${fmt.plural(s.airports.count, 'airport run')}.`);
  }

  if (s.wait && s.wait.count >= 5) lines.push(`Average wait for a pickup: ${s.wait.avgMinutes.toFixed(1)} minutes.`);

  if (s.longest) {
    const t = s.longest.trip;
    const from = s.longest.from ? placeById.get(s.longest.from)?.name : null;
    const to = s.longest.to ? placeById.get(s.longest.to)?.name : null;
    const route = from && to ? `, ${from} → ${to}` : '';
    lines.push(`Longest ride: ${fmt.distance(/** @type {number} */ (tripKm(t)), s.unit)}${route}.`);
  }

  const ppd = s.pricePerDistance;
  if (ppd.change != null && Math.abs(ppd.change) >= 0.05) {
    lines.push(`Price per ${ppd.unit === 'mi' ? 'mile' : 'km'} ${ppd.change > 0 ? 'rose' : 'fell'} ${Math.round(Math.abs(ppd.change) * 100)}% from your first months to your latest.`);
  }
  if (s.cities.length >= 2) lines.push(`Rides in ${fmt.plural(s.cities.filter((c) => c.name !== 'Unknown').length, 'city', 'cities')}.`);
  return lines;
}

// Helpers -----------------------------------------------------------------

/** Distance for a trip: reported, else straight-line × 1.3 road factor. */
export function tripKm(/** @type {Trip} */ t) {
  if (t.km != null) return t.km;
  if (isCoord(t.fromLat) && isCoord(t.toLat) && isCoord(t.fromLng) && isCoord(t.toLng)) {
    return haversineKm(/** @type {number} */ (t.fromLat), /** @type {number} */ (t.fromLng), /** @type {number} */ (t.toLat), /** @type {number} */ (t.toLng)) * 1.3;
  }
  return null;
}

/** @template T @param {T[]} arr @param {(x:T)=>number} f @returns {T|null} */
function maxBy(arr, f) {
  let best = null; let bestV = -Infinity;
  for (const x of arr) { const v = f(x); if (v > bestV) { bestV = v; best = x; } }
  return best;
}

/** @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** @param {string} k "YYYY-MM" */
function nextMonth(k) {
  let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** @param {string} a */
function isAirportText(a) { return !!a && /\bairport\b|\bterminal\b/i.test(a); }

/** Merge Uber's variants: "San Francisco Bay Area" / "San Francisco" etc. */
function cleanCity(c) {
  if (!c) return '';
  return String(c).replace(/\s+(Bay Area|Metro(politan)? Area|Area)$/i, '').trim();
}

export { airportAt };
