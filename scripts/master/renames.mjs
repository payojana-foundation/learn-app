/**
 * scripts/master/renames.mjs — PART 9 (17 Nov): class and lesson renames from the master sheet
 * (.github/workflows/class-renames.yml, hourly).
 *
 * TEAM columns (columns.json, added at the END of their tab by this job):
 *   Courses.title_km_new    the new course title; Lessons.lesson_title_new   the new lesson title.
 * For a filled cell: validate (not blank, no leading/trailing space, for a course not the title
 * or old title of another course, not the same as now). The text is used EXACTLY as typed (never
 * trimmed, normalised or "corrected"). Valid →
 *   course: Courses.course_title_km and the course_title_km of every Lessons row of the course;
 *   lesson: Lessons.lesson_title;
 *   the old title becomes a search alias (data/master/title-aliases.json: courses by course_id,
 *   lessons by row_key), the _new cell is cleared, issues gets "renamed <date>: old → new" (a
 *   course rename: on every Lessons row of the course — the Courses tab has no issues column).
 * Invalid → the cell stays, issues gets "CHECK: rename: <reason>".
 * course_id, row_key and lesson_id never change (lesson_id comes from the code / source, not the
 * title). The log is kept in data/ops/renames.json so master-sync keeps it in Lessons issues.
 *
 * CLI (env ACCESS_TOKEN): plan --sheet-id <id> | write --sheet-id <id>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTab, writeRanges } from './sync.mjs';
import { colLetter } from './seed.mjs';
import { allLessonColumns, allCourseColumns } from './export.mjs';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
export const ALIASES = 'data/master/title-aliases.json';
export const LOG = 'data/ops/renames.json';
const LOG_RE = /^(renamed \d{4}-\d{2}-\d{2}: |CHECK: rename: )/;

/** Why a new title is not usable, or null. Pure. Never changes the text. */
export function invalidTitle(next, current) {
  const s = String(next ?? '');
  if (s.trim() === '') return 'blank';
  if (/^[\s\u200B\uFEFF]|[\s\u200B\uFEFF]$/.test(s)) return 'leading or trailing space';
  if (s === String(current ?? '')) return 'same as the current title';
  return null;
}

/** The rename notes in an issues text. Pure. */
export const renameParts = (issues) => String(issues || '').split('; ').filter((p) => LOG_RE.test(p));

/** issues text with its rename notes replaced by \`texts\` (order-insensitive no-op). Pure. */
export function withRenameLog(issues, texts) {
  const want = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  const have = renameParts(issues);
  if (have.length === want.length && want.every((w) => have.includes(w))) return String(issues ?? '');
  const parts = String(issues || '').split('; ').filter((p) => p && !LOG_RE.test(p));
  return [...parts, ...want].join('; ');
}

const objects = (sheet) => sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));
const addAlias = (map, key, old) => {
  if (!old) return;
  const list = map[key] || [];
  if (!list.includes(old)) map[key] = [...list, old];
};

/**
 * -> { cells: [{tab, row, column, to}], aliases, log, applied: [...], refused: [...] }
 * aliases = { courses: {cid: [old]}, lessons: {row_key: [old]} }
 * log     = { courses: {cid: text}, lessons: {row_key: text} } — the note each Lessons row carries
 *           in issues: its course's (on every row of the course) and its own.
 */
export function planRenames({ lessonsTab, coursesTab, aliases = {}, log = {}, date }) {
  const A = { courses: { ...(aliases.courses || {}) }, lessons: { ...(aliases.lessons || {}) } };
  const LG = { courses: { ...(log.courses || {}) }, lessons: { ...(log.lessons || {}) } };
  const cells = [];
  const applied = [];
  const refused = [];
  const courses = objects(coursesTab);
  const lessons = objects(lessonsTab);
  const has = (sheet, k) => sheet.header.includes(k);
  const set = (tab, row, column, to) => cells.push({ tab, row, column, to });
  const lessonTitle = new Map(); // row index -> new course title for that row (course rename)

  // ── courses ──
  const titleOf = new Map(courses.filter((c) => c.course_id).map((c) => [c.course_id, c.course_title_km ?? '']));
  const pendingNew = new Map();
  for (const c of courses) if (c.course_id && String(c.title_km_new ?? '') !== '') pendingNew.set(c.course_id, c.title_km_new);
  courses.forEach((c, i) => {
    const cid = c.course_id;
    if (!cid || !has(coursesTab, 'title_km_new')) return;
    const row = i + 2;
    const next = c.title_km_new ?? '';
    if (next === '') {
      if (LG.courses[cid] && LG.courses[cid].startsWith('CHECK: rename: ')) delete LG.courses[cid];
      return;
    }
    let why = invalidTitle(next, c.course_title_km);
    if (!why) {
      const clash = [...titleOf].some(([id, t]) => id !== cid && t === next)
        || [...pendingNew].some(([id, t]) => id !== cid && t === next)
        || Object.entries(A.courses).some(([id, list]) => id !== cid && list.includes(next));
      if (clash) why = 'duplicate course title';
    }
    if (why) {
      LG.courses[cid] = `CHECK: rename: ${why}`;
      refused.push({ kind: 'course', key: cid, reason: why });
      return;
    }
    const old = c.course_title_km ?? '';
    addAlias(A.courses, cid, old);
    LG.courses[cid] = `renamed ${date}: ${old} → ${next}`;
    set('Courses', row, 'course_title_km', next);
    set('Courses', row, 'title_km_new', '');
    lessons.forEach((l, j) => { if (l.course_id === cid && l.course_title_km !== next) lessonTitle.set(j, next); });
    titleOf.set(cid, next);
    applied.push({ kind: 'course', key: cid, old, next });
  });

  // ── lessons ──
  lessons.forEach((l, j) => {
    const rk = l.row_key;
    if (!rk) return;
    const row = j + 2;
    if (lessonTitle.has(j)) set('Lessons', row, 'course_title_km', lessonTitle.get(j));
    if (has(lessonsTab, 'lesson_title_new')) {
      const next = l.lesson_title_new ?? '';
      if (next === '') {
        if (LG.lessons[rk] && LG.lessons[rk].startsWith('CHECK: rename: ')) delete LG.lessons[rk];
      } else {
        const why = invalidTitle(next, l.lesson_title);
        if (why) {
          LG.lessons[rk] = `CHECK: rename: ${why}`;
          refused.push({ kind: 'lesson', key: rk, reason: why });
        } else {
          const old = l.lesson_title ?? '';
          addAlias(A.lessons, rk, old);
          LG.lessons[rk] = `renamed ${date}: ${old} → ${next}`;
          set('Lessons', row, 'lesson_title', next);
          set('Lessons', row, 'lesson_title_new', '');
          applied.push({ kind: 'lesson', key: rk, old, next });
        }
      }
    }
    // the notes this row must carry in issues (its course's, then its own)
    const want = [l.course_id && LG.courses[l.course_id], LG.lessons[rk]].filter(Boolean);
    const now = withRenameLog(l.issues, want);
    if (now !== String(l.issues ?? '')) set('Lessons', row, 'issues', now);
  });
  return { cells, aliases: A, log: LG, applied, refused };
}


/** Cells -> batchUpdate ranges (one cell each). Pure. */
export function renameRanges(lessonsTab, coursesTab, cells) {
  return cells.map((c) => {
    const sheet = c.tab === 'Courses' ? coursesTab : lessonsTab;
    const L = colLetter(sheet.header.indexOf(c.column));
    return { range: `${c.tab}!${L}${c.row}:${L}${c.row}`, values: [[c.to]] };
  });
}

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

/**
 * Add the missing `added_after_seed` columns at the END of a tab (header cells, and a dropdown when
 * columns.json has one). Only when the header is exactly a prefix of `keys` that covers every
 * seeded column. Returns the keys added ([] = nothing to do). Throws on any other header.
 */
export async function ensureTrailingColumns({ sheetId, token, tab, columns, fetchFn = fetch }) {
  const keys = columns.map((c) => c.key);
  const sheet = await readTab({ sheetId, token, tab, fetchFn });
  const n = sheet.header.length;
  const prefixOk = n <= keys.length && sheet.header.every((h, i) => h === keys[i]);
  if (!prefixOk || keys.slice(n).some((k) => !columns.find((c) => c.key === k).added_after_seed)) {
    if (n === keys.length && prefixOk) return [];
    throw new Error(`${tab} header is not the columns of columns.json: not adding columns`);
  }
  const missing = columns.slice(n);
  if (!missing.length) return [];
  const meta = await api(fetchFn, sheetId, token, 'GET', '?fields=sheets(properties(sheetId,title,gridProperties))');
  const s = (meta.sheets || []).find((x) => x.properties.title === tab);
  if (!s) throw new Error(`no ${tab} tab`);
  const gid = s.properties.sheetId;
  const grid = s.properties.gridProperties || {};
  const requests = [];
  if ((grid.columnCount || 0) < keys.length) requests.push({ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: keys.length - (grid.columnCount || 0) } });
  missing.forEach((c, k) => {
    if (!Array.isArray(c.dropdown)) return;
    requests.push({ setDataValidation: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: grid.rowCount || 1000, startColumnIndex: n + k, endColumnIndex: n + k + 1 }, rule: { condition: { type: 'ONE_OF_LIST', values: c.dropdown.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true } } });
  });
  if (requests.length) await api(fetchFn, sheetId, token, 'POST', ':batchUpdate', { requests });
  const range = `${tab}!${colLetter(n)}1:${colLetter(keys.length - 1)}1`;
  await api(fetchFn, sheetId, token, 'PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { range, values: [missing.map((c) => c.key)] });
  return missing.map((c) => c.key);
}

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf-8');
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const cmd = process.argv[2];
  const sheetId = arg('sheet-id', '');
  const token = process.env.ACCESS_TOKEN || '';
  if (!token || !/^[A-Za-z0-9_-]+$/.test(sheetId)) { console.error('needs --sheet-id and ACCESS_TOKEN'); process.exit(2); }
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (cmd === 'plan') {
    const columns = readJson('data/master/columns.json', {});
    const added = [
      ...(await ensureTrailingColumns({ sheetId, token, tab: 'Courses', columns: allCourseColumns(columns) })),
      ...(await ensureTrailingColumns({ sheetId, token, tab: 'Lessons', columns: allLessonColumns(columns) })),
    ];
    if (added.length) console.log(`columns added: ${added.join(', ')}`);
    const lessonsTab = await readTab({ sheetId, token, tab: 'Lessons' });
    const coursesTab = await readTab({ sheetId, token, tab: 'Courses' });
    const prevA = readJson(ALIASES, { courses: {}, lessons: {} });
    const prevL = readJson(LOG, { courses: {}, lessons: {} });
    const p = planRenames({ lessonsTab, coursesTab, aliases: prevA, log: prevL, date: new Date().toISOString().slice(0, 10) });
    const changed = JSON.stringify(p.aliases) !== JSON.stringify(prevA) || JSON.stringify(p.log) !== JSON.stringify(prevL);
    mkdirSync('data/ops', { recursive: true });
    if (changed) { writeJson(ALIASES, { _doc: 'Old titles kept as search aliases after a rename (scripts/master/renames.mjs): courses by course_id, lessons by row_key. Byte-exact.', courses: p.aliases.courses, lessons: p.aliases.lessons }); writeJson(LOG, p.log); }
    writeJson('renames-plan.json', { ranges: renameRanges(lessonsTab, coursesTab, p.cells) });
    const line = `class-renames: ${p.applied.length} applied (${p.applied.map((a) => `${a.kind} ${a.key}`).join(', ') || 'none'}), ${p.refused.length} refused (${p.refused.map((r) => `${r.kind} ${r.key}: ${r.reason}`).join(', ') || 'none'}), ${p.cells.length} cells`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
    out('changed', changed ? 'true' : 'false');
    out('cells', p.cells.length);
    out('applied', p.applied.length);
  } else if (cmd === 'write') {
    const { ranges } = readJson('renames-plan.json', { ranges: [] });
    const n = ranges.length ? await writeRanges({ sheetId, token, ranges }) : 0;
    console.log(`cells written: ${n}`);
  } else {
    console.error('Usage: renames.mjs plan|write --sheet-id <id>');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('renames.mjs')) main().catch((e) => { console.error(`::error title=class-renames::${e.message}`); process.exit(1); });
