// App controller: load files, compute stats, render, handle interactions.
import { parseTripsCsv, mergeTrips, ParseError } from '../core/parse.js';
import { computeStats } from '../core/stats.js';
import { parseReceipts, looksLikeEmail } from '../core/email.js';
import * as views from './views.js';
import * as store from './store.js';
import { animateIn, installTooltip } from './motion.js';
import { RideMap, mapSection } from './map.js';
import { cardSection, mountCard } from './card.js';

/** @typedef {import('../core/types.js').Trip} Trip */

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const prefs = store.load();

const state = {
  /** @type {Trip[]} */ trips: [],
  source: '',
  /** @type {string[]} */ warnings: [],
  /** @type {'mi'|'km'} */ unit: prefs.unit || 'mi',
  names: prefs.names,
  allPlaces: false,
  /** @type {ReturnType<typeof computeStats>} */ stats: null,
};

/** @type {RideMap|null} */
let map = null;

const SOURCE_LABEL = { uber: 'Uber export', lyft: 'Lyft export', generic: 'Ride history', email: 'Receipt emails' };

function showLanding(error = '') {
  state.stats = null;
  map?.destroy(); map = null;
  app.removeAttribute('data-ready');
  app.innerHTML = views.landing({ error });
  window.scrollTo(0, 0);
  animateIn(app, { animate: true });
}

/** @param {{animate: boolean, keepScroll?: boolean}} o */
function showDashboard(o) {
  const y = window.scrollY;
  state.stats = computeStats(state.trips, { names: state.names, unit: state.unit });
  if (!state.stats) { showLanding('No rides to show.'); return; }
  map?.destroy(); map = null;
  app.innerHTML = views.dashboard(state.stats, { source: state.source, unit: state.unit, allPlaces: state.allPlaces, warnings: state.warnings });
  const slot = app.querySelector('#map-slot');
  if (slot && state.stats.places.length) {
    slot.outerHTML = mapSection(state.stats);
    map = new RideMap(/** @type {HTMLElement} */ (app.querySelector('.map-card')), state.stats);
  } else slot?.remove();
  const before = app.querySelector('.note-honest');
  if (before) {
    before.insertAdjacentHTML('beforebegin', cardSection(state.stats));
    mountCard(/** @type {HTMLElement} */ (app.querySelector('.share-card')), state.trips, { names: state.names, unit: state.unit });
  }
  app.setAttribute('data-ready', '');
  if (o.keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  animateIn(app, { animate: o.animate });
  document.dispatchEvent(new CustomEvent('rides:render', { detail: state }));
}

/** @param {{name: string, text: string}[]} files */
function loadTexts(files) {
  /** @type {Trip[][]} */
  const lists = [];
  /** @type {string[]} */
  const warnings = [];
  const sources = new Set();
  const errors = [];
  let emailRead = 0; let emailSkipped = 0;
  for (const f of files) {
    try {
      if (/\.(eml|mbox|mbx)$/i.test(f.name) || looksLikeEmail(f.text)) {
        const r = parseReceipts(f.text, { idPrefix: f.name });
        if (!r.trips.length) throw new ParseError(`No Uber or Lyft ride receipts found${r.skipped ? ` (${r.skipped} other ${r.skipped === 1 ? 'email' : 'emails'} skipped)` : ''}.`);
        lists.push(r.trips); sources.add('email');
        emailRead += r.read; emailSkipped += r.skipped;
        continue;
      }
      const r = parseTripsCsv(f.text, { idPrefix: f.name });
      lists.push(r.trips); sources.add(r.source); warnings.push(...r.warnings);
    } catch (e) {
      errors.push(e instanceof ParseError ? `${f.name}: ${e.message}` : `${f.name}: ${String(/** @type {Error} */ (e).message || e)}`);
    }
  }
  if (!lists.length) { showLanding(errors.join(' ')); return; }
  state.trips = mergeTrips(lists);
  if (emailRead) {
    warnings.push(`Read ${emailRead} receipt ${emailRead === 1 ? 'email' : 'emails'}${emailSkipped ? ` and skipped ${emailSkipped} that weren’t ride receipts` : ''}. Receipts have no coordinates, so those rides count in the stats but don’t appear on the map.`);
  }
  state.warnings = [...new Set(warnings), ...errors.map((e) => `Skipped ${e}`)];
  const label = sources.size === 1 ? SOURCE_LABEL[/** @type {keyof typeof SOURCE_LABEL} */ ([...sources][0])] : sources.has('email') ? 'Export + receipts' : 'Uber + Lyft';
  state.source = files.length === 1 ? `${label} · ${files[0].name}` : `${label} · ${files.length} files`;
  if (!prefs.unit) {
    const s = computeStats(state.trips, { unit: 'mi' });
    state.unit = s && !['USD', 'GBP', ''].includes(s.primaryCurrency) ? 'km' : 'mi';
  }
  state.allPlaces = false;
  showDashboard({ animate: true });
}

/** @param {FileList|File[]} list */
async function loadFiles(list) {
  const files = [...list];
  if (!files.length) return;
  const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
  loadTexts(texts);
}

async function loadSample() {
  const res = await fetch(new URL('../../data/sample-trips.csv', import.meta.url));
  const text = await res.text();
  loadTexts([{ name: 'sample-trips.csv', text }]);
  state.source = 'Sample data · a made-up rider in San Francisco';
  const eyebrow = app.querySelector('.headline .eyebrow');
  if (eyebrow) eyebrow.innerHTML = `<b>●</b> ${views.esc(state.source)}`;
}

/** @param {HTMLButtonElement} btn */
function startRename(btn) {
  const id = /** @type {string} */ (btn.dataset.rename);
  const place = state.stats?.places.find((p) => p.id === id);
  if (!place) return;
  const input = document.createElement('input');
  input.value = place.name; input.maxLength = 32;
  input.setAttribute('aria-label', `New name for ${place.name}`);
  btn.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = (/** @type {boolean} */ keep) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (keep && v && v !== place.autoName) state.names[id] = v;
    else if (keep) delete state.names[id];
    store.save({ names: state.names, unit: prefs.unit });
    showDashboard({ animate: false, keepScroll: true });
    /** @type {HTMLElement|null} */ (app.querySelector(`[data-rename="${CSS.escape(id)}"]`))?.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
}

// Events ---------------------------------------------------------------------
app.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const action = t.closest('[data-action]')?.getAttribute('data-action');
  if (action === 'sample') { loadSample(); return; }
  if (action === 'home') { showLanding(); return; }
  if (action === 'all-places') { state.allPlaces = !state.allPlaces; showDashboard({ animate: false, keepScroll: true }); return; }
  if (action === 'reset-names') { state.names = {}; store.save({ names: {}, unit: prefs.unit }); showDashboard({ animate: false, keepScroll: true }); return; }
  const unitBtn = t.closest('[data-unit]');
  if (unitBtn) {
    const u = /** @type {'mi'|'km'} */ (unitBtn.getAttribute('data-unit'));
    if (u !== state.unit) { state.unit = u; prefs.unit = u; store.save({ names: state.names, unit: u }); showDashboard({ animate: false, keepScroll: true }); }
    return;
  }
  const rn = t.closest('[data-rename]');
  if (rn) startRename(/** @type {HTMLButtonElement} */ (rn));
});

app.addEventListener('change', (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.type === 'file' && input.files) loadFiles(input.files);
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files);
});

installTooltip();
if (new URLSearchParams(location.search).has('sample')) loadSample(); else showLanding();
