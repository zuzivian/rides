// HTML for each screen. Every interpolated value goes through esc().
import * as fmt from '../core/format.js';
import { tripKm } from '../core/stats.js';
import { personality, distanceComparison, earthShare } from '../core/story.js';
import { icons, globeSvg, dialsSvg, clockSvg, calendarHtml, priceSpark, emblemSvg } from './visuals.js';

import { localParts, dayKey } from '../core/time.js';
/** @typedef {import('../core/stats.js').Stats} Stats */
/** @typedef {import('../core/types.js').Trip} Trip */

import { esc } from './esc.js';

export { esc };

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

/** @param {{error?: string, manualCount?: number}} [o] */
export function landing(o = {}) {
  return `
  <div class="landing wrap">
    <header><span class="mark">Rides<i>.</i></span></header>
    <section class="hero">
      ${heroArt()}
      <h1>Every ride you’ve taken, <em>counted and mapped.</em></h1>
      <p class="lede">Tap where a ride started and where it ended. See it on the map in seconds, then keep adding, or bring in your whole history. It all runs on this device.</p>
      ${o.error ? `<div class="error" role="alert"><strong>That file didn’t work</strong>${esc(o.error)}</div>` : ''}
      <div class="actions first-run">
        <button class="btn btn-primary btn-big" type="button" data-action="add-ride">＋ ${o.manualCount ? 'Add a ride' : 'Add your first ride'}</button>
        <div class="actions-sub">
          ${o.manualCount ? `<button class="link" type="button" data-action="my-rides">See your ${fmt.plural(o.manualCount, 'ride')}</button><span aria-hidden="true">·</span>` : ''}
          <label class="link" for="file">Import your history</label>
          <span aria-hidden="true">·</span>
          <button class="link" type="button" data-action="sample">Try with sample data</button>
        </div>
      </div>
      <input id="file" class="sr-only" type="file" accept=".csv,.eml,.mbox,.txt,text/csv,message/rfc822" multiple>
      <div class="drop">Or drop your <code>trips_data.csv</code>, or receipt emails (<code>.eml</code> / <code>.mbox</code>), anywhere on this page</div>
      <ul class="promises">
        <li>Parsed in your browser. No server, no account, no analytics.</li>
        <li>The street map and place names come from OpenFreeMap tiles. Your rides never leave your device.</li>
        <li>Rides you add and place nicknames are saved on this device only. You can delete them anytime.</li>
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
        <summary>Using receipt emails instead</summary>
        <ol>
          <li>In your mail app, select your Uber or Lyft receipt emails and save or export them as <code>.eml</code> files. Gmail and Apple Mail can do this. You can also use an <code>.mbox</code> export, such as Google Takeout with a label.</li>
          <li>Drop them here. They’re read on this device, and only trip times, addresses, distance, fare and ride type are kept. Names and card digits are ignored.</li>
          <li>Receipts don’t include coordinates, so those rides appear in the stats but not on the map. You can load them with your export, and duplicates are dropped.</li>
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
 * Overlay shown on top of the hero map: who, how many, and four totals.
 * @param {Stats} s @param {{source: string, unit: 'mi'|'km'}} ctx
 */
export function mapOverlay(s, ctx) {
  const unit = ctx.unit;
  const distV = unit === 'mi' ? s.km / 1.609344 : s.km;
  const hours = s.minutes / 60;
  const primary = s.spend[0];
  const p = personality(s);
  return `
    <div class="ov-head">
      <div class="eyebrow"><b>●</b> ${esc(ctx.source)}</div>
      <div class="ov-big"><span data-count="${s.count}">${fmt.int(s.count)}</span><small>${s.count === 1 ? 'ride' : 'rides'}</small></div>
      <div class="ov-sub">${esc(fmt.dayLabel(s.firstDay))} – ${esc(fmt.dayLabel(s.lastDay))}</div>
      ${s.count >= TYPE_MIN ? `<button type="button" class="ov-type" data-action="story" data-story-start="type">${icons.spark}<span>${esc(p.title)}</span></button>` : `<button type="button" class="ov-type locked" data-action="add-ride">${icons.spark}<span>Add ${TYPE_MIN - s.count} more ${TYPE_MIN - s.count === 1 ? 'ride' : 'rides'} to unlock your rider type</span></button>`}
    </div>
    <div class="ov-chips">
      <span class="ov-chip">${icons.road}<b data-count="${distV.toFixed(1)}">${fmt.int(distV)}</b>${unit}</span>
      ${hours >= 1 ? `<span class="ov-chip">${icons.clock}<b data-count="${hours.toFixed(1)}">${fmt.int(hours)}</b>hours</span>` : `<span class="ov-chip">${icons.clock}<b>${Math.round(s.minutes)}</b>min</span>`}
      ${primary ? `<span class="ov-chip">${icons.coin}<b data-count="${primary.total.toFixed(2)}" data-money="${esc(primary.currency)}">${esc(fmt.money(primary.total, primary.currency, { compact: true }))}</b></span>` : ''}
      <span class="ov-chip">${icons.pin}<b data-count="${s.places.length}">${s.places.length}</b>places</span>
    </div>`;
}

/** Rides needed before the rider type means anything. */
export const TYPE_MIN = 4;
/** Manual rides after which importing the full history is suggested. */
export const IMPORT_NUDGE = 5;
const CO2_KG_PER_KM = 0.17; // a typical petrol car, per km
const WALK_KMH = 5;

/**
 * The payoff after adding a ride, plus the rides you added.
 * @param {Stats} s
 * @param {{all: Trip[], last: Trip[]|null, hasImport: boolean}} m
 * @param {'mi'|'km'} unit
 */
export function addedSection(s, m, unit) {
  if (!m.all.length) return '';
  const last = m.last && m.last.length ? m.last : null;
  const one = last && last.length === 1 ? last[0] : null;
  const km = one ? one.km || 0 : 0;
  const mins = one && one.end ? Math.round((one.end - one.start) / 60000) : 0;
  const cmp = one ? distanceComparison(km) : null;
  const first = m.all.length === 1 && !m.hasImport;
  const series = [...new Set(m.all.map((t) => t.series).filter(Boolean))];
  const singles = m.all.filter((t) => !t.series).slice(-8).reverse();
  const stop = (/** @type {string} */ a) => esc(a || 'a spot on the map');
  const head = one
    ? `<div class="eyebrow">${first ? 'Your first ride on Rides' : 'Ride added'}</div>
       <h2>${stop(one.fromAddress)} <span class="accent">→</span> ${stop(one.toAddress)}</h2>
       <div class="facts added-facts">
         <div class="fact"><div class="eyebrow">Distance</div><div class="v">≈ ${esc(fmt.distance(km, unit))}</div><div class="d">by road, estimated</div></div>
         <div class="fact"><div class="eyebrow">Time</div><div class="v">≈ ${mins} min</div><div class="d">in the car, estimated</div></div>
         <div class="fact"><div class="eyebrow">Or on foot</div><div class="v">${esc(fmt.duration((km / WALK_KMH) * 60))}</div><div class="d">at a steady walk</div></div>
         <div class="fact"><div class="eyebrow">CO₂</div><div class="v">≈ ${(km * CO2_KG_PER_KM).toFixed(1)} kg</div><div class="d">for a typical petrol car${cmp ? `. ${esc(cmp.text)}` : ''}</div></div>
       </div>`
    : last ? `<div class="eyebrow">Commute added</div><h2>${last.length} rides, Home ⇄ Work</h2><p class="sub">Estimated from one entry and marked as estimated. Remove them together below.</p>`
      : `<div class="eyebrow">Rides you added</div><h2>${fmt.plural(m.all.length, 'ride')} on this device</h2>`;
  const hasCommute = series.some((id) => String(id).startsWith('commute-'));
  return `
  <section class="wrap added" aria-labelledby="h-added">
    <div class="card added-card reveal" id="h-added-card">
      <div id="h-added">${head}</div>
      <div class="actions added-actions">
        <button class="btn btn-primary btn-small" type="button" data-action="add-ride">＋ Add another ride</button>
        ${hasCommute ? '' : '<button class="btn btn-small" type="button" data-action="add-commute">Add your usual commute (Home ⇄ Work)</button>'}
      </div>
      ${!m.hasImport && m.all.length >= IMPORT_NUDGE ? `<div class="nudge"><b>Ready for the whole picture?</b> Import your Uber or Lyft history to see every ride you’ve taken, with real distances and fares, your rider type and your year in rides. <label class="link" for="file-added">Import your full history</label><input id="file-added" class="sr-only" type="file" accept=".csv,.eml,.mbox,.txt,text/csv,message/rfc822" multiple></div>` : ''}
      <details class="added-list"${m.all.length <= 3 ? ' open' : ''}>
        <summary>Rides you added (${m.all.length})</summary>
        <ul>
          ${series.map((id) => { const n = m.all.filter((t) => t.series === id).length; return `<li><span>Commute · ${n} estimated rides</span><button type="button" class="btn btn-small btn-ghost" data-delete-series="${esc(String(id))}">Remove all</button></li>`; }).join('')}
          ${singles.map((t) => `<li><span>${esc(fmt.dayLabel(dayKey(localParts(t.start, t.tz))))} · ${stop(t.fromAddress)} → ${stop(t.toAddress)}</span>
            <span class="li-actions"><button type="button" class="btn btn-small btn-ghost" data-edit-ride="${esc(t.id)}">Edit</button><button type="button" class="btn btn-small btn-ghost" data-delete-ride="${esc(t.id)}" aria-label="Delete ride">Delete</button></span></li>`).join('')}
        </ul>
        <p class="foot">Saved in this browser only. Distances and times are estimates.</p>
      </details>
    </div>
  </section>`;
}

/**
 * The explore view: map first, then a grid of visual highlights.
 * @param {Stats} s
 * @param {{source: string, unit: 'mi'|'km', allPlaces: boolean, warnings: string[], manual?: {all: Trip[], last: Trip[]|null, hasImport: boolean}}} ctx
 */
export function dashboard(s, ctx) {
  const unit = ctx.unit;
  const name = (/** @type {string|null} */ id) => (id ? s.places.find((p) => p.id === id)?.name || '?' : null);
  const hours = s.minutes / 60;
  const primary = s.spend[0];
  const p = personality(s);
  const cmp = distanceComparison(s.km);
  const share = earthShare(s.km);
  const distV = unit === 'mi' ? s.km / 1.609344 : s.km;

  return `
  <header class="topbar"><div class="wrap">
    <button class="btn btn-ghost btn-small" data-action="home" aria-label="Back to start" style="padding:0 6px"><span class="mark">Rides<i>.</i></span></button>
    <span class="spacer"></span>
    <button class="btn btn-primary btn-small" data-action="story">▶ Story</button>
    <div class="seg" role="group" aria-label="Distance unit">
      <button type="button" data-unit="mi" aria-pressed="${unit === 'mi'}">mi</button>
      <button type="button" data-unit="km" aria-pressed="${unit === 'km'}">km</button>
    </div>
    <button class="btn btn-small btn-ghost" data-action="home" aria-label="Load a different file">New</button>
  </div></header>

  <main class="explore${ctx.manual && !ctx.manual.hasImport ? ' compact-map' : ''}">
    <section id="map-slot"></section>
    ${ctx.manual ? addedSection(s, ctx.manual, unit) : ''}

    <div class="wrap dash">
      ${s.count >= TYPE_MIN ? `<section class="card type-card span-4 reveal" aria-labelledby="h-type">
        <div class="eyebrow">Your rider type</div>
        <div class="type-row">${emblemSvg(p.traits.map((t) => t.key))}<h2 id="h-type">${esc(p.title)}</h2></div>
        <ul class="reason-list">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </section>` : ''}

      ${s.km > 0 ? `<section class="card vis-card span-4 reveal" aria-labelledby="h-dist">
        <div class="eyebrow">${icons.road} Distance</div>
        <div class="vis">${globeSvg(share)}</div>
        <h2 id="h-dist" class="vis-big">${fmt.int(distV)} ${unit === 'mi' ? 'miles' : 'km'}</h2>
        <p class="sub">${cmp ? esc(cmp.text) : 'Every ride, end to end.'} ${share >= 0.01 ? `${share >= 1 ? `${share.toFixed(1)}×` : `${Math.round(share * 100)}% of the way`} around the Earth.` : ''}</p>
      </section>` : ''}

      ${hours > 0.5 ? `<section class="card vis-card span-4 reveal" aria-labelledby="h-time">
        <div class="eyebrow">${icons.clock} In the back seat</div>
        <div class="vis">${dialsSvg(hours)}</div>
        <h2 id="h-time" class="vis-big">${hours >= 24 ? `${(hours / 24).toFixed(1)} days` : `${Math.round(hours)} hours`}</h2>
        <p class="sub">${fmt.int(hours)} hours in cars, about ${esc(fmt.duration(s.minutes / Math.max(1, s.minutesKnown)))} per ride.</p>
      </section>` : ''}

      <section class="card span-7 reveal pre" aria-labelledby="h-routes">
        <div class="eyebrow">${icons.flame} Routes</div>
        <h2 id="h-routes">${s.routes[0] ? `${esc(s.routes[0].fromName)} <span class="accent">→</span> ${esc(s.routes[0].toName)}, ${s.routes[0].count} times` : 'Where you go most'}</h2>
        ${s.routes.length ? `<ul class="bars routes">${s.routes.slice(0, 6).map((r) => `
          <li data-tip="${esc(`${r.fromName} → ${r.toName}\n${r.count} rides · ${fmt.distance(r.avgKm, unit)} each${r.medianMinutes ? ` · ${Math.round(r.medianMinutes)} min typical` : ''}${r.spend ? `\n${fmt.money(r.spend, s.primaryCurrency)} in total` : ''}`)}">
            <span class="label">${miniArc()}${esc(r.fromName)}<span class="arrow">→</span>${esc(r.toName)}</span><span class="n">${r.count}</span>
            <span class="track"><span class="fill" style="--w:${(r.count / s.routes[0].count).toFixed(3)}"></span></span>
          </li>`).join('')}</ul>` : '<p class="foot">No pickup and dropoff coordinates in this file, so routes can’t be grouped.</p>'}
      </section>

      <section class="card span-5 reveal" aria-labelledby="h-places">
        <div class="eyebrow">${icons.pin} Places</div>
        <h2 id="h-places">Name your spots</h2>
        ${s.places.length ? `<ul class="places">${s.places.slice(0, ctx.allPlaces ? 60 : 6).map((pl) => `
          <li>
            <span class="kind" aria-hidden="true">${KIND_BADGE[pl.kind]}</span>
            <button class="name" type="button" data-rename="${esc(pl.id)}" aria-label="Rename ${esc(pl.name)}"${pl.nameSource === 'pattern' || pl.nameSource === 'area' ? ' title="A guess. Tap to name it."' : ''}>${esc(pl.name)}</button>
            <span class="n">${pl.visits}</span>
          </li>`).join('')}</ul>
          <div class="more">
            ${s.places.length > 6 ? `<button class="btn btn-small" data-action="all-places">${ctx.allPlaces ? 'Show fewer' : `Show all ${s.places.length}`}</button>` : ''}
            <button class="btn btn-small btn-ghost" data-action="reset-names">Reset names</button>
          </div>` : '<p class="foot">Receipt-only rides have no coordinates, so there are no places to name.</p>'}
        <p class="foot">Place names come from OpenFreeMap map tiles for the areas you ride in; your rides never leave your device.</p>
        ${s.places.some((pl) => pl.nameSource === 'pattern' || pl.nameSource === 'area') ? '<p class="foot">Where the map has no name nearby, places are named from when you ride there ("Work?", "Late nights") and how far they are from Home. Tap ✎ to name them.</p>' : ''}
        <p class="foot">Nicknames stay on this device.</p>
      </section>

      <section class="card span-7 reveal" aria-labelledby="h-heat">
        <div class="eyebrow">${icons.clock} Rhythm</div>
        <h2 id="h-heat"><span class="accent">${esc(fmt.WEEKDAY_NAMES[s.peak.weekday])}s, ${esc(fmt.hourLabel(s.peak.hour))}</span> is your hour</h2>
        <div class="rhythm">
          <div class="clock-wrap small">${clockSvg(s.byHour, s.peak.hour)}<div class="clock-mid"><b>${esc(fmt.hourLabel(s.peak.hour))}</b><span>peak</span></div></div>
          <div class="rhythm-heat">${heatmap(s)}
            <div class="legend"><span>Fewer</span><span class="ramp"></span><span>More rides</span></div>
          </div>
        </div>
      </section>

      <section class="card span-5 reveal" aria-labelledby="h-facts">
        <div class="eyebrow">Habits</div>
        <h2 id="h-facts">The little patterns</h2>
        <div class="facts icons">
          ${fact(`${icons.moon} Late night`, fmt.int(s.lateNight.count), `rides between midnight and 5 am (${Math.round(s.lateNight.share * 100)}%)`)}
          ${fact(`${icons.plane} Airport runs`, fmt.int(s.airports.count), s.airports.byCode.length ? s.airports.byCode.slice(0, 3).map((a) => `${esc(a.code)} ${a.count}`).join(' · ') : 'none found')}
          ${fact(`${icons.flame} Streak`, `${s.streaks.longestDays.length} ${s.streaks.longestDays.length === 1 ? 'day' : 'days'}`, s.streaks.longestDays.length > 1 ? `in a row, ending ${esc(fmt.dayLabel(s.streaks.longestDays.end))}` : 'with a ride each day')}
          ${fact(`${icons.clock} Wait`, s.wait ? `${s.wait.avgMinutes.toFixed(1)} min` : '—', s.wait ? 'on average, request to pickup' : 'no request times in this file')}
        </div>
      </section>

      <section class="card span-12 reveal pre" aria-labelledby="h-months">
        <div class="eyebrow">${icons.calendar} Months</div>
        <h2 id="h-months">${s.busiestMonth ? `Busiest: <span class="accent">${esc(fmt.monthLabel(s.busiestMonth.key))}</span>, ${s.busiestMonth.count} rides` : 'By month'}</h2>
        <div class="months-row">
          <div class="months-chart">${months(s)}</div>
          ${s.busiestMonth ? `<div class="months-cal">${calendarHtml(s, s.busiestMonth.key)}</div>` : ''}
        </div>
      </section>

      ${s.years.length > 1 ? `<section class="card span-6 reveal pre" aria-labelledby="h-years">
        <div class="eyebrow">Year over year</div>
        <h2 id="h-years">${yearTitle(s)}</h2>
        ${yearBars(s)}
        <p class="foot">Rides per month, so partial years compare fairly.</p>
      </section>` : ''}

      ${primary ? `<section class="card span-6 reveal" aria-labelledby="h-spend">
        <div class="eyebrow">${icons.coin} Spent</div>
        <h2 id="h-spend" class="vis-big">${esc(fmt.money(primary.total, primary.currency, { compact: true }))}</h2>
        <p class="sub">${esc(fmt.money(primary.total / primary.count, primary.currency))} a ride on average${s.pricePerDistance.overall ? `, ${esc(fmt.money(s.pricePerDistance.overall, s.pricePerDistance.currency))} per ${unit}` : ''}.${s.spend.length > 1 ? ` Plus ${s.spend.slice(1).map((x) => esc(fmt.money(x.total, x.currency, { compact: true }))).join(', ')} (not converted).` : ''}</p>
        <div class="spark-wrap">${priceSpark(s)}<span class="spark-cap">price per ${unit === 'mi' ? 'mile' : 'km'} by month${s.pricePerDistance.change != null && Math.abs(s.pricePerDistance.change) >= 0.05 ? `, ${s.pricePerDistance.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(s.pricePerDistance.change) * 100)}%` : ''}</span></div>
      </section>` : ''}

      <section class="card span-6 reveal" aria-labelledby="h-mix">
        <div class="eyebrow">Ride types</div>
        <h2 id="h-mix">${esc(s.products[0]?.name || '')}, ${Math.round((s.products[0]?.share || 0) * 100)}% of the time</h2>
        <div class="mix big" aria-hidden="true">${s.products.map((pr, i) => `<span style="flex:${pr.count};--o:${Math.max(0.2, 1 - i * 0.16).toFixed(2)}" data-tip="${esc(`${pr.name}\n${pr.count} rides · ${Math.round(pr.share * 100)}%`)}"></span>`).join('')}</div>
        <div class="mix-legend">${s.products.slice(0, 7).map((pr, i) => `<span><i style="--o:${Math.max(0.2, 1 - i * 0.16).toFixed(2)}"></i>${esc(pr.name)} <b>${Math.round(pr.share * 100)}%</b></span>`).join('')}</div>
      </section>

      <section class="card span-6 reveal" aria-labelledby="h-cities">
        <div class="eyebrow">${icons.globe} Cities</div>
        <h2 id="h-cities">${fmt.plural(s.cities.length, 'city', 'cities')}</h2>
        <div class="city-chips">${s.cities.slice(0, 8).map((c) => `<button type="button" class="city-chip" data-city="${esc(c.name.replace(/\s+(Bay Area|Area)$/i, ''))}" style="--f:${Math.sqrt(c.count / s.cities[0].count).toFixed(2)}"><b>${esc(c.name)}</b><span>${fmt.plural(c.count, 'ride')}</span></button>`).join('')}</div>
        <p class="foot">Tap a city to fly the map there.</p>
      </section>

      <section class="card span-12 reveal" aria-labelledby="h-rec">
        <div class="eyebrow">Records</div>
        <h2 id="h-rec">Your extremes</h2>
        <div class="records">
          ${s.longest ? record('Longest ride', fmt.distance(/** @type {number} */ (tripKm(s.longest.trip)), unit), s.longest, name) : ''}
          ${s.mostExpensive ? record('Most expensive', fmt.money(/** @type {number} */ (s.mostExpensive.trip.fare), s.primaryCurrency), s.mostExpensive, name) : ''}
          ${s.cheapest ? record('Cheapest', fmt.money(/** @type {number} */ (s.cheapest.trip.fare), s.primaryCurrency), s.cheapest, name) : ''}
        </div>
      </section>

      <p class="note-honest span-12">These are rides on your account. Rides friends booked for you aren’t in your export, so they aren’t included.${ctx.warnings.length ? ` ${ctx.warnings.map(esc).join(' ')}` : ''}</p>
    </div>
  </main>`;
}

/** @param {Stats} s */
function yearTitle(s) {
  const ys = s.years; const a = ys[ys.length - 2]; const b = ys[ys.length - 1];
  const ch = (b.count / Math.max(1, b.monthsCovered)) / (a.count / Math.max(1, a.monthsCovered)) - 1;
  return Math.abs(ch) < 0.05 ? `${b.year} is on the same pace as ${a.year}` : `${b.year} is <span class="accent">${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? 'busier' : 'quieter'}</span> than ${a.year}`;
}

/** Year-over-year as side-by-side pace bars for rides, distance and spend. @param {Stats} s */
function yearBars(s) {
  const ys = s.years.slice(-3);
  const metrics = [
    ['Rides a month', (/** @type {typeof ys[0]} */ y) => y.count / Math.max(1, y.monthsCovered), (/** @type {number} */ v) => v.toFixed(1)],
    [`${s.unit} a month`, (/** @type {typeof ys[0]} */ y) => (s.unit === 'mi' ? y.km / 1.609344 : y.km) / Math.max(1, y.monthsCovered), (/** @type {number} */ v) => fmt.int(v)],
    ...(s.primaryCurrency ? [['Spent a month', (/** @type {typeof ys[0]} */ y) => y.spend / Math.max(1, y.monthsCovered), (/** @type {number} */ v) => fmt.money(v, s.primaryCurrency, { compact: true })]] : []),
  ];
  return `<div class="ybars">${metrics.map(([label, f, show]) => {
    const vals = ys.map((y) => /** @type {(y: any)=>number} */ (f)(y)); const max = Math.max(...vals, 1e-9);
    return `<div class="yb"><div class="yb-label">${esc(label)}</div><div class="yb-cols">${ys.map((y, i) => `
      <div class="yb-col${i === ys.length - 1 ? ' cur' : ''}"><span class="yb-v">${esc(/** @type {(v:number)=>string} */ (show)(vals[i]))}</span><span class="yb-bar" style="--h:${(vals[i] / max).toFixed(3)}"></span><span class="yb-y">${y.year}${y.monthsCovered < 12 ? `<small>${y.monthsCovered} mo</small>` : ''}</span></div>`).join('')}</div></div>`;
  }).join('')}</div>`;
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

