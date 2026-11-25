// Uber / Lyft receipt emails (.eml, .mbox) → trips. Pure: uses only
// TextDecoder and atob, which exist in browsers and Node 18+.
//
// Receipts are free-form HTML that changes often, so extraction is
// heuristic: we read the text, look for labelled totals, "<time> <address>"
// pairs, distance and duration, and keep only those fields. Names, card
// digits and anything else in the email are never copied into a Trip.
import { parseTimestamp } from './time.js';
import { parseMoney, normalizeProduct } from './parse.js';
import { KM_PER_MILE, METROS, cityFromAddress } from './geo.js';

/** @typedef {import('./types.js').Trip} Trip */

/**
 * @typedef {Object} Mime
 * @property {Record<string, string>} headers  lower-cased names, unfolded
 * @property {string} body                      decoded text of the best part
 * @property {'plain'|'html'|''} kind
 */

/** Split an mbox file into raw messages. @param {string} text */
export function splitMbox(text) {
  const t = text.replace(/\r\n/g, '\n');
  if (!/^From /m.test(t.slice(0, 200)) && !/\nFrom \S+.*\d{4}\n/.test(t)) return [t];
  return t.split(/^From .*\n/m).map((m) => m.replace(/^>From /gm, 'From ')).filter((m) => /\S/.test(m));
}

/** @param {string} block */
function parseHeaders(block) {
  /** @type {Record<string, string>} */
  const h = {};
  const unfolded = block.replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = line.slice(i + 1).trim(); }
  }
  return h;
}

/** RFC 2047 encoded words: =?utf-8?Q?...?= / =?utf-8?B?...?= @param {string} s */
export function decodeWords(s) {
  return s.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? b64Bytes(data) : qpBytes(data.replace(/_/g, ' '));
      return new TextDecoder(cs).decode(bytes);
    } catch { return data; }
  }).replace(/\?=\s+=\?/g, '');
}

/** @param {string} s */
function b64Bytes(s) {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {string} s */
function qpBytes(s) {
  const clean = s.replace(/=\r?\n/g, '');
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) { out.push(parseInt(clean.slice(i + 1, i + 3), 16)); i += 2; }
    else {
      const code = clean.charCodeAt(i);
      if (code < 128) out.push(code); else out.push(...new TextEncoder().encode(c));
    }
  }
  return new Uint8Array(out);
}

/** @param {string} body @param {Record<string,string>} headers */
function decodeBody(body, headers) {
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const cs = /charset="?([^";\s]+)/i.exec(headers['content-type'] || '')?.[1] || 'utf-8';
  try {
    if (enc === 'base64') return new TextDecoder(cs).decode(b64Bytes(body));
    if (enc === 'quoted-printable') return new TextDecoder(cs).decode(qpBytes(body));
  } catch { /* fall through to raw */ }
  return body;
}

/**
 * Parse one RFC 822 message, walking multipart bodies, and return the most
 * useful text part (plain preferred, else HTML).
 * @param {string} raw
 * @returns {Mime}
 */
export function parseEml(raw) {
  const t = raw.replace(/\r\n/g, '\n');
  const split = t.indexOf('\n\n');
  const headers = parseHeaders(split === -1 ? t : t.slice(0, split));
  const body = split === -1 ? '' : t.slice(split + 2);
  /** @type {{plain: string, html: string}} */
  const found = { plain: '', html: '' };
  walk(headers, body, found, 0);
  if (headers.subject) headers.subject = decodeWords(headers.subject);
  if (headers.from) headers.from = decodeWords(headers.from);
  if (found.plain && found.plain.replace(/\s+/g, '').length > 80) return { headers, body: found.plain, kind: 'plain' };
  if (found.html) return { headers, body: found.html, kind: 'html' };
  return { headers, body: found.plain, kind: found.plain ? 'plain' : '' };
}

/** @param {Record<string,string>} headers @param {string} body @param {{plain:string,html:string}} found @param {number} depth */
function walk(headers, body, found, depth) {
  const ct = (headers['content-type'] || 'text/plain').toLowerCase();
  if (ct.startsWith('multipart/') && depth < 6) {
    const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] || '')?.[1];
    if (!boundary) return;
    const parts = body.split(new RegExp(`^--${escapeRe(boundary)}(?:--)?[ \\t]*$`, 'm')).slice(1);
    for (const part of parts) {
      const p = part.replace(/^\n/, '');
      const i = p.indexOf('\n\n');
      if (i === -1) continue;
      walk(parseHeaders(p.slice(0, i)), p.slice(i + 2), found, depth + 1);
    }
    return;
  }
  if (/attachment/i.test(headers['content-disposition'] || '')) return;
  if (ct.startsWith('text/plain') && !found.plain) found.plain = decodeBody(body, headers);
  else if (ct.startsWith('text/html') && !found.html) found.html = decodeBody(body, headers);
  else if (ct.startsWith('message/rfc822')) { const inner = parseEml(body); if (inner.kind === 'plain' && !found.plain) found.plain = inner.body; else if (!found.html) found.html = inner.body; }
}

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML → readable lines. @param {string} html */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' \t ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** @param {Record<string,string>} h */
export function receiptSource(h) {
  const from = (h.from || '').toLowerCase(); const subj = (h.subject || '').toLowerCase();
  if (/uber\.com/.test(from) && !/eats/.test(subj) && !/eats|delivery|order/.test(subj)) return 'uber';
  if (/lyft(mail)?\.com/.test(from)) return 'lyft';
  if (/\btrip with uber\b|\buber receipt\b|\bride with uber\b/.test(subj)) return 'uber';
  if (/\bride with lyft\b|\blyft ride receipt\b|\blyft receipt\b/.test(subj)) return 'lyft';
  return '';
}

const TIME = /\b(\d{1,2}:\d{2})\s*([AaPp]\.?[Mm]\.?)?/;
const MONEY = /(?:[A-Z]{3}\s?|[A-Z]{1,2}\$|[$£€¥₹])\s?\d[\d,]*(?:[.,]\d{2})?|\d[\d,]*[.,]\d{2}\s?(?:[A-Z]{3}|€|£)/;

/**
 * Pull trip fields from receipt text. Exported for tests.
 * @param {string} text
 * @param {'uber'|'lyft'} source
 */
export function extractReceipt(text, source) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const all = lines.join('\n');

  // Total: prefer a labelled total line; ignore lines with card digits.
  let fare = null; let currency = '';
  const totalRe = /^(?:total(?: charged| fare| paid)?|amount charged|you paid|trip total|fare total|grand total|charged)\b[^\d$£€¥₹A-Z]*/i;
  for (let i = 0; i < lines.length && fare == null; i++) {
    if (!totalRe.test(lines[i])) continue;
    for (const candidate of [lines[i], lines[i + 1] || '']) {
      const m = candidate.replace(/[•*]{1,4}\s?\d{4}/g, '').match(MONEY);
      if (m) { const p = parseMoney(m[0]); if (p.amount != null) { fare = p.amount; currency = p.currency; break; } }
    }
  }

  // Distance and duration.
  let km = null;
  const dm = all.match(/(\d+(?:\.\d+)?)\s*(mi|miles|km|kilomet(?:er|re)s?)\b/i);
  if (dm) km = /^k/i.test(dm[2]) ? +dm[1] : +dm[1] * KM_PER_MILE;
  let minutes = null;
  const durM = all.match(/(\d+)\s*h(?:r|ours?)?\s*(\d+)\s*m(?:in)?\b/i) || all.match(/\b(\d+)\s*m(?:in(?:utes?)?)?\s*(\d+)\s*s(?:ec)?\b/i) || all.match(/\b(\d+)\s*min(?:ute)?s?\b/i);
  if (durM) {
    if (/h/i.test(durM[0])) minutes = +durM[1] * 60 + +durM[2];
    else if (/s(ec)?\b/i.test(durM[0])) minutes = +durM[1] + +durM[2] / 60;
    else minutes = +durM[1];
  }

  // Pickup and dropoff: lines with a clock time and an address, either on
  // the same line ("5:42 PM | 123 Main St") or the next line.
  /** @type {{time:string, address:string}[]} */
  const stops = [];
  for (let i = 0; i < lines.length && stops.length < 2; i++) {
    const l = lines[i];
    const m = l.match(TIME);
    if (!m || /\b(total|fare|charged|paid|receipt|date)\b/i.test(l) && !/pick|drop/i.test(l)) continue;
    const time = `${m[1]}${m[2] ? ` ${m[2].replace(/\./g, '').toUpperCase()}` : ''}`;
    let rest = l.slice((m.index || 0) + m[0].length).replace(/^[\s|·•\-–—:]+/, '').trim();
    rest = rest.replace(/^(pick-?up|drop-?off)\b[:\s]*/i, '');
    if (!looksLikeAddress(rest) && looksLikeAddress(lines[i + 1] || '')) rest = lines[i + 1];
    if (looksLikeAddress(rest)) stops.push({ time, address: rest });
  }

  const productMatch = all.match(/\b(UberX(?:L| Share| Priority)?|Uber ?(?:Comfort|Black(?: SUV)?|Green|Pool|Pet|Taxi|WAV)|Comfort Electric|Comfort|Lyft (?:XL|Lux(?: Black)?(?: XL)?|Shared|Preferred|Extra Comfort|Standard|Priority Pickup|Wait & Save))\b/i);
  const product = normalizeProduct(productMatch ? productMatch[1].replace(/^Uber ?(?=Comfort|Black|Green|Pool|Pet|Taxi|WAV)/i, '') : source === 'lyft' ? 'Lyft' : 'UberX', source);

  // Trip date written in the body ("May 14, 2023" or "14 May 2023").
  const dateM = all.match(/\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/);

  return { fare, currency, km, minutes, stops, product, bodyDate: dateM ? dateM[1] : '' };
}

/** @param {string} s */
function looksLikeAddress(s) {
  if (!s || s.length < 6 || s.length > 160) return false;
  if (MONEY.test(s) && !/\d+\s+\w+\s+(st|ave|rd|blvd|street|avenue|road|way|dr|ln)\b/i.test(s)) return false;
  return /\d+\s+\S+|,\s*[A-Z]{2}\b|\b(st|ave|rd|blvd|street|avenue|road|way|drive|dr|lane|ln|plaza|pl|station|airport|terminal|square|sq)\b/i.test(s);
}

/** "-0700" → minutes. @param {string} date */
function headerOffset(date) {
  const m = /([+-])(\d{2})(\d{2})\s*(\(.*\))?$/.exec(date.trim());
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
}

/**
 * @param {string} text  contents of an .eml or .mbox file
 * @param {{idPrefix?: string, defaultTz?: string}} [opts]
 * @returns {{trips: Trip[], read: number, skipped: number}}
 */
export function parseReceipts(text, opts = {}) {
  const messages = splitMbox(text);
  /** @type {Trip[]} */
  const trips = [];
  let skipped = 0;
  messages.forEach((raw, i) => {
    const mime = parseEml(raw);
    const source = receiptSource(mime.headers);
    if (!source) { skipped++; return; }
    const textBody = mime.kind === 'html' ? htmlToText(mime.body) : mime.body;
    const r = extractReceipt(textBody, source);
    if (r.fare == null && !r.stops.length) { skipped++; return; }

    const sent = parseTimestamp(mime.headers.date);
    const sentMs = sent && 'ms' in sent ? sent.ms : null;
    const offset = headerOffset(mime.headers.date || '');
    const fromAddress = r.stops[0]?.address || '';
    const toAddress = r.stops[1]?.address || '';
    const city = cityFromAddress(fromAddress) || cityFromAddress(toAddress);
    const metro = METROS.find(([name]) => city && (name.toLowerCase().includes(city.toLowerCase()) || city.toLowerCase().includes(name.toLowerCase())));
    const tz = metro ? metro[4] : offset != null && offset % 60 === 0 ? (offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset / 60)}`) : (opts.defaultTz || 'UTC');

    // Day: from the body, else the email's local date (receipts arrive minutes after dropoff).
    let day = null;
    if (r.bodyDate) { const d = parseTimestamp(r.bodyDate); if (d && 'wall' in d) day = d.wall; }
    if (!day && sentMs != null) {
      const local = new Date(sentMs + (offset ?? 0) * 60000);
      day = { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
    }
    if (!day) { skipped++; return; }
    /** @param {string|undefined} clock */
    const at = (clock) => {
      if (!clock) return null;
      const m = /^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i.exec(clock); if (!m) return null;
      let hour = +m[1]; if (m[3]) { hour %= 12; if (/p/i.test(m[3])) hour += 12; }
      const wall = Date.UTC(day.year, day.month - 1, day.day, hour, +m[2]);
      // Offset: the trip zone's offset if known via Intl, else the header's.
      let off = offset ?? 0;
      try {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(wall)).find((x) => x.type === 'timeZoneName')?.value || '';
        const mm = /GMT([+-])(\d{2}):?(\d{2})?/.exec(p); if (mm) off = (mm[1] === '-' ? -1 : 1) * (+mm[2] * 60 + +(mm[3] || 0)); else if (p === 'GMT') off = 0;
      } catch { /* keep header offset */ }
      return wall - off * 60000;
    };
    let start = at(r.stops[0]?.time);
    let end = at(r.stops[1]?.time);
    if (start != null && end != null && end < start) end += 86400000; // past midnight
    if (start == null && sentMs != null) start = sentMs - (r.minutes ? r.minutes * 60000 : 0) - 5 * 60000;
    if (start == null) { skipped++; return; }
    if (end == null && r.minutes) end = start + r.minutes * 60000;

    trips.push({
      id: `${opts.idPrefix || 'email'}-${i}`,
      source: 'email', start, end, requested: null, tz,
      fromLat: null, fromLng: null, toLat: null, toLng: null,
      fromAddress, toAddress,
      km: r.km, fare: r.fare, currency: r.currency, product: r.product,
      city: metro ? metro[0] : city,
    });
  });
  trips.sort((a, b) => a.start - b.start);
  return { trips, read: trips.length, skipped };
}

/** Quick sniff: does this text look like email rather than CSV? @param {string} text */
export function looksLikeEmail(text) {
  const head = text.slice(0, 4000);
  return /^From \S+/.test(head) || (/^(Received|Return-Path|Delivered-To|MIME-Version|Message-ID|Date|From|Subject):/im.test(head) && /^Subject:/im.test(head));
}

