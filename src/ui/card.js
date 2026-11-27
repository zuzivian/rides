// "My year in rides": a 1080×1920 share card drawn on a canvas and saved as
// PNG. Place names and addresses are left out unless the user opts in to
// showing their own nicknames.
import { computeStats } from '../core/stats.js';
import { project, arcControl, robustBounds } from '../core/mercator.js';
import * as fmt from '../core/format.js';

/** @typedef {import('../core/stats.js').Stats} Stats */
/** @typedef {import('../core/types.js').Trip} Trip */

export const CARD_W = 1080;
export const CARD_H = 1920;

const INK = '#07090e';
const TEXT = '#ece7df';
const MUTED = '#a19b91';
const FAINT = '#6c685f';
const SODIUM = '#ffb547';
const AMBER = '255, 181, 71';
const HOT = '255, 220, 160';
const SANS = 'system-ui, -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const memo = { period: '', names: false };

/** @param {Stats} s */
export function cardSection(s) {
  const years = s.years.map((y) => y.year);
  const def = memo.period && (memo.period === 'all' || years.includes(Number(memo.period))) ? memo.period : String(years[years.length - 1]);
  memo.period = def;
  return `
  <section class="card share-card span-12 reveal" aria-labelledby="h-share">
    <div class="share-grid">
      <div class="share-copy">
        <div class="eyebrow">Share card</div>
        <h2 id="h-share">Your year in rides, as one image</h2>
        <p class="sub">A 1080 × 1920 PNG for stories and chats. It’s drawn on this device. Place names and addresses are left out unless you turn them on. Names include your nicknames and names guessed from the map.</p>
        <div class="share-controls">
          <div class="seg" role="group" aria-label="Card period">
            ${years.length > 1 ? `<button type="button" data-card-period="all" aria-pressed="${def === 'all'}">All</button>` : ''}
            ${years.map((y) => `<button type="button" data-card-period="${y}" aria-pressed="${def === String(y)}">${y}</button>`).join('')}
          </div>
          <label class="toggle"><input type="checkbox" data-card-names ${memo.names ? 'checked' : ''}><span>Show place names</span></label>
          <button type="button" class="btn btn-primary" data-card-download>Download PNG</button>
        </div>
        <p class="foot">With place names off, the mini map shows arcs only: no streets, names or addresses. Even so, a cluster of arcs can hint at where you live, so check before posting.</p>
      </div>
      <div class="share-preview"><canvas width="${CARD_W}" height="${CARD_H}" aria-label="Preview of your share card" role="img"></canvas></div>
    </div>
  </section>`;
}

/**
 * Wire up the share card section.
 * @param {HTMLElement} root @param {Trip[]} trips @param {{names: Record<string,string>, guesses?: Record<string, {name: string, kind?: string}>, unit: 'mi'|'km'}} opts
 */
export function mountCard(root, trips, opts) {
  const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('canvas'));
  const draw = () => {
    const subset = memo.period === 'all' ? trips : trips.filter((t) => periodOf(t) === memo.period);
    const s = computeStats(subset.length ? subset : trips, { names: opts.names, guesses: opts.guesses, unit: opts.unit });
    if (s) drawCard(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), s, { period: memo.period, showNames: memo.names, unit: opts.unit });
    canvas.setAttribute('aria-label', `Share card preview: ${s?.count ?? 0} rides${memo.period === 'all' ? '' : ` in ${memo.period}`}`);
  };
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    const p = t.closest('[data-card-period]')?.getAttribute('data-card-period');
    if (p) {
      memo.period = p;
      root.querySelectorAll('[data-card-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-card-period') === p)));
      draw();
    }
    if (t.closest('[data-card-download]')) download(canvas, memo.period);
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.hasAttribute('data-card-names')) { memo.names = t.checked; draw(); }
  });
  // Draw after fonts settle so measurements match what's shown.
  (document.fonts?.ready || Promise.resolve()).then(draw);
  draw();
}

/** Calendar year of a trip in its own zone. @param {Trip} t */
function periodOf(t) {
  return new Intl.DateTimeFormat('en-US', { timeZone: t.tz, year: 'numeric' }).format(new Date(t.start));
}

/**
 * Render the card off-screen and download it.
 * @param {Stats} s @param {{period: string, showNames: boolean, unit: 'mi'|'km'}} o
 */
export function saveCard(s, o) {
  const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H;
  drawCard(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), s, o);
  download(c, o.period);
}

/** @param {HTMLCanvasElement} canvas @param {string} period */
function download(canvas, period) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `my-${period === 'all' ? 'rides' : `${period}-in-rides`}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Stats} s
 * @param {{period: string, showNames: boolean, unit: 'mi'|'km'}} o
 */
export function drawCard(ctx, s, o) {
  const W = CARD_W; const H = CARD_H; const X = 88;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);

  // Haze and street grid.
  const haze = ctx.createRadialGradient(W / 2, -200, 0, W / 2, -200, 1300);
  haze.addColorStop(0, 'rgba(255, 181, 71, .20)'); haze.addColorStop(1, 'rgba(255, 181, 71, 0)');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, .03)'; ctx.lineWidth = 2;
  ctx.translate(W / 2, H / 2); ctx.rotate((28 * Math.PI) / 180);
  for (let i = -2200; i < 2200; i += 96) { ctx.beginPath(); ctx.moveTo(i, -2200); ctx.lineTo(i, 2200); ctx.moveTo(-2200, i); ctx.lineTo(2200, i); ctx.stroke(); }
  ctx.restore();

  // Header.
  ctx.fillStyle = TEXT; ctx.font = `800 64px ${SANS}`;
  ctx.fillText('Rides', X, 150);
  const rw = ctx.measureText('Rides').width;
  ctx.fillStyle = SODIUM; ctx.fillText('.', X + rw + 2, 150);
  ctx.textAlign = 'right'; ctx.font = `600 26px ${MONO}`; ctx.fillStyle = MUTED;
  ctx.fillText(o.period === 'all' ? 'MY RIDES' : 'MY YEAR IN RIDES', W - X, 118);
  ctx.fillStyle = SODIUM; ctx.font = `700 44px ${MONO}`;
  ctx.fillText(o.period === 'all' ? `${s.firstDay.slice(0, 4)}–${s.lastDay.slice(0, 4)}` : o.period, W - X, 168);
  ctx.textAlign = 'left';

  // Hero number.
  const count = fmt.int(s.count);
  let size = 340;
  ctx.font = `800 ${size}px ${SANS}`;
  while (ctx.measureText(count).width > W - X * 2 - 220 && size > 160) { size -= 10; ctx.font = `800 ${size}px ${SANS}`; }
  ctx.fillStyle = TEXT;
  setTracking(ctx, -0.055 * size);
  ctx.fillText(count, X - size * 0.04, 520);
  const cw = ctx.measureText(count).width;
  setTracking(ctx, 0);
  ctx.fillStyle = MUTED; ctx.font = `700 64px ${SANS}`;
  ctx.fillText('rides', X + cw + 18, 520);
  ctx.font = `500 32px ${SANS}`; ctx.fillStyle = FAINT;
  ctx.fillText(`on my account, ${fmt.dayLabel(s.firstDay)} – ${fmt.dayLabel(s.lastDay)}`, X, 586);

  // Mini map.
  const map = { x: X, y: 640, w: W - X * 2, h: 600 };
  drawMiniMap(ctx, s, map, o.showNames);

  // Stat grid.
  const dist = o.unit === 'mi' ? s.km / 1.609344 : s.km;
  const primary = s.spend[0];
  const cells = [
    ['DISTANCE', `${fmt.int(dist)} ${o.unit}`],
    ['IN THE CAR', `${fmt.int(s.minutes / 60)} h`],
    ['SPENT', primary ? fmt.money(primary.total, primary.currency, { compact: true }) : '—'],
    ['LATE NIGHT', fmt.int(s.lateNight.count)],
    ['AIRPORT RUNS', fmt.int(s.airports.count)],
    [s.cities.length === 1 ? 'CITY' : 'CITIES', fmt.int(s.cities.filter((c) => c.name !== 'Unknown').length || 1)],
  ];
  const gy = 1310; const colW = (W - X * 2) / 3; const rowH = 170;
  cells.forEach(([label, value], i) => {
    const cx = X + (i % 3) * colW; const cy = gy + Math.floor(i / 3) * rowH;
    ctx.fillStyle = MUTED; ctx.font = `600 22px ${MONO}`; setTracking(ctx, 3);
    ctx.fillText(label, cx, cy); setTracking(ctx, 0);
    ctx.fillStyle = TEXT; let fs = 66; ctx.font = `750 ${fs}px ${SANS}`;
    while (ctx.measureText(value).width > colW - 24 && fs > 34) { fs -= 4; ctx.font = `750 ${fs}px ${SANS}`; }
    ctx.fillText(value, cx, cy + 78);
  });

  // Highlight lines.
  const top = s.routes[0];
  /** @type {[string, string][]} */
  const facts = [];
  if (top) facts.push(['MOST LOYAL ROUTE', o.showNames ? `${top.fromName} → ${top.toName} · ${top.count}×` : `${top.count} rides on one route`]);
  if (s.busiestMonth) facts.push(['BUSIEST MONTH', `${fmt.monthLabel(s.busiestMonth.key)} · ${s.busiestMonth.count}`]);
  else if (s.streaks.longestDays.length > 1) facts.push(['LONGEST STREAK', `${s.streaks.longestDays.length} days in a row`]);
  let fy = 1680;
  ctx.fillStyle = 'rgba(255, 255, 255, .08)'; ctx.fillRect(X, fy - 66, W - X * 2, 2);
  for (const [label, value] of facts) {
    ctx.fillStyle = SODIUM; ctx.font = `600 22px ${MONO}`; setTracking(ctx, 3); ctx.fillText(label, X, fy - 18); setTracking(ctx, 0);
    ctx.fillStyle = TEXT; let fs = 38; ctx.font = `650 ${fs}px ${SANS}`;
    while (ctx.measureText(value).width > (W - X * 2) / 2 - 20 && fs > 24) { fs -= 2; ctx.font = `650 ${fs}px ${SANS}`; }
    ctx.fillText(value, X, fy + 26);
    ctx.translate((W - X * 2) / 2, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Footer.
  ctx.fillStyle = FAINT; ctx.font = `500 24px ${SANS}`;
  ctx.fillText('Rides on my account only. Made with Rides, on my own device.', X, H - 72);
}

/**
 * @param {CanvasRenderingContext2D} ctx @param {Stats} s
 * @param {{x:number,y:number,w:number,h:number}} box @param {boolean} showNames
 */
function drawMiniMap(ctx, s, box, showNames) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 36);
  ctx.fillStyle = 'rgba(13, 17, 25, .92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, .07)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.clip();

  // Frame the city with the most rides.
  const city = s.cities[0]?.name;
  const placeById = new Map(s.places.map((p) => [p.id, { ...p, w: project(p.lng, p.lat) }]));
  /** @type {[number,number][]} */
  const pts = [];
  for (const v of s.views) {
    if (city && v.trip.city.replace(/\s+(Bay Area|Area)$/i, '') !== city) continue;
    for (const id of [v.from, v.to]) { const p = id ? placeById.get(id) : null; if (p) pts.push(/** @type {[number,number]} */ (p.w)); }
  }
  const b = robustBounds(pts, 0.05);
  if (!b) {
    ctx.fillStyle = FAINT; ctx.font = `500 28px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText('No coordinates in this export', box.x + box.w / 2, box.y + box.h / 2);
    ctx.restore(); ctx.textAlign = 'left'; return;
  }
  const pad = 70;
  const bw = Math.max(b.maxX - b.minX, 1e-6); const bh = Math.max(b.maxY - b.minY, 1e-6);
  const z = Math.min((box.w - pad * 2) / bw, (box.h - pad * 2) / bh);
  const cx = (b.minX + b.maxX) / 2; const cy = (b.minY + b.maxY) / 2;
  const toS = (/** @type {number[]} */ w) => /** @type {[number,number]} */ ([box.x + box.w / 2 + (w[0] - cx) * z, box.y + box.h / 2 + (w[1] - cy) * z]);

  /** @type {Map<string, {a:string,b:string,n:number}>} */
  const routes = new Map();
  for (const v of s.views) {
    if (!v.from || !v.to || v.from === v.to) continue;
    const k = `${v.from}>${v.to}`; const r = routes.get(k) || { a: v.from, b: v.to, n: 0 }; r.n++; routes.set(k, r);
  }
  const maxN = Math.max(1, ...[...routes.values()].map((r) => r.n));
  const maxV = Math.max(1, ...s.places.map((p) => p.visits));

  ctx.globalCompositeOperation = 'lighter';
  for (const p of placeById.values()) {
    const [x, y] = toS(p.w); const f = Math.sqrt(p.visits / maxV); const r = 18 + f * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${AMBER}, ${0.12 + 0.25 * f})`); g.addColorStop(1, `rgba(${AMBER}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.lineCap = 'round';
  for (const r of routes.values()) {
    const A = toS(/** @type {any} */ (placeById.get(r.a)).w); const B = toS(/** @type {any} */ (placeById.get(r.b)).w);
    const C = arcControl(A, B, 0.2); const f = Math.sqrt(r.n / maxN);
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.quadraticCurveTo(C[0], C[1], B[0], B[1]);
    ctx.strokeStyle = `rgba(${AMBER}, ${0.05 + 0.14 * f})`; ctx.lineWidth = 6 + 10 * f; ctx.stroke();
    ctx.strokeStyle = `rgba(${f > 0.6 ? HOT : AMBER}, ${0.25 + 0.7 * f})`; ctx.lineWidth = 1.6 + 3 * f; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const ranked = [...placeById.values()].sort((a, b2) => b2.visits - a.visits);
  for (const p of ranked) {
    const [x, y] = toS(p.w); const r = 3 + Math.sqrt(p.visits / maxV) * 9;
    ctx.fillStyle = `rgb(${HOT})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  if (showNames) {
    ctx.font = `600 22px ${MONO}`; ctx.textBaseline = 'middle';
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const boxes = [];
    for (const p of ranked.slice(0, 10)) {
      const [x, y] = toS(p.w); const text = p.name.toUpperCase();
      const tw = ctx.measureText(text).width + 20; const th = 36;
      let bx = x + 18; const by = y - th / 2;
      if (bx + tw > box.x + box.w - 16) bx = x - 18 - tw;
      if (bx < box.x + 12 || by < box.y + 12 || by + th > box.y + box.h - 12) continue;
      if (boxes.some((q) => bx < q.x + q.w && bx + tw > q.x && by < q.y + q.h && by + th > q.y)) continue;
      if (boxes.length >= 5) break;
      boxes.push({ x: bx, y: by, w: tw, h: th });
      ctx.fillStyle = 'rgba(7, 9, 14, .82)'; roundRect(ctx, bx, by, tw, th, 10); ctx.fill();
      ctx.fillStyle = TEXT; ctx.fillText(text, bx + 10, y + 1);
    }
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  // City caption under the map frame (city names are public, not personal).
  if (city) {
    ctx.font = `600 22px ${MONO}`; setTracking(ctx, 3);
    const label = city.toUpperCase(); const lw = ctx.measureText(label).width + 28;
    ctx.fillStyle = 'rgba(7, 9, 14, .86)'; roundRect(ctx, box.x + 18, box.y + box.h - 62, lw, 40, 12); ctx.fill();
    ctx.fillStyle = MUTED; ctx.fillText(label, box.x + 32, box.y + box.h - 34); setTracking(ctx, 0);
  }
}

/** Canvas letterSpacing where supported (Chrome/Safari 17+). */
function setTracking(ctx, px) {
  if ('letterSpacing' in ctx) /** @type {any} */ (ctx).letterSpacing = `${px}px`;
}

/** @param {CanvasRenderingContext2D} ctx */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

