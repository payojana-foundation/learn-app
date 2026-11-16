/**
 * scripts/master/intake.mjs — PART 3 (16 Nov): new content the team adds as rows in the
 * master sheet's Lessons tab. Pure; used by master-sync (write mode writes the cells).
 *
 * For each Lessons row WITHOUT a row_key that has any value:
 *   row_key      the next M##### after the highest one in the tab (written once; never changes);
 *   course_id    the course whose Courses row has the same course_title_km (and the same teacher
 *                when the row names one) — exactly one match; else, for a new title WITH a known
 *                teacher (a teacher name_km in the teachers file), the next free c### (the same
 *                first-free rule as the catalogue: from c001, not in data/course-ids.json and not
 *                in the Courses tab), registered as "master-sheet\t<title>\t<teacher>" and given a
 *                new Courses row; else no course_id and an issue;
 *   teacher      copied from the matched course when the cell is empty;
 *   source_type  the first file link: mp3 > mp4 > minicourse (when the cell is empty).
 * lesson_id and the other SYSTEM columns follow from computeSystem once the row has its key.
 * Rows are never reordered, moved or deleted; only these cells and new Courses rows are written.
 */
import { driveIds, hasFolderLink } from '../catalogue/sheets-map.mjs';
import { pickSource } from '../catalogue/catalogue-build.mjs';

export const REGISTRY_PREFIX = 'master-sheet';
export const ISSUE_NEEDS_TEACHER = 'CHECK: new course needs a known teacher';
export const ISSUE_NO_TITLE = 'CHECK: no course title';
export const ISSUE_AMBIGUOUS = 'CHECK: course title matches more than one course';
export const ISSUE_NO_FILE = 'CHECK: no file link';

/** True when the row has no Drive FILE link (mp3/mp4/minicourse), or a folder link there. Pure. */
export function noFileLink(r) {
  const cells = [r.mp3_link, r.mp4_link, r.minicourse_link];
  return hasFolderLink(...cells) || !cells.some((c) => driveIds(c).length);
}

const objects = (sheet) => sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));

/** First free c### (from c001). Pure. */
export function nextFreeCourseId(used) {
  for (let n = 1; ; n++) {
    const c = `c${String(n).padStart(3, '0')}`;
    if (!used.has(c)) return c;
  }
}

/**
 * -> { cells: [{row, column, to}], newCourses: [{course_id, course_title_km, teacher, lesson_count, course_status}],
 *      registry (new object), registryAdds: {key: id}, issues: Map(row_key -> [text]), assigned: [{row, row_key, course_id}] }
 */
export function intakePlan({ lessonsTab, coursesTab, registry = {}, teacherNames = new Set() }) {
  const rows = objects(lessonsTab);
  const courses = objects(coursesTab).filter((c) => c.course_id);
  let maxN = 0;
  for (const r of rows) {
    const m = /^M(\d+)$/.exec(String(r.row_key || '').trim());
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  const used = new Set([...Object.values(registry), ...courses.map((c) => c.course_id)]);
  const reg = { ...registry };
  const registryAdds = {};
  const newCourses = [];
  const cells = [];
  const issues = new Map();
  const assigned = [];
  const byTitle = (title, teacher) => {
    const all = [...courses, ...newCourses].filter((c) => c.course_title_km === title);
    return teacher ? all.filter((c) => c.teacher === teacher) : all;
  };
  rows.forEach((r, i) => {
    if (!Object.values(r).some((v) => String(v ?? '').trim() !== '')) return;
    // A team row = no source_file (seeded rows always have one). Its course is resolved on
    // every run until it has one, so an issue stays visible until it is fixed.
    if (String(r.source_file || '').trim()) return;
    const row = i + 2;
    let key = String(r.row_key || '').trim();
    const isNew = !key;
    if (isNew) {
      key = `M${String(++maxN).padStart(5, '0')}`;
      cells.push({ row, column: 'row_key', to: key });
    }
    const iss = [];
    const title = r.course_title_km;
    const teacher = r.teacher;
    let courseId = r.course_id;
    if (!courseId) {
      if (!String(title || '').trim()) iss.push(ISSUE_NO_TITLE);
      else {
        const hits = byTitle(title, teacher);
        if (hits.length === 1) {
          courseId = hits[0].course_id;
          if (!teacher) cells.push({ row, column: 'teacher', to: hits[0].teacher });
        } else if (hits.length > 1) iss.push(ISSUE_AMBIGUOUS);
        else if (teacher && teacherNames.has(teacher)) {
          const rkey = `${REGISTRY_PREFIX}\t${title}\t${teacher}`;
          courseId = reg[rkey] || nextFreeCourseId(used);
          used.add(courseId);
          if (!reg[rkey]) { reg[rkey] = courseId; registryAdds[rkey] = courseId; }
          newCourses.push({ course_id: courseId, course_title_km: title, teacher, lesson_count: '0', course_status: '' });
        } else iss.push(ISSUE_NEEDS_TEACHER);
      }
      if (courseId) cells.push({ row, column: 'course_id', to: courseId });
    }
    if (!r.source_type) {
      const ps = pickSource({ mp3: driveIds(r.mp3_link), mp4: driveIds(r.mp4_link), minicourse: driveIds(r.minicourse_link) });
      if (ps.from) cells.push({ row, column: 'source_type', to: ps.from });
    }
    if (iss.length) issues.set(key, iss);
    if (isNew || cells.some((c) => c.row === row)) assigned.push({ row, row_key: key, course_id: courseId || '', new_key: isNew });
  });
  return { cells, newCourses, registry: reg, registryAdds, issues, assigned };
}

/** The Lessons tab after the plan (in memory), so computeSystem / diffTab see the new keys. Pure. */
export function applyToTab(lessonsTab, cells) {
  const rows = lessonsTab.rows.map((r) => [...r]);
  for (const c of cells) {
    const col = lessonsTab.header.indexOf(c.column);
    if (col < 0) continue;
    const r = rows[c.row - 2];
    while (r.length <= col) r.push('');
    r[col] = c.to;
  }
  return { header: lessonsTab.header, rows };
}

/** Ranges for the cells (Lessons) and the new Courses rows (appended after the last row). Pure. */
export function intakeRanges(lessonsTab, coursesTab, plan, colLetter, courseKeys) {
  const out = plan.cells.map((c) => {
    const L = colLetter(lessonsTab.header.indexOf(c.column));
    return { range: `Lessons!${L}${c.row}:${L}${c.row}`, values: [[c.to]] };
  });
  if (plan.newCourses.length) {
    const first = coursesTab.rows.length + 2;
    const last = first + plan.newCourses.length - 1;
    out.push({ range: `Courses!A${first}:${colLetter(courseKeys.length - 1)}${last}`, values: plan.newCourses.map((c) => courseKeys.map((k) => c[k] ?? '')) });
  }
  return out;
}
