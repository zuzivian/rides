import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceComparison, personality, earthShare } from '../src/core/story.js';
import { parseTripsCsv } from '../src/core/parse.js';
import { computeStats } from '../src/core/stats.js';

const s = computeStats(parseTripsCsv(readFileSync(new URL('../data/sample-trips.csv', import.meta.url), 'utf8'), { defaultTz: 'America/Los_Angeles' }).trips);

test('distance comparison picks the biggest familiar distance', () => {
  assert.equal(distanceComparison(5), null);
  assert.match(distanceComparison(30 * 1.609344)?.text || '', /2\.2 lengths of Manhattan/);
  assert.match(distanceComparison(382 * 1.609344)?.text || '', /^That’s a drive from San Francisco to Los Angeles\.$/);
  assert.match(distanceComparison(1796 * 1.609344)?.text || '', /4\.7 drives from San Francisco to Los Angeles/);
  assert.match(distanceComparison(60000 * 1.609344)?.text || '', /2\.4 trips around the Earth/);
  assert.ok(Math.abs(earthShare(40075) - 1) < 1e-12);
});

test('personality for the sample rider', () => {
  assert.ok(s);
  const p = personality(s);
  assert.equal(p.title, 'The Night Owl Commuter');
  assert.ok(p.reasons.length >= 2);
  for (const r of p.reasons) assert.match(r, /\.$/);
});

test('personality falls back when nothing stands out', () => {
  assert.ok(s);
  const flat = { ...s, routes: [], places: [], lateNight: { ...s.lateNight, share: 0 }, airports: { ...s.airports, count: 0 }, cities: [], byWeekday: [1, 1, 1, 1, 1, 0, 0], byHour: new Array(24).fill(0), count: 100 };
  assert.equal(personality(flat).title, 'The Occasional Rider');
});
