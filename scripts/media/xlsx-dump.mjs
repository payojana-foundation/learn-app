/**
 * scripts/media/xlsx-dump.mjs — dump the STRUCTURE of every .xlsx in a folder
 * to one JSON array (Q1, sheets-inventory.yml). CI-only: it imports the `xlsx`
 * reader that the workflow installs with `npm install --no-save` (not a repo
 * dependency). It reads nothing it writes — structure discovery only.
 *
 * Output (consumed by sheets-inventory.mjs), per file:
 *   { name, id, tabs: [ { name, header[], rowCount, sample[<=3][] } ] }
 *
 * `name` comes from the Drive listing (<id>\t<name> in _names.tsv); `id` is the
 * file stem. Titles/cell text are copied verbatim — never retyped or trimmed.
 *
 * Usage:
 *   node scripts/media/xlsx-dump.mjs <dir> <names.tsv> > dump.json
 *
 * The pure `workbookToTabs` is exported so a fixture test can exercise it
 * without the xlsx dependency (it takes an already-parsed sheet matrix).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

/**
 * Turn a parsed workbook (tab name → array-of-rows matrix) into the tab
 * descriptors. Pure: no xlsx dependency, so tests pass plain matrices.
 *   sheets = { "<tabName>": [ ["h1","h2"], ["r1c1","r1c2"], … ] }
 */
export function workbookToTabs(sheets) {
  const tabs = [];
  for (const [name, matrix] of Object.entries(sheets || {})) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const header = Array.isArray(rows[0]) ? rows[0].map((c) => (c == null ? '' : String(c))) : [];
    const dataRows = rows.slice(1);
    tabs.push({
      name,
      header,
      rowCount: dataRows.length,
      sample: dataRows.slice(0, 3).map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : [])),
    });
  }
  return tabs;
}

/** Parse _names.tsv (<id>\t<name> per line) into a Map<id, name>. */
export function parseNames(tsv) {
  const map = new Map();
  for (const line of String(tsv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t');
    if (i < 0) continue;
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

async function main() {
  const [, , dir, namesPath] = process.argv;
  if (!dir) {
    console.error('Usage: node scripts/media/xlsx-dump.mjs <dir> [names.tsv]');
    process.exit(1);
  }
  const names = namesPath && existsSync(namesPath) ? parseNames(readFileSync(namesPath, 'utf-8')) : new Map();

  // xlsx is installed CI-side with `npm install --no-save`.
  const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));

  const out = [];
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== '.xlsx') continue;
    const id = basename(f, extname(f));
    const wb = XLSX.readFile(join(dir, f));
    const sheets = {};
    for (const tabName of wb.SheetNames) {
      sheets[tabName] = XLSX.utils.sheet_to_json(wb.Sheets[tabName], { header: 1, blankrows: false, defval: '' });
    }
    out.push({ name: names.get(id) ?? id, id, tabs: workbookToTabs(sheets) });
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('xlsx-dump.mjs')) main();
