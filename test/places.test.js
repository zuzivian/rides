import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterPlaces, shortAddress, nameFromAddresses, patternLabel, areaLabel } from '../src/core/places.js';
import { parseTripsCsv, mergeTrips } from '../src/core/parse.js';
import { parseReceipts } from '../src/core/email.js';
import { computeStats } from '../src/core/stats.js';
import { zonedToUtc } from '../src/core/time.js';

const LA = 'America/Los_Angeles';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** A synthetic trip at a local wall-clock time in SF. */
let seq = 0;
function trip({ day, hour, from, to, fromAddress = '', toAddress = '', km = 3, fare = 12 }) {
  const start = zonedToUtc({ year: 2026, month: 3, day, hour, minute: 10 }, LA);
  return {
    id: `t${seq++}`, source: 'uber', start, end: start + 15 * 60000, requested: null, tz: LA,
    fromLat: from[0], fromLng: from[1], toLat: to[0], toLng: to[1], fromAddress, toAddress,
    km, fare: fare + (seq % 7) * 0.37, currency: 'USD', product: 'UberX', city: 'San Francisco',
  };
}
const HOME = [37.7599, -122.4148];
const BAR = [37.7989, -122.4106];
const GYM = [37.7712, -122.4337];
const BRUNCH = [37.7425, -122.4211];
const OFFICE = [37.7898, -122.3942];
// March 2026: the 2nd is a Monday, the 7th/8th a weekend.

test('shortAddress: streets, ranges, venues, intersections and junk', () => {
  assert.equal(shortAddress('500 Howard St, San Francisco, CA 94105, US'), 'Howard St');
  assert.equal(shortAddress('1200-1210 9th Ave, San Francisco, CA'), '9th Ave');
  assert.equal(shortAddress('9th Ave & Irving St, San Francisco, CA'), '9th Ave & Irving St');
  assert.equal(shortAddress('Salesforce Tower, 415 Mission St, San Francisco'), 'Salesforce Tower');
  assert.equal(shortAddress('1200, 9th Ave, San Francisco'), '9th Ave');
  assert.equal(shortAddress('Apt 4 22 Valencia St, SF'), 'Valencia St');
  assert.equal(shortAddress('22 Valencia St #3, SF'), 'Valencia St');
  for (const junk of ['', '  ', 'N/A', 'null', 'Unknown', '37.7879, -122.3972', '(37.78,-122.39)']) assert.equal(shortAddress(junk), '', junk);
});

test('nameFromAddresses: counts by street, not by exact address', () => {
  const m = new Map([['500 Howard St, SF', 2], ['510 Howard St, SF', 2], ['1 Market St, SF', 3], ['N/A', 9]]);
  assert.equal(nameFromAddresses(m), 'Howard St');
});

test('export with addresses: places are named from them', () => {
  const { trips } = parseTripsCsv(read('../data/sample-trips.csv'));
  const { places } = clusterPlaces(trips);
  assert.ok(places.filter((p) => p.nameSource === 'address').length > 10);
  assert.ok(places.every((p) => !/^Spot \d+/.test(p.autoName)), 'no bare "Spot N"');
  assert.ok(places.some((p) => p.autoName === 'Howard St' || p.autoName === 'Home'));
});

test('coordinates only: pattern labels, then city + compass, never "Spot N"', () => {
  const trips = [];
  for (let d = 2; d <= 27; d++) {
    const wd = new Date(Date.UTC(2026, 2, d)).getUTCDay(); // 0 Sun … 6 Sat
    const weekday = wd >= 1 && wd <= 5;
    if (weekday) {
      trips.push(trip({ day: d, hour: 8, from: HOME, to: OFFICE, km: 4 }));
      trips.push(trip({ day: d, hour: 17, from: OFFICE, to: HOME, km: 4 }));
    }
    if (wd === 2 || wd === 4) trips.push(trip({ day: d, hour: 6, from: HOME, to: GYM, km: 2 }));
    if (wd === 5) trips.push(trip({ day: d, hour: 23, from: HOME, to: BAR, km: 5 }));
    if (wd === 0) trips.push(trip({ day: d, hour: 11, from: HOME, to: BRUNCH, km: 3 }));
  }
  const { places } = clusterPlaces(trips);
  const name = (pt) => places.find((p) => Math.abs(p.lat - pt[0]) < 0.003 && Math.abs(p.lng - pt[1]) < 0.003)?.autoName;
  assert.equal(name(HOME), 'Home');
  assert.equal(name(OFFICE), 'Work'); // strong enough to be Work outright
  assert.match(name(GYM), /^Gym\? · 1\.\d mi NW of Home$/);
  assert.match(name(BAR), /^Late nights · 2\.\d mi N of Home$/);
  assert.match(name(BRUNCH), /^Weekends · 1\.\d mi S of Home$/);
  assert.ok(places.every((p) => !/Spot \d/.test(p.autoName)));
  assert.equal(places.find((p) => p.autoName.startsWith('Gym?'))?.nameSource, 'pattern');
});

test('patternLabel: "Work?" for weekday morning arrivals, nothing for mixed use', () => {
  const work = [2, 3, 4].map((d) => ({ trip: trip({ day: d, hour: 8, from: HOME, to: OFFICE }), end: /** @type {'to'} */ ('to') }));
  assert.equal(patternLabel(work), 'Work?');
  const mixed = [[2, 13], [7, 15], [10, 20]].map(([d, h]) => ({ trip: trip({ day: d, hour: h, from: HOME, to: BRUNCH }), end: /** @type {'to'} */ ('to') }));
  assert.equal(patternLabel(mixed), '');
  assert.equal(patternLabel(work.slice(0, 2)), '', 'too few visits to guess');
});

test('areaLabel: compass and distance from the city centre, in the chosen unit', () => {
  assert.equal(areaLabel(37.65, -122.25), 'SF · centre');
  assert.match(areaLabel(37.7989, -122.4106), /^SF · \d+ mi NW$/);
  assert.match(areaLabel(37.7989, -122.4106, 'km'), /^SF · \d+ km NW$/);
  assert.match(areaLabel(51.53, -0.1), /^London · [\d.]+ mi NE$/);
  const home = { lat: 37.7599, lng: -122.4148, label: 'of Home' };
  assert.equal(areaLabel(37.7989, -122.4106, 'mi', home), '2.7 mi N of Home');
  assert.equal(areaLabel(37.7600, -122.4149, 'mi', home), 'Next to Home');
  assert.equal(areaLabel(37.7989, -122.4106, 'mi', { lat: 37.78, lng: -122.42, label: '' }), 'SF · 1.4 mi N');
  assert.equal(areaLabel(-12.05, -77.04), '12.05°S 77.04°W');
});

test('nicknames still win, and say so', () => {
  const { trips } = parseTripsCsv(read('../data/sample-trips.csv'));
  const first = clusterPlaces(trips).places.find((p) => p.kind === 'place');
  const { places } = clusterPlaces(trips, { names: { [first.id]: 'Climbing gym' } });
  const p = places.find((x) => x.id === first.id);
  assert.equal(p.name, 'Climbing gym');
  assert.equal(p.nameSource, 'nickname');
  assert.equal(p.autoName, first.autoName);
});

test('export without addresses + receipts with addresses: merged rides get street names', () => {
  // The export has coordinates but blank addresses; receipts have the same rides with addresses.
  const rides = [2, 3, 4, 5, 6].map((d) => trip({ day: d, hour: 12, from: HOME, to: BAR }));
  const exportOnly = rides.map((t) => ({ ...t, fromAddress: '', toAddress: '' }));
  const receipts = rides.map((t) => ({
    ...t, id: `${t.id}-r`, source: 'email', fromLat: null, fromLng: null, toLat: null, toLng: null,
    fromAddress: '3000 24th St, San Francisco, CA', toAddress: '1500 Grant Ave, San Francisco, CA', start: t.start + 60000,
  }));
  assert.ok(clusterPlaces(exportOnly).places.every((p) => p.nameSource !== 'address'));
  const merged = mergeTrips([exportOnly, receipts]);
  assert.equal(merged.length, 5, 'duplicates dropped');
  const names = clusterPlaces(merged).places.map((p) => p.autoName).sort();
  assert.deepEqual(names, ['24th St', 'Grant Ave']);
  assert.equal(exportOnly[0].fromAddress, '', 'inputs are not mutated');
});

test('email receipts without coordinates: counted in stats, no places, no crash', () => {
  const { trips } = parseReceipts(read('./fixtures/receipts.mbox'));
  assert.ok(trips.length >= 2);
  assert.equal(clusterPlaces(trips).places.length, 0);
  const s = computeStats(trips, { unit: 'mi' });
  assert.equal(s?.count, trips.length);
});
