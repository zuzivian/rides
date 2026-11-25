// Time helpers built on Intl only (no tz database shipped).

/** @type {Map<string, Intl.DateTimeFormat>} */
const fmtCache = new Map();

/** @param {string} tz */
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Wall-clock parts of an instant in a zone. weekday: 0 = Monday … 6 = Sunday.
 * @param {number} ms
 * @param {string} tz
 */
export function localParts(ms, tz) {
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (p.weekday)],
  };
}

/**
 * Offset of `tz` from UTC at instant `ms`, in minutes (e.g. -420 for PDT).
 * @param {number} ms
 * @param {string} tz
 */
export function tzOffsetMinutes(ms, tz) {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Convert a wall-clock time in `tz` to a UTC instant.
 * @param {{year:number,month:number,day:number,hour?:number,minute?:number,second?:number}} w
 * @param {string} tz
 */
export function zonedToUtc(w, tz) {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour || 0, w.minute || 0, w.second || 0);
  let ms = guess - tzOffsetMinutes(guess, tz) * 60000;
  ms = guess - tzOffsetMinutes(ms, tz) * 60000; // refine across DST edges
  return ms;
}

/** @param {{year:number,month:number,day:number}} p */
export function dayKey(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** @param {{year:number,month:number}} p */
export function monthKey(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Days since epoch for a YYYY-MM-DD key (calendar arithmetic, zone-free). */
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** The browser's / runtime's zone, with a safe fallback. */
export function defaultTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Parse the timestamp shapes seen in Uber/Lyft exports and receipts.
 * Returns either an absolute instant (`ms`) or a wall-clock time (`wall`)
 * that still needs a zone. Returns null if unparseable.
 * @param {string | undefined | null} raw
 * @returns {{ms:number} | {wall:{year:number,month:number,day:number,hour:number,minute:number,second:number}} | null}
 */
export function parseTimestamp(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || /^(n\/?a|null|none|-)$/i.test(s)) return null;

  // Epoch seconds / millis.
  if (/^\d{10}(\.\d+)?$/.test(s)) return { ms: Math.round(parseFloat(s) * 1000) };
  if (/^\d{13}$/.test(s)) return { ms: +s };

  // "2023-05-14 18:22:10 +0000 UTC", "2023-05-14T18:22:10-07:00", "2023-05-14 18:22", "...Z"
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?(?:\s*(?:UTC|GMT|[A-Z]{3,4}))?$/i);
  if (m) {
    const wall = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] || 0) };
    const tz = m[7] || (/\b(UTC|GMT)$/i.test(s) ? 'Z' : '');
    if (tz) {
      const base = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
      if (/^(Z|UTC)$/i.test(tz)) return { ms: base };
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      const off = sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4));
      return { ms: base - off * 60000 };
    }
    return { wall };
  }
  // Date only.
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { wall: { year: +m[1], month: +m[2], day: +m[3], hour: 12, minute: 0, second: 0 } };

  // "05/14/2023 6:22 PM", "5/14/23 18:22", "05/14/2023"
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i);
  if (m) {
    let year = +m[3]; if (year < 100) year += 2000;
    let hour = m[4] ? +m[4] : 12;
    if (m[7]) { hour %= 12; if (/p/i.test(m[7])) hour += 12; }
    return { wall: { year, month: +m[1], day: +m[2], hour, minute: +(m[5] || 0), second: +(m[6] || 0) } };
  }

  // "May 14, 2023 6:22 PM", "Sun, May 14, 2023 at 6:22 PM", "14 May 2023 18:22"
  s = s.replace(/^[A-Za-z]{3,9},?\s+(?=[A-Za-z]{3,9}\s+\d)/, '').replace(/\s+at\s+/i, ' ');
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i)
    || null;
  let month, day, year, hh, mm, ap;
  if (m) { [, month, day, year, hh, mm, ap] = m; }
  else {
    const m2 = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i);
    if (m2) { [, day, month, year, hh, mm, ap] = m2; }
  }
  if (month) {
    const mo = MONTHS[/** @type {keyof typeof MONTHS} */ (month.slice(0, 3).toLowerCase())];
    if (mo) {
      let hour = hh ? +hh : 12;
      if (ap) { hour %= 12; if (/p/i.test(ap)) hour += 12; }
      return { wall: { year: Number(year), month: mo, day: Number(day), hour, minute: +(mm || 0), second: 0 } };
    }
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : { ms: t };
}
