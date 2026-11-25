// SVG visuals shared by the story and the explore view. Each returns markup;
// animations are CSS (classes in styles.css) so reduced motion turns them off.
import * as fmt from '../core/format.js';
import { esc } from './esc.js';

/** @typedef {import('../core/stats.js').Stats} Stats */

export const icons = {
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" fill="currentColor"/></svg>',
  plane: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5Z" fill="currentColor"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#07090e"/></svg>',
  road: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 3 4 21M16 3l4 18M12 4v3M12 10v3M12 16v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  coin: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 22c4 0 7-2.8 7-6.8 0-3.6-2.6-6-4.2-8.7-.4 2-1.4 3.2-2.6 3.8C12.6 7 11.4 4.4 9 2c.2 3.5-4 6.6-4 11.6C5 18.6 8 22 12 22Z" fill="currentColor"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4Z" fill="currentColor"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.6"/></svg>',
};

/**
 * A drawn globe with an amber road wrapping part of the equator.
 * @param {number} share  fraction of the Earth's circumference covered
 */
export function globeSvg(share) {
  const laps = Math.floor(share);
  const part = Math.max(0.012, share - laps);
  const meridians = [-60, -30, 0, 30, 60].map((d) => {
    const rx = Math.abs(Math.sin((d * Math.PI) / 180)) * 110;
    return d === 0 ? '<line x1="150" y1="40" x2="150" y2="260" class="g-line"/>' : `<ellipse cx="150" cy="150" rx="${rx.toFixed(1)}" ry="110" class="g-line"/>`;
  }).join('');
  const parallels = [-50, -25, 25, 50].map((d) => {
    const y = 150 - Math.sin((d * Math.PI) / 180) * 110 * 0.82;
    const rx = Math.cos((d * Math.PI) / 180) * 110;
    return `<ellipse cx="150" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.22).toFixed(1)}" class="g-line"/>`;
  }).join('');
  // Equator ring, tilted: we draw the full ellipse as the "road".
  const road = laps >= 1
    ? `<ellipse cx="150" cy="150" rx="122" ry="34" class="g-road g-full" pathLength="100" transform="rotate(-14 150 150)"/>`
    : '';
  return `<svg class="v-globe" viewBox="0 0 300 300" role="img" aria-label="Globe with your distance drawn along the equator">
    <defs><radialGradient id="gl" cx="38%" cy="34%"><stop offset="0" stop-color="#1b2232"/><stop offset="1" stop-color="#0a0e16"/></radialGradient></defs>
    <circle cx="150" cy="150" r="110" fill="url(#gl)" stroke="#2a3346"/>
    ${meridians}${parallels}
    <ellipse cx="150" cy="150" rx="122" ry="34" class="g-track" transform="rotate(-14 150 150)"/>
    ${road}
    <ellipse cx="150" cy="150" rx="122" ry="34" class="g-road" pathLength="100" style="--d:${(part * 100).toFixed(2)}" transform="rotate(-14 150 150)"/>
  </svg>`;
}

/**
 * One dial per day spent in cars (last one partial). Falls back to a
 * single 24-hour dial under a day.
 * @param {number} hours
 */
export function dialsSvg(hours) {
  const days = hours / 24;
  const count = Math.min(14, Math.max(1, Math.ceil(days)));
  const perRow = count <= 4 ? count : Math.ceil(count / 2);
  const size = 64; const gap = 14;
  const rows = Math.ceil(count / perRow);
  const W = perRow * size + (perRow - 1) * gap; const H = rows * size + (rows - 1) * gap;
  let html = '';
  for (let i = 0; i < count; i++) {
    const fill = Math.min(1, Math.max(0, days - i)) || (days < 1 ? days : 0);
    const x = (i % perRow) * (size + gap) + size / 2; const y = Math.floor(i / perRow) * (size + gap) + size / 2;
    html += `<g transform="translate(${x} ${y})">
      <circle r="26" class="d-track"/>
      <circle r="26" class="d-fill" pathLength="100" style="--d:${(fill * 100).toFixed(1)};animation-delay:${(i * 0.12).toFixed(2)}s" transform="rotate(-90)"/>
      <circle r="3" class="d-hub"/>
      <text y="44" class="d-lab">${i + 1 === count && fill < 1 ? `${Math.round(fill * 24)}h` : `day ${i + 1}`}</text>
    </g>`;
  }
  return `<svg class="v-dials" viewBox="-4 -4 ${W + 8} ${H + 22}" role="img" aria-label="${days.toFixed(1)} days in cars">${html}</svg>`;
}

/**
 * 24-hour radial clock: one bar per hour, length by rides.
 * @param {number[]} byHour @param {number} peakHour
 */
export function clockSvg(byHour, peakHour) {
  const max = Math.max(1, ...byHour);
  let bars = '';
  for (let h = 0; h < 24; h++) {
    const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
    const len = 14 + (byHour[h] / max) * 86;
    const x1 = 150 + Math.cos(a) * 44; const y1 = 150 + Math.sin(a) * 44;
    const x2 = 150 + Math.cos(a) * (44 + len); const y2 = 150 + Math.sin(a) * (44 + len);
    bars += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="c-bar${h === peakHour ? ' peak' : ''}${h < 5 ? ' night' : ''}" style="animation-delay:${(h * 0.035).toFixed(3)}s"><title>${fmt.hourLabel(h)}: ${byHour[h]} rides</title></line>`;
  }
  const ticks = [0, 6, 12, 18].map((h) => {
    const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
    return `<text x="${(150 + Math.cos(a) * 146).toFixed(1)}" y="${(150 + Math.sin(a) * 146 + 4).toFixed(1)}" class="c-tick">${h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}</text>`;
  }).join('');
  return `<svg class="v-clock" viewBox="0 0 300 300" role="img" aria-label="Rides by hour of day">${bars}${ticks}</svg>`;
}

/**
 * Calendar of one month, each day a dot sized by rides.
 * @param {Stats} s @param {string} monthKey
 */
export function calendarHtml(s, monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  /** @type {Map<number, number>} */
  const perDay = new Map();
  for (const v of s.views) if (v.month === monthKey) perDay.set(v.local.day, (perDay.get(v.local.day) || 0) + 1);
  const max = Math.max(1, ...perDay.values());
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let cells = fmt.WEEKDAY_SHORT.map((d) => `<span class="cal-h">${d.slice(0, 1)}</span>`).join('');
  for (let i = 0; i < first; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const n = perDay.get(d) || 0;
    cells += `<span class="cal-d${n ? ' on' : ''}" style="--s:${n ? (0.45 + 0.55 * Math.sqrt(n / max)).toFixed(2) : 0};animation-delay:${(d * 0.04).toFixed(2)}s" data-tip="${esc(`${d} ${fmt.MONTH_NAMES[m - 1]}\n${fmt.plural(n, 'ride')}`)}"><i></i><b>${d}</b></span>`;
  }
  return `<div class="v-cal" role="img" aria-label="Rides per day in ${esc(fmt.monthLabel(monthKey))}">${cells}</div>`;
}

/** Airports as boarding-tag pins with a plane crossing above. @param {Stats} s */
export function airportsHtml(s) {
  const list = s.airports.byCode.filter((a) => a.code !== 'Airport').slice(0, 4);
  const max = Math.max(1, ...list.map((a) => a.count));
  return `<div class="v-air">
    <svg class="air-arc" viewBox="0 0 300 90" aria-hidden="true"><path id="airpath" d="M14 80 Q150 -30 286 80" class="air-line"/>
      <g class="air-plane"><g transform="rotate(90)">${icons.plane.replace('width="18" height="18"', 'width="22" height="22" x="-11" y="-11"')}</g>
      <animateMotion dur="3.2s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#airpath"/></animateMotion></g></svg>
    <div class="air-tags">${list.map((a, i) => `<div class="air-tag" style="--f:${(a.count / max).toFixed(2)};animation-delay:${(0.3 + i * 0.15).toFixed(2)}s"><b>${esc(a.code)}</b><span>${a.count}×</span></div>`).join('')}</div>
  </div>`;
}

/** Price per distance sparkline. @param {Stats} s */
export function priceSpark(s) {
  const pts = s.pricePerDistance.series;
  if (pts.length < 2) return '';
  const W = 300; const H = 110;
  const vals = pts.map((p) => p.value); const lo = Math.min(...vals) * 0.9; const hi = Math.max(...vals) * 1.05;
  const x = (/** @type {number} */ i) => 6 + (i / (pts.length - 1)) * (W - 12);
  const y = (/** @type {number} */ v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  return `<svg class="v-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price per ${s.unit} by month">
    <path d="${d} L${x(pts.length - 1).toFixed(1)} ${H} L6 ${H} Z" class="sp-area"/><path d="${d}" class="sp-line" pathLength="100"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1].value).toFixed(1)}" r="5" class="sp-dot"/></svg>`;
}

/** Concentric emblem for the personality card. @param {string[]} keys trait keys */
export function emblemSvg(keys) {
  const map = { commute: icons.road, night: icons.moon, jet: icons.plane, weekend: icons.calendar, habit: icons.flame, explore: icons.pin, early: icons.clock };
  const main = map[/** @type {keyof typeof map} */ (keys[0])] || icons.spark;
  return `<div class="v-emblem" aria-hidden="true">
    <span class="em-ring r1"></span><span class="em-ring r2"></span><span class="em-ring r3"></span>
    <span class="em-icon">${main.replace('width="18" height="18"', 'width="64" height="64"')}</span>
  </div>`;
}
