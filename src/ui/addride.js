// "Add a ride" sheet: tap the pickup on the street map, tap the dropoff, pick
// a time (and optionally a fare). Also used for the usual commute, and to
// edit a ride. Places are named from the OpenFreeMap tile under the tap, on
// this device. No geocoder and no search box, so no new hosts.
import { AIRPORTS, METROS, isCoord, haversineKm } from '../core/geo.js';
import { makeManualTrip, commuteTrips } from '../core/manual.js';
import { loadMapLibre, pickStyle, TIMEOUT_MS, ATTRIBUTION } from './basemap.js';
import { nameAt } from './placenames.js';
import { reducedMotion } from './motion.js';
import { esc } from './esc.js';

/** @typedef {import('../core/types.js').Trip} Trip */
/** @typedef {{lat:number, lng:number, name?:string}} Stop */

/**
 * @typedef {Object} SheetOpts
 * @property {'ride'|'commute'} [mode]
 * @property {Trip} [edit]                  ride to edit (mode 'ride')
 * @property {{home?: Stop, work?: Stop}} [known]  quick picks from earlier rides
 * @property {{lat:number, lng:number}} [near]    where to centre the map
 * @property {(trips: Trip[], o: {replaces?: string}) => void} onSave
 * @property {() => void} [onClose]
 */

/** A starting view: near earlier rides, else the metro for this device's time zone. */
function startView(/** @type {SheetOpts} */ o) {
  if (o.edit) return { lat: o.edit.fromLat ?? 0, lng: o.edit.fromLng ?? 0, zoom: 13 };
  if (o.near) return { lat: o.near.lat, lng: o.near.lng, zoom: 12.5 };
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
  const m = METROS.find((r) => r[4] === tz);
  return m ? { lat: m[1], lng: m[2], zoom: 11 } : { lat: 30, lng: 0, zoom: 1.5 };
}

/** @param {number} ms local datetime-local value */
function localInput(ms) {
  const d = new Date(ms); const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A sensible fare currency for this device. */
function guessCurrency() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
  if (tz === 'Europe/London') return 'GBP';
  if (tz.startsWith('Europe/')) return 'EUR';
  if (tz.startsWith('Asia/Tokyo')) return 'JPY';
  if (tz.startsWith('Asia/Singapore')) return 'SGD';
  if (tz.startsWith('Australia/')) return 'AUD';
  if (tz === 'America/Toronto' || tz === 'America/Vancouver') return 'CAD';
  return 'USD';
}

/**
 * Open the sheet. Returns a function that closes it.
 * @param {SheetOpts} o
 */
export function openAddRide(o) {
  const mode = o.mode || 'ride';
  const commute = mode === 'commute';
  const labels = commute ? ['Where’s home?', 'Where’s work?', 'When do you usually go?'] : ['Where did it start?', 'Where did it end?', 'When was it?'];
  /** @type {(Stop|null)[]} */
  const stops = o.edit
    ? [{ lat: /** @type {number} */ (o.edit.fromLat), lng: /** @type {number} */ (o.edit.fromLng), name: o.edit.fromAddress }, { lat: /** @type {number} */ (o.edit.toLat), lng: /** @type {number} */ (o.edit.toLng), name: o.edit.toAddress }]
    : [null, null];
  let step = o.edit ? 2 : 0;
  const view = startView(o);
  const prevFocus = /** @type {HTMLElement|null} */ (document.activeElement);

  const root = document.createElement('div');
  root.className = 'sheet';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'sheet-title');
  const airports = [...AIRPORTS].map(([code, name, lat, lng]) => ({ code, name, lat, lng, d: haversineKm(view.lat, view.lng, lat, lng) }))
    .sort((a, b) => a.d - b.d).slice(0, 3).filter((a) => a.d < 150);
  root.innerHTML = `
    <div class="sheet-frame">
      <header class="sheet-head">
        <div><div class="eyebrow">${commute ? 'Your usual commute' : o.edit ? 'Edit ride' : 'Add a ride'} · <span class="sheet-step">Step 1 of 3</span></div>
        <h2 id="sheet-title">${esc(labels[step])}</h2></div>
        <button type="button" class="btn btn-ghost btn-small" data-sheet-close aria-label="Close">✕</button>
      </header>
      <div class="sheet-map" data-step-map>
        <div class="sheet-gl" aria-hidden="true"></div>
        <div class="sheet-cross" aria-hidden="true"></div>
        <div class="sheet-pins" aria-hidden="true"><span class="pin pin-a" hidden>A</span><span class="pin pin-b" hidden>B</span></div>
        <div class="attrib sheet-attrib" hidden>${ATTRIBUTION}</div>
        <p class="sheet-mapnote" role="status">Loading the street map…</p>
      </div>
      <div class="sheet-body">
        <div class="sheet-stops">
          <button type="button" class="stop" data-goto="0"><b>${commute ? 'Home' : 'Pickup'}</b><span data-stop="0">Tap the map</span></button>
          <button type="button" class="stop" data-goto="1"><b>${commute ? 'Work' : 'Dropoff'}</b><span data-stop="1">—</span></button>
        </div>
        <div class="sheet-pick" data-step-pick>
          <button type="button" class="btn btn-primary btn-small" data-use-centre>Use the map centre</button>
          ${o.known?.home ? '<button type="button" class="chip" data-quick="home">Home</button>' : ''}
          ${o.known?.work ? '<button type="button" class="chip" data-quick="work">Work</button>' : ''}
          ${airports.map((a) => `<button type="button" class="chip" data-quick="ap:${esc(a.code)}">✈ ${esc(a.code)}</button>`).join('')}
          <details class="sheet-adv">
            <summary>Advanced: enter coordinates</summary>
            <div class="sheet-ll">
              <label>Latitude <input type="number" step="any" min="-85" max="85" data-lat inputmode="decimal"></label>
              <label>Longitude <input type="number" step="any" min="-180" max="180" data-lng inputmode="decimal"></label>
              <button type="button" class="btn btn-small" data-set-ll>Set</button>
            </div>
            <p class="foot">Arrow keys move the map when it has focus; + and − zoom.</p>
          </details>
        </div>
        <form class="sheet-when" data-step-when hidden>
          ${commute ? `
            <div class="sheet-row">
              <label>Leave home <input type="time" data-out value="08:30" required></label>
              <label>Leave work <input type="time" data-back value="17:45" required></label>
            </div>
            <fieldset class="sheet-days"><legend>Days</legend>
              ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<label><input type="checkbox" data-day="${i}" ${i < 5 ? 'checked' : ''}> ${d}</label>`).join('')}
            </fieldset>
            <label>For the past <select data-weeks><option value="2">2 weeks</option><option value="4" selected>4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option></select></label>
            <p class="foot">These rides are estimated from one entry, and marked as estimated. You can remove them together later.</p>`
    : `
            <div class="sheet-row">
              <label>When <input type="datetime-local" data-when required value="${localInput(o.edit?.start ?? Date.now())}"></label>
              <label>Fare (optional) <span class="fare"><input type="number" step="0.01" min="0" inputmode="decimal" data-fare value="${o.edit?.fare ?? ''}" placeholder="0.00"><select data-cur>${['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'MXN'].map((c) => `<option ${c === (o.edit?.currency || guessCurrency()) ? 'selected' : ''}>${c}</option>`).join('')}</select></span></label>
            </div>
            <p class="foot">Distance and time are estimated from the map. Saved on this device only.</p>`}
          <div class="sheet-actions">
            <button type="button" class="btn btn-small btn-ghost" data-back>Back</button>
            <button type="submit" class="btn btn-primary" data-save>${commute ? 'Add my commute' : o.edit ? 'Save changes' : 'Add ride'}</button>
          </div>
          <p class="sheet-err" role="alert"></p>
        </form>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('sheet-open');

  const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  const mapEl = $('.sheet-gl');
  const note = $('.sheet-mapnote');
  /** @type {any} */ let map = null;
  let closed = false;

  const render = () => {
    $('#sheet-title').textContent = labels[step];
    $('.sheet-step').textContent = `Step ${step + 1} of 3`;
    $('[data-step-pick]').hidden = step === 2;
    $('[data-step-when]').hidden = step !== 2;
    stops.forEach((s, i) => {
      $(`[data-stop="${i}"]`).textContent = s ? (s.name || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`) : (i === step ? 'Tap the map' : '—');
      root.querySelector(`[data-goto="${i}"]`)?.classList.toggle('active', i === step);
    });
    placePins();
    if (step === 2) ($('[data-when]') || $('[data-out]'))?.focus();
  };

  const placePins = () => {
    ['a', 'b'].forEach((k, i) => {
      const pin = $(`.pin-${k}`); const s = stops[i];
      if (!s || !map) { pin.hidden = true; return; }
      const pt = map.project([s.lng, s.lat]);
      pin.hidden = false; pin.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
    });
  };

  /** @param {Stop} s */
  const setStop = (s) => {
    if (!isCoord(s.lat) || !isCoord(s.lng) || step > 1) return;
    const i = step;
    stops[i] = { ...s };
    if (!s.name) {
      stops[i].name = '';
      nameAt(s.lat, s.lng).then((n) => { if (n && stops[i] && stops[i]?.lat === s.lat && stops[i]?.lng === s.lng) { /** @type {Stop} */ (stops[i]).name = n; render(); } });
    }
    step = stops[0] && stops[1] ? 2 : stops[0] ? 1 : 0;
    render();
  };

  // Map ----------------------------------------------------------------------
  const startMap = async () => {
    try {
      const [lib, style] = await Promise.all([loadMapLibre(TIMEOUT_MS), pickStyle(fetch.bind(globalThis))]);
      if (closed) return;
      if (!style.style) throw new Error(style.reason);
      mapEl.parentElement?.classList.toggle('basemap-invert', style.style.invert);
      map = new lib.Map({
        container: mapEl, style: style.style.url, center: [view.lng, view.lat], zoom: view.zoom,
        attributionControl: false, minZoom: 1, fadeDuration: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
      map.on('error', () => {});
      map.on('click', (/** @type {any} */ e) => setStop({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.on('move', placePins);
      map.once('load', () => { note.hidden = true; $('.sheet-attrib').hidden = false; placePins(); });
      mapEl.setAttribute('aria-hidden', 'false');
      mapEl.tabIndex = 0;
      mapEl.setAttribute('role', 'application');
      mapEl.setAttribute('aria-label', 'Street map. Arrow keys pan, plus and minus zoom. Use the map centre button to set the point.');
      note.textContent = 'Tap where the ride started.';
    } catch (e) {
      if (closed) return;
      root.classList.add('no-map');
      note.textContent = `Street map unavailable (${String(/** @type {any} */ (e)?.message || e)}). Pick a quick place or enter coordinates under Advanced.`;
      /** @type {HTMLDetailsElement} */ (root.querySelector('.sheet-adv')).open = true;
    }
  };
  startMap();

  // Events -------------------------------------------------------------------
  const close = () => {
    if (closed) return; closed = true;
    try { map?.remove(); } catch { /* ignore */ }
    root.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
    o.onClose?.();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);

  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    if (t.closest('[data-sheet-close]')) { close(); return; }
    const go = t.closest('[data-goto]')?.getAttribute('data-goto');
    if (go != null) { step = Number(go); if (!commute || step < 2) { stops[step] = null; } render(); return; }
    if (t.closest('[data-use-centre]') && map) { const c = map.getCenter(); setStop({ lat: c.lat, lng: c.lng }); return; }
    if (t.closest('[data-set-ll]')) {
      const lat = Number(/** @type {HTMLInputElement} */ ($('[data-lat]')).value); const lng = Number(/** @type {HTMLInputElement} */ ($('[data-lng]')).value);
      if (!isCoord(lat) || !isCoord(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) { note.hidden = false; note.textContent = 'Enter a latitude between −85 and 85 and a longitude between −180 and 180.'; return; }
      map?.jumpTo({ center: [lng, lat], zoom: Math.max(13, map.getZoom()) });
      setStop({ lat, lng });
      return;
    }
    const q = t.closest('[data-quick]')?.getAttribute('data-quick');
    if (q) {
      if (q === 'home' && o.known?.home) setStop({ ...o.known.home, name: 'Home' });
      else if (q === 'work' && o.known?.work) setStop({ ...o.known.work, name: 'Work' });
      else if (q.startsWith('ap:')) { const a = AIRPORTS.find((r) => r[0] === q.slice(3)); if (a) setStop({ lat: a[2], lng: a[3], name: a[0] }); }
      const s = stops[step === 2 ? 1 : Math.max(0, step - 1)];
      if (s && map) map[reducedMotion() ? 'jumpTo' : 'flyTo']({ center: [s.lng, s.lat], zoom: Math.max(12, map.getZoom()) });
      return;
    }
    if (t.closest('[data-back]')) { step = 1; stops[1] = null; render(); }
  });

  /** @type {HTMLFormElement} */ ($('[data-step-when]')).addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('.sheet-err');
    const [a, b] = stops;
    if (!a || !b) { err.textContent = 'Set both points first.'; return; }
    try {
      if (commute) {
        const [oh, om] = /** @type {HTMLInputElement} */ ($('[data-out]')).value.split(':').map(Number);
        const [bh, bm] = /** @type {HTMLInputElement} */ ($('[data-back]')).value.split(':').map(Number);
        const weekdays = [...root.querySelectorAll('[data-day]')].filter((c) => /** @type {HTMLInputElement} */ (c).checked).map((c) => Number(c.getAttribute('data-day')));
        if (!weekdays.length) { err.textContent = 'Pick at least one day.'; return; }
        const trips = commuteTrips({
          home: { ...a, name: a.name || 'Home' }, work: { ...b, name: b.name || 'Work' }, now: Date.now(),
          weeks: Number(/** @type {HTMLSelectElement} */ ($('[data-weeks]')).value), weekdays, out: [oh, om], back: [bh, bm],
        });
        if (!trips.length) { err.textContent = 'No past rides fit those days and times yet.'; return; }
        o.onSave(trips, {});
      } else {
        const when = new Date(/** @type {HTMLInputElement} */ ($('[data-when]')).value).getTime();
        if (!Number.isFinite(when)) { err.textContent = 'Pick a date and time.'; return; }
        if (when > Date.now() + 5 * 60000) { err.textContent = 'That time is in the future. Rides here are ones you’ve taken.'; return; }
        const fareV = /** @type {HTMLInputElement} */ ($('[data-fare]')).value;
        const trip = makeManualTrip({
          from: a, to: b, start: when, fare: fareV === '' ? null : Number(fareV),
          currency: /** @type {HTMLSelectElement} */ ($('[data-cur]')).value, id: o.edit?.id,
        });
        o.onSave([trip], { replaces: o.edit?.id });
      }
      close();
    } catch (x) { err.textContent = String(/** @type {any} */ (x)?.message || x); }
  });

  render();
  setTimeout(() => /** @type {HTMLElement|null} */ (root.querySelector(step === 2 ? '[data-save]' : '[data-use-centre]'))?.focus(), 0);
  return close;
}
