// Per-device preferences. localStorage can be missing or throw (private
// mode, blocked storage), so every access is guarded and optional.
const KEY = 'rides.v1';

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
