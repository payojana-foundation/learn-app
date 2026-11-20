/**
 * scripts/master/teaching-points.mjs — bulk 10 P2b: the master sheet tab "Teaching points"
 * (schema data/master/teaching-points.json). Run by .github/workflows/master-teaching-points.yml.
 *   ensure  create the tab once (header, frozen row, approved_by dropdown, term_id protected:
 *           service account only). An existing tab must have exactly the schema header, else the
 *           job stops (nothing written). Lessons, Courses and every other tab are never touched.
 *   assign  give a term_id (T0001, ...) to each row with a term (km, Pāḷi or English) and no id,
 *           in sheet order; ids are never reused (data/master/term-ids.json keeps every id given,
 *           committed BEFORE the cells are written). Only term_id cells are written.
 * Nothing is ever deleted.
 *
 * CLI (env ACCESS_TOKEN, SA_EMAIL): plan --sheet-id <id> | write --sheet-id <id>
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { readTab, writeRanges } from './sync.mjs';
import { colLetter } from './seed.mjs';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SCHEMA = 'data/master/teaching-points.json';
export const REGISTRY = 'data/master/term-ids.json';
export const PLAN = 'teaching-points-plan.json';

const api = async (fetchFn, sheetId, token, method, path, body) => {
  const res = await fetchFn(`${SHEETS_BASE}/${sheetId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets API ${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

/** Create the tab when missing. -> 'created' | 'exists'. Throws on a different header. */
export async function ensureTab({ sheetId, token, schema, saEmail, fetchFn = fetch }) {
  const keys = schema.columns.map((c) => c.key);
  const meta = await api(fetchFn, sheetId, token, 'GET', '?fields=sheets(properties(sheetId,title))');
  const has = (meta.sheets || []).find((s) => s.properties.title === schema.tab);
  const range = `'${schema.tab}'!A1:${colLetter(keys.length - 1)}1`;
  if (has) {
    const cur = await api(fetchFn, sheetId, token, 'GET', `/values/${encodeURIComponent(`'${schema.tab}'!1:1`)}`);
    const head = ((cur.values || [])[0] || []).map(String);
    if (head.length === 0) {
      await api(fetchFn, sheetId, token, 'PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { range, values: [keys] });
      return 'header written';
    }
    if (head.length !== keys.length || head.some((h, i) => h !== keys[i])) throw new Error(`tab "${schema.tab}" exists with a different header (${head.join(',')}): not touching it`);
    return 'exists';
  }
  if (!saEmail || !/@/.test(saEmail)) throw new Error('SA_EMAIL (the service account) is needed to protect term_id');
  const add = await api(fetchFn, sheetId, token, 'POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: schema.tab, gridProperties: { frozenRowCount: 1 } } } }] });
  const gid = add.replies[0].addSheet.properties.sheetId;
  const requests = [];
  schema.columns.forEach((c, i) => {
    if (Array.isArray(c.dropdown)) requests.push({ setDataValidation: { range: { sheetId: gid, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 }, rule: { condition: { type: 'ONE_OF_LIST', values: c.dropdown.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true } } });
    if (c.protected) requests.push({ addProtectedRange: { protectedRange: { range: { sheetId: gid, startColumnIndex: i, endColumnIndex: i + 1 }, description: `master sheet ${schema.tab}: ${c.key} (service account only)`, warningOnly: false, editors: { users: [saEmail] } } } });
  });
  if (requests.length) await api(fetchFn, sheetId, token, 'POST', ':batchUpdate', { requests });
  await api(fetchFn, sheetId, token, 'PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { range, values: [keys] });
  return 'created';
}

const fmt = (n) => `T${String(n).padStart(4, '0')}`;

/**
 * Rows with a term and no term_id get the next ids. Pure.
 * registry = { next: number, ids: [given ids] } -> { cells: [{row, to}], registry }
 */
export function assignIds(sheet, registry) {
  const R = { next: Number((registry && registry.next) || 1), ids: [...((registry && registry.ids) || [])] };
  const i = (k) => sheet.header.indexOf(k);
  const cells = [];
  const used = new Set([...R.ids, ...sheet.rows.map((r) => String(r[i('term_id')] ?? '')).filter(Boolean)]);
  sheet.rows.forEach((r, j) => {
    if (String(r[i('term_id')] ?? '') !== '') return;
    if (!['term_km', 'term_pali', 'term_en'].some((k) => String(r[i(k)] ?? '').trim() !== '')) return;
    let id = fmt(R.next);
    while (used.has(id)) { R.next++; id = fmt(R.next); }
    used.add(id);
    R.ids.push(id);
    R.next++;
    cells.push({ row: j + 2, to: id });
  });
  return { cells, registry: R };
}

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
function arg(name, def) {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 && process.argv[k + 1] ? process.argv[k + 1] : def;
}

async function main() {
  const cmd = process.argv[2];
  const sheetId = arg('sheet-id', '');
  const token = process.env.ACCESS_TOKEN || '';
  if (!token || !/^[A-Za-z0-9_-]+$/.test(sheetId)) { console.error('needs --sheet-id and ACCESS_TOKEN'); process.exit(2); }
  const schema = readJson(SCHEMA, null);
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (cmd === 'plan') {
    const state = await ensureTab({ sheetId, token, schema, saEmail: process.env.SA_EMAIL || '' });
    const sheet = await readTab({ sheetId, token, tab: `'${schema.tab}'` });
    const prev = readJson(REGISTRY, { next: 1, ids: [] });
    const p = assignIds(sheet, prev);
    const changed = JSON.stringify(p.registry) !== JSON.stringify({ next: prev.next, ids: prev.ids });
    if (changed) writeFileSync(REGISTRY, JSON.stringify({ _doc: 'Bulk 10 P2b: every term_id ever given in the master "Teaching points" tab (never reused). next = the next number.', ...p.registry }, null, 2) + '\n', 'utf-8');
    const col = colLetter(schema.columns.findIndex((c) => c.key === 'term_id'));
    writeFileSync(PLAN, JSON.stringify({ ranges: p.cells.map((c) => ({ range: `'${schema.tab}'!${col}${c.row}:${col}${c.row}`, values: [[c.to]] })) }));
    console.log(`teaching-points: tab ${state}; ${p.cells.length} new term id(s)`);
    out('changed', changed ? 'true' : 'false');
    out('cells', p.cells.length);
  } else if (cmd === 'write') {
    const { ranges } = readJson(PLAN, { ranges: [] });
    const n = ranges.length ? await writeRanges({ sheetId, token, ranges }) : 0;
    console.log(`cells written: ${n}`);
  } else {
    console.error('Usage: teaching-points.mjs plan|write --sheet-id <id>');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('teaching-points.mjs')) main().catch((e) => { console.error(`::error title=teaching-points::${e.message}`); process.exit(1); });
