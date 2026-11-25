// Count-ups, scroll reveals and the tooltip. All respect reduced motion.
import * as fmt from '../core/format.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @param {HTMLElement} el */
function countUp(el) {
  const target = Number(el.dataset.count);
  const money = el.dataset.money;
  const dec = Number(el.dataset.dec || 0);
  const show = (/** @type {number} */ v) => {
    el.textContent = money ? fmt.money(v, money, { compact: true }) : v.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
  };
  if (reducedMotion() || !Number.isFinite(target)) { show(target); return; }
  const t0 = performance.now(); const dur = 1300;
  const step = (/** @type {number} */ t) => {
    const k = Math.min(1, (t - t0) / dur);
    show(target * (1 - Math.pow(1 - k, 4)));
    if (k < 1) requestAnimationFrame(step);
  };
  show(0);
  requestAnimationFrame(step);
}

/** Reveal sections as they scroll in; start count-ups and bar growth then. @param {ParentNode} root @param {{animate: boolean}} o */
export function animateIn(root, o) {
  const els = [...root.querySelectorAll('.reveal')];
  const fire = (/** @type {Element} */ el) => {
    el.classList.add('in');
    el.classList.remove('pre');
    el.querySelectorAll('[data-count]').forEach((c) => { if (o.animate) countUp(/** @type {HTMLElement} */ (c)); });
  };
  if (!o.animate || reducedMotion() || !('IntersectionObserver' in window)) {
    els.forEach((el) => { el.classList.add('in'); el.classList.remove('pre'); });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { fire(e.target); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((el) => io.observe(el));
}

let tip = /** @type {HTMLDivElement|null} */ (null);
/** One shared tooltip for every [data-tip]. Text only; first line bold. */
export function installTooltip() {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  const show = (/** @type {Element} */ el, /** @type {number} */ x, /** @type {number} */ y) => {
    const t = /** @type {HTMLDivElement} */ (tip);
    const [head, ...rest] = (el.getAttribute('data-tip') || '').split('\n');
    t.replaceChildren();
    const b = document.createElement('b'); b.textContent = head; t.append(b);
    for (const line of rest) { t.append(document.createElement('br'), document.createTextNode(line)); }
    const w = t.offsetWidth; const h = t.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    const top = y - h - 14 < 8 ? y + 18 : y - h - 14;
    t.style.left = `${left}px`; t.style.top = `${top}px`;
    t.classList.add('show');
  };
  const hide = () => tip?.classList.remove('show');
  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el && e.pointerType !== 'mouse') show(el, e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('scroll', hide, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', hide);
}
