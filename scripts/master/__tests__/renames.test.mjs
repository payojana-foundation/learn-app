/** PART 9 — class and lesson renames from the master sheet (fake Sheets API with a real grid; placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planRenames, renameRanges, invalidTitle, withRenameLog, ensureTrailingColumns } from '../renames.mjs';
import { readTab, writeRanges, computeSystem } from '../sync.mjs';
import { allLessonColumns, allCourseColumns, rowsFromValues, plan as exportPlan } from '../export.mjs';
import { intakePlan } from '../intake.mjs';
import { buildFromMaster } from '../../build-courses.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = allLessonColumns(columns).map((c) => c.key);
const CK = allCourseColumns(columns).map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const lrow = (o) => LK.map((k) => o[k] ?? '');
const crow = (o) => CK.map((k) => o[k] ?? '');
const D = '2026-01-01';

function fakeSheets(tabs) {
  const grid = Object.fromEntries(Object.entries(tabs).map(([t, v]) => [t, v.map((r) => [...r])]));
  const writes = [];
  const fetchFn = async (u, init) => {
    const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEET', ''));
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET' && p.startsWith('?fields=')) return ok({ sheets: Object.keys(grid).map((t, i) => ({ properties: { sheetId: i, title: t, gridProperties: { rowCount: 1000, columnCount: 40 } } })) });
    if (init.method === 'GET') return ok({ values: grid[/\/values\/([^?]+)/.exec(p)[1]] });
    const put = (range, values) => {
      const m = /^(\w+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
      const col0 = [...m[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      values.forEach((vals, ri) => {
        const r = Number(m[3]) - 1 + ri;
        while (grid[m[1]].length <= r) grid[m[1]].push([]);
        vals.forEach((v, ci) => { const row = grid[m[1]][r]; while (row.length <= col0 + ci) row.push(''); row[col0 + ci] = v; });
      });
      writes.push(range);
    };
    if (p === '/values:batchUpdate') { for (const d of JSON.parse(init.body).data) put(d.range, d.values); return ok({}); }
    if (init.method === 'PUT') { const b = JSON.parse(init.body); put(b.range, b.values); return ok({}); }
    if (p === ':batchUpdate') { writes.push(':batchUpdate'); return ok({}); }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { fetchFn, grid, writes };
}

const lessons = () => [LK,
  lrow({ row_key: 'M00001', lesson_id: 'CODE-1', course_id: 'c900', course_title_km: 'old course', lesson_title: 'old lesson', lesson_code: 'CODE-1', mp3_link: url('A'), source_file: 'F', notes: 'team note' }),
  lrow({ row_key: 'M00002', lesson_id: 'CODE-2', course_id: 'c900', course_title_km: 'old course', lesson_title: 'two', lesson_code: 'CODE-2', mp3_link: url('B'), source_file: 'F' }),
  lrow({ row_key: 'M00003', lesson_id: 'CODE-3', course_id: 'c901', course_title_km: 'other course', lesson_title: 'three', lesson_code: 'CODE-3', mp3_link: url('C'), source_file: 'F' }),
];
const courses = () => [CK, crow({ course_id: 'c900', course_title_km: 'old course', teacher: 't', lesson_count: '2' }), crow({ course_id: 'c901', course_title_km: 'other course', teacher: 't', lesson_count: '1' })];

async function runOnce(api, state) {
  const lt = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
  const ct = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
  const p = planRenames({ lessonsTab: lt, coursesTab: ct, aliases: state.aliases, log: state.log, date: D });
  const ranges = renameRanges(lt, ct, p.cells);
  if (ranges.length) await writeRanges({ sheetId: 'SHEET', token: 't', ranges, fetchFn: api.fetchFn });
  return { p, ranges, state: { aliases: p.aliases, log: p.log } };
}
const cell = (api, tab, row, key) => api.grid[tab][row - 1][(tab === 'Lessons' ? LK : CK).indexOf(key)] ?? '';

describe('validation (text kept exactly as typed)', () => {
  it('blank, leading/trailing space (incl. zero-width), same as now', () => {
    expect(invalidTitle('', 'x')).toBe('blank');
    expect(invalidTitle('   ', 'x')).toBe('blank');
    expect(invalidTitle(' new', 'x')).toBe('leading or trailing space');
    expect(invalidTitle('new\u200B', 'x')).toBe('leading or trailing space');
    expect(invalidTitle('x', 'x')).toBe('same as the current title');
    expect(invalidTitle('ថ្មី ចំណងជើង', 'x')).toBe(null);
  });
  it('the rename note replaces the old one; same notes in any order = no change', () => {
    expect(withRenameLog('no title; renamed 2025-01-01: a → b', ['renamed 2026-01-01: b → c'])).toBe('no title; renamed 2026-01-01: b → c');
    expect(withRenameLog('renamed 2026-01-01: a → b; no title', ['renamed 2026-01-01: a → b'])).toBe('renamed 2026-01-01: a → b; no title');
  });
});

describe('fake Sheets API: rename course, rename lesson', () => {
  it('a course rename changes Courses and every Lessons row of the course; ids unchanged; old title an alias', async () => {
    const L = lessons();
    const C = courses();
    C[1][CK.indexOf('title_km_new')] = 'ថ្មី course';
    const api = fakeSheets({ Lessons: L, Courses: C });
    const { p } = await runOnce(api, { aliases: {}, log: {} });
    expect(p.applied).toEqual([{ kind: 'course', key: 'c900', old: 'old course', next: 'ថ្មី course' }]);
    expect(cell(api, 'Courses', 2, 'course_title_km')).toBe('ថ្មី course');
    expect(cell(api, 'Courses', 2, 'title_km_new')).toBe('');
    expect([2, 3].map((r) => cell(api, 'Lessons', r, 'course_title_km'))).toEqual(['ថ្មី course', 'ថ្មី course']);
    expect(cell(api, 'Lessons', 4, 'course_title_km')).toBe('other course');
    expect([2, 3].map((r) => cell(api, 'Lessons', r, 'issues'))).toEqual(['renamed 2026-01-01: old course → ថ្មី course', 'renamed 2026-01-01: old course → ថ្មី course']);
    for (const k of ['row_key', 'lesson_id', 'course_id', 'lesson_code', 'notes']) for (const r of [2, 3, 4]) expect(cell(api, 'Lessons', r, k)).toBe(L[r - 1][LK.indexOf(k)]);
    expect(cell(api, 'Courses', 2, 'course_id')).toBe('c900');
    expect(p.aliases.courses).toEqual({ c900: ['old course'] });
  });
  it('a lesson rename changes lesson_title only; the old title is an alias by row_key', async () => {
    const L = lessons();
    L[1][LK.indexOf('lesson_title_new')] = 'new lesson';
    const api = fakeSheets({ Lessons: L, Courses: courses() });
    const { p } = await runOnce(api, { aliases: {}, log: {} });
    expect(cell(api, 'Lessons', 2, 'lesson_title')).toBe('new lesson');
    expect(cell(api, 'Lessons', 2, 'lesson_title_new')).toBe('');
    expect(cell(api, 'Lessons', 2, 'issues')).toBe('renamed 2026-01-01: old lesson → new lesson');
    expect(cell(api, 'Lessons', 2, 'lesson_id')).toBe('CODE-1');
    expect(p.aliases.lessons).toEqual({ M00001: ['old lesson'] });
    expect(api.writes.some((w) => w.startsWith('Courses!'))).toBe(false);
  });
});

describe('fake Sheets API: refused, re-run', () => {
  it('a duplicate course title is refused: the cell stays, CHECK on the course rows, nothing renamed', async () => {
    const C = courses();
    C[1][CK.indexOf('title_km_new')] = 'other course';
    const api = fakeSheets({ Lessons: lessons(), Courses: C });
    const { p } = await runOnce(api, { aliases: {}, log: {} });
    expect(p.refused).toEqual([{ kind: 'course', key: 'c900', reason: 'duplicate course title' }]);
    expect(cell(api, 'Courses', 2, 'title_km_new')).toBe('other course');
    expect(cell(api, 'Courses', 2, 'course_title_km')).toBe('old course');
    expect(cell(api, 'Lessons', 2, 'issues')).toBe('CHECK: rename: duplicate course title');
    expect(cell(api, 'Lessons', 4, 'issues')).toBe('');
  });
  it('an old title of another course is a duplicate too; a leading space is refused', async () => {
    const C = courses();
    C[2][CK.indexOf('title_km_new')] = 'was c900';
    const L = lessons();
    L[3][LK.indexOf('lesson_title_new')] = ' padded';
    const api = fakeSheets({ Lessons: L, Courses: C });
    const { p } = await runOnce(api, { aliases: { courses: { c900: ['was c900'] } }, log: {} });
    expect(p.refused.map((r) => r.reason)).toEqual(['duplicate course title', 'leading or trailing space']);
  });
  it('a re-run writes nothing and changes no state; ids unchanged', async () => {
    const L = lessons();
    const C = courses();
    C[1][CK.indexOf('title_km_new')] = 'ថ្មី course';
    L[3][LK.indexOf('lesson_title_new')] = 'new three';
    const api = fakeSheets({ Lessons: L, Courses: C });
    const first = await runOnce(api, { aliases: {}, log: {} });
    expect(first.ranges.length).toBeGreaterThan(0);
    const n = api.writes.length;
    const second = await runOnce(api, first.state);
    expect(second.ranges).toEqual([]);
    expect(api.writes.length).toBe(n);
    expect(second.state).toEqual(first.state);
    expect(api.grid.Lessons.map((r) => r[LK.indexOf('row_key')])).toEqual(L.map((r) => r[LK.indexOf('row_key')]));
    expect(api.grid.Courses.map((r) => r[CK.indexOf('course_id')])).toEqual(C.map((r) => r[CK.indexOf('course_id')]));
  });
  it('clearing a refused cell removes the CHECK', async () => {
    const C = courses();
    C[1][CK.indexOf('title_km_new')] = 'other course';
    const api = fakeSheets({ Lessons: lessons(), Courses: C });
    const first = await runOnce(api, { aliases: {}, log: {} });
    api.grid.Courses[1][CK.indexOf('title_km_new')] = '';
    await runOnce(api, first.state);
    expect(cell(api, 'Lessons', 2, 'issues')).toBe('');
  });
});

describe('columns, intake, export, build, sync', () => {
  it('the new columns are added once at the end of each tab (fake API), never in the middle', async () => {
    // the sheet as seeded (no added columns yet): every added column is appended, in order
    const seededL = columns.columns.map((c) => c.key);
    const api = fakeSheets({ Lessons: [seededL], Courses: [CK.slice(0, -1)] });
    expect(await ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Courses', columns: allCourseColumns(columns), fetchFn: api.fetchFn })).toEqual(['title_km_new']);
    expect(await ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Lessons', columns: allLessonColumns(columns), fetchFn: api.fetchFn })).toEqual(columns.added_columns.map((c) => c.key));
    expect(api.grid.Courses[0]).toEqual(CK);
    expect(api.grid.Lessons[0]).toEqual(LK);
    expect(await ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Lessons', columns: allLessonColumns(columns), fetchFn: api.fetchFn })).toEqual([]);
    const bad = fakeSheets({ Lessons: [['row_key', 'other']] });
    await expect(ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Lessons', columns: allLessonColumns(columns), fetchFn: bad.fetchFn })).rejects.toThrow(/not adding/);
  });
  it('intake matches the OLD title of a renamed course: no new course id', () => {
    const lt = { header: LK, rows: [lrow({ course_title_km: 'old course', teacher: 't', lesson_title: 'x', mp3_link: url('Z') })] };
    const ct = { header: CK, rows: [crow({ course_id: 'c900', course_title_km: 'ថ្មី course', teacher: 't' })] };
    const p = intakePlan({ lessonsTab: lt, coursesTab: ct, registry: {}, teacherNames: new Set(['t']), courseAliases: { c900: ['old course'] } });
    expect(p.cells.find((c) => c.column === 'course_id').to).toBe('c900');
    expect(p.newCourses).toEqual([]);
  });
  it('the export still writes the seeded columns and accepts the new ones in the sheet', () => {
    const [L, C] = exportPlan(columns);
    expect(L.keys).not.toContain('lesson_title_new');
    expect(rowsFromValues('Lessons', [LK, ['M1']], L.readKeys, L.optional)[0]).toMatchObject({ row_key: 'M1', lesson_title_new: '' });
    expect(rowsFromValues('Courses', [CK.slice(0, -1), ['c1']], C.readKeys, C.optional)[0]).toMatchObject({ course_id: 'c1', title_km_new: '' });
  });
  it('the build serves old titles as search aliases (shown title = the current one)', () => {
    const rows = [{ row_key: 'M00001', lesson_id: 'L1', course_id: 'c900', teacher: 'tn', course_title_km: 'new', lesson_no: '1', lesson_title: 'new lesson', mp3_link: url('A'), mp4_link: '', minicourse_link: '', source_type: 'mp3' }];
    const out = buildFromMaster(rows, [{ course_id: 'c900', course_title_km: 'new', teacher: 'tn', course_status: '' }], [{ slug: 's', name_km: 'tn' }], [{ drive_file_id: DID('A'), key: 'audio/A-a64.mp3', duration_s: 60, status: 'approved' }], null, { courses: { c900: ['old'] }, lessons: { M00001: ['old lesson'] } });
    expect(out.catalog.courses[0]).toMatchObject({ title_km: 'new', title_aliases: ['old'] });
    expect(out.courses[0]).toMatchObject({ title_km: 'new', title_aliases: ['old'] });
    expect(out.courses[0].lessons[0]).toMatchObject({ title_km: 'new lesson', title_aliases: ['old lesson'] });
    const none = buildFromMaster(rows, [{ course_id: 'c900', course_title_km: 'new', teacher: 'tn', course_status: '' }], [{ slug: 's', name_km: 'tn' }], [{ drive_file_id: DID('A'), key: 'audio/A-a64.mp3', duration_s: 60, status: 'approved' }]);
    expect('title_aliases' in none.courses[0].lessons[0]).toBe(false);
  });
  it('master-sync keeps the rename notes in Lessons issues', () => {
    const r = Object.fromEntries(LK.map((k) => [k, '']));
    const w = computeSystem([{ ...r, row_key: 'M1', course_id: 'c900', lesson_title: 't', mp3_link: url('A'), source_type: 'mp3', source_file: 'F' }], [], { manifest: [], renameLog: { courses: { c900: 'renamed 2026-01-01: a → b' }, lessons: { M1: 'CHECK: rename: blank' } } });
    expect(w.lessons.get('M1').issues).toContain('renamed 2026-01-01: a → b; CHECK: rename: blank');
  });
});

describe('workflow', () => {
  const y = readFileSync('.github/workflows/class-renames.yml', 'utf-8');
  it('hourly, aliases committed before the sheet is written, export + build in the same run', () => {
    expect(y).toMatch(/cron: "29 \* \* \* \*"/);
    const a = y.indexOf('git add data/master/title-aliases.json');
    const w = y.indexOf('renames.mjs write');
    const e = y.indexOf('node scripts/master/export.mjs');
    expect(a).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(a);
    expect(e).toBeGreaterThan(w);
    expect(y).toContain('npm run build-courses');
  });
});
