/**
 * scripts/master/csv.mjs — the CSV format of the master-sheet dry run
 * (docs/master-sheet.md "CSV format"): UTF-8, no BOM, "\n" line ends, a value is
 * quoted when it contains a comma, a double quote, \r or \n (quotes doubled).
 * Values are written byte-for-byte; nothing is trimmed or normalised.
 */

const q = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** header = array of keys; rows = array of objects (missing key = ''). */
export function toCsv(header, rows) {
  const lines = [header.map(q).join(',')];
  for (const r of rows) lines.push(header.map((k) => q(r[k])).join(','));
  return lines.join('\n') + '\n';
}

/** Parse CSV text → array of arrays (handles quoted newlines and doubled quotes). */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch === '\r' && s[i + 1] === '\n') { /* swallowed with the \n */ }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** CSV text → array of objects keyed by the header row. */
export function parseCsvObjects(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}
