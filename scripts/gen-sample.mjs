#!/usr/bin/env node
// Generates data/sample-trips.csv: a SYNTHETIC rider in the SF Bay Area,
// May 2025 – Oct 2026, in Uber's classic "trips_data.csv" format.
// Deterministic (seeded) so tests can pin numbers. No real person's data.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zonedToUtc, localParts } from '../src/core/time.js';
import { haversineKm } from '../src/core/geo.js';
import { toCsv } from '../src/core/csv.js';

let seed = 20251;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const chance = (p) => rand() < p;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rand() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
};

const SF = 'America/Los_Angeles';
/** name: [lat, lng, address, city, tz] */
const P = {
  home: [37.7650, -122.4664, '1200 9th Ave, San Francisco, CA 94122, US', 'San Francisco', SF],
  work: [37.7880, -122.3969, '500 Howard St, San Francisco, CA 94105, US', 'San Francisco', SF],
  gym: [37.7672, -122.4290, '2100 Market St, San Francisco, CA 94114, US', 'San Francisco', SF],
  valencia: [37.7598, -122.4214, '800 Valencia St, San Francisco, CA 94110, US', 'San Francisco', SF],
  northBeach: [37.8000, -122.4100, '500 Columbus Ave, San Francisco, CA 94133, US', 'San Francisco', SF],
  ferry: [37.7955, -122.3937, '1 Ferry Building, San Francisco, CA 94111, US', 'San Francisco', SF],
  oakland: [37.8297, -122.2655, '4000 Telegraph Ave, Oakland, CA 94609, US', 'San Francisco', SF],
  sfo: [37.6160, -122.3860, 'San Francisco International Airport (SFO), San Francisco, CA 94128, US', 'San Francisco', SF],
  oak: [37.7110, -122.2140, 'Oakland International Airport (OAK), Oakland, CA 94621, US', 'San Francisco', SF],
  sea: [47.4436, -122.3016, 'Seattle-Tacoma International Airport (SEA), SeaTac, WA 98158, US', 'Seattle', SF],
  seaHotel: [47.6107, -122.3355, '1415 5th Ave, Seattle, WA 98101, US', 'Seattle', SF],
  pike: [47.6097, -122.3422, '85 Pike St, Seattle, WA 98101, US', 'Seattle', SF],
  fremont: [47.6510, -122.3500, '3400 Fremont Ave N, Seattle, WA 98103, US', 'Seattle', SF],
  lhr: [51.4710, -0.4600, 'Heathrow Airport Terminal 5, Longford, Hounslow TW6 2GA, UK', 'London', 'Europe/London'],
  ldnHotel: [51.5246, -0.0780, '100 Shoreditch High St, London E1 6JQ, UK', 'London', 'Europe/London'],
  soho: [51.5136, -0.1320, '50 Dean St, London W1D 5BQ, UK', 'London', 'Europe/London'],
  kingsX: [51.5308, -0.1238, "King's Cross Station, Euston Rd, London N1C 4AX, UK", 'London', 'Europe/London'],
};
const ERRANDS = [
  [37.7699, -122.4469, '1600 Haight St, San Francisco, CA 94117, US'],
  [37.7830, -122.4640, '600 Clement St, San Francisco, CA 94118, US'],
  [37.8005, -122.4370, '2100 Chestnut St, San Francisco, CA 94123, US'],
  [37.7590, -122.3880, '2400 3rd St, San Francisco, CA 94107, US'],
  [37.7765, -122.4240, '400 Hayes St, San Francisco, CA 94102, US'],
  [37.7515, -122.4330, '4000 24th St, San Francisco, CA 94114, US'],
  [37.7880, -122.4075, '170 O\'Farrell St, San Francisco, CA 94102, US'],
  [37.7941, -122.4078, '900 Grant Ave, San Francisco, CA 94108, US'],
  [37.7853, -122.4298, '1610 Post St, San Francisco, CA 94115, US'],
  [37.7989, -122.4662, '210 Lincoln Blvd, San Francisco, CA 94129, US'],
  [37.7786, -122.3893, '24 Willie Mays Plaza, San Francisco, CA 94107, US'],
].map(([lat, lng, a]) => [lat, lng, a, 'San Francisco', SF]);

const pad = (n) => String(n).padStart(2, '0');
const utcString = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 UTC`;
};
const jitter = ([lat, lng, ...rest]) => [lat + between(-0.0005, 0.0005), lng + between(-0.0006, 0.0006), ...rest];

const START = { year: 2025, month: 5, day: 1 };
const END = { year: 2026, month: 10, day: 31 };
const startMs = zonedToUtc({ ...START, hour: 12 }, SF);

const rows = [];

/**
 * @param {string} dateKey 'YYYY-MM-DD' local date in the place's zone
 * @param {number} hour decimal local hour (may exceed 24 to roll over)
 */
function ride(from, to, dateKey, hour, opts = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const tz = from[4];
  const h = Math.floor(hour); const min = Math.floor((hour - h) * 60); const sec = Math.floor(rand() * 60);
  const dayShift = Math.floor(h / 24);
  const begin = zonedToUtc({ year: y, month: m, day: d + dayShift, hour: h % 24, minute: min, second: sec }, tz);
  const a = jitter(from); const b = jitter(to);
  const straightKm = haversineKm(a[0], a[1], b[0], b[1]);
  const miles = (straightKm * between(1.22, 1.45)) / 1.609344;
  const local = localParts(begin, tz);
  const late = local.hour < 5;
  const highway = miles > 6;
  const mph = (highway ? between(24, 34) : between(10, 15)) * (late ? 1.35 : 1);
  const minutes = (miles / mph) * 60 + between(1.5, 4);
  const wait = between(2, 7) + (late ? between(1, 6) : 0) + (opts.airportPickup ? between(2, 6) : 0);
  const product = opts.product || weighted(
    opts.airport ? [['UberX', 55], ['Comfort', 25], ['UberXL', 15], ['Black', 5]]
      : [['UberX', 66], ['Comfort', 11], ['UberX Share', 8], ['UberXL', 5], ['Green', 6], ['Black', 2], ['UberX Priority', 2]],
  );
  const mult = { UberX: 1, Comfort: 1.32, 'UberX Share': 0.78, UberXL: 1.6, Green: 1.06, Black: 2.35, 'UberX Priority': 1.18 }[product] || 1;
  const yearsIn = (begin - startMs) / (365.25 * 86400000);
  const inflation = 1 + 0.11 * yearsIn;
  const weekendEvening = (local.weekday >= 4) && local.hour >= 19;
  const surge = late ? between(1.15, 1.75) : weekendEvening ? between(1.0, 1.35) : chance(0.12) ? between(1.1, 1.5) : 1;
  let fare;
  if (opts.currency === 'GBP') fare = Math.max(7, (2.5 + 0.2 * minutes + 1.3 * miles) * mult * surge);
  else fare = Math.max(9.5, (2.55 + 0.32 * minutes + 1.12 * miles + 2.95) * mult * surge * inflation + (opts.airport ? 5.5 : 0));
  const dropoff = begin + minutes * 60000;
  const request = begin - wait * 60000;
  rows.push({
    begin,
    cells: [
      from[3], product, 'COMPLETED', utcString(request), utcString(begin),
      a[0].toFixed(6), a[1].toFixed(6), a[2], utcString(dropoff), b[0].toFixed(6), b[1].toFixed(6), b[2],
      miles.toFixed(2), fare.toFixed(2), opts.currency || 'USD',
    ],
  });
  return dropoff;
}

function canceled(from, dateKey, hour) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const req = zonedToUtc({ year: y, month: m, day: d, hour: Math.floor(hour), minute: Math.floor((hour % 1) * 60) }, from[4]);
  rows.push({
    begin: req,
    cells: [from[3], 'UberX', chance(0.5) ? 'CANCELED' : 'DRIVER_CANCELED', utcString(req), '1970-01-01 00:00:00 +0000 UTC',
      '0.0', '0.0', '', '1970-01-01 00:00:00 +0000 UTC', '0.0', '0.0', '', '0.00', chance(0.3) ? '5.00' : '0.00', 'USD'],
  });
}

// Trips away from home and airport runs ------------------------------------
const away = [];
const trip = (outKey, outHour, airport, backKey, backHour) => {
  ride(P.home, airport, outKey, outHour, { airport: true });
  ride(airport, P.home, backKey, backHour, { airport: true, airportPickup: true });
  away.push([outKey, backKey]);
};
trip('2025-06-12', 6.2, P.sfo, '2025-06-16', 21.4);
trip('2025-11-25', 13.5, P.sfo, '2025-11-30', 18.9);
trip('2025-12-19', 5.4, P.sfo, '2026-01-03', 23.6);
trip('2026-03-06', 16.1, P.oak, '2026-03-09', 11.2);
trip('2026-07-02', 7.8, P.sfo, '2026-07-06', 1.3);
trip('2026-09-18', 17.6, P.oak, '2026-09-21', 22.1);

// Seattle long weekend.
ride(P.home, P.sfo, '2025-09-11', 7.1, { airport: true });
ride(P.sea, P.seaHotel, '2025-09-11', 12.4, { airport: true, airportPickup: true });
ride(P.seaHotel, P.pike, '2025-09-12', 12.5);
ride(P.pike, P.fremont, '2025-09-12', 18.9);
ride(P.fremont, P.seaHotel, '2025-09-12', 23.2);
ride(P.seaHotel, P.sea, '2025-09-15', 9.8, { airport: true });
ride(P.sfo, P.home, '2025-09-15', 14.6, { airport: true, airportPickup: true });
away.push(['2025-09-11', '2025-09-15']);

// London week, paid in GBP.
ride(P.home, P.sfo, '2026-05-14', 14.2, { airport: true });
ride(P.lhr, P.ldnHotel, '2026-05-15', 10.9, { airport: true, airportPickup: true, currency: 'GBP' });
ride(P.ldnHotel, P.soho, '2026-05-16', 19.1, { currency: 'GBP' });
ride(P.soho, P.ldnHotel, '2026-05-16', 24.7, { currency: 'GBP' });
ride(P.ldnHotel, P.kingsX, '2026-05-18', 8.8, { currency: 'GBP' });
ride(P.kingsX, P.ldnHotel, '2026-05-18', 18.4, { currency: 'GBP' });
ride(P.ldnHotel, P.lhr, '2026-05-20', 12.6, { airport: true, currency: 'GBP' });
ride(P.sfo, P.home, '2026-05-20', 17.3, { airport: true, airportPickup: true });
away.push(['2026-05-14', '2026-05-20']);

// Everyday life --------------------------------------------------------------
const isAway = (key) => away.some(([a, b]) => key >= a && key <= b);
for (let ms = zonedToUtc({ ...START, hour: 12 }, SF); ; ms += 86400000) {
  const p = localParts(ms, SF);
  const key = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  if (key > `${END.year}-${pad(END.month)}-${pad(END.day)}`) break;
  if (isAway(key)) continue;
  const wd = p.weekday; // 0 Mon
  const weekday = wd < 5;
  // Rainier winters → more commute rides.
  const wet = [11, 12, 1, 2, 3].includes(p.month) ? 1.7 : 1;
  // A quieter August, a busier spring.
  const season = 1.5 * (p.month === 8 ? 0.45 : [3, 4].includes(p.month) ? 1.25 : 1);

  if (weekday && chance(0.115 * wet * season)) ride(P.home, P.work, key, between(8.1, 9.6));
  if (weekday && chance(0.085 * wet * season)) ride(P.work, P.home, key, between(17.7, 20.4));
  if ((wd === 1 || wd === 3) && chance(0.05 * season)) ride(P.work, P.gym, key, between(18, 19));
  if ((wd === 4 || wd === 5) && chance(0.24 * season)) {
    const spot = chance(0.65) ? P.valencia : P.northBeach;
    ride(P.home, spot, key, between(20, 22.5), { });
    if (chance(0.85)) ride(spot, P.home, key, between(23.6, 26.6));
  }
  if (wd >= 5 && chance(0.15 * season)) {
    const e = pick(ERRANDS);
    ride(P.home, e, key, between(10.5, 16));
    if (chance(0.45)) ride(e, P.home, key, between(16.5, 19));
  }
  if (weekday && chance(0.03 * season)) ride(P.work, pick(ERRANDS), key, between(12, 13.5));
  if (wd === 6 && chance(0.06 * season)) {
    ride(P.home, P.oakland, key, between(13, 15), { });
    ride(P.oakland, P.home, key, between(21, 24.5));
  }
  if (wd === 5 && chance(0.03)) ride(P.home, P.ferry, key, between(9, 10.5));
  if (chance(0.006)) canceled(P.home, key, between(8, 22));
}

rows.sort((a, b) => b.begin - a.begin); // Uber lists newest first
const header = ['City', 'Product Type', 'Trip or Order Status', 'Request Time', 'Begin Trip Time', 'Begin Trip Lat', 'Begin Trip Lng', 'Begin Trip Address', 'Dropoff Time', 'Dropoff Lat', 'Dropoff Lng', 'Dropoff Address', 'Distance (miles)', 'Fare Amount', 'Fare Currency'];
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample-trips.csv');
writeFileSync(out, toCsv([header, ...rows.map((r) => r.cells)]));
const done = rows.filter((r) => r.cells[2] === 'COMPLETED').length;
console.log(`Wrote ${rows.length} rows (${done} completed) to ${out}`);
