/**
 * scripts/master/sync.mjs — master-sheet status sync (bulk 09 P4 / P5 of the 12 Nov run).
 *
 * Writes ONLY these SYSTEM columns, matched by `row_key`, and only the cells whose value
 * changed:
 *   Lessons: lesson_id, audio_status, learn_live, acast_embed, acast_episode_id, issues
 *   Courses: lesson_count
 * It never touches a TEAM column, never adds or deletes a row and never resizes a tab.
 * A sheet row without a row_key (added by the team) or with a duplicate row_key is left
 * alone and reported. Also writes public/ops/status.json (counts per course and status)
 * for the future dashboard; it is not read by the app (not under /data, not precached).
 *
 * How each value is computed (docs/master-sheet.md "Sync"):
 *   lesson_id        catalogue-build lessonIdOf(lesson_code, source id); the source id is the
 *                    Drive id of the link named by source_type, else pickSource (mp3 > mp4 >
 *                    minicourse). Empty when there is no source and no code.
 *   audio_status     data/media-manifest.json by source id: approved > needs review (id in
 *                    data/queues/failed-review.csv) > converted (any other entry) > not started.
 *   learn_live       yes when the lesson id is shown in public/data (course file), else no.
 *   acast_embed /    from the frozen teacher-sheet exports (data/source/sheets) by
 *   acast_episode_id source_file + source_tab + source_row; no match = the current value stays.
 *   issues           why the row is not shown today (build-courses shownRows), plus: hidden tab,
 *                    teacher pending, no title, no source, no code, acast embed missing,
 *                    source_type not set, and one 'CHECK: <reason>' per flag of the automatic
 *                    pre-approval check (data/queues/approve/precheck.json). Joined with '; '.
 *   lesson_count     Lessons rows with that course_id.
 *
 * Modes:
 *   dry   (default) computes the changes and writes reports/master-sync-preview.csv,
 *         reports/master-sync-report.md and public/ops/status.json. With ACCESS_TOKEN set it
 *         reads the live sheet; without one it reads data/master/lessons.csv + courses.csv
 *         (the export = the sheet as of the last export). Never writes the sheet.
 *   write reads the live sheet (ACCESS_TOKEN, scope spreadsheets) and writes the changed
 *         cells with values:batchUpdate (RAW), in chunks. Fails before writing anything if a
 *         header differs from data/master/columns.json.
 *
 * Usage: node scripts/master/sync.mjs [--mode dry|write] [--sheet-id <id>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { driveIds } from '../catalogue/sheets-map.mjs';
import { pickSource, lessonIdOf } from '../catalogue/catalogue-build.mjs';
import { shownRows } from '../build-courses.mjs';
import { parseCsvObjects, toCsv } from './csv.mjs';
import { colLetter } from './seed.mjs';
import { checksJson, failedMap, videoFailuresFrom } from './checks.mjs';
import { presentKeys, allLessonColumns, allCourseColumns } from './export.mjs';
import { intakePlan, applyToTab, intakeRanges, noFileLink, ISSUE_NO_FILE } from './intake.mjs';
export { presentKeys };

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
export const LESSON_SYNC_COLUMNS = ['lesson_id', 'audio_status', 'learn_live', 'acast_embed', 'acast_episode_id', 'issues'];
export const COURSE_SYNC_COLUMNS = ['lesson_count'];
export const BATCH_RANGES = 400; // ranges per values:batchUpdate request

const SOURCE_COL = { mp3: 'mp3_link', mp4: 'mp4_link', minicourse: 'minicourse_link' };

export class HeaderMismatchError extends Error {}

// ── pure computation ────────────────────────────────────────────────────────

/** The Drive source id of a master row (the source_type link, else mp3 > mp4 > minicourse). */
export function sourceIdOf(r) {
  const col = SOURCE_COL[r.source_type];
  if (col) return driveIds(r[col])[0] || null;
  return pickSource({ mp3: driveIds(r.mp3_link), mp4: driveIds(r.mp4_link), minicourse: driveIds(r.minicourse_link) }).id;
}

/** audio_status by source id (same rule as the seed, data/master/columns.json). */
export function audioStatus(sourceId, approved, failedReview, inManifest) {
  if (sourceId && approved.has(sourceId)) return 'approved';
  if (sourceId && failedReview.has(sourceId)) return 'needs review';
  if (sourceId && inManifest.has(sourceId)) return 'converted';
  return 'not started';
}

/**
 * The SYSTEM values every row should have now.
 *   ctx = { manifest, failedReview:Set, shownLessonIds:Set('course|lesson'), acastBySource:Map }
 * Returns { lessons: Map(row_key -> {col: value}), courses: Map(course_id -> {lesson_count}) }.
 */
export function computeSystem(lessonRows, courseRows, ctx) {
  const { manifest = [], failedReview = new Set(), shownLessonIds = new Set(), acastBySource = new Map(), checkFlags = new Map(), decisions = {}, intakeIssues = new Map(), failedReasons = new Map(), renameLog = { courses: {}, lessons: {} } } = ctx;
  const approved = new Set(manifest.filter((e) => e && e.drive_file_id && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
  const inManifest = new Set(manifest.filter((e) => e && e.drive_file_id).map((e) => e.drive_file_id));
  const { hidden } = shownRows(lessonRows, manifest);
  const pendingCourse = new Set(courseRows.filter((c) => c.teacher === 'pending').map((c) => c.course_id));
  const lessons = new Map();
  const counts = new Map();
  for (const r of lessonRows) {
    if (!r.row_key) continue;
    if (r.course_id) counts.set(r.course_id, (counts.get(r.course_id) || 0) + 1);
    const src = sourceIdOf(r);
    const lessonId = lessonIdOf({ lesson_code: r.lesson_code }, src) || '';
    const acast = acastBySource.get(`${r.source_file}\t${r.source_tab}\t${r.source_row}`);
    const embed = acast ? acast.acast_embed : r.acast_embed;
    const episode = acast ? acast.acast_episode_id : r.acast_episode_id;
    const issues = [];
    if (!r.course_id) issues.push('hidden tab');
    else if (hidden.has(r)) issues.push(hidden.get(r));
    if (r.course_id && pendingCourse.has(r.course_id)) issues.push('teacher pending');
    if (!String(r.lesson_title ?? '').trim()) issues.push('no title');
    if (!lessonId) issues.push('no source, no code');
    if (r.acast_status === 'posted' && !embed && !episode) issues.push('acast embed missing');
    if (!r.source_type && src) issues.push('source_type not set');
    if ((r.course_id || !r.source_file) && noFileLink(r)) issues.push(ISSUE_NO_FILE);
    for (const x of intakeIssues.get(r.row_key) || []) issues.push(x);
    if (src && failedReasons.get(src) && !inManifest.has(src)) issues.push(`CONVERSION FAILED: ${failedReasons.get(src)}`);
    for (const reason of (src && checkFlags.get(src)) || []) issues.push(`CHECK: ${reason}`);
    if (r.course_id && renameLog.courses && renameLog.courses[r.course_id]) issues.push(renameLog.courses[r.course_id]);
    if (renameLog.lessons && renameLog.lessons[r.row_key]) issues.push(renameLog.lessons[r.row_key]);
    const dec = decisions[r.row_key];
    if (dec && dec.decision) issues.push(`DECISION: ${dec.decision} (${dec.at}): ${dec.result}`);
    lessons.set(r.row_key, {
      lesson_id: lessonId,
      audio_status: audioStatus(src, approved, failedReview, inManifest),
      learn_live: shownLessonIds.has(`${r.course_id}|${lessonId}`) ? 'yes' : 'no',
      acast_embed: embed ?? '',
      acast_episode_id: episode ?? '',
      issues: issues.join('; '),
    });
  }
  const courses = new Map(courseRows.filter((c) => c.course_id).map((c) => [c.course_id, { lesson_count: String(counts.get(c.course_id) || 0) }]));
  return { lessons, courses };
}

/**
 * Cell changes. sheet = { header: string[], rows: string[][] } (row 0 = sheet row 2).
 * keyCol = 'row_key' | 'course_id'. Returns { changes: [{row, col, key, column, from, to}],
 * unkeyed: [sheet row numbers], duplicate: [keys] }. Only `allowed` columns are compared.
 */
export function diffTab(sheet, keyCol, wanted, allowed) {
  const ki = sheet.header.indexOf(keyCol);
  const seen = new Map();
  const unkeyed = [];
  sheet.rows.forEach((r, i) => {
    const k = String(r[ki] ?? '').trim();
    if (!k) {
      if (r.some((c) => String(c ?? '').trim() !== '')) unkeyed.push(i + 2);
      return;
    }
    seen.set(k, [...(seen.get(k) || []), i]);
  });
  const duplicate = [...seen].filter(([, v]) => v.length > 1).map(([k]) => k);
  const changes = [];
  for (const [k, idxs] of seen) {
    if (idxs.length > 1) continue; // never write an ambiguous row
    const want = wanted.get(k);
    if (!want) continue;
    const r = sheet.rows[idxs[0]];
    for (const column of allowed) {
      const c = sheet.header.indexOf(column);
      if (c < 0) continue;
      const from = String(r[c] ?? '');
      const to = String(want[column] ?? '');
      if (from !== to) changes.push({ row: idxs[0] + 2, col: c, key: k, column, from, to });
    }
  }
  return { changes, unkeyed, duplicate };
}

/** Group single-cell changes into ranges (same column, consecutive rows). */
export function toRanges(tab, changes) {
  const byCol = new Map();
  for (const ch of changes) byCol.set(ch.col, [...(byCol.get(ch.col) || []), ch]);
  const out = [];
  for (const [col, list] of byCol) {
    list.sort((a, b) => a.row - b.row);
    let run = [list[0]];
    const flush = () => {
      const a = run[0].row;
      const b = run[run.length - 1].row;
      const L = colLetter(col);
      out.push({ range: `${tab}!${L}${a}:${L}${b}`, values: run.map((x) => [x.to]) });
    };
    for (let i = 1; i < list.length; i++) {
      if (list[i].row === run[run.length - 1].row + 1) run.push(list[i]);
      else { flush(); run = [list[i]]; }
    }
    flush();
  }
  return out;
}

/** Counts per course and status (public/ops/status.json). */
export function statusJson(lessonRows, wanted, asOf) {
  const per = new Map();
  const blank = () => ({ lessons: 0, live: 0, audio: { 'not started': 0, converted: 0, 'needs review': 0, approved: 0 } });
  const totals = blank();
  for (const r of lessonRows) {
    const w = r.row_key && wanted.get(r.row_key);
    if (!w || !r.course_id) continue;
    if (!per.has(r.course_id)) per.set(r.course_id, blank());
    for (const t of [per.get(r.course_id), totals]) {
      t.lessons++;
      if (w.learn_live === 'yes') t.live++;
      t.audio[w.audio_status]++;
    }
  }
  return {
    version: 1,
    as_of: asOf,
    totals,
    courses: [...per].sort((a, b) => a[0].localeCompare(b[0])).map(([course_id, v]) => ({ course_id, ...v })),
  };
}

// ── sheet access ────────────────────────────────────────────────────────────

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

export async function readTab({ sheetId, token, tab, fetchFn = fetch }) {
  const v = await api(fetchFn, sheetId, token, 'GET', `/values/${encodeURIComponent(tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  const [header = [], ...rows] = v.values || [];
  return { header: header.map(String), rows: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))) };
}

/** Numeric gid of a tab (for a row link on the dashboard), or null. Never throws. */
export async function tabGid({ sheetId, token, tab, fetchFn = fetch }) {
  try {
    const m = await api(fetchFn, sheetId, token, 'GET', '?fields=sheets(properties(sheetId,title))');
    const s = (m.sheets || []).find((x) => x.properties && x.properties.title === tab);
    return s ? s.properties.sheetId : null;
  } catch {
    return null;
  }
}


export function checkHeader(tab, header, keys, optionalTail = []) {
  if (!presentKeys(header, keys, optionalTail)) {
    throw new HeaderMismatchError(`tab ${tab}: header differs from data/master/columns.json (expected ${keys.join(',')})`);
  }
}

/** Write the ranges in chunks. On an error: which tab, and how many ranges were written. */
export async function writeRanges({ sheetId, token, ranges, fetchFn = fetch }) {
  let done = 0;
  for (let i = 0; i < ranges.length; i += BATCH_RANGES) {
    const chunk = ranges.slice(i, i + BATCH_RANGES);
    try {
      await api(fetchFn, sheetId, token, 'POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: chunk });
    } catch (e) {
      throw new Error(`sync write stopped after ${done} of ${ranges.length} ranges (next: ${chunk[0].range}): ${e.message}`);
    }
    done += chunk.length;
  }
  return done;
}

// ── inputs from the repo ────────────────────────────────────────────────────

const objects = (sheet) => sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));
const fromCsv = (path) => {
  const rows = parseCsvObjects(readFileSync(path, 'utf-8'));
  const header = rows.length ? Object.keys(rows[0]) : [];
  return { header, rows: rows.map((o) => header.map((k) => o[k])) };
};

export function shownFromPublicData(root = process.cwd()) {
  const dir = join(root, 'public', 'data', 'courses');
  const set = new Set();
  if (!existsSync(dir)) return set;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    for (const l of c.lessons || []) set.add(`${c.id}|${l.id}`);
  }
  return set;
}

/** failed-review.csv reasons (column `reason`, when recorded): Map(id -> reason). */
export function failedReasonsFrom(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() || '').split(',');
  const ri = head.indexOf('reason');
  const m = new Map();
  if (ri < 0) return m;
  for (const l of lines) {
    const c = l.split(',');
    const reason = c.slice(ri).join(',').trim();
    if (c[0] && reason) m.set(c[0].trim(), reason);
  }
  return m;
}

function failedReviewSet(root) {
  const p = join(root, 'data', 'queues', 'failed-review.csv');
  return new Set(existsSync(p) ? readFileSync(p, 'utf-8').split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter((v) => v && v !== 'drive_file_id') : []);
}

async function acastFromTeacherSheets(root) {
  // The frozen teacher-sheet exports carry the embed cells; the seed reads them the same way.
  try {
    const { loadContext, loadFiles, buildMaster } = await import('./seed.mjs');
    const ctx = loadContext(root);
    const files = await loadFiles(join(root, 'data', 'source', 'sheets'), ctx.aliases);
    const { rows } = buildMaster(files, ctx);
    return new Map(rows.map((r) => [`${r.source_file}\t${r.source_tab}\t${r.source_row}`, { acast_embed: r.acast_embed, acast_episode_id: r.acast_episode_id }]));
  } catch (e) {
    console.warn(`acast columns kept as they are (teacher sheets not readable: ${e.message})`);
    return new Map();
  }
}

/** drive id -> flag reasons, from the pre-approval check (empty when it has not run). */
export function checkFlagsFrom(precheck) {
  const m = new Map();
  for (const f of (precheck && precheck.results && precheck.results.flagged) || []) if (f && f.id) m.set(f.id, f.reasons || []);
  return m;
}

function checkFlagsFile(root) {
  const p = join(root, 'data', 'queues', 'approve', 'precheck.json');
  return checkFlagsFrom(existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null);
}

function asOfDate(root) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'data/master/lessons.csv', 'data/media-manifest.json', 'public/data'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return iso ? new Date(iso).toISOString() : null;
  } catch {
    return null;
  }
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const root = process.cwd();
  const mode = arg('mode', 'dry');
  const sheetId = arg('sheet-id', '');
  const token = process.env.ACCESS_TOKEN || '';
  if (!['dry', 'write'].includes(mode)) { console.error(`--mode must be dry or write (got ${mode})`); process.exit(2); }
  if (mode === 'write' && (!token || !/^[A-Za-z0-9_-]+$/.test(sheetId))) { console.error('write needs --sheet-id and ACCESS_TOKEN'); process.exit(2); }
  const columns = JSON.parse(readFileSync(join(root, 'data', 'master', 'columns.json'), 'utf-8'));
  const lessonKeys = allLessonColumns(columns).map((c) => c.key);
  const lessonOptional = allLessonColumns(columns).filter((c) => c.added_after_seed).map((c) => c.key);
  const courseKeys = allCourseColumns(columns).map((c) => c.key);
  // never write a TEAM column, even if columns.json changed under us
  const sys = new Set([...allLessonColumns(columns), ...allCourseColumns(columns)].filter((c) => c.owner === 'SYSTEM').map((c) => c.key));
  for (const k of [...LESSON_SYNC_COLUMNS, ...COURSE_SYNC_COLUMNS]) if (!sys.has(k)) { console.error(`::error::${k} is not a SYSTEM column in columns.json`); process.exit(3); }

  const live = Boolean(token && sheetId);
  let lessonsTab;
  let coursesTab;
  try {
    lessonsTab = live ? await readTab({ sheetId, token, tab: 'Lessons' }) : fromCsv(join(root, 'data', 'master', 'lessons.csv'));
    coursesTab = live ? await readTab({ sheetId, token, tab: 'Courses' }) : fromCsv(join(root, 'data', 'master', 'courses.csv'));
    checkHeader('Lessons', lessonsTab.header, lessonKeys, lessonOptional);
    checkHeader('Courses', coursesTab.header, courseKeys, allCourseColumns(columns).filter((c) => c.added_after_seed).map((c) => c.key));
  } catch (e) {
    console.error(`::error title=master sync::${e.message}`);
    process.exit(e instanceof HeaderMismatchError ? 3 : 1);
  }
  // PART 3 intake: rows the team added get row_key / course_id / teacher / source_type, a new
  // course a Courses row and a registry id. Everything below sees the tab as the plan leaves it.
  const registryPath = join(root, 'data', 'course-ids.json');
  const registryFile = JSON.parse(readFileSync(registryPath, 'utf-8'));
  const teacherNames = new Set(JSON.parse(readFileSync(join(root, 'data', 'source', 'teachers-2026-11-02', 'teachers-2026-11-02.json'), 'utf-8')).map((x) => x.name_km));
  const titleAliases = existsSync(join(root, 'data', 'master', 'title-aliases.json')) ? JSON.parse(readFileSync(join(root, 'data', 'master', 'title-aliases.json'), 'utf-8')) : {};
  const intake = intakePlan({ lessonsTab, coursesTab, registry: registryFile.courses || {}, teacherNames, courseAliases: titleAliases.courses || {} });
  lessonsTab = applyToTab(lessonsTab, intake.cells);
  const lessonRows = objects(lessonsTab);
  const courseRows = [...objects(coursesTab), ...intake.newCourses];
  const manifest = JSON.parse(readFileSync(join(root, 'data', 'media-manifest.json'), 'utf-8'));
  const wanted = computeSystem(lessonRows, courseRows, {
    manifest, failedReview: failedReviewSet(root), shownLessonIds: shownFromPublicData(root), acastBySource: await acastFromTeacherSheets(root),
    checkFlags: checkFlagsFile(root),
    intakeIssues: intake.issues,
    renameLog: existsSync(join(root, 'data', 'ops', 'renames.json')) ? JSON.parse(readFileSync(join(root, 'data', 'ops', 'renames.json'), 'utf-8')) : { courses: {}, lessons: {} },
    failedReasons: failedReasonsFrom(existsSync(join(root, 'data', 'queues', 'failed-review.csv')) ? readFileSync(join(root, 'data', 'queues', 'failed-review.csv'), 'utf-8') : ''),
    decisions: existsSync(join(root, 'data', 'ops', 'check-decisions.json')) ? JSON.parse(readFileSync(join(root, 'data', 'ops', 'check-decisions.json'), 'utf-8')) : {},
  });
  const L = diffTab(lessonsTab, 'row_key', wanted.lessons, LESSON_SYNC_COLUMNS);
  const C = diffTab(coursesTab, 'course_id', wanted.courses, COURSE_SYNC_COLUMNS);
  for (const c of intake.newCourses) c.lesson_count = wanted.courses.get(c.course_id)?.lesson_count ?? '0';
  const intakeR = intakeRanges(lessonsTab, coursesTab, intake, colLetter, courseKeys);
  const ranges = [...intakeR, ...toRanges('Lessons', L.changes), ...toRanges('Courses', C.changes)];

  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports', 'master-sync-preview.csv'), toCsv(['tab', 'key', 'column', 'row', 'from', 'to'], [
    ...intake.cells.map((c) => ({ tab: 'Lessons', key: intake.assigned.find((a) => a.row === c.row)?.row_key ?? '', column: c.column, row: c.row, from: '', to: c.to })),
    ...intake.newCourses.map((c) => ({ tab: 'Courses', key: c.course_id, column: '(new row)', row: '', from: '', to: ` / ` })),
    ...L.changes.map((c) => ({ tab: 'Lessons', ...c })), ...C.changes.map((c) => ({ tab: 'Courses', ...c })),
  ]), 'utf-8');
  const byCol = {};
  for (const c of [...L.changes, ...C.changes]) byCol[c.column] = (byCol[c.column] || 0) + 1;
  const status = statusJson(lessonRows, wanted.lessons, asOfDate(root));
  const md = [
    '# Master sync report', '',
    `Source: ${live ? 'live sheet' : 'data/master export (no token: dry run on the last export)'}; mode ${mode}.`, '',
    `- Lessons rows: ${lessonRows.length}; Courses rows: ${courseRows.length}`,
    `- cells to change: ${L.changes.length + C.changes.length} in ${ranges.length} ranges; by column: ${JSON.stringify(byCol)}`,
    `- new rows from the team: ${intake.assigned.filter((a) => a.new_key).length} get a row_key; intake cells ${intake.cells.length}; new courses ${intake.newCourses.map((c) => c.course_id).join(', ') || 'none'}; rows still without a course: ${[...intake.issues.keys()].length}`,
    `- rows without row_key left alone (seeded rows): ${L.unkeyed.length}${L.unkeyed.length ? ' (sheet rows ' + L.unkeyed.slice(0, 50).join(', ') + ')' : ''}`,
    `- duplicate row_key (left alone): ${L.duplicate.length}${L.duplicate.length ? ' (' + L.duplicate.join(', ') + ')' : ''}`,
    `- Courses rows without course_id: ${C.unkeyed.length}; duplicate course_id: ${C.duplicate.length}`,
    `- status: ${JSON.stringify(status.totals)}`, '',
  ].join('\n');
  writeFileSync(join(root, 'reports', 'master-sync-report.md'), md, 'utf-8');
  const statusPath = join(root, 'public', 'ops', 'status.json');
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf-8');

  // public/ops/checks.json (Operations dashboard): flagged / failed lessons, no sheet id.
  const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
  const checksPath = join(root, 'public', 'ops', 'checks.json');
  const sheetRows = live ? new Map(lessonsTab.rows.map((r, i) => [r[lessonsTab.header.indexOf('row_key')], i + 2]).filter(([k]) => k)) : null;
  const frPath = join(root, 'data', 'queues', 'failed-review.csv');
  const checks = checksJson({
    lessonRows, sheetRows, gid: live ? await tabGid({ sheetId, token, tab: 'Lessons' }) : null, courseRows, wanted: wanted.lessons, manifest,
    videoManifest: readJson(join(root, 'data', 'video-manifest.json'), []),
    precheck: readJson(join(root, 'data', 'queues', 'approve', 'precheck.json'), null),
    videoPrecheck: readJson(join(root, 'data', 'queues', 'approve-video', 'precheck.json'), null),
    failed: failedMap(existsSync(frPath) ? readFileSync(frPath, 'utf-8') : '', readJson(join(root, 'data', 'ops', 'autorun-state.json'), {})),
    videoFailures: videoFailuresFrom(existsSync(join(root, 'reports', 'video-inventory-failures.csv')) ? parseCsvObjects(readFileSync(join(root, 'reports', 'video-inventory-failures.csv'), 'utf-8')) : []),
    prev: readJson(checksPath, null),
    now: new Date().toISOString(),
  });
  writeFileSync(checksPath, JSON.stringify(checks, null, 2) + '\n', 'utf-8');
  const byReason = {};
  for (const i of checks.items) byReason[`${i.media_type}: ${i.reason}`] = (byReason[`${i.media_type}: ${i.reason}`] || 0) + 1;
  console.log(`checks.json: ${checks.items.length} items ${JSON.stringify(byReason)}`);
  console.log(md);

  if (mode === 'write' && ranges.length) {
    try {
      const n = await writeRanges({ sheetId, token, ranges });
      console.log(`written: ${n} ranges, ${L.changes.length + C.changes.length + intake.cells.length} cells`);
      if (Object.keys(intake.registryAdds).length) {
        // The sheet has the new course ids now: record them so they are never given again.
        registryFile.courses = intake.registry;
        writeFileSync(registryPath, JSON.stringify(registryFile, null, 2) + '\n', 'utf-8');
        console.log(`course-ids.json: added ${Object.entries(intake.registryAdds).map(([, v]) => v).join(', ')}`);
      }
    } catch (e) {
      console.error(`::error title=master sync::${e.message}`);
      process.exit(1);
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `cells=${L.changes.length + C.changes.length}\nintake=${mode === 'write' ? intake.cells.length + intake.newCourses.length : 0}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('sync.mjs')) main();
