/** PART 3 — new content intake (fake Sheets API with a real grid; placeholders only). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { intakePlan, applyToTab, intakeRanges, noFileLink, nextFreeCourseId, ISSUE_NEEDS_TEACHER, ISSUE_NO_FILE, ISSUE_AMBIGUOUS } from '../intake.mjs';
import { readTab, writeRanges, computeSystem, diffTab, toRanges, LESSON_SYNC_COLUMNS } from '../sync.mjs';
import { colLetter } from '../seed.mjs';
import { queueAdds, appendText } from '../../queues/intake-queues.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = columns.columns.map((c) => c.key);
const CK = columns.courses.columns.map((c) => c.key);
const TEAM = new Set(columns.columns.filter((c) => c.owner === 'TEAM').map((c) => c.key));
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const folder = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const lrow = (o) => LK.map((k) => o[k] ?? '');

/** In-memory sheet: GET values, values:batchUpdate applied to the grid; no row moves. */
function fakeSheets(tabs) {
  const grid = Object.fromEntries(Object.entries(tabs).map(([t, v]) => [t, v.map((r) => [...r])]));
  const writes = [];
  const fetchFn = async (u, init) => {
    const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEET', ''));
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET') return ok({ values: grid[/\/values\/([^?]+)/.exec(p)[1]] });
    if (p === '/values:batchUpdate') {
      const body = JSON.parse(init.body);
      for (const d of body.data) {
        writes.push(d.range);
        const m = /^(\w+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(d.range);
        const col0 = [...m[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        d.values.forEach((vals, ri) => {
          const r = Number(m[3]) - 1 + ri;
          while (grid[m[1]].length <= r) grid[m[1]].push([]);
          vals.forEach((v, ci) => {
            const row = grid[m[1]][r];
            while (row.length <= col0 + ci) row.push('');
            row[col0 + ci] = v;
          });
        });
      }
      return ok({});
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { fetchFn, grid, writes };
}

const teacherNames = new Set(['teacher-one-name', 'teacher-two-name']);
const seeded = [
  { row_key: 'M00001', course_id: 'c001', teacher: 'teacher-one-name', course_title_km: 'course A', lesson_no: '1', lesson_title: 'one', mp3_link: url('A1'), source_type: 'mp3', source_file: 'F1', source_tab: 'T', source_row: '3' },
  { row_key: 'M00007', course_id: 'c003', teacher: 'teacher-two-name', course_title_km: 'course B', lesson_no: '1', lesson_title: 'two', mp3_link: url('B1'), source_type: 'mp3', source_file: 'F2', source_tab: 'T', source_row: '3' },
];
const added = [
  { course_title_km: 'course A', lesson_no: '2', lesson_title: 'new in A', mp3_link: url('A2'), notes: 'team note' }, // existing course
  { course_title_km: 'course NEW', teacher: 'teacher-two-name', lesson_no: '1', lesson_title: 'new course lesson', mp4_link: url('N1') }, // new course
  { course_title_km: 'course NEW', teacher: 'teacher-two-name', lesson_no: '2', lesson_title: 'second', minicourse_link: url('N2') },
  { course_title_km: 'course NOTEACHER', lesson_no: '1', lesson_title: 'x', mp3_link: folder }, // no teacher + folder link
];
const lessonsValues = () => [LK, ...seeded.map(lrow), ...added.map(lrow)];
const coursesValues = () => [CK, ['c001', 'course A', 'teacher-one-name', '1', ''], ['c003', 'course B', 'teacher-two-name', '1', 'complete']];
const registry = { 'F1\tT': 'c001', 'F2\tT': 'c003' };

describe('intake plan', () => {
  const lessonsTab = { header: LK, rows: lessonsValues().slice(1) };
  const coursesTab = { header: CK, rows: coursesValues().slice(1) };
  const plan = intakePlan({ lessonsTab, coursesTab, registry, teacherNames });
  const at = (row, column) => plan.cells.find((c) => c.row === row && c.column === column)?.to;
  it('next row keys after the highest one, in sheet order, only for rows without one', () => {
    expect([4, 5, 6, 7].map((r) => at(r, 'row_key'))).toEqual(['M00008', 'M00009', 'M00010', 'M00011']);
    expect(plan.cells.some((c) => c.row < 4)).toBe(false);
  });
  it('an existing course title joins that course (teacher copied); source_type from the first file link', () => {
    expect(at(4, 'course_id')).toBe('c001');
    expect(at(4, 'teacher')).toBe('teacher-one-name');
    expect(at(4, 'source_type')).toBe('mp3');
  });
  it('a new title + known teacher gets the next free c### (c002 here), one Courses row, a registry entry', () => {
    expect(at(5, 'course_id')).toBe('c002');
    expect(at(6, 'course_id')).toBe('c002');
    expect(at(5, 'source_type')).toBe('mp4');
    expect(at(6, 'source_type')).toBe('minicourse');
    expect(plan.newCourses).toEqual([{ course_id: 'c002', course_title_km: 'course NEW', teacher: 'teacher-two-name', lesson_count: '0', course_status: '' }]);
    expect(plan.registryAdds).toEqual({ 'master-sheet\tcourse NEW\tteacher-two-name': 'c002' });
  });
  it('a new title without a known teacher gets no course and an issue', () => {
    expect(at(7, 'course_id')).toBeUndefined();
    expect(plan.issues.get('M00011')).toEqual([ISSUE_NEEDS_TEACHER]);
  });
  it('never a TEAM column; never reorders: only cells of the new rows', () => {
    expect(plan.cells.every((c) => !TEAM.has(c.column))).toBe(true);
    expect(new Set(plan.cells.map((c) => c.column))).toEqual(new Set(['row_key', 'course_id', 'teacher', 'source_type']));
  });
  it('the registry id is reused on the next run; a title in two courses is ambiguous', () => {
    const again = intakePlan({ lessonsTab: { header: LK, rows: [lrow(added[1])] }, coursesTab: { header: CK, rows: [] }, registry: plan.registry, teacherNames });
    expect(again.cells.find((c) => c.column === 'course_id').to).toBe('c002');
    const amb = intakePlan({ lessonsTab: { header: LK, rows: [lrow({ course_title_km: 'dup', lesson_title: 'x', mp3_link: url('Q') })] }, coursesTab: { header: CK, rows: [['c010', 'dup', 'teacher-one-name'], ['c011', 'dup', 'teacher-two-name']] }, teacherNames });
    expect([...amb.issues.values()][0]).toEqual([ISSUE_AMBIGUOUS]);
  });
  it('helpers: no file link (missing or folder), next free id', () => {
    expect(noFileLink({ mp3_link: folder })).toBe(true);
    expect(noFileLink({})).toBe(true);
    expect(noFileLink({ mp4_link: url('Z') })).toBe(false);
    expect(nextFreeCourseId(new Set(['c001', 'c002', 'c004']))).toBe('c003');
  });
});

describe('intake through the fake Sheets API (write, read back)', () => {
  it('writes the new cells and the Courses row; seeded rows, TEAM cells and order unchanged', async () => {
    const api = fakeSheets({ Lessons: lessonsValues(), Courses: coursesValues() });
    const lessonsTab = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const coursesTab = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
    const plan = intakePlan({ lessonsTab, coursesTab, registry, teacherNames });
    const after = applyToTab(lessonsTab, plan.cells);
    const rowsObj = after.rows.map((r) => Object.fromEntries(LK.map((k, i) => [k, r[i] ?? ''])));
    const courseRows = [...coursesTab.rows.map((r) => Object.fromEntries(CK.map((k, i) => [k, r[i] ?? '']))), ...plan.newCourses];
    const wanted = computeSystem(rowsObj, courseRows, { manifest: [], intakeIssues: plan.issues });
    for (const c of plan.newCourses) c.lesson_count = wanted.courses.get(c.course_id).lesson_count;
    const L = diffTab(after, 'row_key', wanted.lessons, LESSON_SYNC_COLUMNS);
    const ranges = [...intakeRanges(after, coursesTab, plan, colLetter, CK), ...toRanges('Lessons', L.changes)];
    await writeRanges({ sheetId: 'SHEET', token: 't', ranges, fetchFn: api.fetchFn });

    const back = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const get = (row, k) => back.rows[row - 2][LK.indexOf(k)];
    expect(back.rows.length).toBe(6);
    const orig = lessonsValues().slice(1);
    for (const r of [0, 1]) LK.forEach((k, i) => { if (!LESSON_SYNC_COLUMNS.includes(k)) expect(back.rows[r][i] ?? '').toBe(orig[r][i]); });
    expect([2, 3, 4, 5, 6, 7].map((r) => get(r, 'row_key'))).toEqual(['M00001', 'M00007', 'M00008', 'M00009', 'M00010', 'M00011']);
    expect(get(4, 'course_id')).toBe('c001');
    expect(get(4, 'lesson_id')).toBe(`d-${DID('A2')}`); // lesson_id computed
    expect(get(4, 'notes')).toBe('team note'); // TEAM cell untouched
    expect(get(5, 'course_id')).toBe('c002');
    expect(get(7, 'issues')).toContain(ISSUE_NEEDS_TEACHER);
    expect(get(7, 'issues')).toContain(ISSUE_NO_FILE);
    for (const col of LK.filter((k) => TEAM.has(k))) {
      for (let r = 0; r < added.length; r++) expect(back.rows[r + 2][LK.indexOf(col)] ?? '').toBe(lrow(added[r])[LK.indexOf(col)]);
    }
    const courses = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
    expect(courses.rows.map((r) => r[0])).toEqual(['c001', 'c003', 'c002']);
    expect(courses.rows[2]).toEqual(['c002', 'course NEW', 'teacher-two-name', '2', '']);
    expect(api.writes.every((r) => !TEAM.has(LK[[...r.split('!')[1].match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1]) || r.startsWith('Courses!'))).toBe(true);
  });
  it('a second run writes no intake cells (keys written once)', async () => {
    const api = fakeSheets({ Lessons: lessonsValues(), Courses: coursesValues() });
    const t1 = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const c1 = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
    const p1 = intakePlan({ lessonsTab: t1, coursesTab: c1, registry, teacherNames });
    await writeRanges({ sheetId: 'SHEET', token: 't', ranges: intakeRanges(t1, c1, p1, colLetter, CK), fetchFn: api.fetchFn });
    const t2 = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const c2 = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
    const p2 = intakePlan({ lessonsTab: t2, coursesTab: c2, registry: p1.registry, teacherNames });
    expect(p2.cells).toEqual([]);
    expect(p2.newCourses).toEqual([]);
    expect([...p2.issues.values()]).toEqual([[ISSUE_NEEDS_TEACHER]]); // still visible until fixed
  });
});

describe('conversion queues for new lessons', () => {
  const rows = [
    { course_id: 'c001', source_file: 'F1', source_type: 'mp3', mp3_link: url('A1') }, // seeded: left to the catalogue
    { course_id: 'c001', source_file: '', source_type: 'mp3', mp3_link: url('A2') },
    { course_id: 'c002', source_file: '', source_type: 'mp4', mp4_link: url('N1') },
    { course_id: 'c002', source_file: '', source_type: 'mp4', mp4_link: url('N1') }, // same file once
    { course_id: 'c002', source_file: '', source_type: 'mp3', mp3_link: url('DONE') }, // converted already
    { course_id: '', source_file: '', source_type: 'mp3', mp3_link: url('X') }, // no course yet
  ];
  it('appends only team rows with a course, new to the manifest and to every queue', () => {
    const adds = queueAdds(rows, new Set([DID('DONE')]), [DID('A9')]);
    expect([...adds]).toEqual([['c001', [DID('A2')]], ['c002', [DID('N1')]]]);
    expect(queueAdds(rows, new Set(), [DID('A2'), DID('N1'), DID('DONE')]).size).toBe(0);
  });
  it('append keeps every old line as it is (no reorder), creates a header for a new queue', () => {
    expect(appendText('drive_file_id\nb\na\n', ['c'])).toBe('drive_file_id\nb\na\nc\n');
    expect(appendText('drive_file_id\nb', ['c'])).toBe('drive_file_id\nb\nc\n');
    expect(appendText('', ['x'])).toBe('drive_file_id\nx\n');
  });
  it('master-export runs the intake queues and the video queues before the build and commits data/queues', () => {
    const y = readFileSync('.github/workflows/master-export.yml', 'utf-8');
    expect(y).toMatch(/node scripts\/queues\/intake-queues\.mjs\n\s+node scripts\/queues\/video-queues\.mjs\n\s+npm run build-courses/);
    expect(y).toContain('git add data/queues');
  });
  it('master-sync commits the registry and starts master-export after new rows were written', () => {
    const y = readFileSync('.github/workflows/master-sync.yml', 'utf-8');
    expect(y).toContain('git add data/course-ids.json');
    expect(y).toMatch(/steps\.sync\.outputs\.intake != '0'[\s\S]*?gh workflow run master-export\.yml/);
  });
});
