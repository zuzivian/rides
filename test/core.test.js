import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/core/csv.js';
import { parseTimestamp, zonedToUtc, localParts } from '../src/core/time.js';
import { parseTripsCsv, ParseError, parseMoney, detectColumns, mergeTrips, normalizeProduct } from '../src/core/parse.js';
import { computeStats } from '../src/core/stats.js';
import { airportAt, guessTimeZone, cityFromAddress } from '../src/core/geo.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SAMPLE = read('../data/sample-trips.csv');
const LA = 'America/Los_Angeles';

test('csv: quotes, escaped quotes, CRLF, BOM, newline in field', () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line\nbreak",\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', 'line\nbreak', '']]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('csv: semicolon-delimited files', () => {
  assert.deepEqual(parseCsv('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
});

test('time: parses export timestamp shapes', () => {
  assert.deepEqual(parseTimestamp('2023-05-14 18:22:10 +0000 UTC'), { ms: Date.UTC(2023, 4, 14, 18, 22, 10) });
  assert.deepEqual(parseTimestamp('2023-05-14T18:22:10-07:00'), { ms: Date.UTC(2023, 4, 15, 1, 22, 10) });
  assert.deepEqual(parseTimestamp('2023-05-14T18:22:10.123Z'), { ms: Date.UTC(2023, 4, 14, 18, 22, 10) });
  assert.deepEqual(parseTimestamp('05/14/2023 6:22 PM'), { wall: { year: 2023, month: 5, day: 14, hour: 18, minute: 22, second: 0 } });
  assert.deepEqual(parseTimestamp('Sun, May 14, 2023 at 12:05 AM'), { wall: { year: 2023, month: 5, day: 14, hour: 0, minute: 5, second: 0 } });
  assert.deepEqual(parseTimestamp('1684088530'), { ms: 1684088530000 });
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('n/a'), null);
});

test('time: wall clock to UTC across DST', () => {
  const summer = zonedToUtc({ year: 2025, month: 7, day: 1, hour: 9 }, LA);
  assert.equal(summer, Date.UTC(2025, 6, 1, 16));
  const winter = zonedToUtc({ year: 2025, month: 12, day: 1, hour: 9 }, LA);
  assert.equal(winter, Date.UTC(2025, 11, 1, 17));
  const p = localParts(summer, LA);
  assert.equal(p.hour, 9); assert.equal(p.weekday, 1); // Tuesday
});

test('money: symbols, codes and separators', () => {
  assert.deepEqual(parseMoney('$23.45'), { amount: 23.45, currency: 'USD' });
  assert.deepEqual(parseMoney('£1,234.50'), { amount: 1234.5, currency: 'GBP' });
  assert.deepEqual(parseMoney('23,45 €'), { amount: 23.45, currency: 'EUR' });
  assert.deepEqual(parseMoney('SGD 18.20'), { amount: 18.2, currency: 'SGD' });
  assert.deepEqual(parseMoney('S$18.20'), { amount: 18.2, currency: 'SGD' });
  assert.deepEqual(parseMoney(''), { amount: null, currency: '' });
});

test('geo: airports, zones, cities', () => {
  assert.equal(airportAt(37.616, -122.386)?.code, 'SFO');
  assert.equal(airportAt(37.765, -122.466), null);
  assert.equal(guessTimeZone(51.5, -0.1), 'Europe/London');
  assert.equal(guessTimeZone(41.0, -100.0), 'America/Chicago');
  assert.equal(cityFromAddress('500 Howard St, San Francisco, CA 94105, US'), 'San Francisco');
});

test('columns: detected by alias regardless of case and punctuation', () => {
  const c = detectColumns(['Begin Trip Time', 'begintrip_lat', 'BEGIN TRIP LNG', 'Fare Amount', 'distance (miles)']);
  assert.deepEqual(c, { start: 0, fromLat: 1, fromLng: 2, distanceMi: 4, fare: 3 });
});

test('products: normalised names', () => {
  assert.equal(normalizeProduct('uberX', 'uber'), 'UberX');
  assert.equal(normalizeProduct('lyft_xl', 'lyft'), 'Lyft XL');
  assert.equal(normalizeProduct('UberX Share', 'uber'), 'UberX Share');
  assert.equal(normalizeProduct('Some New Thing', 'uber'), 'Some New Thing');
});

test('parse: sample Uber export', () => {
  const r = parseTripsCsv(SAMPLE, { defaultTz: LA });
  assert.equal(r.source, 'uber');
  assert.ok(r.trips.length >= 280 && r.trips.length <= 340, `got ${r.trips.length}`);
  assert.ok(r.skipped.canceled >= 1);
  for (const t of r.trips) {
    assert.ok(Number.isFinite(t.start));
    assert.ok(t.end == null || t.end >= t.start);
    assert.ok(t.fare == null || t.fare > 0);
  }
  // Sorted ascending even though Uber lists newest first.
  assert.ok(r.trips[0].start < r.trips[r.trips.length - 1].start);
  const london = r.trips.filter((t) => t.city === 'London');
  assert.ok(london.length >= 4);
  assert.ok(london.every((t) => t.tz === 'Europe/London' && t.currency === 'GBP'));
});

test('parse: newer Uber export with local timestamps and km', () => {
  const r = parseTripsCsv(read('./fixtures/uber-newer.csv'));
  assert.equal(r.source, 'uber');
  assert.equal(r.trips.length, 1);
  assert.equal(r.skipped.nonRide, 1);
  const t = r.trips[0];
  assert.equal(t.tz, 'Europe/London');
  assert.equal(t.start, Date.UTC(2025, 6, 4, 17, 6)); // 18:06 BST
  assert.equal(t.km, 6.4);
  assert.equal(t.fare, 14.2);
  assert.equal(t.currency, 'GBP');
});

test('parse: Lyft export with a title row and $ amounts', () => {
  const r = parseTripsCsv(read('./fixtures/lyft-export.csv'));
  assert.equal(r.source, 'lyft');
  assert.equal(r.trips.length, 3);
  assert.equal(r.skipped.canceled, 1);
  assert.equal(r.trips[0].tz, 'America/New_York');
  assert.equal(r.trips[0].start, Date.UTC(2024, 2, 3, 2, 19)); // 21:19 EST
  assert.equal(r.trips[0].currency, 'USD');
  assert.equal(r.trips[1].product, 'Lyft XL');
  assert.ok(r.warnings.some((w) => w.includes('miles')));
  const s = computeStats(r.trips);
  assert.equal(s?.airports.count, 2);
  assert.equal(s?.airports.byCode[0].code, 'JFK');
  assert.equal(s?.lateNight.count, 1);
});

test('parse: clear error listing headers for a non-ride file', () => {
  assert.throws(() => parseTripsCsv(read('./fixtures/not-rides.csv')), (e) => {
    assert.ok(e instanceof ParseError);
    assert.match(e.message, /"Name", "Email", "Favourite colour"/);
    assert.deepEqual(e.headers, ['Name', 'Email', 'Favourite colour']);
    return true;
  });
  assert.throws(() => parseTripsCsv(''), ParseError);
});

test('merge: drops duplicates across files', () => {
  const { trips } = parseTripsCsv(SAMPLE, { defaultTz: LA });
  const shifted = trips.slice(0, 10).map((t) => ({ ...t, id: `email-${t.id}`, start: t.start + 60000 }));
  assert.equal(mergeTrips([trips, shifted]).length, trips.length);
});

test('stats: sample data', () => {
  const { trips } = parseTripsCsv(SAMPLE, { defaultTz: LA });
  const s = computeStats(trips);
  assert.ok(s);
  assert.equal(s.count, trips.length);

  // Totals
  assert.ok(s.km > 1000 && s.km < 4000, `km ${s.km}`);
  assert.ok(s.minutes / 60 > 60, 'hours');
  assert.equal(s.primaryCurrency, 'USD');
  assert.deepEqual(s.spend.map((x) => x.currency), ['USD', 'GBP']);

  // Places & routes
  const kinds = s.places.map((p) => p.kind);
  assert.ok(kinds.includes('home') && kinds.includes('work'));
  assert.equal(s.routes[0].fromName, 'Home');
  assert.equal(s.routes[0].toName, 'Work');
  assert.ok(s.routes[0].count >= 30);

  // Airports: SFO is the most visited
  assert.ok(s.airports.count >= 18);
  assert.equal(s.airports.byCode[0].code, 'SFO');
  assert.deepEqual(s.airports.byCode.map((a) => a.code).sort(), ['LHR', 'OAK', 'SEA', 'SFO']);

  // Time patterns
  assert.ok(s.lateNight.count >= 10);
  assert.ok(s.lateNight.latest && s.lateNight.latest.local.hour < 5);
  assert.equal(s.heatmap.flat().reduce((a, b) => a + b, 0), s.count);
  assert.equal(s.months.length, 18);
  assert.equal(s.months[0].key, '2025-05');
  assert.equal(s.quietestMonth?.key.slice(5), '08');
  assert.ok(s.busiestMonth && s.busiestMonth.count > s.quietestMonth.count);

  // Cities, wait, streaks, years
  assert.deepEqual(s.cities.map((c) => c.name).sort(), ['London', 'San Francisco', 'Seattle']);
  assert.ok(s.wait && s.wait.avgMinutes > 2 && s.wait.avgMinutes < 12);
  assert.ok(s.streaks.longestDays.length >= 3);
  assert.ok(s.streaks.activeDays <= s.count);
  assert.deepEqual(s.years.map((y) => y.year), [2025, 2026]);
  assert.equal(s.years.reduce((a, y) => a + y.count, 0), s.count);

  // Price trend: sample fares inflate ~11%/yr
  assert.ok(s.pricePerDistance.overall && s.pricePerDistance.overall > 2 && s.pricePerDistance.overall < 10);
  assert.equal(s.pricePerDistance.series.length, 18);

  // Product mix
  assert.equal(s.products[0].name, 'UberX');
  assert.ok(Math.abs(s.products.reduce((a, p) => a + p.share, 0) - 1) < 1e-9);

  // Lines are plain sentences
  assert.ok(s.lines.length >= 5);
  assert.ok(s.lines.some((l) => /back seat/.test(l)));
  assert.ok(s.lines.some((l) => /Home → Work, \d+ times/.test(l)));
  for (const l of s.lines) assert.match(l, /\.$/);
});

test('stats: renames flow through places, routes and lines', () => {
  const { trips } = parseTripsCsv(SAMPLE, { defaultTz: LA });
  const first = computeStats(trips);
  const work = first?.places.find((p) => p.kind === 'work');
  assert.ok(work);
  const s = computeStats(trips, { names: { [work.id]: 'Studio' } });
  assert.equal(s?.places.find((p) => p.id === work.id)?.name, 'Studio');
  assert.equal(s?.routes[0].toName, 'Studio');
  assert.ok(s?.lines.some((l) => l.includes('Home → Studio')));
});

test('stats: km unit and empty input', () => {
  const { trips } = parseTripsCsv(SAMPLE, { defaultTz: LA });
  const mi = computeStats(trips, { unit: 'mi' });
  const km = computeStats(trips, { unit: 'km' });
  assert.ok(mi && km);
  assert.ok(Math.abs(/** @type {number} */ (mi.pricePerDistance.overall) / /** @type {number} */ (km.pricePerDistance.overall) - 1.609344) < 1e-6);
  assert.equal(computeStats([]), null);
});

test('stats: trips with no coordinates or fares still count', () => {
  const s = computeStats([{
    id: 'x', source: 'generic', start: Date.UTC(2025, 0, 1, 9), end: null, requested: null, tz: 'UTC',
    fromLat: null, fromLng: null, toLat: null, toLng: null, fromAddress: '', toAddress: 'SFO Terminal 2',
    km: null, fare: null, currency: '', product: 'Unknown', city: '',
  }]);
  assert.equal(s?.count, 1);
  assert.equal(s?.airports.count, 1);
  assert.equal(s?.routes.length, 0);
  assert.equal(s?.wait, null);
});
