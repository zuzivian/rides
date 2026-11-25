// HTML for each screen. Every interpolated value goes through esc().
import * as fmt from '../core/format.js';
import { tripKm } from '../core/stats.js';

/** @typedef {import('../core/stats.js').Stats} Stats */

/** @param {unknown} s */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

const KIND_BADGE = { home: 'HM', work: 'WK', airport: '✈', place: '•' };

/** Decorative hero: a made-up city of dots with arcs fanning out from one point. */
export function heroArt() {
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const W = 560; const H = 400; const hx = 210; const hy = 238;
  let dots = '';
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2; const d = Math.pow(r(), 0.7) * 230;
    const x = W / 2 + Math.cos(a) * d * 1.15; const y = H / 2 + Math.sin(a) * d * 0.72;
    dots += `<circle class="city" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.8 + r() * 1.6).toFixed(1)}"/>`;
  }
  const targets = [[388, 132, 9], [470, 300, 3], [300, 86, 4], [120, 120, 2], [96, 300, 3], [330, 330, 5], [432, 220, 2], [520, 70, 1]];
  let arcs = '';
  targets.forEach(([x, y, w], i) => {
    const mx = (hx + x) / 2; const my = (hy + y) / 2;
    const dx = x - hx; const dy = y - hy; const len = Math.hypot(dx, dy);
    const cx = mx - (dy / len) * len * 0.28; const cy = my + (dx / len) * len * 0.28;
    const L = Math.round(len * 1.15);
    arcs += `<path class="arc" d="M${hx} ${hy} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x} ${y}" style="--len:${L};stroke-width:${(0.8 + w * 0.32).toFixed(2)};animation-delay:${(i * 0.18).toFixed(2)}s"/>`;
    arcs += `<circle class="pt" cx="${x}" cy="${y}" r="${(1.6 + w * 0.25).toFixed(1)}"/>`;
  });
  return `<svg class="hero-art" viewBox="0 0 ${W} ${H}" role="img" aria-label="Illustration: arcs connecting points on a dark city map">
    <defs><radialGradient id="glow"><stop offset="0" stop-color="#ffb547" stop-opacity=".55"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>
    ${dots}<circle cx="${hx}" cy="${hy}" r="34" fill="url(#glow)"/>${arcs}<circle class="pt" cx="${hx}" cy="${hy}" r="4"/></svg>`;
}

/** @param {{error?: string}} [o] */
export function landing(o = {}) {
  return `
  <div class="landing wrap">
    <header><span class="mark">Rides<i>.</i></span></header>
    <section class="hero">
      ${heroArt()}
      <h1>Every ride you’ve taken, <em>counted and mapped.</em></h1>
      <p class="lede">Load your Uber or Lyft data export and see your routes, habits and spending on a night-time map. It all runs on this device. Nothing is uploaded.</p>
      ${o.error ? `<div class="error" role="alert"><strong>That file didn’t work</strong>${esc(o.error)}</div>` : ''}
      <div class="actions">
        <label class="btn btn-primary" for="file">Choose your export</label>
        <button class="btn" type="button" data-action="sample">Try with sample data</button>
      </div>
      <input id="file" class="sr-only" type="file" accept=".csv,text/csv" multiple>
      <div class="drop">Or drop your <code>trips_data.csv</code> anywhere on this page</div>
      <ul class="promises">
        <li>Parsed in your browser. No server, no account, no analytics.</li>
        <li>The map is drawn from your rides alone. No map tiles, no third-party requests.</li>
        <li>Place nicknames are saved on this device only. You can clear them anytime.</li>
      </ul>
    </section>
    <section class="howto" aria-label="How to get your data">
      <details>
        <summary>How to get your Uber data</summary>
        <ol>
          <li>Go to Uber’s Privacy Center (privacy.uber.com) and sign in.</li>
          <li>Choose <b>Download your data</b>. Uber emails you when it’s ready, which can take a few hours to a couple of days.</li>
          <li>Unzip it and load <code>Rider/trips_data.csv</code>.</li>
        </ol>
      </details>
      <details>
        <summary>How to get your Lyft data</summary>
        <ol>
          <li>Open Lyft’s privacy settings in the app or on lyft.com.</li>
          <li>Choose <b>Download your data</b> and wait for the email.</li>
          <li>Load the ride history CSV from the download.</li>
        </ol>
      </details>
      <details>
        <summary>What gets counted</summary>
        <ol>
          <li>Completed rides on your account. Canceled trips and food orders are skipped.</li>
          <li>Rides a friend booked for you aren’t in your export, so they aren’t counted.</li>
          <li>Local times use the zone where each ride started.</li>
        </ol>
      </details>
    </section>
  </div>`;
}

/**
 * @param {Stats} s
 * @param {{source: string, unit: 'mi'|'km', allPlaces: boolean, warnings: string[]}} ctx
 */
export function dashboard(s, ctx) {
  const unit = ctx.unit;
  const name = (/** @type {string|null} */ id) => (id ? s.places.find((p) => p.id === id)?.name || '?' : null);
  const distV = unit === 'mi' ? s.km / 1.609344 : s.km;
  const hours = s.minutes / 60;
  const primary = s.spend[0];
  const otherSpend = s.spend.slice(1).filter((x) => x.currency);

  return `
  <header class="topbar"><div class="wrap">
    <button class="btn btn-ghost btn-small" data-action="home" aria-label="Back to start" style="padding:0 6px"><span class="mark">Rides<i>.</i></span></button>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Distance unit">
      <button type="button" data-unit="mi" aria-pressed="${unit === 'mi'}">mi</button>
      <button type="button" data-unit="km" aria-pressed="${unit === 'km'}">km</button>
    </div>
    <button class="btn btn-small" data-action="home">New file</button>
  </div></header>

  <main class="wrap dash">
    <section class="headline span-12 reveal">
      <div class="eyebrow"><b>●</b> ${esc(ctx.source)}</div>
      <div class="big"><span data-count="${s.count}">${fmt.int(s.count)}</span><small>rides</small></div>
      <p class="sub">on your account, <strong>${esc(fmt.dayLabel(s.firstDay))}</strong> to <strong>${esc(fmt.dayLabel(s.lastDay))}</strong>.</p>
    </section>

    <section class="tiles span-12 reveal" aria-label="Totals">
      ${tile('Distance', `<span data-count="${distV.toFixed(1)}" data-dec="0">${fmt.int(distV)}</span><span class="u">${unit}</span>`, s.kmKnown < s.count ? `${s.count - s.kmKnown} rides without distance` : `${fmt.distance(s.km / s.count, unit)} on average`)}
      ${tile('In the car', `<span data-count="${hours.toFixed(1)}" data-dec="0">${fmt.int(hours)}</span><span class="u">hours</span>`, `${(hours / 24).toFixed(1)} days`)}
      ${tile('Spent', primary ? `<span data-count="${primary.total.toFixed(2)}" data-money="${esc(primary.currency)}">${esc(fmt.money(primary.total, primary.currency, { compact: true }))}</span>` : '—',
        otherSpend.length ? `+ ${otherSpend.map((o) => esc(fmt.money(o.total, o.currency, { compact: true }))).join(', ')}` : primary ? `${esc(fmt.money(primary.total / primary.count, primary.currency))} a ride` : 'No fares in this file')}
      ${tile('Places', `<span data-count="${s.places.length}">${s.places.length}</span>`, `${fmt.plural(s.cities.filter((c) => c.name !== 'Unknown').length || 1, 'city', 'cities')}`)}
    </section>

    <section id="map-slot" class="span-12"></section>

    ${s.lines.length ? `<section class="card span-7 reveal" aria-labelledby="h-lines">
      <div class="eyebrow">Highlights</div>
      <h2 id="h-lines">The short version</h2>
      <ol class="lines">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    </section>` : ''}

    <section class="card span-5 reveal" aria-labelledby="h-rec">
      <div class="eyebrow">Records</div>
      <h2 id="h-rec">Your extremes</h2>
      <div class="records" style="grid-template-columns:1fr">
        ${s.longest ? record('Longest ride', fmt.distance(/** @type {number} */ (tripKm(s.longest.trip)), unit), s.longest, name) : ''}
        ${s.mostExpensive ? record('Most expensive', fmt.money(/** @type {number} */ (s.mostExpensive.trip.fare), s.primaryCurrency), s.mostExpensive, name) : ''}
        ${s.cheapest ? record('Cheapest', fmt.money(/** @type {number} */ (s.cheapest.trip.fare), s.primaryCurrency), s.cheapest, name) : ''}
      </div>
    </section>

    <section class="card span-7 reveal pre" aria-labelledby="h-routes">
      <div class="eyebrow">Routes</div>
      <h2 id="h-routes">Where you go most</h2>
      ${s.routes.length ? `<ul class="bars">${s.routes.slice(0, 6).map((r) => `
        <li data-tip="${esc(`${r.fromName} → ${r.toName}\n${r.count} rides · ${fmt.distance(r.avgKm, unit)} each${r.medianMinutes ? ` · ${Math.round(r.medianMinutes)} min typical` : ''}${r.spend ? `\n${fmt.money(r.spend, s.primaryCurrency)} in total` : ''}`)}">
          <span class="label">${esc(r.fromName)}<span class="arrow">→</span>${esc(r.toName)}</span><span class="n">${r.count}</span>
          <span class="track"><span class="fill" style="--w:${(r.count / s.routes[0].count).toFixed(3)}"></span></span>
        </li>`).join('')}</ul>` : '<p class="foot">No pickup and dropoff coordinates in this file, so routes can’t be grouped.</p>'}
      <p class="foot">Pickups and dropoffs within about 250 m are grouped into one place. Give places your own names in the Places card.</p>
    </section>

    <section class="card span-5 reveal" aria-labelledby="h-places">
      <div class="eyebrow">Places</div>
      <h2 id="h-places">Name your spots</h2>
      ${s.places.length ? `<ul class="places">${s.places.slice(0, ctx.allPlaces ? 60 : 8).map((p) => `
        <li>
          <span class="kind" aria-hidden="true">${KIND_BADGE[p.kind]}</span>
          <button class="name" type="button" data-rename="${esc(p.id)}" aria-label="Rename ${esc(p.name)}">${esc(p.name)}</button>
          <span class="n">${p.visits}</span>
        </li>`).join('')}</ul>
        <div class="more">
          ${s.places.length > 8 ? `<button class="btn btn-small" data-action="all-places">${ctx.allPlaces ? 'Show fewer' : `Show all ${s.places.length}`}</button>` : ''}
          <button class="btn btn-small btn-ghost" data-action="reset-names">Reset names</button>
        </div>` : '<p class="foot">No coordinates in this file.</p>'}
      <p class="foot">Nicknames stay on this device. Numbers count pickups plus dropoffs.</p>
    </section>

    <section class="card span-7 reveal" aria-labelledby="h-heat">
      <div class="eyebrow">Rhythm</div>
      <h2 id="h-heat">When you ride: <span class="accent">${esc(fmt.WEEKDAY_NAMES[s.peak.weekday])}s, ${esc(fmt.hourLabel(s.peak.hour))}</span></h2>
      ${heatmap(s)}
      <div class="legend"><span>Fewer</span><span class="ramp"></span><span>More rides</span><span style="margin-left:auto">Local time where each ride began</span></div>
    </section>

    <section class="card span-5 reveal" aria-labelledby="h-facts">
      <div class="eyebrow">Habits</div>
      <h2 id="h-facts">Patterns</h2>
      <div class="facts">
        ${fact('Late night', fmt.int(s.lateNight.count), `rides between midnight and 5 am (${Math.round(s.lateNight.share * 100)}%)`)}
        ${fact('Airport runs', fmt.int(s.airports.count), s.airports.byCode.length ? s.airports.byCode.slice(0, 3).map((a) => `${esc(a.code)} ${a.count}`).join(' · ') : 'none found')}
        ${fact('Longest streak', `${s.streaks.longestDays.length} ${s.streaks.longestDays.length === 1 ? 'day' : 'days'}`, s.streaks.longestDays.length > 1 ? `${esc(fmt.dayLabel(s.streaks.longestDays.start))} to ${esc(fmt.dayLabel(s.streaks.longestDays.end))}` : 'with a ride each day')}
        ${fact('Weekly streak', `${s.streaks.longestWeeks} ${s.streaks.longestWeeks === 1 ? 'week' : 'weeks'}`, 'in a row with at least one ride')}
        ${fact('Average wait', s.wait ? `${s.wait.avgMinutes.toFixed(1)} min` : '—', s.wait ? `from request to pickup, ${fmt.plural(s.wait.count, 'ride')}` : 'no request times in this file')}
        ${fact('Longest break', `${s.streaks.longestGap.days} days`, s.streaks.longestGap.days ? `without a ride, ending ${esc(fmt.dayLabel(s.streaks.longestGap.end))}` : '')}
      </div>
    </section>

    <section class="card span-12 reveal pre" aria-labelledby="h-months">
      <div class="eyebrow">Months</div>
      <h2 id="h-months">${s.busiestMonth ? `Busiest: <span class="accent">${esc(fmt.monthLabel(s.busiestMonth.key))}</span>` : 'By month'}</h2>
      ${months(s)}
      <div class="split">
        <div><div class="k">Busiest month</div><div class="val">${s.busiestMonth ? `${esc(fmt.monthLabel(s.busiestMonth.key))} · ${fmt.plural(s.busiestMonth.count, 'ride')}` : '—'}</div></div>
        <div><div class="k">Quietest month</div><div class="val">${s.quietestMonth ? `${esc(fmt.monthLabel(s.quietestMonth.key))} · ${fmt.plural(s.quietestMonth.count, 'ride')}` : '—'}</div></div>
      </div>
    </section>

    <section class="card span-7 reveal" aria-labelledby="h-years">
      <div class="eyebrow">Year over year</div>
      <h2 id="h-years">${years(s).title}</h2>
      <div class="scroll-x">${years(s).table}</div>
      <p class="foot">Changes compare rides per month, so partial years are fair.</p>
    </section>

    <section class="card span-5 reveal" aria-labelledby="h-ppm">
      <div class="eyebrow">Price per ${unit === 'mi' ? 'mile' : 'km'}</div>
      <h2 id="h-ppm">${ppmTitle(s)}</h2>
      ${spark(s)}
      <p class="foot">${s.pricePerDistance.currency ? `${esc(s.pricePerDistance.currency)} rides only, monthly. Short hops under 0.3 km left out.` : 'No fares in this file.'}</p>
    </section>

    <section class="card span-6 reveal pre" aria-labelledby="h-mix">
      <div class="eyebrow">Product mix</div>
      <h2 id="h-mix">${esc(s.products[0]?.name || '')} most of the time</h2>
      <div class="mix" aria-hidden="true">${s.products.map((p, i) => `<span style="flex:${p.count};--o:${Math.max(0.18, 1 - i * 0.16).toFixed(2)}" data-tip="${esc(`${p.name}\n${p.count} rides · ${Math.round(p.share * 100)}%`)}"></span>`).join('')}</div>
      <ul class="bars">${s.products.slice(0, 6).map((p) => `
        <li><span class="label">${esc(p.name)}</span><span class="n">${Math.round(p.share * 100)}%</span>
        <span class="track"><span class="fill" style="--w:${(p.count / s.products[0].count).toFixed(3)}"></span></span></li>`).join('')}</ul>
    </section>

    <section class="card span-6 reveal pre" aria-labelledby="h-cities">
      <div class="eyebrow">Cities</div>
      <h2 id="h-cities">${fmt.plural(s.cities.length, 'city', 'cities')}</h2>
      <ul class="bars">${s.cities.slice(0, 6).map((c) => `
        <li data-tip="${esc(`${c.name}\nFirst ride ${new Date(c.first).toISOString().slice(0, 10)}`)}"><span class="label">${esc(c.name)}</span><span class="n">${c.count}</span>
        <span class="track"><span class="fill" style="--w:${(c.count / s.cities[0].count).toFixed(3)}"></span></span></li>`).join('')}</ul>
      ${s.spend.length > 1 ? `<p class="foot">Spending by currency: ${s.spend.map((x) => esc(fmt.money(x.total, x.currency))).join(' · ')}. Currencies aren’t converted.</p>` : ''}
    </section>

    <p class="note-honest span-12">These are rides on your account. Rides friends booked for you aren’t in your export, so they aren’t included.${ctx.warnings.length ? ` ${ctx.warnings.map(esc).join(' ')}` : ''}</p>
  </main>`;
}

function tile(label, value, note) {
  return `<div class="tile"><div class="eyebrow">${label}</div><div class="v">${value}</div><div class="note">${note}</div></div>`;
}

function fact(label, value, detail) {
  return `<div class="fact"><div class="eyebrow">${label}</div><div class="v">${value}</div><div class="d">${detail}</div></div>`;
}

/** @param {string} label @param {string} value @param {import('../core/stats.js').TripView} v @param {(id: string|null) => string|null} name */
function record(label, value, v, name) {
  const from = name(v.from) || shortAddr(v.trip.fromAddress) || 'Pickup';
  const to = name(v.to) || shortAddr(v.trip.toAddress) || 'Dropoff';
  return `<div class="record">
    <div class="eyebrow">${label}</div>
    <div class="v">${esc(value)}</div>
    <div class="route"><span>${esc(from)}</span>${miniArc()}<span>${esc(to)}</span></div>
    <div class="when">${esc(fmt.dayLabel(v.day))} · ${esc(fmt.hourLabel(v.local.hour))}${v.trip.city ? ` · ${esc(v.trip.city)}` : ''}</div>
  </div>`;
}

const miniArc = () => '<svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true"><path d="M3 11 Q17 -4 31 11" fill="none" stroke="#ffb547" stroke-width="1.6" stroke-linecap="round"/><circle cx="3" cy="11" r="2.2" fill="#ffb547"/><circle cx="31" cy="11" r="2.2" fill="#ffd08a"/></svg>';

const shortAddr = (a) => (a ? a.split(',')[0].replace(/^\d+\s+/, '') : '');

/** @param {Stats} s */
function heatmap(s) {
  const max = Math.max(...s.heatmap.flat(), 1);
  let html = '<div class="heat" role="img" aria-label="Rides by weekday and hour">';
  s.heatmap.forEach((row, d) => {
    html += `<span class="d">${fmt.WEEKDAY_SHORT[d].slice(0, 2)}</span>`;
    row.forEach((n, h) => {
      const a = n ? (0.14 + 0.86 * Math.sqrt(n / max)).toFixed(2) : 0;
      const peak = d === s.peak.weekday && h === s.peak.hour;
      html += `<span class="c${n ? ' on' : ''}${peak ? ' peak' : ''}" style="--a:${a}" data-tip="${esc(`${fmt.WEEKDAY_NAMES[d]}, ${fmt.hourLabel(h)}\n${fmt.plural(n, 'ride')}`)}"></span>`;
    });
  });
  html += '<span></span>';
  for (let h = 0; h < 24; h++) html += `<span class="h">${h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : ''}</span>`;
  return `${html}</div>`;
}

/** @param {Stats} s */
function months(s) {
  const max = Math.max(...s.months.map((m) => m.count), 1);
  const hi = s.busiestMonth?.key; const lo = s.quietestMonth?.key;
  const cols = s.months.map((m) => {
    const cls = m.key === hi ? ' hi' : m.key === lo ? ' lo' : '';
    const tag = m.key === hi || m.key === lo ? `<span class="tag">${m.count}</span>` : '';
    return `<div class="col${cls}" style="--h:${(m.count / max).toFixed(3)}" data-tip="${esc(`${fmt.monthLabel(m.key)}\n${fmt.plural(m.count, 'ride')}${m.spend ? ` · ${fmt.money(m.spend, s.primaryCurrency, { compact: true })}` : ''}`)}">${tag}<div class="bar"></div></div>`;
  }).join('');
  const axis = s.months.map((m) => {
    const mo = Number(m.key.slice(5));
    const label = mo === 1 || m === s.months[0] ? `${fmt.MONTH_NAMES[mo - 1].slice(0, 1)}<br>’${m.key.slice(2, 4)}` : fmt.MONTH_NAMES[mo - 1].slice(0, 1);
    return `<span>${label}</span>`;
  }).join('');
  return `<div class="cols" role="img" aria-label="Rides per month">${cols}</div><div class="axis" aria-hidden="true">${axis}</div>`;
}

/** @param {Stats} s */
function years(s) {
  const ys = s.years;
  const unit = s.unit;
  const rows = ys.map((y, i) => {
    const prev = ys[i - 1];
    const perMonth = (/** @type {typeof y} */ x, /** @type {number} */ v) => v / Math.max(1, x.monthsCovered);
    const delta = (/** @type {number} */ cur, /** @type {number} */ old) => {
      if (!prev || !old) return '';
      const ch = (perMonth(y, cur) - perMonth(prev, old)) / perMonth(prev, old);
      if (Math.abs(ch) < 0.01) return '<span class="delta">same pace</span>';
      return `<span class="delta${ch > 0 ? ' up' : ''}">${ch > 0 ? '↑' : '↓'} ${Math.abs(Math.round(ch * 100))}%</span>`;
    };
    const dist = unit === 'mi' ? y.km / 1.609344 : y.km;
    return `<tr>
      <th scope="row">${y.year}${y.monthsCovered < 12 ? `<span class="partial">${y.monthsCovered} mo</span>` : ''}</th>
      <td>${fmt.int(y.count)}${delta(y.count, prev?.count || 0)}</td>
      <td>${fmt.int(dist)}${delta(y.km, prev?.km || 0)}</td>
      <td>${fmt.int(y.minutes / 60)}${delta(y.minutes, prev?.minutes || 0)}</td>
      <td>${s.primaryCurrency ? esc(fmt.money(y.spend, s.primaryCurrency, { compact: true })) : '—'}${delta(y.spend, prev?.spend || 0)}</td>
      <td>${fmt.int(y.lateNight)}</td>
    </tr>`;
  }).join('');
  let title = 'One year so far';
  if (ys.length >= 2) {
    const a = ys[ys.length - 2]; const b = ys[ys.length - 1];
    const ch = (b.count / Math.max(1, b.monthsCovered)) / (a.count / Math.max(1, a.monthsCovered)) - 1;
    title = Math.abs(ch) < 0.05 ? `${b.year} is on the same pace as ${a.year}` : `${b.year} is <span class="accent">${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? 'busier' : 'quieter'}</span> than ${a.year}`;
  }
  return {
    title,
    table: `<table class="years"><thead><tr><th scope="col">Year</th><th scope="col">Rides</th><th scope="col">${unit}</th><th scope="col">Hours</th><th scope="col">Spent</th><th scope="col">Late</th></tr></thead><tbody>${rows}</tbody></table>`,
  };
}

/** @param {Stats} s */
function ppmTitle(s) {
  const p = s.pricePerDistance;
  if (p.overall == null) return 'Not enough fares';
  const v = esc(fmt.money(p.overall, p.currency));
  if (p.change == null || Math.abs(p.change) < 0.05) return `About <span class="accent">${v}</span>, steady`;
  return `<span class="accent">${v}</span> on average, ${p.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(p.change) * 100)}%`;
}

/** @param {Stats} s */
function spark(s) {
  const pts = s.pricePerDistance.series;
  if (pts.length < 2) return '';
  const W = 600; const H = 230; const P = { l: 74, r: 10, t: 14, b: 34 };
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals) * 0.9; const hi = Math.max(...vals) * 1.05;
  const x = (/** @type {number} */ i) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (/** @type {number} */ v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts.length - 1).toFixed(1)} ${H - P.b} L${x(0).toFixed(1)} ${H - P.b} Z`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(x(i) - x(i - 1), y(pts[i].value) - y(pts[i - 1].value));
  const ticks = [lo + (hi - lo) * 0.15, lo + (hi - lo) * 0.85];
  const cur = s.pricePerDistance.currency;
  const step = (W - P.l - P.r) / (pts.length - 1);
  return `<svg class="spark draw" viewBox="0 0 ${W} ${H}" style="height:auto;--len:${Math.ceil(len)}" role="img" aria-label="Price per distance by month">
    <defs><linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity=".22"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="0" y="${(y(t) + 6).toFixed(1)}">${esc(fmt.money(t, cur))}</text>`).join('')}
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    <circle class="dot" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1].value).toFixed(1)}" r="5"/>
    <text x="${P.l}" y="${H - 6}">${esc(fmt.monthLabel(pts[0].key, true))}</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end">${esc(fmt.monthLabel(pts[pts.length - 1].key, true))}</text>
    ${pts.map((p, i) => `<rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" data-tip="${esc(`${fmt.monthLabel(p.key)}\n${fmt.money(p.value, cur)} per ${s.unit} · ${fmt.plural(p.count, 'ride')}`)}"/>`).join('')}
  </svg>`;
}
