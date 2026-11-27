// App controller: load files, compute stats, render, handle interactions.
import { parseTripsCsv, mergeTrips, ParseError } from '../core/parse.js';
import { computeStats } from '../core/stats.js';
import { parseReceipts, looksLikeEmail } from '../core/email.js';
import * as views from './views.js';
import * as store from './store.js';
import { animateIn, installTooltip } from './motion.js';
import { RideMap, mapSection } from './map.js';
import { cardSection, mountCard, saveCard } from './card.js';
import { openStory } from './story.js';
import { nameFromTiles } from './placenames.js';
import { openAddRide } from './addride.js';
import { readManual } from '../core/manual.js';

/** @typedef {import('../core/types.js').Trip} Trip */

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const prefs = store.load();

const state = {
  /** @type {Trip[]} */ trips: [],
  /** Imported from files (or the sample). @type {Trip[]} */ imported: [],
  /** Added by hand, saved on this device. @type {Trip[]} */ manual: readManual(store.loadManualRaw()),
  /** The rides just added, for the payoff card. @type {Trip[]|null} */ lastAdded: null,
  sample: false,
  source: '',
  /** @type {string[]} */ warnings: [],
  /** @type {'mi'|'km'} */ unit: prefs.unit || 'mi',
  names: prefs.names,
  /** Place names from OpenFreeMap tiles: per device, names only. */
  guesses: store.loadGuesses(),
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
  app.innerHTML = views.landing({ error, manualCount: state.manual.length });
  window.scrollTo(0, 0);
  animateIn(app, { animate: true });
}

const guessNames = () => Object.fromEntries(Object.entries(state.guesses).map(([id, g]) => [id, { name: g.name, kind: g.kind }]));

/**
 * @param {{animate: boolean, keepScroll?: boolean, keepMap?: boolean}} o
 * keepMap: only names changed, so move the live map (and its basemap) into
 * the new page instead of rebuilding it.
 */
function showDashboard(o) {
  const y = window.scrollY;
  state.stats = computeStats(state.trips, { names: state.names, guesses: guessNames(), unit: state.unit });
  if (!state.stats) { showLanding('No rides to show.'); return; }
  const keep = o.keepMap && map ? /** @type {HTMLElement|null} */ (app.querySelector('.map-card')) : null;
  if (keep) keep.remove(); else { map?.destroy(); map = null; }
  const manual = state.sample ? undefined : { all: state.manual, last: state.lastAdded, hasImport: state.imported.length > 0 };
  app.innerHTML = views.dashboard(state.stats, { source: state.source, unit: state.unit, allPlaces: state.allPlaces, warnings: state.warnings, manual });
  const slot = app.querySelector('#map-slot');
  if (slot && keep && map) { slot.replaceWith(keep); map.updateNames(state.stats); }
  else if (slot && state.stats.places.length) {
    slot.outerHTML = mapSection(state.stats, views.mapOverlay(state.stats, { source: state.source, unit: state.unit }));
    map = new RideMap(/** @type {HTMLElement} */ (app.querySelector('.map-card')), state.stats);
  } else slot?.remove();
  const before = app.querySelector('.note-honest');
  if (before) {
    before.insertAdjacentHTML('beforebegin', cardSection(state.stats));
    mountCard(/** @type {HTMLElement} */ (app.querySelector('.share-card')), state.trips, { names: state.names, guesses: guessNames(), unit: state.unit });
  }
  app.setAttribute('data-ready', '');
  if (o.keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  animateIn(app, { animate: o.animate && !keep });
  if (!keep) nameFromTiles(state.stats.places, state.guesses, { onNames: onGuesses });
  document.dispatchEvent(new CustomEvent('rides:render', { detail: state }));
}

// New names from map tiles: save them, then refresh names on the page.
// Batched, and held while the user is typing a nickname.
let guessTimer = 0;
function onGuesses() {
  store.saveGuesses(state.guesses);
  clearTimeout(guessTimer);
  guessTimer = /** @type {any} */ (setTimeout(function apply() {
    if (!state.stats) return;
    if (document.activeElement instanceof HTMLInputElement && app.contains(document.activeElement)) { guessTimer = /** @type {any} */ (setTimeout(apply, 1500)); return; }
    showDashboard({ animate: false, keepScroll: true, keepMap: true });
  }, 800));
}

/** @param {{name: string, text: string}[]} files @param {{sample?: boolean}} [opts] */
function loadTexts(files, opts = {}) {
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
  state.imported = mergeTrips(lists);
  state.sample = !!opts.sample; state.lastAdded = null;
  combine();
  if (emailRead) {
    warnings.push(`Read ${emailRead} receipt ${emailRead === 1 ? 'email' : 'emails'}${emailSkipped ? ` and skipped ${emailSkipped} that weren’t ride receipts` : ''}. Receipts have no coordinates, so those rides count in the stats but don’t appear on the map.`);
  }
  state.warnings = [...new Set(warnings), ...errors.map((e) => `Skipped ${e}`)];
  const label = sources.size === 1 ? SOURCE_LABEL[/** @type {keyof typeof SOURCE_LABEL} */ ([...sources][0])] : sources.has('email') ? 'Export + receipts' : 'Uber + Lyft';
  state.source = files.length === 1 ? `${label} · ${files[0].name}` : `${label} · ${files.length} files`;
  if (state.manual.length && !state.sample) state.source += ` + ${state.manual.length} added`;
  if (!prefs.unit) {
    const s = computeStats(state.trips, { unit: 'mi' });
    state.unit = s && !['USD', 'GBP', ''].includes(s.primaryCurrency) ? 'km' : 'mi';
  }
  state.allPlaces = false;
  showDashboard({ animate: true });
  if (!new URLSearchParams(location.search).has('nostory')) playStory();
}

/** @param {string} [startId] */
function playStory(startId) {
  const s = state.stats; if (!s) return;
  const year = s.years[s.years.length - 1];
  openStory(s, {
    unit: state.unit, startId,
    onClose: () => { /** @type {HTMLElement|null} */ (app.querySelector('.map-canvas'))?.focus({ preventScroll: true }); },
    onDownload: () => saveCard(s, { period: s.years.length > 1 ? 'all' : String(year.year), showNames: false, unit: state.unit }),
  });
}

/** @param {FileList|File[]} list */
async function loadFiles(list) {
  const files = [...list];
  if (!files.length) return;
  const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
  loadTexts(texts);
}

/** Imported rides plus the ones added by hand (the sample stays on its own). */
function combine() {
  state.trips = state.sample ? state.imported : mergeTrips([state.imported, state.manual]);
}

async function loadSample() {
  const res = await fetch(new URL('../../data/sample-trips.csv', import.meta.url));
  const text = await res.text();
  loadTexts([{ name: 'sample-trips.csv', text }], { sample: true });
  state.source = 'Sample data · a made-up rider in San Francisco';
  const eyebrow = app.querySelector('.ov-head .eyebrow');
  if (eyebrow) eyebrow.innerHTML = `<b>●</b> ${views.esc(state.source)}`;
}

// Rides added by hand ---------------------------------------------------------

/** Quick picks and a starting point for the add sheet. */
function sheetContext() {
  const places = state.sample ? [] : state.stats?.places || [];
  const pick = (/** @type {string} */ kind, /** @type {string} */ name) => {
    const p = places.find((x) => x.kind === kind);
    if (p) return { lat: p.lat, lng: p.lng };
    for (const t of state.manual) {
      if (t.fromAddress === name) return { lat: /** @type {number} */ (t.fromLat), lng: /** @type {number} */ (t.fromLng) };
      if (t.toAddress === name) return { lat: /** @type {number} */ (t.toLat), lng: /** @type {number} */ (t.toLng) };
    }
    return undefined;
  };
  const last = state.manual[state.manual.length - 1];
  const near = last ? { lat: /** @type {number} */ (last.fromLat), lng: /** @type {number} */ (last.fromLng) } : places[0] ? { lat: places[0].lat, lng: places[0].lng } : undefined;
  return { known: { home: pick('home', 'Home'), work: pick('work', 'Work') }, near };
}

/** @param {'ride'|'commute'} mode @param {Trip} [edit] */
function addRide(mode, edit) {
  openAddRide({
    mode, edit, ...sheetContext(),
    onSave: (trips, o) => {
      const keep = state.manual.filter((t) => t.id !== o.replaces && !trips.some((n) => n.id === t.id));
      state.manual = [...keep, ...trips].sort((a, b) => a.start - b.start);
      store.saveManual(state.manual);
      state.lastAdded = trips;
      if (state.sample) { state.sample = false; state.imported = []; }
      if (!state.imported.length) state.source = 'Rides you added on this device';
      combine();
      showDashboard({ animate: false });
      map?.focusTrips(trips);
      /** @type {HTMLElement|null} */ (app.querySelector('#h-added-card'))?.focus({ preventScroll: true });
    },
  });
}

/** @param {(t: Trip) => boolean} drop */
function removeManual(drop) {
  state.manual = state.manual.filter((t) => !drop(t));
  store.saveManual(state.manual);
  state.lastAdded = null;
  combine();
  if (!state.trips.length) { showLanding(); return; }
  showDashboard({ animate: false, keepScroll: true });
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
  if (action === 'add-ride') { addRide('ride'); return; }
  if (action === 'add-commute') { addRide('commute'); return; }
  const editId = t.closest('[data-edit-ride]')?.getAttribute('data-edit-ride');
  if (editId) { const tr = state.manual.find((x) => x.id === editId); if (tr) addRide('ride', tr); return; }
  const delId = t.closest('[data-delete-ride]')?.getAttribute('data-delete-ride');
  if (delId) { removeManual((x) => x.id === delId); return; }
  const delSeries = t.closest('[data-delete-series]')?.getAttribute('data-delete-series');
  if (delSeries) { removeManual((x) => x.series === delSeries); return; }
  if (action === 'story') { playStory(t.closest('[data-story-start]')?.getAttribute('data-story-start') || undefined); return; }
  const cityBtn = t.closest('[data-city]');
  if (cityBtn && !t.closest('.map-card') && map) {
    map.fitCity(/** @type {string} */ (cityBtn.getAttribute('data-city')));
    app.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'home') { showLanding(); return; }
  if (action === 'my-rides') { state.imported = []; state.sample = false; state.lastAdded = null; state.source = 'Rides you added on this device'; combine(); showDashboard({ animate: true }); return; }
  if (action === 'all-places') { state.allPlaces = !state.allPlaces; showDashboard({ animate: false, keepScroll: true }); return; }
  if (action === 'reset-names') { state.names = {}; state.guesses = {}; store.save({ names: {}, unit: prefs.unit }); store.clearGuesses(); showDashboard({ animate: false, keepScroll: true }); return; }
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
if (new URLSearchParams(location.search).has('sample')) loadSample();
else if (state.manual.length) { state.source = 'Rides you added on this device'; combine(); showDashboard({ animate: true }); }
else showLanding();
