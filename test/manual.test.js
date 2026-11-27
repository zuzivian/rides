import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManualTrip, commuteTrips, readManual, estimate, ROAD_FACTOR } from '../src/core/manual.js';
import { computeStats } from '../src/core/stats.js';
import { localParts, zonedToUtc } from '../src/core/time.js';
import { mergeTrips } from '../src/core/parse.js';

const HOME = { lat: 37.7599, lng: -122.4148, name: 'Home' };
const WORK = { lat: 37.7898, lng: -122.3942, name: 'near Salesforce Tower' };
const SFO = { lat: 37.6152, lng: -122.3900 };
const LA = 'America/Los_Angeles';

test('makeManualTrip: estimated road distance and time, zone and city from the map', () => {
  const start = Date.UTC(2026, 10, 20, 17, 0);
  const t = makeManualTrip({ from: HOME, to: WORK, start, fare: 14.5, currency: 'USD' });
  assert.equal(t.source, 'manual');
  assert.equal(t.estimated, true);
  assert.equal(t.tz, LA);
  assert.equal(t.city, 'San Francisco Bay Area');
  assert.ok(t.km > 3.6 * ROAD_FACTOR * 0.95 && t.km < 3.9 * ROAD_FACTOR, `km ${t.km}`);
  assert.equal(t.end - t.start, estimate(t.km / ROAD_FACTOR).minutes * 60000);
  assert.equal(t.fare, 14.5);
  assert.equal(t.fromAddress, 'Home');
  assert.equal(t.toAddress, 'near Salesforce Tower');
});

test('makeManualTrip: airports are named by code; bad input is refused', () => {
  const t = makeManualTrip({ from: HOME, to: SFO, start: Date.now() });
  assert.equal(t.toAddress, 'SFO airport');
  assert.equal(t.fare, null);
  assert.equal(t.currency, '');
  assert.throws(() => makeManualTrip({ from: HOME, to: { lat: NaN, lng: 0 }, start: Date.now() }), /map position/);
  assert.throws(() => makeManualTrip({ from: HOME, to: WORK, start: NaN }), /time/);
});

test('commuteTrips: weekday mornings and evenings for N weeks, never in the future, one series', () => {
  const now = zonedToUtc({ year: 2026, month: 11, day: 25, hour: 12 }, LA); // Wednesday noon
  const trips = commuteTrips({ home: HOME, work: WORK, now, weeks: 2 });
  // 2 weeks back + this week up to Wednesday noon: Mon–Fri ×2 weeks = 10 days, plus Mon, Tue, Wed this week.
  const days = new Set(trips.map((t) => { const p = localParts(t.start, LA); return `${p.month}-${p.day}`; }));
  assert.ok(trips.every((t) => t.start <= now));
  assert.ok(trips.every((t) => localParts(t.start, LA).weekday < 5), 'weekdays only');
  const am = trips.filter((t) => localParts(t.start, LA).hour === 8);
  const pm = trips.filter((t) => localParts(t.start, LA).hour === 17);
  assert.equal(am.length, days.size);
  assert.equal(pm.length, days.size - 1, 'today’s evening ride is still in the future');
  assert.equal(new Set(trips.map((t) => t.series)).size, 1);
  assert.equal(new Set(trips.map((t) => t.id)).size, trips.length, 'unique ids');
  assert.ok(am.every((t) => t.fromAddress === 'Home' && t.toAddress === 'near Salesforce Tower'));
});

test('commuteTrips: custom weekdays and times; DST change keeps local wall-clock time', () => {
  const now = zonedToUtc({ year: 2026, month: 11, day: 10, hour: 20 }, LA); // after the 1 Nov DST change
  const trips = commuteTrips({ home: HOME, work: WORK, now, weeks: 3, weekdays: [1, 3], out: [7, 15], back: [18, 0] });
  for (const t of trips) {
    const p = localParts(t.start, LA);
    assert.ok(p.weekday === 1 || p.weekday === 3);
    assert.ok((p.hour === 7 && p.minute === 15) || (p.hour === 18 && p.minute === 0), `${p.hour}:${p.minute}`);
  }
});

test('readManual: round-trips through JSON and drops junk', () => {
  const a = makeManualTrip({ from: HOME, to: WORK, start: Date.UTC(2026, 10, 1, 16), fare: 9 });
  const stored = JSON.parse(JSON.stringify([a, { source: 'uber', id: 'x', start: 1 }, null, { source: 'manual', id: 'bad', start: 5, fromLat: 'x' }]));
  const back = readManual(stored);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], a);
  assert.deepEqual(readManual('nope'), []);
});

test('stats work from one manual ride, and manual rides merge with an import without duplicates', () => {
  const one = makeManualTrip({ from: HOME, to: WORK, start: Date.UTC(2026, 10, 20, 17) });
  const s = computeStats([one], { unit: 'mi' });
  assert.equal(s?.count, 1);
  assert.equal(s?.routes.length, 1);
  assert.equal(s?.places.length, 2);
  // The same ride imported later (same time, same pickup) is not counted twice.
  const imported = { ...one, id: 'u1', source: /** @type {'uber'} */ ('uber'), estimated: undefined, km: 4.9, fare: 15.2, currency: 'USD' };
  const merged = mergeTrips([[imported], [one]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'uber');
});
