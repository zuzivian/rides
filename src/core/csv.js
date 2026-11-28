// RFC 4180-ish CSV parser. Handles quoted fields, escaped quotes, CRLF/LF,
// a UTF-8 BOM, and newlines inside quotes. Pure: no DOM, no Node APIs.

/**
 * @param {string} text
 * @returns {string[][]} rows (blank lines dropped)
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  // Sniff the delimiter from the first record: comma, semicolon or tab,
  // counting only those outside quotes.
  /** @type {Record<string, number>} */
  const seen = { ',': 0, ';': 0, '\t': 0 };
  for (let j = 0, q = false; j < n; j++) {
    const c = text[j];
    if (c === '"') q = !q;
    else if (!q && c === '\n') break;
    else if (!q && c in seen) seen[c]++;
  }
  const delim = [';', '\t'].reduce((best, d) => (seen[d] > seen[best] ? d : best), ',');

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/**
 * @param {string[][]} rows
 * @returns {string} CSV text
 */
export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",;\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n') + '\n';
}
