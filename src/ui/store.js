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
 * Place names read from OpenFreeMap tiles, keyed by place id (the same ids
 * nicknames use). Each entry holds only the name, what kind of name it is
 * (poi, address, street, area) and the tile zoom it came from. No
 * coordinates or ride data.
 * @returns {Record<string, {name: string, z: number, kind?: string}>}
 */
export function loadGuesses() {
  try {
    const v = JSON.parse(localStorage.getItem(GUESS_KEY) || '{}');
    /** @type {Record<string, {name: string, z: number, kind?: string}>} */
    const out = {};
    for (const [id, g] of Object.entries(v || {})) if (g && typeof g.name === 'string' && typeof g.z === 'number') out[id] = { name: g.name.slice(0, 48), z: g.z, kind: typeof g.kind === 'string' ? g.kind.slice(0, 10) : '' };
    return out;
  } catch {
    return {};
  }
}

/** @param {Record<string, {name: string, z: number, kind?: string}>} g */
export function saveGuesses(g) {
  try { localStorage.setItem(GUESS_KEY, JSON.stringify(g)); } catch { /* keep in memory only */ }
}

export function clearGuesses() {
  try { localStorage.removeItem(GUESS_KEY); } catch { /* ignore */ }
}
