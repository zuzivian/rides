import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, arcControl, quadAt, quadSplit, robustBounds, metresPerWorldUnit } from '../src/core/mercator.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('mercator round trip', () => {
  for (const [lng, lat] of [[-122.4, 37.77], [0, 51.5], [151.2, -33.9], [0, 0]]) {
    const [x, y] = project(lng, lat);
    const [lng2, lat2] = unproject(x, y);
    close(lng, lng2); close(lat, lat2);
  }
  assert.deepEqual(project(0, 0), [0.5, 0.5]);
  assert.ok(project(0, 60)[1] < 0.5); // north is up (smaller y)
});

test('arc control bows left of travel, reversed trips bow the other way', () => {
  const a = [0, 0]; const b = [1, 0];
  const c1 = arcControl(a, b); const c2 = arcControl(b, a);
  assert.ok(c1[1] < 0 && c2[1] > 0);
});

test('quadratic split end matches point at t', () => {
  const a = [0, 0]; const c = [0.5, 1]; const b = [1, 0];
  const [, , end] = quadSplit(a, c, b, 0.3);
  const p = quadAt(a, c, b, 0.3);
  close(end[0], p[0]); close(end[1], p[1]);
  assert.deepEqual(quadAt(a, c, b, 1), b);
});

test('robust bounds trims outliers', () => {
  const pts = Array.from({ length: 100 }, (_, i) => [i / 1000, i / 1000]);
  pts.push([0.9, 0.9]);
  const bb = robustBounds(pts, 0.02);
  assert.ok(bb && bb.maxX < 0.2);
  assert.equal(robustBounds([]), null);
});

test('scale: about 40,075 km per world unit at the equator', () => {
  close(metresPerWorldUnit(0), 40075016.686, 1e-3);
  assert.ok(metresPerWorldUnit(60) < metresPerWorldUnit(0) / 1.9);
});
