import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEml, parseReceipts, splitMbox, htmlToText, decodeWords, extractReceipt, looksLikeEmail } from '../src/core/email.js';
import { parseTripsCsv, mergeTrips } from '../src/core/parse.js';
import { computeStats } from '../src/core/stats.js';
import { localParts } from '../src/core/time.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const UBER = read('./fixtures/uber-receipt.eml');
const LYFT = read('./fixtures/lyft-receipt.eml');
const MBOX = read('./fixtures/receipts.mbox');

test('mime: headers, encoded words, multipart, quoted-printable, base64', () => {
  const u = parseEml(UBER);
  assert.equal(u.headers.subject, 'Your Thursday evening trip with Uber');
  assert.equal(u.kind, 'plain');
  assert.match(u.body, /Visa •••• 4242/);
  const l = parseEml(LYFT);
  assert.equal(l.kind, 'html');
  assert.match(l.body, /Total charged/);
  assert.equal(decodeWords('=?utf-8?B?Q2Fmw6k=?='), 'Café');
});

test('html to text keeps rows on their own lines', () => {
  const t = htmlToText('<style>x{}</style><table><tr><td>Total</td><td>$5.00</td></tr></table><p>A&amp;B&nbsp;C</p>');
  assert.deepEqual(t.split('\n'), ['Total $5.00', 'A&B C']);
});

test('mbox: splits messages and unescapes >From', () => {
  const msgs = splitMbox(MBOX);
  assert.equal(msgs.length, 4);
  assert.ok(looksLikeEmail(MBOX) && looksLikeEmail(UBER));
  assert.ok(!looksLikeEmail('City,Product Type\nSF,UberX\n'));
});

test('uber receipt → trip', () => {
  const { trips, skipped } = parseReceipts(UBER);
  assert.equal(skipped, 0);
  assert.equal(trips.length, 1);
  const t = trips[0];
  assert.equal(t.source, 'email');
  assert.equal(t.fare, 24.86); // the total, not the card line or fare subtotal
  assert.equal(t.currency, 'USD');
  assert.equal(t.product, 'UberX');
  assert.ok(Math.abs(/** @type {number} */ (t.km) - 3.94 * 1.609344) < 1e-9);
  assert.equal(t.tz, 'America/Los_Angeles');
  assert.equal(t.start, Date.UTC(2026, 2, 13, 2, 2)); // 7:02 PM PDT
  assert.equal(t.end, Date.UTC(2026, 2, 13, 2, 23));
  assert.equal(t.fromAddress, '500 Howard St, San Francisco, CA 94105, US');
  assert.equal(t.toAddress, '1200 9th Ave, San Francisco, CA 94122, US');
  assert.equal(t.city, 'San Francisco Bay Area');
  // No personal details leak into the trip.
  assert.ok(!JSON.stringify(t).includes('4242'));
  assert.ok(!JSON.stringify(t).includes('Sam'));
});

test('lyft html receipt → trip', () => {
  const { trips } = parseReceipts(LYFT);
  assert.equal(trips.length, 1);
  const t = trips[0];
  assert.equal(t.fare, 46.71);
  assert.equal(t.product, 'Lyft XL');
  assert.ok(Math.abs(/** @type {number} */ (t.km) - 12.4 * 1.609344) < 1e-9);
  const p = localParts(t.start, t.tz);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 4, 2, 5, 48]);
  assert.match(t.toAddress, /San Francisco International Airport/);
  assert.ok(!JSON.stringify(t).includes('1111'));
  assert.ok(!JSON.stringify(t).includes('Jordan'));
});

test('mbox: keeps receipts, skips promos and personal mail', () => {
  const r = parseReceipts(MBOX);
  assert.equal(r.trips.length, 2);
  assert.equal(r.skipped, 2);
  const s = computeStats(r.trips);
  assert.equal(s?.count, 2);
  assert.equal(s?.airports.count, 1); // the Lyft ride to SFO, found from the address text
  assert.equal(s?.lateNight.count, 0);
});

test('receipt extraction tolerates other layouts', () => {
  const r = extractReceipt('Your trip\nTrip total: £12.30\n1.2 km\n9:05 am\n10 Dean St, London W1D 3RY\n9:20 am\nKing\'s Cross Station, London N1C 4AX', 'uber');
  assert.equal(r.fare, 12.3); assert.equal(r.currency, 'GBP');
  assert.equal(r.km, 1.2);
  assert.deepEqual(r.stops.map((s) => s.time), ['9:05 AM', '9:20 AM']);
});

test('receipts merge with an export without double counting', () => {
  const csv = parseTripsCsv(read('../data/sample-trips.csv'), { defaultTz: 'America/Los_Angeles' }).trips;
  const email = parseReceipts(MBOX).trips;
  // A receipt for a ride already in the export: same start minute, same fare.
  const dup = { ...email[0], start: csv[10].start + 40000, fare: csv[10].fare };
  const merged = mergeTrips([csv, [dup, ...email]]);
  assert.equal(merged.length, csv.length + email.length);
});
