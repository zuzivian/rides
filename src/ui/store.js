// Per-device preferences. localStorage can be missing or throw (private
// mode, blocked storage), so every access is guarded and optional.
const KEY = 'rides.v1';

const GUESS_KEY = 'rides.guesses.v1';

/** @returns {{names: Record<string,string>, unit?: 'mi'|'km'}} */
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return { names: v && typeof v.names === 'object' ? v.names : {}, unit: v?.unit === 'km' || v?.unit === 'mi' ? v.unit : undefined };
  } catch {
    return { names: {} };
  }
}

/** @param {{names: Record<string,string>, unit?: 'mi'|'km'}} v */
export function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable: keep in memory only */ }
}

/**
 * Names guessed from map labels, keyed by place id (the same ids nicknames
 * use). Each entry holds only the name and the tile zoom it was read at, so a
 * closer look can improve it. No coordinates or ride data.
 * @returns {Record<string, {name: string, z: number}>}
 */
export function loadGuesses() {
  try {
    const v = JSON.parse(localStorage.getItem(GUESS_KEY) || '{}');
    /** @type {Record<string, {name: string, z: number}>} */
    const out = {};
    for (const [id, g] of Object.entries(v || {})) if (g && typeof g.name === 'string' && typeof g.z === 'number') out[id] = { name: g.name.slice(0, 48), z: g.z };
    return out;
  } catch {
    return {};
  }
}

/** @param {Record<string, {name: string, z: number}>} g */
export function saveGuesses(g) {
  try { localStorage.setItem(GUESS_KEY, JSON.stringify(g)); } catch { /* keep in memory only */ }
}

export function clearGuesses() {
  try { localStorage.removeItem(GUESS_KEY); } catch { /* ignore */ }
}
