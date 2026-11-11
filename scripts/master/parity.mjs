/**
 * scripts/master/parity.mjs — master-sheet parity report (bulk 08, PART 3). REPORT
 * ONLY: it changes no data and nothing Learn reads.
 *
 * Builds the catalogue twice and diffs it:
 *   A  from the teacher files (planCatalogue + parseTab, straight from the .xlsx)
 *   B  from the master sheet export = the dry-run CSV reports/master-seed-preview.csv
 *      (docs/master-sheet.md "CSV format"); nothing is recomputed from the sheets.
 * Compared per sheet row (key = source file, source tab, source row): course id,
 * lesson id, course title, lesson title, media id (the drive id inside the link of
 * the column named by source_type) and visibility (learn_live vs catalogue visible).
 * Rows that only the master has are expected only for the hidden tab (the catalogue
 * never builds that tab); any other extra or missing row is a difference.
 * Goal: 0 differences.
 *
 * Usage: node scripts/master/parity.mjs [--csv reports/master-seed-preview.csv]
 *          [--dir data/source/sheets] [--out reports/master-parity.md] [--strict]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseTab, driveIds } from '../catalogue/sheets-map.mjs';
import { planCatalogue } from '../catalogue/catalogue-build.mjs';
import { parseCsvObjects } from './csv.mjs';
import { loadContext, loadFiles } from './seed.mjs';

export const PARITY_FIELDS = ['course_id', 'lesson_id', 'course_title', 'lesson_title', 'media_id', 'visible'];
const keyOf = (file, tab, row) => `${file}\t${tab}\t${row}`;

/** A: the catalogue from the teacher files. Map key → { course_id, lesson_id, course_title, lesson_title, media_id, visible } */
export function fromTeacherFiles(files, ctx = {}) {
  const { teacherFiles = {}, pending = [], teachers = [], courseIds = {}, manifest = [], aliases = null } = ctx;
  const approved = new Set(manifest.filter((e) => e && e.drive_file_id && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
  const inManifest = new Set(manifest.filter((e) => e && e.drive_file_id).map((e) => e.drive_file_id));
  const plan = planCatalogue(files, { teacherFiles, teachers, courseIds, approved, inManifest, aliases, pending });
  const grid = new Map();
  for (const f of files) for (const t of f.tabs) grid.set(`${f.file_id}\t${t.name}`, t);
  const parsed = new Map();
  const lessonAt = (file, tab, row) => {
    const k = `${file}\t${tab}`;
    if (!parsed.has(k)) parsed.set(k, new Map(parseTab(grid.get(k)).lessons.map((l) => [l.row, l])));
    return parsed.get(k).get(row);
  };
  const byId = new Map(plan.courses.map((c) => [c.course_id, c]));
  const out = new Map();
  const add = (course, l, visible) => {
    const lesson = lessonAt(course.file_id, course.tab, l.row);
    out.set(keyOf(course.file_id, course.tab, l.row), {
      course_id: course.course_id,
      lesson_id: l.lesson_id ?? '',
      course_title: course.title,
      lesson_title: lesson ? lesson.title : '',
      media_id: l.source_id ?? '',
      visible,
    });
  };
  for (const c of plan.courses) for (const l of c.visible) add(c, l, true);
  for (const h of plan.hidden) if (h.course_id && h.row != null && byId.has(h.course_id)) add(byId.get(h.course_id), h, false);
  return out;
}

/** B: the catalogue read back from the master sheet export (array of row objects). */
export function fromMasterRows(rows) {
  const out = new Map();
  for (const r of rows) {
    const linkCol = { mp3: 'mp3_link', mp4: 'mp4_link', minicourse: 'minicourse_link' }[r.source_type];
    out.set(keyOf(r.source_file, r.source_tab, Number(r.source_row)), {
      course_id: r.course_id,
      lesson_id: r.lesson_id,
      course_title: r.course_title_km,
      lesson_title: r.lesson_title,
      media_id: linkCol ? driveIds(r[linkCol])[0] || '' : '',
      visible: r.learn_live === 'yes',
      hiddenTab: /(^|; )hidden tab(;|$)/.test(r.issues || ''),
    });
  }
  return out;
}

/** Diff A (catalogue) against B (master). */
export function diffCatalogues(a, b) {
  const differences = [];
  let expectedExtras = 0;
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (!rb) { differences.push({ key: k, field: 'row', catalogue: 'present', master: 'missing' }); continue; }
    for (const f of PARITY_FIELDS) {
      if (ra[f] !== rb[f]) differences.push({ key: k, field: f, catalogue: String(ra[f]), master: String(rb[f]) });
    }
  }
  for (const [k, rb] of b) {
    if (a.has(k)) continue;
    if (rb.hiddenTab) expectedExtras++;
    else differences.push({ key: k, field: 'row', catalogue: 'missing', master: 'present' });
  }
  const byField = Object.fromEntries([...PARITY_FIELDS, 'row'].map((f) => [f, differences.filter((d) => d.field === f).length]));
  return { rowsCatalogue: a.size, rowsMaster: b.size, expectedExtras, differences, byField };
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderParity(res, meta = {}) {
  const L = [];
  L.push('# Master sheet parity (bulk 08, PART 3)');
  L.push('');
  L.push('REPORT ONLY. A = catalogue built from the teacher files; B = the master sheet export (' + (meta.csv || 'dry-run CSV') + '). Goal: 0 differences. Nothing Learn reads is changed.');
  L.push('');
  L.push(`- Rows in the catalogue (A): **${res.rowsCatalogue}** · rows in the master (B): **${res.rowsMaster}**`);
  L.push(`- Rows only the master has, expected (hidden tab, never built by the catalogue): **${res.expectedExtras}**`);
  L.push(`- **Differences: ${res.differences.length}**`);
  L.push('');
  L.push('| field | differences |');
  L.push('| --- | --- |');
  for (const [f, n] of Object.entries(res.byField)) L.push(`| ${f} | ${n} |`);
  L.push('');
  if (res.differences.length) {
    L.push('## First differences (file id · tab · row)');
    L.push('');
    L.push('| row | field | catalogue | master |');
    L.push('| --- | --- | --- | --- |');
    for (const d of res.differences.slice(0, 100)) L.push(`| ${esc(d.key.replace(/\t/g, ' · '))} | ${d.field} | ${esc(d.catalogue)} | ${esc(d.master)} |`);
    if (res.differences.length > 100) L.push(`| … | | ${res.differences.length - 100} more | |`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const root = process.cwd();
  const csv = arg('csv', join(root, 'reports', 'master-seed-preview.csv'));
  const dir = arg('dir', join(root, 'data', 'source', 'sheets'));
  const out = arg('out', join(root, 'reports', 'master-parity.md'));
  if (!existsSync(csv)) { console.error(`dry-run CSV not found: ${csv} (run: node scripts/master/seed.mjs --mode dry)`); process.exit(1); }
  const ctx = loadContext(root);
  const files = await loadFiles(dir, ctx.aliases);
  const a = fromTeacherFiles(files, ctx);
  const b = fromMasterRows(parseCsvObjects(readFileSync(csv, 'utf-8')));
  const res = diffCatalogues(a, b);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderParity(res, { csv }), 'utf-8');
  console.log(`catalogue rows ${res.rowsCatalogue} · master rows ${res.rowsMaster} · expected extras ${res.expectedExtras} · DIFFERENCES ${res.differences.length}`);
  console.log(`wrote ${out}`);
  if (res.differences.length && process.argv.includes('--strict')) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('parity.mjs')) main();
