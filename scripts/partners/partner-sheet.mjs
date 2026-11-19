/**
 * scripts/partners/export.mjs — bulk 10 P1: export the partner sheet (YouTube partner classes)
 * to data/partners/{partners,playlists,videos,terms}.csv, byte-exact (cells as the sheet shows
 * them, nothing trimmed or normalised). Read-only (spreadsheets.readonly). Run by
 * .github/workflows/partner-export.yml. The sheet is synced from YouTube by an Apps Script
 * inside it; Learn never talks to YouTube or KillerPlayer.
 *
 * Tabs: Partners, Playlists, Videos, "Terms (copy)" → terms.csv. README, Example and Meta are
 * not read.
 * Header contract: data/partners/columns.json lists each tab's header row. Every listed header
 * must still be in the sheet (a renamed or missing header fails loudly, exit 3, nothing is
 * written); a NEW column the team adds is exported and reported, never fails. The contract is
 * written only on purpose: `--record-contract` (first run, or after a deliberate change).
 *
 * CLI (env ACCESS_TOKEN): node scripts/partners/export.mjs --sheet-id <id> [--record-contract]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchTab } from '../master/export.mjs';

export const TABS = [
  { tab: 'Partners', file: 'partners.csv' },
  { tab: 'Playlists', file: 'playlists.csv' },
  { tab: 'Videos', file: 'videos.csv' },
  { tab: 'Terms (copy)', file: 'terms.csv', range: "'Terms (copy)'" }, // A1 notation: quoted (space)
];
export const CONTRACT = 'data/partners/columns.json';
export const OUT_DIR = 'data/partners';
export class HeaderContractError extends Error {}

const q = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Sheets values → { header, rows } (rows padded to the header, empty rows dropped). Pure. */
export function tableFrom(values) {
  const [head = [], ...body] = values || [];
  const header = head.map((h) => String(h ?? ''));
  const rows = [];
  for (const r of body) {
    const cells = header.map((_, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i])));
    if (cells.every((c) => c === '')) continue;
    rows.push(cells);
  }
  return { header, rows };
}

/** CSV text of a table, cells byte-exact. Pure. */
export const csvOf = ({ header, rows }) => [header, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';

/**
 * Header check. Pure. -> { missing: [...], added: [...], duplicate: [...] }.
 * missing = contract headers no longer in the sheet (renamed or removed) → fail.
 */
export function headerCheck(tab, header, contract) {
  const want = contract || [];
  const missing = want.filter((h) => !header.includes(h));
  const added = header.filter((h) => h !== '' && !want.includes(h));
  const duplicate = [...new Set(header.filter((h, i) => h !== '' && header.indexOf(h) !== i))];
  return { tab, missing, added, duplicate };
}

/**
 * Read all tabs; write the CSVs only when EVERY tab passes. Returns
 * { changed, files: [{file, rows, changed}], added: {tab: [...]}, contract }.
 */
export async function exportPartners({ sheetId, token, contract, record = false, outDir = OUT_DIR, fetchFn = fetch }) {
  const tables = [];
  const errors = [];
  const added = {};
  const newContract = { ...(contract || {}) };
  for (const t of TABS) {
    const table = tableFrom(await fetchTab({ sheetId, tab: t.range || t.tab, token, fetchFn }));
    if (!table.header.length || table.header.every((h) => h === '')) { errors.push(`tab ${t.tab}: no header row`); continue; }
    const c = headerCheck(t.tab, table.header, record ? table.header : contract && contract[t.tab]);
    if (!record && !(contract && Array.isArray(contract[t.tab]))) errors.push(`tab ${t.tab}: not in ${CONTRACT} (run once with --record-contract)`);
    if (c.missing.length) errors.push(`tab ${t.tab}: header renamed or missing: ${c.missing.join(', ')}`);
    if (c.duplicate.length) errors.push(`tab ${t.tab}: duplicate header: ${c.duplicate.join(', ')}`);
    if (c.added.length) added[t.tab] = c.added;
    if (record) newContract[t.tab] = table.header.filter((h) => h !== '');
    tables.push({ ...t, table });
  }
  if (errors.length) throw new HeaderContractError(errors.join('; '));
  mkdirSync(outDir, { recursive: true });
  const files = tables.map((t) => {
    const path = join(outDir, t.file);
    const text = csvOf(t.table);
    const old = existsSync(path) ? readFileSync(path, 'utf-8') : null;
    const changed = old !== text;
    if (changed) writeFileSync(path, text, 'utf-8');
    return { file: t.file, rows: t.table.rows.length, changed };
  });
  return { changed: files.some((f) => f.changed), files, added, contract: newContract };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const sheetId = arg('sheet-id', '');
  const record = process.argv.includes('--record-contract');
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId) || !process.env.ACCESS_TOKEN) { console.error('needs --sheet-id and ACCESS_TOKEN'); process.exit(2); }
  const contract = existsSync(CONTRACT) ? JSON.parse(readFileSync(CONTRACT, 'utf-8')) : null;
  const tabs = contract && contract.tabs;
  try {
    const r = await exportPartners({ sheetId, token: process.env.ACCESS_TOKEN, contract: tabs, record });
    let contractChanged = false;
    if (record) {
      const next = { _doc: 'Bulk 10 P1: header row of each partner-sheet tab (scripts/partners/export.mjs). A listed header missing from the sheet fails the export; recorded with --record-contract.', tabs: r.contract };
      contractChanged = JSON.stringify(next) !== JSON.stringify(contract);
      if (contractChanged) writeFileSync(CONTRACT, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    }
    for (const f of r.files) console.log(`${f.file}: ${f.rows} rows${f.changed ? ' (changed)' : ' (unchanged)'}`);
    for (const [t, a] of Object.entries(r.added)) console.log(`::warning title=partner-export::tab ${t} has new column(s) not in the contract: ${a.join(', ')}`);
    const changed = r.changed || contractChanged;
    console.log(`changed=${changed}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  } catch (e) {
    console.error(`::error title=partner-export::${e.message}`);
    process.exit(e instanceof HeaderContractError ? 3 : 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('export.mjs') && process.argv[1].includes('partners')) main();
