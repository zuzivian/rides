// Full-screen "year in rides" story: one big idea per card, every card a
// visual. Tap right or swipe left for next; tap left for back; hold to pause.
import * as fmt from '../core/format.js';
import { distanceComparison, earthShare, personality } from '../core/story.js';
import { esc } from './esc.js';
import { makeScene, fitCanvas, tween } from './scene.js';
import { globeSvg, dialsSvg, clockSvg, calendarHtml, airportsHtml, priceSpark, emblemSvg, icons } from './visuals.js';
import { drawCard, CARD_W, CARD_H } from './card.js';
import { reducedMotion } from './motion.js';

/** @typedef {import('../core/stats.js').Stats} Stats */
/** @typedef {{id:string, html:string, enter?:(el:HTMLElement)=>(()=>void)|void}} Card */

const DURATION = 6500;

/**
 * Build the cards that this dataset supports.
 * @param {Stats} s @param {{unit:'mi'|'km'}} o
 * @returns {Card[]}
 */
export function buildCards(s, o) {
  const scene = makeScene(s);
  const unit = o.unit;
  const dist = unit === 'mi' ? s.km / 1.609344 : s.km;
  const hours = s.minutes / 60;
  const primary = s.spend[0];
  const p = personality(s);
  /** @type {Card[]} */
  const cards = [];

  /** Canvas card helper: draws the scene with a tween. */
  const sceneEnter = (/** @type {Parameters<typeof scene.draw>[3]} */ opts, /** @type {((t:number)=>void)|undefined} */ extra) => (/** @type {HTMLElement} */ el) => {
    const c = /** @type {HTMLCanvasElement|null} */ (el.querySelector('canvas.sc-scene'));
    if (!c) return;
    return tween((t) => {
      const { ctx, w, h } = fitCanvas(c);
      scene.draw(ctx, w, h, { ...opts, progress: t });
      extra?.(t);
    }, 2200);
  };

  // 1. Intro
  cards.push({
    id: 'intro',
    html: card('Your rides', `<canvas class="sc-scene"></canvas>`,
      `<span class="sc-num" data-to="${s.count}">${fmt.int(s.count)}</span> rides`,
      `on your account, ${esc(fmt.dayLabel(s.firstDay))} to ${esc(fmt.dayLabel(s.lastDay))}. Here’s what they add up to.`, 'scene'),
    enter: sceneEnter({}, undefined),
  });

  // 2. Distance
  if (s.km > 0) {
    const cmp = distanceComparison(s.km);
    const share = earthShare(s.km);
    cards.push({
      id: 'distance',
      html: card(`${icons.road} Distance`, globeSvg(share),
        `<span class="sc-num" data-to="${Math.round(dist)}">${fmt.int(dist)}</span> ${unit === 'mi' ? 'miles' : 'km'}`,
        `${cmp ? esc(cmp.text) : ''} ${share >= 0.01 ? `Or ${share >= 1 ? `${share.toFixed(1)} times` : `${Math.round(share * 100)}% of the way`} around the Earth.` : ''}`),
    });
  }

  // 3. Time
  if (hours > 0.5) {
    const days = hours / 24;
    cards.push({
      id: 'time',
      html: card(`${icons.clock} In the back seat`, dialsSvg(hours),
        days >= 1 ? `<span class="sc-num" data-to="${days.toFixed(1)}" data-dec="1">${days.toFixed(1)}</span> days` : `<span class="sc-num" data-to="${Math.round(hours)}">${Math.round(hours)}</span> hours`,
        `${fmt.int(hours)} hours in cars, about ${esc(fmt.duration(s.minutes / Math.max(1, s.minutesKnown)))} per ride.`),
    });
  }

  // 4. Loyal route
  const top = s.routes[0];
  if (top && top.count >= 3) {
    cards.push({
      id: 'route',
      html: card(`${icons.flame} Most loyal route`, `<canvas class="sc-scene"></canvas><div class="sc-counter"><span class="sc-num" data-to="${top.count}">${top.count}</span><small>times</small></div>`,
        `${esc(top.fromName)} <span class="arrow">→</span> ${esc(top.toName)}`,
        `${top.medianMinutes ? `Usually ${Math.round(top.medianMinutes)} minutes` : 'Your go-to'}${top.spend ? `, ${esc(fmt.money(top.spend / top.count, s.primaryCurrency))} a ride` : ''}. That’s ${Math.round((top.count / s.count) * 100)}% of all your rides.`, 'scene'),
      enter: sceneEnter({ lit: (v) => v.from === top.from && v.to === top.to, dim: 0.16 }),
    });
  }

  // 5. Night owl
  if (s.lateNight.count >= 2) {
    const latest = s.lateNight.latest;
    cards.push({
      id: 'night',
      html: card(`${icons.moon} After midnight`, `<canvas class="sc-scene"></canvas>`,
        `<span class="sc-num" data-to="${s.lateNight.count}">${s.lateNight.count}</span> late-night rides`,
        `Started between midnight and 5 am.${latest ? ` Your latest pickup: ${esc(clockTime(latest.local.hour, latest.local.minute))} on a ${fmt.WEEKDAY_NAMES[latest.local.weekday]}.` : ''}`, 'scene night'),
      enter: sceneEnter({ lit: (v) => v.local.hour < 5, dim: 0.05, cool: true }),
    });
  }

  // 6. Rhythm
  cards.push({
    id: 'rhythm',
    html: card(`${icons.clock} Your hour`, `<div class="clock-wrap">${clockSvg(s.byHour, s.peak.hour)}<div class="clock-mid"><b>${esc(fmt.hourLabel(s.peak.hour))}</b><span>${esc(fmt.WEEKDAY_SHORT[s.peak.weekday])}</span></div></div>`,
      `${esc(fmt.WEEKDAY_NAMES[s.peak.weekday])}s at ${esc(fmt.hourLabel(s.peak.hour))}`,
      `Your busiest time of the week. Each spoke is an hour of the day, longer when you ride more.`),
  });

  // 7. Busiest month
  if (s.busiestMonth && s.months.length > 1) {
    cards.push({
      id: 'month',
      html: card(`${icons.calendar} Busiest month`, calendarHtml(s, s.busiestMonth.key),
        esc(fmt.monthLabel(s.busiestMonth.key)),
        `${fmt.plural(s.busiestMonth.count, 'ride')}, your busiest month.${s.quietestMonth ? ` The quietest was ${esc(fmt.monthLabel(s.quietestMonth.key))}, with ${s.quietestMonth.count}.` : ''}`),
    });
  }

  // 8. Airports
  if (s.airports.count >= 1 && s.airports.byCode.some((a) => a.code !== 'Airport')) {
    cards.push({
      id: 'airports',
      html: card(`${icons.plane} Airport runs`, airportsHtml(s),
        `<span class="sc-num" data-to="${s.airports.count}">${s.airports.count}</span> airport ${s.airports.count === 1 ? 'run' : 'runs'}`,
        `${s.airports.toAirport} to the airport and ${s.airports.fromAirport} home again${s.airports.spend ? `, ${esc(fmt.money(s.airports.spend, s.primaryCurrency, { compact: true }))} in total` : ''}.`),
    });
  }

  // 9. Cities
  const cities = s.cities.filter((c) => c.name !== 'Unknown');
  const drawableCities = cities.filter((c) => scene.cities.includes(c.name)).slice(0, 3);
  if (cities.length >= 2) {
    cards.push({
      id: 'cities',
      html: card(`${icons.globe} Cities`, `<div class="mini-cities">${drawableCities.map((c) => `<figure><canvas class="sc-mini" data-city="${esc(c.name)}"></canvas><figcaption>${esc(c.name)}<span>${c.count}</span></figcaption></figure>`).join('')}</div>`,
        `${cities.length} cities`,
        `${esc(listAnd(cities.map((c) => c.name)))}. Same habits, different streets.`),
      enter: (el) => {
        const stops = [...el.querySelectorAll('canvas.sc-mini')].map((cv, i) => tween((t) => {
          const { ctx, w, h } = fitCanvas(/** @type {HTMLCanvasElement} */ (cv));
          scene.draw(ctx, w, h, { city: /** @type {HTMLElement} */ (cv).dataset.city, progress: Math.max(0, t * 1.3 - i * 0.15), scale: 0.7 });
        }, 2200));
        return () => stops.forEach((f) => f());
      },
    });
  }

  // 10. Spend
  if (primary) {
    const ppd = s.pricePerDistance;
    cards.push({
      id: 'spend',
      html: card(`${icons.coin} Spent on rides`, `<div class="spark-wrap">${priceSpark(s)}<span class="spark-cap">price per ${unit === 'mi' ? 'mile' : 'km'}, month by month</span></div>`,
        `<span class="sc-num" data-to="${Math.round(primary.total)}" data-money="${esc(primary.currency)}">${esc(fmt.money(primary.total, primary.currency, { compact: true }))}</span>`,
        `About ${esc(fmt.money(primary.total / primary.count, primary.currency))} a ride.${ppd.change != null && Math.abs(ppd.change) >= 0.05 ? ` Price per ${unit === 'mi' ? 'mile' : 'km'} ${ppd.change > 0 ? 'rose' : 'fell'} ${Math.round(Math.abs(ppd.change) * 100)}%.` : ''}${s.spend.length > 1 ? ` Plus ${s.spend.slice(1).map((x) => esc(fmt.money(x.total, x.currency, { compact: true }))).join(', ')} abroad.` : ''}`),
    });
  }

  // 11. Personality
  cards.push({
    id: 'type',
    html: card(`${icons.spark} Your rider type`, emblemSvg(p.traits.map((t) => t.key)),
      esc(p.title),
      `<span class="reasons">${p.reasons.map((r) => `<span>${esc(r)}</span>`).join('')}</span>`, 'type'),
  });

  // 12. Finale: the share card grows out of the story.
  cards.push({
    id: 'finale',
    html: `<article class="sc sc-finale">
      <div class="sc-eyebrow">${icons.spark} That’s your year</div>
      <div class="finale-card"><canvas width="${CARD_W}" height="${CARD_H}" class="finale-canvas" aria-label="Your share card"></canvas></div>
      <div class="finale-actions">
        <button type="button" class="btn btn-primary" data-story-download>Save image</button>
        <button type="button" class="btn" data-story-close>Explore map</button>
      </div>
    </article>`,
    enter: (el) => {
      const c = /** @type {HTMLCanvasElement} */ (el.querySelector('canvas'));
      const year = s.years[s.years.length - 1];
      drawCard(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), s, { period: s.years.length > 1 ? 'all' : String(year.year), showNames: false, unit });
    },
  });
  return cards;
}

/** @param {string} eyebrow @param {string} visual @param {string} big @param {string} sub @param {string} [kind] */
function card(eyebrow, visual, big, sub, kind = '') {
  return `<article class="sc ${kind.split(' ').filter(Boolean).map((k) => `sc-${k}`).join(' ')}">
    <div class="sc-eyebrow">${eyebrow}</div>
    <div class="sc-visual">${visual}</div>
    <div class="sc-text"><h2 class="sc-big">${big}</h2><p class="sc-sub">${sub}</p></div>
  </article>`;
}

/** @param {number} h @param {number} m */
function clockTime(h, m) { return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; }

/** @param {string[]} xs */
function listAnd(xs) { return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }

/** Count a .sc-num up from 0. @param {HTMLElement} el */
function countUp(el) {
  const to = Number(el.dataset.to); const dec = Number(el.dataset.dec || 0); const cur = el.dataset.money;
  const show = (/** @type {number} */ v) => { el.textContent = cur ? fmt.money(v, cur, { compact: true }) : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
  return tween((t) => show(to * t), 1300);
}

/**
 * Open the story overlay.
 * @param {Stats} s
 * @param {{unit:'mi'|'km', onClose:()=>void, onDownload:()=>void, startId?: string}} o
 */
export function openStory(s, o) {
  const cards = buildCards(s, { unit: o.unit });
  const root = document.createElement('div');
  root.className = 'story';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Your rides story');
  root.innerHTML = `<div class="story-frame">
    <div class="story-bars">${cards.map(() => '<span><i></i></span>').join('')}</div>
    <button type="button" class="story-x" data-story-close aria-label="Close story">✕</button>
    <div class="story-stage">${cards.map((c, i) => `<section class="story-card" data-i="${i}" aria-hidden="true">${c.html}</section>`).join('')}</div>
    <button type="button" class="story-prev" aria-label="Previous">‹</button>
    <button type="button" class="story-next" aria-label="Next">›</button>
    <div class="story-hint" aria-hidden="true">Tap to continue</div>
  </div>`;
  document.body.append(root);
  document.body.classList.add('story-open');
  const prevFocus = document.activeElement;

  const els = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.story-card')]);
  const bars = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.story-bars i')]);
  const auto = !reducedMotion();
  let i = -1; /** @type {(()=>void)|void} */ let stop; /** @type {(()=>void)[]} */ let counts = [];
  let timer = 0; let started = 0; let remaining = DURATION; let paused = false;

  const schedule = () => {
    clearTimeout(timer);
    if (!auto || i >= cards.length - 1) return;
    started = performance.now();
    timer = window.setTimeout(() => go(i + 1), remaining);
  };
  const go = (/** @type {number} */ n) => {
    if (n < 0) n = 0;
    if (n >= cards.length) { close(); return; }
    stop?.(); counts.forEach((f) => f()); counts = [];
    els.forEach((el, k) => {
      el.classList.toggle('active', k === n); el.classList.toggle('past', k < n);
      el.setAttribute('aria-hidden', String(k !== n));
    });
    bars.forEach((b, k) => {
      b.style.animation = 'none'; b.offsetWidth; // restart
      b.style.transform = k < n ? 'scaleX(1)' : 'scaleX(0)';
      if (k === n) {
        if (auto && n < cards.length - 1) { b.style.animation = `bar ${DURATION}ms linear forwards`; b.style.animationPlayState = 'running'; } else b.style.transform = 'scaleX(1)';
      }
    });
    i = n; remaining = DURATION;
    const el = els[n];
    stop = cards[n].enter?.(el);
    counts = [...el.querySelectorAll('.sc-num')].map((x) => countUp(/** @type {HTMLElement} */ (x)));
    root.classList.toggle('last', n === cards.length - 1);
    schedule();
  };
  const pause = () => {
    if (paused || !auto) return; paused = true;
    clearTimeout(timer); remaining -= performance.now() - started;
    const b = bars[i]; if (b) b.style.animationPlayState = 'paused';
  };
  const resume = () => {
    if (!paused) return; paused = false;
    const b = bars[i]; if (b) b.style.animationPlayState = 'running';
    schedule();
  };
  const close = () => {
    clearTimeout(timer); stop?.(); counts.forEach((f) => f());
    document.removeEventListener('keydown', onKey);
    root.classList.add('closing');
    setTimeout(() => { root.remove(); document.body.classList.remove('story-open'); /** @type {HTMLElement|null} */ (prevFocus instanceof HTMLElement ? prevFocus : null)?.focus?.(); o.onClose(); }, reducedMotion() ? 0 : 260);
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') go(i - 1);
  };
  document.addEventListener('keydown', onKey);

  // Tap zones, swipe, hold-to-pause.
  const frame = /** @type {HTMLElement} */ (root.querySelector('.story-frame'));
  let downX = 0; let downY = 0; let downT = 0;
  frame.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('button, a')) return;
    downX = e.clientX; downY = e.clientY; downT = performance.now(); pause();
  });
  frame.addEventListener('pointerup', (e) => {
    if (e.target instanceof Element && e.target.closest('button, a')) return;
    const dx = e.clientX - downX; const dy = e.clientY - downY; const held = performance.now() - downT;
    if (Math.abs(dy) > 90 && dy > 0 && Math.abs(dx) < 60) { close(); return; }
    if (Math.abs(dx) > 50) { go(i + (dx < 0 ? 1 : -1)); return; }
    if (held > 450) { resume(); return; }
    const r = frame.getBoundingClientRect();
    go(e.clientX - r.left < r.width * 0.3 ? i - 1 : i + 1);
  });
  frame.addEventListener('pointercancel', resume);
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    if (t.closest('[data-story-close]')) close();
    else if (t.closest('[data-story-download]')) o.onDownload();
    else if (t.closest('.story-prev')) go(i - 1);
    else if (t.closest('.story-next')) go(i + 1);
  });

  go(Math.max(0, cards.findIndex((c) => c.id === o.startId)));
  /** @type {HTMLElement} */ (root.querySelector('.story-x')).focus({ preventScroll: true });
  return { go: (/** @type {number} */ n) => go(n), close, count: cards.length };
}
