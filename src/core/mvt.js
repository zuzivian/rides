// Minimal Mapbox Vector Tile (MVT v2) reader: enough to pull named points and
// lines out of an OpenMapTiles tile. Pure: bytes in, features out. Spec:
// https://github.com/mapbox/vector-tile-spec/tree/master/2.1
import { unproject } from './mercator.js';

/**
 * @typedef {Object} TileFeature
 * @property {number} type        1 point, 2 line, 3 polygon
 * @property {Record<string, string|number|boolean>} properties
 * @property {[number, number][][]} geometry  rings/lines/points as [lng, lat]
 */

class Pbf {
  /** @param {Uint8Array} buf */
  constructor(buf) { this.buf = buf; this.pos = 0; }
  varint() {
    let result = 0; let shift = 0; let b;
    do {
      if (this.pos >= this.buf.length) throw new Error('mvt: truncated varint');
      b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift; shift += 7;
    } while (b & 0x80 && shift < 70);
    return result;
  }
  /** @param {number} n */
  bytes(n) { const out = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  /** Skip a field of the given wire type. @param {number} wire */
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
  /** Read a length-delimited field as a sub-reader. */
  sub() { const n = this.varint(); return new Pbf(this.bytes(n)); }
  /** Packed uint32s. */
  packed() { const p = this.sub(); const out = []; while (p.pos < p.buf.length) out.push(p.varint()); return out; }
  done() { return this.pos >= this.buf.length; }
}

const zigzag = (/** @type {number} */ n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);
const utf8 = new TextDecoder();

/** @param {Pbf} p */
function readValue(p) {
  /** @type {string|number|boolean} */ let v = '';
  while (!p.done()) {
    const tag = p.varint(); const field = tag >> 3; const wire = tag & 7;
    if (field === 1) v = utf8.decode(p.bytes(p.varint()));
    else if (field === 2) { const b = p.bytes(4); v = new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true); }
    else if (field === 3) { const b = p.bytes(8); v = new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true); }
    else if (field === 4 || field === 5) v = p.varint();
    else if (field === 6) v = zigzag(p.varint());
    else if (field === 7) v = p.varint() !== 0;
    else p.skip(wire);
  }
  return v;
}

/**
 * Decode geometry commands into lists of tile-pixel points.
 * @param {number[]} cmds
 * @returns {[number, number][][]}
 */
export function decodeGeometry(cmds) {
  /** @type {[number, number][][]} */
  const parts = [];
  /** @type {[number, number][]|null} */ let cur = null;
  let x = 0; let y = 0; let i = 0;
  while (i < cmds.length) {
    const c = cmds[i++]; const id = c & 7; const count = c >> 3;
    if (id === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
    for (let k = 0; k < count && i + 1 < cmds.length; k++) {
      x += zigzag(cmds[i++]); y += zigzag(cmds[i++]);
      if (id === 1) { cur = [[x, y]]; parts.push(cur); } else if (cur) cur.push([x, y]);
    }
  }
  return parts;
}

/**
 * Read the named layers of a tile into features with lng/lat geometry.
 * @param {Uint8Array} bytes  raw (not gzipped) tile
 * @param {{z:number, x:number, y:number}} tile
 * @param {string[]} [wanted]  layer names to keep (default: all)
 * @returns {Record<string, TileFeature[]>}
 */
export function readTile(bytes, tile, wanted) {
  const p = new Pbf(bytes);
  /** @type {Record<string, TileFeature[]>} */
  const out = {};
  const n = 2 ** tile.z;
  while (!p.done()) {
    const tag = p.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { p.skip(tag & 7); continue; }
    const lp = p.sub();
    let name = ''; let extent = 4096;
    /** @type {string[]} */ const keys = [];
    /** @type {(string|number|boolean)[]} */ const values = [];
    /** @type {Pbf[]} */ const feats = [];
    while (!lp.done()) {
      const t = lp.varint(); const f = t >> 3; const w = t & 7;
      if (f === 1) name = utf8.decode(lp.bytes(lp.varint()));
      else if (f === 2) feats.push(lp.sub());
      else if (f === 3) keys.push(utf8.decode(lp.bytes(lp.varint())));
      else if (f === 4) values.push(readValue(lp.sub()));
      else if (f === 5) extent = lp.varint();
      else lp.skip(w);
    }
    if (wanted && !wanted.includes(name)) continue;
    const list = out[name] || (out[name] = []);
    const toLngLat = (/** @type {[number, number]} */ [px, py]) => /** @type {[number, number]} */ (unproject((tile.x + px / extent) / n, (tile.y + py / extent) / n));
    for (const fp of feats) {
      let type = 0; /** @type {number[]} */ let tags = []; /** @type {number[]} */ let geom = [];
      while (!fp.done()) {
        const t = fp.varint(); const f = t >> 3; const w = t & 7;
        if (f === 2) tags = fp.packed();
        else if (f === 3) type = fp.varint();
        else if (f === 4) geom = fp.packed();
        else fp.skip(w);
      }
      /** @type {Record<string, string|number|boolean>} */
      const properties = {};
      for (let k = 0; k + 1 < tags.length; k += 2) if (keys[tags[k]] != null) properties[keys[tags[k]]] = values[tags[k + 1]];
      list.push({ type, properties, geometry: decodeGeometry(geom).map((part) => part.map(toLngLat)) });
    }
  }
  return out;
}

/**
 * Tile containing a point at zoom z.
 * @param {number} lat @param {number} lng @param {number} z
 */
export function tileFor(lat, lng, z) {
  const n = 2 ** z;
  const la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

// --- writer, for tests and fixtures only ------------------------------------

/** @param {number[]} out @param {number} v */
function wv(out, v) { while (v > 127) { out.push((v & 127) | 128); v = Math.floor(v / 128); } out.push(v); }
/** @param {number[]} out @param {number} field @param {number[]|Uint8Array} bytes */
function wlen(out, field, bytes) { wv(out, (field << 3) | 2); wv(out, bytes.length); for (const b of bytes) out.push(b); }
const enc = new TextEncoder();
const zz = (/** @type {number} */ n) => (n < 0 ? -2 * n - 1 : 2 * n);

/**
 * Build an MVT tile from lng/lat features (points and lines). Test helper.
 * @param {Record<string, {type: 1|2, properties: Record<string, string|number>, geometry: [number, number][][]}[]>} layers
 * @param {{z:number, x:number, y:number}} tile
 * @returns {Uint8Array}
 */
export function writeTile(layers, tile, extent = 4096) {
  const n = 2 ** tile.z;
  const toPx = (/** @type {[number, number]} */ [lng, lat]) => {
    const s = Math.sin((lat * Math.PI) / 180);
    const wx = (lng + 180) / 360; const wy = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    return [Math.round((wx * n - tile.x) * extent), Math.round((wy * n - tile.y) * extent)];
  };
  /** @type {number[]} */ const out = [];
  for (const [name, feats] of Object.entries(layers)) {
    /** @type {string[]} */ const keys = []; /** @type {(string|number)[]} */ const vals = [];
    /** @type {number[]} */ const layer = [];
    wlen(layer, 1, enc.encode(name));
    for (const f of feats) {
      /** @type {number[]} */ const tags = [];
      for (const [k, v] of Object.entries(f.properties)) {
        let ki = keys.indexOf(k); if (ki < 0) { ki = keys.length; keys.push(k); }
        let vi = vals.indexOf(v); if (vi < 0) { vi = vals.length; vals.push(v); }
        tags.push(ki, vi);
      }
      /** @type {number[]} */ const geom = []; let cx = 0; let cy = 0;
      for (const part of f.geometry) {
        const pts = part.map(toPx);
        geom.push((1 & 7) | (1 << 3)); geom.push(zz(pts[0][0] - cx), zz(pts[0][1] - cy)); [cx, cy] = pts[0];
        if (pts.length > 1) {
          geom.push((2 & 7) | ((pts.length - 1) << 3));
          for (const pt of pts.slice(1)) { geom.push(zz(pt[0] - cx), zz(pt[1] - cy)); [cx, cy] = pt; }
        }
      }
      /** @type {number[]} */ const feat = [];
      const pk = (/** @type {number[]} */ xs) => { /** @type {number[]} */ const b = []; for (const x of xs) wv(b, x); return b; };
      wlen(feat, 2, pk(tags)); wv(feat, (3 << 3) | 0); wv(feat, f.type); wlen(feat, 4, pk(geom));
      wlen(layer, 2, feat);
    }
    for (const k of keys) wlen(layer, 3, enc.encode(k));
    for (const v of vals) {
      /** @type {number[]} */ const vb = [];
      if (typeof v === 'string') wlen(vb, 1, enc.encode(v)); else { wv(vb, (5 << 3) | 0); wv(vb, v); }
      wlen(layer, 4, vb);
    }
    wv(layer, (5 << 3) | 0); wv(layer, extent);
    wv(layer, (15 << 3) | 0); wv(layer, 2);
    wlen(out, 3, layer);
  }
  return Uint8Array.from(out);
}
