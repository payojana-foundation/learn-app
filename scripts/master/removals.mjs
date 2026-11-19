/**
 * scripts/master/removals.mjs — PART 13 (19 Nov): hide (remove) classes and lessons from the app
 * with a mark in the master sheet. Run hourly by .github/workflows/class-renames.yml (same job
 * family as the renames), whatever MASTER_SYNC_MODE is.
 *
 * TEAM columns (columns.json added_columns, light red #F4CCCC, unprotected), added at the END of
 * their tab: Courses.remove + Courses.remove_reason, Lessons.remove + Lessons.remove_reason.
 *   remove = "remove"  the row is hidden from the app (a course: every lesson of the course);
 *   remove = ""        (cleared) the row comes back with the same ids, so saved progress returns.
 * State (committed): data/ops/removals.json — what is removed, since when and why (the reason
 * byte-exact as typed), the lesson ids this job put in data/retired-lessons.json (so the build's id
 * guard passes; ids put there by hand are never touched), the Drive ids that drop out of the
 * conversion queues and autorun, and the issues log ("removed <date>: <reason>" / "restored
 * <date>"; a course's note goes on every Lessons row of the course: Courses has no issues column).
 * Never deletes anything: no sheet row, no R2 object, no Drive file. It writes only Lessons.issues.
 *
 * CLI (env ACCESS_TOKEN): plan --sheet-id <id> | write --sheet-id <id>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { readTab, writeRanges, sourceIdOf } from './sync.mjs';
import { colLetter } from './seed.mjs';
import { videoLessons } from '../media/video-inventory.mjs';
import { STATE, emptyState, isRemovedRow, keepRows, removedSources, readState } from './removed.mjs';

export { STATE, emptyState, isRemovedRow, keepRows, removedSources, readState };
export const RETIRED = 'data/retired-lessons.json';
export const PLAN = 'removals-plan.json';
const LOG_RE = /^(removed \d{4}-\d{2}-\d{2}: |restored \d{4}-\d{2}-\d{2}$)/;
const DOC = 'PART 13 (scripts/master/removals.mjs): classes (courses, by course_id) and lessons (by row_key) hidden with the remove mark in the master sheet; reason byte-exact as typed. retired = lesson ids this job added to data/retired-lessons.json; sources = Drive ids left out of the conversion queues and autorun; log = the issues notes.';

/** The mark: the dropdown value "remove" (case and outer spaces ignored). Pure. */
export const isMarked = (v) => String(v ?? '').trim().toLowerCase() === 'remove';

/** The reason as it goes into issues (the state keeps it byte-exact). Pure. */
function logReason(s) {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/;/g, ',');
  return t.trim() ? t : 'no reason given';
}
export const removedText = (date, reason) => `removed ${date}: ${logReason(reason)}`;
export const restoredText = (date) => `restored ${date}`;

/** The removal notes in an issues text. Pure. */
export const removalParts = (issues) => String(issues || '').split('; ').filter((p) => LOG_RE.test(p));

/** issues with its removal notes replaced by `texts` (same notes in any order = unchanged). Pure. */
export function withRemovalLog(issues, texts) {
  const want = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  const have = removalParts(issues);
  if (have.length === want.length && want.every((w) => have.includes(w))) return String(issues ?? '');
  const parts = String(issues || '').split('; ').filter((p) => p && !LOG_RE.test(p));
  return [...parts, ...want].join('; ');
}

const objects = (sheet) => sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));

/**
 * -> { cells: [{tab:'Lessons', row, column:'issues', to}], state, retired, removed, restored }
 * state   = the new data/ops/removals.json (without _doc)
 * retired = the new data/retired-lessons.json (ids added by hand kept, in their order)
 */
export function planRemovals({ lessonsTab, coursesTab, state, retired = [], date }) {
  const S0 = { ...emptyState(), ...(state || {}) };
  const C = { ...(S0.courses || {}) };
  const L = { ...(S0.lessons || {}) };
  const LG = { courses: { ...((S0.log && S0.log.courses) || {}) }, lessons: { ...((S0.log && S0.log.lessons) || {}) } };
  const removed = [];
  const restored = [];
  const courses = objects(coursesTab);
  const lessons = objects(lessonsTab);

  const step = (map, logMap, key, marked, reason, extra, kind) => {
    if (marked) {
      if (!map[key]) { map[key] = { date, reason, ...extra }; removed.push({ kind, key }); }
      else if (map[key].reason !== reason || Object.entries(extra).some(([k, v]) => map[key][k] !== v)) map[key] = { ...map[key], reason, ...extra };
      logMap[key] = removedText(map[key].date, map[key].reason);
    } else if (map[key]) {
      delete map[key];
      logMap[key] = restoredText(date);
      restored.push({ kind, key });
    }
  };
  if (coursesTab.header.includes('remove')) {
    for (const c of courses) if (c.course_id) step(C, LG.courses, c.course_id, isMarked(c.remove), c.remove_reason ?? '', {}, 'course');
  }
  if (lessonsTab.header.includes('remove')) {
    for (const l of lessons) if (l.row_key) step(L, LG.lessons, l.row_key, isMarked(l.remove), l.remove_reason ?? '', { course_id: l.course_id ?? '', lesson_id: l.lesson_id ?? '' }, 'lesson');
  }
  const next = { courses: C, lessons: L };

  // lesson ids for the id guard; Drive ids for the queues and autorun
  const gone = lessons.filter((l) => isRemovedRow(l, next));
  const stay = lessons.filter((l) => l.course_id && !isRemovedRow(l, next));
  const wantIds = [...new Set(gone.map((l) => l.lesson_id).filter(Boolean))];
  for (const l of Object.values(L)) if (l.lesson_id && !wantIds.includes(l.lesson_id)) wantIds.push(l.lesson_id); // a removed row no longer in the sheet
  const used = new Set([...stay.map((l) => sourceIdOf(l)), ...videoLessons(stay).map((v) => v.video_id)].filter(Boolean));
  const sources = [...new Set([...gone.map((l) => sourceIdOf(l)), ...videoLessons(gone).map((v) => v.video_id)].filter((id) => id && !used.has(id)))];
  const owned0 = new Set(S0.retired || []);
  const manual = new Set((retired || []).filter((id) => !owned0.has(id)));
  const owned = wantIds.filter((id) => !manual.has(id));
  const ownedSet = new Set(owned);
  const nextRetired = (retired || []).filter((id) => manual.has(id) || ownedSet.has(id));
  for (const id of owned) if (!nextRetired.includes(id)) nextRetired.push(id);

  // the issues notes on every Lessons row (its course's, then its own)
  const cells = [];
  if (lessonsTab.header.includes('issues')) {
    lessons.forEach((l, j) => {
      if (!l.row_key) return;
      const want = [l.course_id && LG.courses[l.course_id], LG.lessons[l.row_key]].filter(Boolean);
      const now = withRemovalLog(l.issues, want);
      if (now !== String(l.issues ?? '')) cells.push({ tab: 'Lessons', row: j + 2, column: 'issues', to: now });
    });
  }
  return { cells, state: { courses: C, lessons: L, retired: owned, sources, log: LG }, retired: nextRetired, removed, restored };
}

/** Cells -> batchUpdate ranges (one cell each). Pure. */
export function removalRanges(lessonsTab, cells) {
  return cells.map((c) => {
    const col = colLetter(lessonsTab.header.indexOf(c.column));
    return { range: `${c.tab}!${col}${c.row}:${col}${c.row}`, values: [[c.to]] };
  });
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
    const lessonsTab = await readTab({ sheetId, token, tab: 'Lessons' });
    const coursesTab = await readTab({ sheetId, token, tab: 'Courses' });
    const prev = readState();
    const { _doc, ...prevState } = prev;
    const prevRetired = readJson(RETIRED, []);
    const p = planRemovals({ lessonsTab, coursesTab, state: prevState, retired: prevRetired, date: new Date().toISOString().slice(0, 10) });
    const changed = JSON.stringify(p.state) !== JSON.stringify({ ...emptyState(), ...prevState }) || JSON.stringify(p.retired) !== JSON.stringify(prevRetired);
    if (changed) {
      mkdirSync('data/ops', { recursive: true });
      writeJson(STATE, { _doc: DOC, ...p.state });
      writeJson(RETIRED, p.retired);
    }
    writeJson(PLAN, { ranges: removalRanges(lessonsTab, p.cells) });
    const line = `class-removals: ${p.removed.length} removed (${p.removed.map((x) => `${x.kind} ${x.key}`).join(', ') || 'none'}), ${p.restored.length} restored (${p.restored.map((x) => `${x.kind} ${x.key}`).join(', ') || 'none'}), ${Object.keys(p.state.courses).length} courses and ${Object.keys(p.state.lessons).length} lessons removed now, ${p.cells.length} cells`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
    out('changed', changed ? 'true' : 'false');
    out('cells', p.cells.length);
  } else if (cmd === 'write') {
    const { ranges } = readJson(PLAN, { ranges: [] });
    const n = ranges.length ? await writeRanges({ sheetId, token, ranges }) : 0;
    console.log(`cells written: ${n}`);
  } else {
    console.error('Usage: removals.mjs plan|write --sheet-id <id>');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('removals.mjs')) main().catch((e) => { console.error(`::error title=class-removals::${e.message}`); process.exit(1); });
