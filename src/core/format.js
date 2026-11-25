// Formatting shared by stats lines and the UI.
import { KM_PER_MILE } from './geo.js';

/** @param {number} amount @param {string} currency @param {{compact?: boolean}} [o] */
export function money(amount, currency, o = {}) {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency,
      maximumFractionDigits: o.compact || Math.abs(amount) >= 1000 ? 0 : 2,
      minimumFractionDigits: o.compact || Math.abs(amount) >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** @param {number} km @param {'mi'|'km'} unit @param {number} [digits] */
export function distance(km, unit, digits) {
  const v = unit === 'mi' ? km / KM_PER_MILE : km;
  const d = digits ?? (v < 10 ? 1 : 0);
  return `${v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })} ${unit}`;
}

/** @param {number} n */
export function int(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** @param {number} minutes */
export function duration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60); const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** @param {number} hour 0–23 */
export function hourLabel(hour) {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-03" → "March 2026" */
export function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return `${short ? name.slice(0, 3) : name} ${y}`;
}

/** "2026-03-14" → "14 Mar 2026" */
export function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

/** Plural helper: plural(3, 'ride') → "3 rides". */
export function plural(n, word, pluralWord) {
  return `${int(n)} ${n === 1 ? word : pluralWord || `${word}s`}`;
}
