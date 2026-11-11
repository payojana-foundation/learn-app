/**
 * scripts/catalogue/sheets-map.mjs — teacher-sheet CATALOGUE REPORT (report only).
 *
 * Reads data/source/sheets/*.xlsx and writes, next to them:
 *   catalogue-draft.csv   one row per lesson
 *   CATALOGUE-REPORT.md   totals, gaps, duplicates, skipped tabs, header variants,
 *                         and the pilot check (Drive ids vs the pilot queue)
 *
 * It changes NO app data and NO build input. It never invents a lesson code or a
 * Drive id: every value is copied from a cell (outer whitespace trimmed only;
 * Khmer text is never retyped). One course = one tab.
 *
 * Layout the sheets use (found by label, because the row varies):
 *   - a LABEL row containing  ចំណងជើង មេរៀន  (title) and  ឈ្មោះគ្រូ  (teacher) and/or
 *     លេខកូដមេរៀន  (lesson code). Tabs with none are listed as skipped.
 *   - the link-column labels (…MP3, …MP4, Video for MiniCourse, …វីដេអូដើម, យូធូប)
 *     sit in the row(s) at/above the label row; the cells under them hold the Drive
 *     links (file/d/<id>, open?id=<id>). Hyperlink targets are read as well as text.
 *   - a lesson row is a row below the label row whose ល.រ (number) cell is a number.
 *
 * xlsx is a CI-side reader (`npm install --no-save xlsx@0.18.5`, as in
 * sheets-inventory.yml); the pure functions below take plain cell grids so they are
 * unit-tested with a small fixture and no xlsx dependency.
 *
 * Usage:
 *   node scripts/catalogue/sheets-map.mjs [--dir data/source/sheets] [--out <dir>]
 *        [--queue data/audio-queue.pilot.csv] [--pilot "<tab-name substring>"]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { loadAliases, canonicalFileId } from './file-aliases.mjs';

// ── text helpers ──────────────────────────────────────────────────────────────

/** For MATCHING only: drop zero-width chars, collapse whitespace. Never displayed. */
export const norm = (s) =>
  String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\s\u00A0]+/g, ' ').trim();
/** For OUTPUT: outer whitespace only; inner text is copied byte-for-byte. */
export const outer = (s) => String(s ?? '').trim();

export const LABELS = {
  title: 'ចំណងជើង មេរៀន',
  code: 'លេខកូដមេរៀន',
  teacher: 'ឈ្មោះគ្រូ',
};
const NT = norm(LABELS.title);
const NC = norm(LABELS.code);
const NTE = norm(LABELS.teacher);

const NUM_RE = /^[0-9\u17E0-\u17E9]+\s*[.)]?$/; // 1  ១  1.
const ID = '[A-Za-z0-9_-]{20,}';

/** Drive FILE ids found in text and/or a hyperlink target, in order, de-duped. */
export function driveIds(...strings) {
  const out = [];
  for (const s of strings) {
    if (!s) continue;
    const str = String(s);
    for (const m of str.matchAll(new RegExp(`/file/d/(${ID})|[?&]id=(${ID})|/(?:document|spreadsheets)/d/(${ID})`, 'g'))) {
      const id = m[1] || m[2] || m[3];
      if (!out.includes(id)) out.push(id);
    }
    // a cell holding just a bare id
    const bare = /^[A-Za-z0-9_-]{25,}$/.exec(outer(str));
    if (bare && !out.includes(bare[0])) out.push(bare[0]);
  }
  return out;
}
/** True when a cell points at a Drive FOLDER (not a file). */
export const hasFolderLink = (...strings) => strings.some((s) => s && /\/folders\//.test(String(s)));

// ── header / column detection ────────────────────────────────────────────────

/** Row index of the label row, or -1. Needs the title label + teacher and/or code. */
export function findHeaderRow(text, maxRows = 25) {
  const n = Math.min(maxRows, text.length);
  for (let r = 0; r < n; r++) {
    const cells = (text[r] || []).map(norm);
    const hasTitle = cells.some((c) => c.includes(NT));
    const hasTeacher = cells.some((c) => c.includes(NTE));
    const hasCode = cells.some((c) => c.includes(NC));
    if (hasTitle && (hasTeacher || hasCode)) return r;
  }
  return -1;
}

const isUrlish = (t) => /https?:\/\//i.test(t) || t.length > 90;

/** Map the label row (+ link labels above it) to column indexes. -1 = absent. */
export function mapColumns(text, hr) {
  const labels = (text[hr] || []).map(norm);
  const find = (pred) => labels.findIndex(pred);
  const teacher = find((c) => c.includes(NTE));
  const title = find((c) => c.includes(NT));
  const codeCols = labels.map((c, i) => (c.includes(NC) ? i : -1)).filter((i) => i >= 0);
  const lessonCode = codeCols.find((i) => !/video/i.test(labels[i])) ?? -1;
  const videoCode = codeCols.find((i) => /video/i.test(labels[i])) ?? -1;

  let number = find((c) => /^ល\.?\s*រ/.test(c));
  let numberVia = 'label';
  if (number < 0) {
    number = teacher > 0 ? teacher - 1 : 0;
    numberVia = 'fallback';
  }

  // Link-column labels live in the rows at/above the label row.
  const link = { mp3: -1, mp4: -1, original: -1, minicourse: -1, youtube: -1 };
  const linkLabel = {};
  const rules = [
    ['mp3', /mp3/i],
    ['mp4', /mp4/i],
    ['original', /វ[ីិ]ដេអូដើម/],
    ['minicourse', /video\s+for\s+minicourse/i],
    ['youtube', /យូធូប|youtube/i],
  ];
  for (let r = 0; r <= hr; r++) {
    const row = text[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = norm(row[c]);
      if (!t || isUrlish(t)) continue;
      for (const [k, re] of rules) {
        if (link[k] < 0 && re.test(t)) {
          link[k] = c;
          linkLabel[k] = outer(row[c]);
        }
      }
    }
  }
  return {
    number, numberVia, teacher, title, lessonCode, videoCode, link,
    labelOf: {
      number: outer((text[hr] || [])[number]),
      title: outer((text[hr] || [])[title]),
      teacher: outer((text[hr] || [])[teacher]),
      lessonCode: lessonCode >= 0 ? outer(text[hr][lessonCode]) : '',
      videoCode: videoCode >= 0 ? outer(text[hr][videoCode]) : '',
      ...linkLabel,
    },
  };
}

// ── one tab ──────────────────────────────────────────────────────────────────

/**
 * Parse one tab grid → { status, reason, headerRow, cols, lessons[], unnumbered[] }.
 * grid = { text: string[][], links: string[][] } (row 0 = sheet row 1).
 */
export function parseTab(grid) {
  const text = grid.text || [];
  const links = grid.links || [];
  if (text.length === 0 || text.every((r) => (r || []).every((c) => outer(c) === ''))) {
    return { status: 'skipped', reason: 'empty tab', headerRow: -1, lessons: [], unnumbered: [] };
  }
  const hr = findHeaderRow(text);
  if (hr < 0) {
    return { status: 'skipped', reason: 'no header row (no ចំណងជើង មេរៀន label with ឈ្មោះគ្រូ / លេខកូដមេរៀន)', headerRow: -1, lessons: [], unnumbered: [] };
  }
  const cols = mapColumns(text, hr);
  const cell = (r, c) => (c >= 0 ? (text[r] || [])[c] ?? '' : '');
  const lnk = (r, c) => (c >= 0 ? (links[r] || [])[c] ?? '' : '');
  const lessons = [];
  const unnumbered = [];

  for (let r = hr + 1; r < text.length; r++) {
    const row = text[r] || [];
    if (row.every((c) => outer(c) === '')) continue;
    const num = outer(cell(r, cols.number));
    if (!NUM_RE.test(norm(num))) {
      if (outer(cell(r, cols.title)) !== '' || outer(cell(r, cols.lessonCode)) !== '') unnumbered.push(r + 1);
      continue;
    }
    const idsFor = (k) => driveIds(cell(r, cols.link[k]), lnk(r, cols.link[k]));
    const folder = ['mp3', 'mp4', 'original', 'minicourse'].some((k) => hasFolderLink(cell(r, cols.link[k]), lnk(r, cols.link[k])));
    const all = row.map((c, i) => `${c} ${(links[r] || [])[i] ?? ''}`).join(' ');
    lessons.push({
      row: r + 1,
      number: num,
      teacher: outer(cell(r, cols.teacher)),
      title: outer(cell(r, cols.title)),
      lesson_code: outer(cell(r, cols.lessonCode)),
      video_code: outer(cell(r, cols.videoCode)),
      mp3: idsFor('mp3'),
      mp4: idsFor('mp4'),
      original: idsFor('original'),
      minicourse: idsFor('minicourse'),
      acast: /acast\.com/i.test(all),
      youtube: /youtu(\.be|be\.com)/i.test(all),
      folder_link: folder,
    });
  }
  if (lessons.length === 0) {
    return { status: 'skipped', reason: 'header row found but no numbered lesson rows', headerRow: hr + 1, cols, lessons, unnumbered };
  }
  return { status: 'ok', reason: '', headerRow: hr + 1, cols, lessons, unnumbered };
}

// ── whole catalogue ──────────────────────────────────────────────────────────

/** Cut-file class from the cut MP3 / MP4 ids. */
export function cutClass(l) {
  const a = l.mp3.length > 0;
  const b = l.mp4.length > 0;
  return a && b ? 'both' : a ? 'mp3_only' : b ? 'mp4_only' : 'none';
}
const anyDrive = (l) => l.mp3.length + l.mp4.length + l.original.length + l.minicourse.length > 0;
const allIds = (l) => [...l.mp3, ...l.mp4, ...l.original, ...l.minicourse];

/**
 * files = [{ file_id, file_name, tabs: [{ name, text, links }] }]
 * → { rows[], tabs[], variants, dupCodes, dupIds }
 */
export function buildCatalogue(files) {
  const rows = [];
  const tabs = [];
  const variants = {};
  const bump = (kind, label) => {
    if (!label) return;
    variants[kind] ??= new Map();
    variants[kind].set(label, (variants[kind].get(label) || 0) + 1);
  };

  for (const f of files) {
    for (const t of f.tabs) {
      const p = parseTab(t);
      const info = {
        file_id: f.file_id, file_name: f.file_name, tab: t.name, status: p.status, reason: p.reason,
        headerRow: p.headerRow, lessons: p.lessons.length, unnumbered: p.unnumbered,
      };
      tabs.push(info);
      if (p.status !== 'ok') continue;
      const lo = p.cols.labelOf;
      bump('number', p.cols.numberVia === 'fallback' ? `(no ល.រ label — used column ${p.cols.number + 1}) ${lo.number}` : lo.number);
      for (const k of ['title', 'teacher', 'lessonCode', 'videoCode', 'mp3', 'mp4', 'original', 'minicourse', 'youtube']) bump(k, lo[k]);
      for (const l of p.lessons) {
        rows.push({ file_id: f.file_id, file_name: f.file_name, tab: t.name, ...l, flags: [] });
      }
    }
  }

  // global passes: duplicate codes / Drive ids, then per-row flags
  const byCode = new Map();
  const byId = new Map();
  rows.forEach((r, i) => {
    if (r.lesson_code) byCode.set(r.lesson_code, [...(byCode.get(r.lesson_code) || []), i]);
    for (const id of new Set(allIds(r))) byId.set(id, [...(byId.get(id) || []), i]);
  });
  const dupCodes = [...byCode].filter(([, v]) => v.length > 1).map(([code, idx]) => ({ code, rows: idx.map((i) => rows[i]) }));
  const dupIds = [...byId].filter(([, v]) => v.length > 1).map(([id, idx]) => ({ id, rows: idx.map((i) => rows[i]) }));
  const dupCodeSet = new Set(dupCodes.map((d) => d.code));
  const dupIdSet = new Set(dupIds.map((d) => d.id));

  for (const r of rows) {
    const c = cutClass(r);
    if (!r.lesson_code) r.flags.push('no_code');
    if (!anyDrive(r)) r.flags.push('no_drive_file');
    r.flags.push(c === 'none' ? 'no_cut_file' : c);
    if (r.lesson_code && dupCodeSet.has(r.lesson_code)) r.flags.push('dup_code');
    if (allIds(r).some((id) => dupIdSet.has(id))) r.flags.push('dup_drive');
    if ([r.mp3, r.mp4, r.original, r.minicourse].some((a) => a.length > 1)) r.flags.push('multi_id');
    if (r.folder_link && !anyDrive(r)) r.flags.push('folder_link_only');
  }
  return { rows, tabs, variants, dupCodes, dupIds };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = [
  'file_name', 'file_id', 'tab', 'row', 'number', 'teacher', 'title', 'lesson_code', 'video_code',
  'mp3_drive_id', 'mp4_drive_id', 'minicourse_drive_id', 'original_drive_id', 'acast', 'youtube', 'flags',
];
const q = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Several ids in one cell are joined with "|" (flagged multi_id). */
export function renderCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.file_name, r.file_id, r.tab, r.row, r.number, r.teacher, r.title, r.lesson_code, r.video_code,
      r.mp3.join('|'), r.mp4.join('|'), r.minicourse.join('|'), r.original.join('|'),
      r.acast ? 'yes' : 'no', r.youtube ? 'yes' : 'no', r.flags.join(' '),
    ].map(q).join(','));
  }
  return lines.join('\n') + '\n';
}

// ── pilot check ──────────────────────────────────────────────────────────────

/** Parse the queue CSV (header optional) into ordered ids. */
export function parseQueueIds(csv) {
  return String(csv || '').split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter((l) => l && l !== 'drive_file_id' && !l.startsWith('#'));
}

/**
 * Compare the pilot course's tab with the pilot queue. Facts only.
 * tabMatch = substring of the tab name (Excel cuts tab names at 31 characters).
 */
export function pilotCheck(cat, queueIds, tabMatch) {
  const needle = norm(tabMatch);
  const tabs = cat.tabs.filter((t) => norm(t.tab).includes(needle));
  const lessons = cat.rows.filter((r) => tabs.some((t) => t.file_id === r.file_id && t.tab === r.tab));
  const where = (id) => {
    const hits = [];
    for (const l of lessons) {
      for (const k of ['mp3', 'mp4', 'minicourse', 'original']) if (l[k].includes(id)) hits.push({ number: l.number, column: k, lesson: l });
    }
    return hits;
  };
  const queue = queueIds.map((id, i) => {
    const hits = where(id);
    const elsewhere = hits.length === 0 ? cat.rows.filter((r) => allIds(r).includes(id) && !lessons.includes(r)) : [];
    return { line: i + 1, id, hits, elsewhere };
  });
  const sheetIds = new Set(lessons.flatMap(allIds));
  const queueSet = new Set(queueIds);
  const byColumn = { mp3: 0, mp4: 0, minicourse: 0, original: 0, none: 0 };
  for (const e of queue) {
    if (e.hits.length === 0) byColumn.none += 1;
    else for (const k of new Set(e.hits.map((h) => h.column))) byColumn[k] += 1;
  }
  return {
    tabs, lessons, queue, byColumn,
    sheetIdsNotInQueue: [...sheetIds].filter((id) => !queueSet.has(id)),
  };
}

// ── report ───────────────────────────────────────────────────────────────────

const CAP = 100;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const loc = (r) => `${r.file_name || r.file_id} › ${r.tab} › row ${r.row} (no. ${r.number})`;

export function renderReport(cat, pilot, opts = {}) {
  const L = [];
  const ok = cat.tabs.filter((t) => t.status === 'ok');
  const skipped = cat.tabs.filter((t) => t.status !== 'ok');
  const files = new Set(cat.tabs.map((t) => t.file_id));
  const rows = cat.rows;
  const count = (f) => rows.filter(f).length;

  L.push('# Teacher-sheet catalogue report (draft)');
  L.push('');
  L.push('REPORT ONLY. Generated by `scripts/catalogue/sheets-map.mjs` from `data/source/sheets/*.xlsx`.');
  L.push('It changes no app data and no build input. Every value is copied from a cell (outer whitespace');
  L.push('trimmed only); nothing is invented. One course = one tab. The per-lesson rows are in');
  L.push('`catalogue-draft.csv` (filter its `flags` column to list any group below).');
  L.push('');
  if (opts.unmappedTeacherFiles && opts.unmappedTeacherFiles.length) {
    L.push('## ERRORS (the catalogue job fails)');
    L.push('');
    for (const u of opts.unmappedTeacherFiles) {
      L.push(`- **ERROR** sheet file «${esc(u.file_name || '(no name)')}» · id \`${u.file_id}\` has no teacher. Add it to \`data/source/file-aliases.json\` (new id → old id) or to \`data/teacher-files.json\`.`);
    }
    L.push('');
  }
  L.push('## Summary');
  L.push('');
  L.push(`- Files: **${files.size}** · tabs: **${cat.tabs.length}** (read: **${ok.length}**, skipped: **${skipped.length}**)`);
  L.push(`- Lessons: **${rows.length}**`);
  L.push(`- No lesson code: **${count((r) => r.flags.includes('no_code'))}**`);
  L.push(`- No Drive file at all (no id in the MP3 / MP4 / MiniCourse / original columns): **${count((r) => r.flags.includes('no_drive_file'))}**`);
  L.push(`- Cut files — both MP3+MP4: **${count((r) => cutClass(r) === 'both')}** · MP3 only: **${count((r) => cutClass(r) === 'mp3_only')}** · MP4 only: **${count((r) => cutClass(r) === 'mp4_only')}** · neither cut file: **${count((r) => cutClass(r) === 'none')}**`);
  L.push(`  - of those with no cut file, a MiniCourse/original Drive id exists on: **${count((r) => cutClass(r) === 'none' && anyDrive(r))}**`);
  L.push(`- Acast present: **${count((r) => r.acast)}** · YouTube present: **${count((r) => r.youtube)}**`);
  L.push(`- Duplicate lesson codes: **${cat.dupCodes.length}** codes · duplicate Drive ids: **${cat.dupIds.length}** ids`);
  L.push(`- Rows with several Drive ids in one cell: **${count((r) => r.flags.includes('multi_id'))}** · lessons whose only link is a Drive folder: **${count((r) => r.flags.includes('folder_link_only'))}**`);
  L.push('');

  // totals per teacher
  L.push('## Totals per teacher');
  L.push('');
  const byTeacher = new Map();
  for (const r of rows) byTeacher.set(r.teacher || '(blank)', (byTeacher.get(r.teacher || '(blank)') || 0) + 1);
  L.push('| teacher (as written in the sheet) | lessons |');
  L.push('| --- | --- |');
  for (const [t, n] of [...byTeacher].sort((a, b) => b[1] - a[1])) L.push(`| ${esc(t)} | ${n} |`);
  L.push('');

  // per course (tab)
  L.push('## Totals per course (one tab = one course)');
  L.push('');
  L.push('| file | tab | header row | lessons | no code | no Drive file | MP3 only | MP4 only | both | neither cut | Acast | YouTube |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of ok) {
    const rs = rows.filter((r) => r.file_id === t.file_id && r.tab === t.tab);
    const n = (f) => rs.filter(f).length;
    L.push(`| ${esc(t.file_name || t.file_id)} | ${esc(t.tab)} | ${t.headerRow} | ${rs.length} | ${n((r) => r.flags.includes('no_code'))} | ${n((r) => r.flags.includes('no_drive_file'))} | ${n((r) => cutClass(r) === 'mp3_only')} | ${n((r) => cutClass(r) === 'mp4_only')} | ${n((r) => cutClass(r) === 'both')} | ${n((r) => cutClass(r) === 'none')} | ${n((r) => r.acast)} | ${n((r) => r.youtube)} |`);
  }
  L.push('');

  // duplicates
  const dupSection = (title, items, fmt) => {
    L.push(`## ${title}`);
    L.push('');
    if (items.length === 0) { L.push('None.'); L.push(''); return; }
    for (const it of items.slice(0, CAP)) L.push(`- ${fmt(it)}`);
    if (items.length > CAP) L.push(`- … ${items.length - CAP} more (filter the CSV \`flags\` column)`);
    L.push('');
  };
  dupSection('Duplicate lesson codes', cat.dupCodes, (d) => `\`${d.code}\` — ${d.rows.map(loc).join(' · ')}`);
  dupSection('Duplicate Drive ids (same id on more than one lesson row)', cat.dupIds, (d) => `\`${d.id}\` — ${d.rows.map(loc).join(' · ')}`);

  // lessons with no code, by tab (the full list is the CSV)
  L.push('## Lessons with no code, by course');
  L.push('');
  const noCodeByTab = ok.map((t) => ({ t, n: rows.filter((r) => r.file_id === t.file_id && r.tab === t.tab && r.flags.includes('no_code')).length })).filter((x) => x.n > 0);
  if (noCodeByTab.length === 0) L.push('None.');
  else for (const { t, n } of noCodeByTab) L.push(`- ${esc(t.file_name || t.file_id)} › ${esc(t.tab)}: ${n}`);
  L.push('');

  // skipped tabs
  L.push('## Tabs skipped, and why');
  L.push('');
  if (skipped.length === 0) L.push('None.');
  else {
    L.push('| file | tab | why |');
    L.push('| --- | --- | --- |');
    for (const t of skipped) L.push(`| ${esc(t.file_name || t.file_id)} | ${esc(t.tab)} | ${esc(t.reason)} |`);
  }
  L.push('');
  const unn = ok.filter((t) => t.unnumbered.length > 0);
  if (unn.length) {
    L.push('Rows with a title or code but NO lesson number (treated as course/section rows, not lessons):');
    L.push('');
    for (const t of unn) L.push(`- ${esc(t.file_name || t.file_id)} › ${esc(t.tab)}: rows ${t.unnumbered.slice(0, 12).join(', ')}${t.unnumbered.length > 12 ? ` … (+${t.unnumbered.length - 12})` : ''}`);
    L.push('');
  }

  // header variants
  L.push('## Header variants found');
  L.push('');
  const kindName = {
    number: 'number (ល.រ)', title: 'title', teacher: 'teacher', lessonCode: 'lesson code', videoCode: 'video code',
    mp3: 'cut MP3 link', mp4: 'cut MP4 link', original: 'original video link', minicourse: 'MiniCourse link', youtube: 'YouTube link',
  };
  for (const k of Object.keys(kindName)) {
    const m = cat.variants[k];
    L.push(`- **${kindName[k]}**: ${m && m.size ? [...m].map(([label, n]) => `\`${label}\` ×${n}`).join(' · ') : '(none found)'}`);
  }
  L.push('');

  // pilot
  if (pilot) {
    L.push('## Pilot check');
    L.push('');
    L.push(`Tab(s) matching the pilot course: ${pilot.tabs.length === 0 ? '**NONE FOUND**' : pilot.tabs.map((t) => `\`${esc(t.tab)}\` (${esc(t.file_name || t.file_id)}, ${t.lessons} lessons, header row ${t.headerRow})`).join(' · ')}`);
    L.push('');
    if (pilot.lessons.length) {
      L.push('Sheet lessons (codes exactly as in the sheet):');
      L.push('');
      L.push('| no. | row | lesson code | video code | cut MP3 id | cut MP4 id | MiniCourse id | original id |');
      L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const l of pilot.lessons) L.push(`| ${esc(l.number)} | ${l.row} | ${esc(l.lesson_code) || '—'} | ${esc(l.video_code) || '—'} | ${l.mp3.join('<br>') || '—'} | ${l.mp4.join('<br>') || '—'} | ${l.minicourse.join('<br>') || '—'} | ${l.original.join('<br>') || '—'} |`);
      L.push('');
    }
    L.push(`Queue (\`${opts.queuePath || 'data/audio-queue.pilot.csv'}\`): **${pilot.queue.length}** ids. Where each queue id sits in the sheet:`);
    L.push('');
    L.push('| queue line | Drive id | found in column (lesson no.) | lesson code |');
    L.push('| --- | --- | --- | --- |');
    for (const e of pilot.queue) {
      const found = e.hits.length
        ? e.hits.map((h) => `${{ mp3: 'cut MP3', mp4: 'cut MP4', minicourse: 'MiniCourse', original: 'original' }[h.column]} (no. ${esc(h.number)})`).join(', ')
        : e.elsewhere.length ? `not in this tab; found elsewhere: ${e.elsewhere.map(loc).join(' · ')}` : '**not found in the sheets**';
      const code = e.hits[0] ? esc(e.hits[0].lesson.lesson_code) || '—' : '—';
      L.push(`| ${e.line} | \`${e.id}\` | ${found} | ${code} |`);
    }
    L.push('');
    const b = pilot.byColumn;
    L.push(`Summary: queue ids found in the cut-MP3 column **${b.mp3}**, cut-MP4 column **${b.mp4}**, MiniCourse column **${b.minicourse}**, original column **${b.original}**, not found in the pilot tab **${b.none}**.`);
    if (pilot.sheetIdsNotInQueue.length) L.push(`Pilot-tab Drive ids that are NOT in the queue: ${pilot.sheetIdsNotInQueue.length} (e.g. ${pilot.sheetIdsNotInQueue.slice(0, 3).map((i) => `\`${i}\``).join(', ')}).`);
    L.push('');
  }
  L.push('---');
  L.push('Stopped after the report: no codes or ids were assigned, and nothing was written to the app or the build.');
  return L.join('\n') + '\n';
}

// ── reading real workbooks (xlsx is a CI-side dependency) ────────────────────

/** Sheet → { text, links } grids (row 0 = sheet row 1). */
export function sheetToGrid(XLSX, ws) {
  if (!ws || !ws['!ref']) return { text: [], links: [] };
  const rng = XLSX.utils.decode_range(ws['!ref']);
  const text = [];
  const links = [];
  for (let r = 0; r <= rng.e.r; r++) {
    const tr = [];
    const lr = [];
    for (let c = 0; c <= rng.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let t = '';
      if (cell) t = cell.t === 's' || cell.t === 'str' ? String(cell.v ?? '') : (cell.w ?? String(cell.v ?? ''));
      tr.push(t);
      lr.push(cell && cell.l && cell.l.Target ? String(cell.l.Target) : '');
    }
    text.push(tr);
    links.push(lr);
  }
  return { text, links };
}

/** "## <name>.xlsx" + "- Drive file id: `<id>`" pairs from INVENTORY.md → Map<id,name>. */
export function parseInventoryNames(md) {
  const map = new Map();
  let name = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^## (?!#)(.+)$/.exec(line);
    if (h) { name = h[1].trim(); continue; }
    const m = /^- Drive file id: `([^`]+)`/.exec(line);
    if (m && name) { map.set(m[1], name); name = null; }
  }
  return map;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const dir = arg('dir', 'data/source/sheets');
  const out = arg('out', dir);
  const queuePath = arg('queue', 'data/audio-queue.pilot.csv');
  const pilotTab = arg('pilot', 'វេស្សន្តរជាត');
  if (!existsSync(dir)) { console.error(`sheets dir not found: ${dir}`); process.exit(1); }

  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    console.error('The `xlsx` reader is not installed. Run:  npm install --no-save xlsx@0.18.5');
    process.exit(1);
  }

  const invPath = join(dir, 'INVENTORY.md');
  const names = existsSync(invPath) ? parseInventoryNames(readFileSync(invPath, 'utf-8')) : new Map();
  const aliases = loadAliases(process.cwd());
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    if (extname(f).toLowerCase() !== '.xlsx') continue;
    const id = basename(f, extname(f));
    const wb = XLSX.readFile(join(dir, f));
    files.push({
      file_id: id,
      file_name: names.get(id) ?? names.get(canonicalFileId(id, aliases)) ?? '',
      tabs: wb.SheetNames.map((n) => ({ name: n, ...sheetToGrid(XLSX, wb.Sheets[n]) })),
    });
  }

  const cat = buildCatalogue(files);
  const queueIds = existsSync(queuePath) ? parseQueueIds(readFileSync(queuePath, 'utf-8')) : [];
  const pilot = pilotCheck(cat, queueIds, pilotTab);
  // Part B: a course sheet with no teacher (after aliases) is an ERROR.
  const root = process.cwd();
  const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
  const { unmappedTeacherFiles } = await import('./catalogue-build.mjs');
  const unmapped = unmappedTeacherFiles(files, {
    teacherFiles: readJson(join(root, 'data', 'teacher-files.json'), { files: {} }).files || {},
    teachers: readJson(join(root, 'data', 'source', 'teachers-2026-11-02', 'teachers-2026-11-02.json'), []),
    aliases,
  });
  writeFileSync(join(out, 'catalogue-draft.csv'), renderCsv(cat.rows), 'utf-8');
  writeFileSync(join(out, 'CATALOGUE-REPORT.md'), renderReport(cat, pilot, { queuePath, unmappedTeacherFiles: unmapped }), 'utf-8');
  console.log(`files ${files.length} · tabs ${cat.tabs.length} (skipped ${cat.tabs.filter((t) => t.status !== 'ok').length}) · lessons ${cat.rows.length}`);
  console.log(`wrote ${join(out, 'catalogue-draft.csv')} and ${join(out, 'CATALOGUE-REPORT.md')}`);
  if (unmapped.length) {
    for (const u of unmapped) console.error(`::error::no teacher for sheet file ${u.file_id} (${u.file_name || 'no name'}) — add to data/source/file-aliases.json`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('sheets-map.mjs')) main();
