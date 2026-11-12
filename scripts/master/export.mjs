/**
 * scripts/master/export.mjs — export the master content sheet (bulk 09, P1).
 *
 * Reads the tabs Lessons and Courses of the master Google Sheet through the Sheets
 * API (read-only) and writes data/master/lessons.csv and data/master/courses.csv:
 * UTF-8, no BOM, "\n" line ends, header = the column keys of data/master/columns.json,
 * values exactly as the API returns them (nothing trimmed or normalised). CSV rules:
 * docs/master-sheet.md "CSV format". A file is rewritten only when its content changed.
 *
 * Fails loudly (exit 3) when a header row differs from columns.json, and refuses to
 * write when a tab has no data rows (an empty export must never wipe the site).
 *
 * Usage:  node scripts/master/export.mjs --sheet-id <id> [--out data/master]
 *   env ACCESS_TOKEN  OAuth token with the spreadsheets.readonly scope
 * Prints `changed=true|false` (also to $GITHUB_OUTPUT) for the workflow.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from './csv.mjs';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class HeaderMismatchError extends Error {
  constructor(tab, expected, actual) {
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    const moved = missing.length === 0 && extra.length === 0;
    super(
      `tab ${tab}: header differs from data/master/columns.json` +
        (missing.length ? `; missing: ${missing.join(', ')}` : '') +
        (extra.length ? `; unexpected: ${extra.join(', ')}` : '') +
        (moved ? '; same names in a different order' : '') +
        `. expected ${expected.length} columns, got ${actual.length}.`
    );
    this.tab = tab;
    this.expected = expected;
    this.actual = actual;
  }
}
export class EmptyTabError extends Error {}

export function loadColumns(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, 'data', 'master', 'columns.json'), 'utf-8'));
}

/**
 * values = the Sheets API `values` array (header row first). Returns row objects keyed
 * by the header. Short rows are padded with ''; completely empty rows are dropped.
 */
export function rowsFromValues(tab, values, keys) {
  const [head = [], ...body] = values || [];
  const header = head.map((h) => String(h));
  if (header.length !== keys.length || header.some((h, i) => h !== keys[i])) throw new HeaderMismatchError(tab, keys, header);
  const rows = [];
  for (const r of body) {
    const cells = keys.map((_, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i])));
    if (cells.every((c) => c === '')) continue;
    rows.push(Object.fromEntries(keys.map((k, i) => [k, cells[i]])));
  }
  if (rows.length === 0) throw new EmptyTabError(`tab ${tab}: no data rows - refusing to export an empty tab`);
  return rows;
}

export function csvFor(keys, rows) {
  return toCsv(keys, rows);
}

/** The two exports: [{ tab, file, keys }] from columns.json. */
export function plan(columns) {
  return [
    { tab: 'Lessons', file: 'lessons.csv', keys: columns.columns.map((c) => c.key) },
    { tab: 'Courses', file: 'courses.csv', keys: columns.courses.columns.map((c) => c.key) },
  ];
}

export async function fetchTab({ sheetId, tab, token, fetchFn = fetch }) {
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId || '')) throw new Error('sheet id missing or malformed');
  if (!token) throw new Error('ACCESS_TOKEN missing');
  const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetchFn(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets API GET ${tab} -> ${res.status}: ${String(text).slice(0, 300)}`);
  return (JSON.parse(text).values) || [];
}

/**
 * Export both tabs into `outDir`. Nothing is written unless BOTH tabs pass their checks.
 * Returns { changed, files: [{ file, rows, changed }] }.
 */
export async function exportMaster({ sheetId, token, columns, outDir, fetchFn = fetch }) {
  const results = [];
  for (const p of plan(columns)) {
    const values = await fetchTab({ sheetId, tab: p.tab, token, fetchFn });
    const rows = rowsFromValues(p.tab, values, p.keys);
    results.push({ ...p, rows, csv: csvFor(p.keys, rows) });
  }
  mkdirSync(outDir, { recursive: true });
  const files = results.map((r) => {
    const path = join(outDir, r.file);
    const old = existsSync(path) ? readFileSync(path, 'utf-8') : null;
    const changed = old !== r.csv;
    if (changed) writeFileSync(path, r.csv, 'utf-8');
    return { file: r.file, rows: r.rows.length, changed };
  });
  return { changed: files.some((f) => f.changed), files };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const root = process.cwd();
  const outDir = arg('out', join(root, 'data', 'master'));
  try {
    const r = await exportMaster({ sheetId: arg('sheet-id', ''), token: process.env.ACCESS_TOKEN, columns: loadColumns(root), outDir });
    for (const f of r.files) console.log(`${f.file}: ${f.rows} rows${f.changed ? ' (changed)' : ' (unchanged)'}`);
    console.log(`changed=${r.changed}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${r.changed}\n`);
  } catch (e) {
    console.error(`::error title=master export::${e.message}`);
    process.exit(e instanceof HeaderMismatchError || e instanceof EmptyTabError ? 3 : 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('export.mjs')) main();
