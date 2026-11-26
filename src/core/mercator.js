// Web Mercator and curve maths for the map. Pure, unit-tested.

const MAX_LAT = 85.05112878;

/** lng/lat → world coords in [0,1]² (x east, y south). */
export function project(lng, lat) {
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin((la * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** World coords → [lng, lat]. */
export function unproject(x, y) {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  return [lng, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}

/** Metres per world unit at a latitude (for scale bars). */
export function metresPerWorldUnit(lat) {
  return 40075016.686 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Control point for a soft arc from a to b, bowed to the left of travel so
 * A→B and B→A sit side by side instead of on top of each other.
 * @param {[number,number]} a @param {[number,number]} b @param {number} [bow]
 * @returns {[number,number]}
 */
export function arcControl(a, b, bow = 0.22) {
  const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  return [mx + dy * bow, my - dx * bow];
}

/** Point on a quadratic Bézier at t. */
export function quadAt(a, c, b, t) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** First part [0,t] of a quadratic Bézier, as [start, control, end]. */
export function quadSplit(a, c, b, t) {
  const c1 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  return [a, c1, quadAt(a, c, b, t)];
}

/**
 * Robust bounds of points: trims the outer `trim` share on each side so one
 * far-off ride doesn't zoom the whole map out.
 * @param {[number,number][]} pts world coords
 */
export function robustBounds(pts, trim = 0.02) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
  const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
  const k = Math.floor(pts.length * trim);
  return { minX: xs[k], maxX: xs[xs.length - 1 - k], minY: ys[k], maxY: ys[ys.length - 1 - k] };
}

/** MapLibre draws a 512px tile at zoom 0, so the world is 512·2^zoom px wide. */
export const MAPLIBRE_TILE = 512;

/**
 * Map camera (centre in world coords, z = px per world unit) → MapLibre view.
 * @param {{cx:number, cy:number, z:number}} cam
 * @returns {{center:[number,number], zoom:number}}
 */
export function camToMapLibre(cam) {
  const [lng, lat] = unproject(cam.cx, cam.cy);
  return { center: [lng, lat], zoom: Math.log2(cam.z / MAPLIBRE_TILE) };
}
