/** PART 13 — hide (remove) classes and lessons from the master sheet (fake Sheets API with a real grid; placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planRemovals, removalRanges, withRemovalLog, isMarked, keepRows, removedSources, emptyState } from '../removals.mjs';
import { readTab, writeRanges, computeSystem } from '../sync.mjs';
import { ensureTrailingColumns } from '../renames.mjs';
import { allLessonColumns, allCourseColumns } from '../export.mjs';
import { buildFromMaster, approvedIdGuard } from '../../build-courses.mjs';
import { planRun } from '../../media/queue-plan.mjs';
import { planVideoRun } from '../../media/video-plan.mjs';
import { decide, exclusions } from '../../media/autorun-plan.mjs';
import { videoQueues } from '../../queues/video-queues.mjs';
import { queueAdds } from '../../queues/intake-queues.mjs';
import { checksJson } from '../checks.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = allLessonColumns(columns).map((c) => c.key);
const CK = allCourseColumns(columns).map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const lrow = (o) => LK.map((k) => o[k] ?? '');
const crow = (o) => CK.map((k) => o[k] ?? '');
const D1 = '2026-01-01';
const D2 = '2026-01-02';

function fakeSheets(tabs) {
  const grid = Object.fromEntries(Object.entries(tabs).map(([t, v]) => [t, v.map((r) => [...r])]));
  const writes = [];
  const calls = [];
  const fetchFn = async (u, init) => {
    calls.push({ url: u, method: init.method, body: init.body });
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
  return { fetchFn, grid, writes, calls };
}

const base = { teacher: 'tn', source_type: 'mp3', source_file: 'F' };
const lessons = () => [LK,
  lrow({ ...base, row_key: 'M00001', lesson_id: 'CODE-1', course_id: 'c900', course_title_km: 'course one', lesson_no: '1', lesson_title: 'lesson 1', lesson_code: 'CODE-1', mp3_link: url('A'), mp4_link: url('VA') }),
  lrow({ ...base, row_key: 'M00002', lesson_id: 'CODE-2', course_id: 'c900', course_title_km: 'course one', lesson_no: '2', lesson_title: 'lesson 2', lesson_code: 'CODE-2', mp3_link: url('B'), issues: 'team-visible note' }),
  lrow({ ...base, row_key: 'M00003', lesson_id: 'CODE-3', course_id: 'c901', course_title_km: 'course two', lesson_no: '1', lesson_title: 'lesson 3', lesson_code: 'CODE-3', mp3_link: url('C') }),
];
const courses = () => [CK, crow({ course_id: 'c900', course_title_km: 'course one', teacher: 'tn', lesson_count: '2' }), crow({ course_id: 'c901', course_title_km: 'course two', teacher: 'tn', lesson_count: '1' })];
const MANIFEST = ['A', 'B', 'C'].map((s) => ({ drive_file_id: DID(s), key: `audio/${s.toLowerCase()}0000000000000000-a64.mp3`, duration_s: 60, status: 'approved' }));
const TEACHERS = [{ slug: 's', name_km: 'tn' }];

async function runOnce(api, st, date = D1) {
  const lt = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
  const ct = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Courses', fetchFn: api.fetchFn });
  const p = planRemovals({ lessonsTab: lt, coursesTab: ct, state: st.state, retired: st.retired, date });
  const ranges = removalRanges(lt, p.cells);
  if (ranges.length) await writeRanges({ sheetId: 'SHEET', token: 't', ranges, fetchFn: api.fetchFn });
  return { p, ranges, st: { state: p.state, retired: p.retired } };
}
const START = { state: emptyState(), retired: [] };
const cell = (api, tab, row, key) => api.grid[tab][row - 1][(tab === 'Lessons' ? LK : CK).indexOf(key)] ?? '';
const objs = (grid, keys) => grid.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
const build = (api, state) => {
  const rows = objs(api.grid.Lessons, LK);
  const crs = objs(api.grid.Courses, CK).map((c) => ({ ...c, course_status: '' }));
  return buildFromMaster(keepRows(rows, state), crs, TEACHERS, MANIFEST);
};
const shownIds = (out) => out.courses.flatMap((c) => c.lessons.map((l) => `${c.id}/${l.id}`));

describe('the mark and the issues note', () => {
  it('only "remove" counts; the reason note replaces the old one, same notes in any order = unchanged', () => {
    expect(['remove', ' Remove ', 'REMOVE'].map(isMarked)).toEqual([true, true, true]);
    expect(['', 'yes', 'removed', 'x'].map(isMarked)).toEqual([false, false, false, false]);
    expect(withRemovalLog('a note; removed 2025-01-01: old', ['restored 2026-01-02'])).toBe('a note; restored 2026-01-02');
    expect(withRemovalLog('restored 2026-01-02; a note', ['restored 2026-01-02'])).toBe('restored 2026-01-02; a note');
  });
});

describe('fake Sheets API: hide a course, hide a lesson, restore', () => {
  it('a course marked remove hides every lesson of it; ids go to retired; issues logged on every row of the course', async () => {
    const C = courses();
    C[1][CK.indexOf('remove')] = 'remove';
    C[1][CK.indexOf('remove_reason')] = 'reason one';
    const api = fakeSheets({ Lessons: lessons(), Courses: C });
    const before = buildFromMaster(objs(lessons(), LK), objs(courses(), CK), TEACHERS, MANIFEST);
    const { p, st } = await runOnce(api, START);
    expect(p.removed).toEqual([{ kind: 'course', key: 'c900' }]);
    expect(st.state.courses).toEqual({ c900: { date: D1, reason: 'reason one' } });
    expect(st.retired).toEqual(['CODE-1', 'CODE-2']);
    expect(st.state.sources).toEqual([DID('A'), DID('B'), DID('VA')]);
    expect(cell(api, 'Lessons', 2, 'issues')).toBe('removed 2026-01-01: reason one');
    expect(cell(api, 'Lessons', 3, 'issues')).toBe('team-visible note; removed 2026-01-01: reason one');
    expect(cell(api, 'Lessons', 4, 'issues')).toBe('');
    // only Lessons.issues is written; the sheet keeps every row and the mark
    expect(api.writes.every((w) => w.startsWith(`Lessons!${String.fromCharCode(65 + LK.indexOf('issues'))}`))).toBe(true);
    expect(api.grid.Lessons.length).toBe(4);
    expect(cell(api, 'Courses', 2, 'remove')).toBe('remove');
    // the app: the course is gone, the id guard passes only thanks to retired
    const after = build(api, st.state);
    expect(after.catalog.courses.map((c) => c.id)).toEqual(['c901']);
    expect(approvedIdGuard(before.courses, after.courses, {}, st.retired)).toEqual([]);
    expect(approvedIdGuard(before.courses, after.courses, {}, [])).toHaveLength(2);
  });

  it('one lesson marked remove: only that lesson is hidden; no reason = "no reason given"', async () => {
    const L = lessons();
    L[2][LK.indexOf('remove')] = 'remove';
    const api = fakeSheets({ Lessons: L, Courses: courses() });
    const before = buildFromMaster(objs(lessons(), LK), objs(courses(), CK), TEACHERS, MANIFEST);
    const { st } = await runOnce(api, START);
    expect(st.state.lessons).toEqual({ M00002: { date: D1, reason: '', course_id: 'c900', lesson_id: 'CODE-2' } });
    expect(st.retired).toEqual(['CODE-2']);
    expect(cell(api, 'Lessons', 3, 'issues')).toBe('team-visible note; removed 2026-01-01: no reason given');
    expect(cell(api, 'Lessons', 2, 'issues')).toBe('');
    const after = build(api, st.state);
    expect(shownIds(after)).toEqual(['c900/CODE-1', 'c901/CODE-3']);
    expect(after.catalog.courses.find((c) => c.id === 'c900').all_shown).toBe(true); // a removed lesson does not block the leaf
    expect(approvedIdGuard(before.courses, after.courses, {}, st.retired)).toEqual([]);
  });

  it('clearing the mark restores it with the same ids; retired loses only what the job added; "restored <date>"', async () => {
    const L = lessons();
    L[2][LK.indexOf('remove')] = 'remove';
    L[2][LK.indexOf('remove_reason')] = 'why; with a semicolon';
    const api = fakeSheets({ Lessons: L, Courses: courses() });
    const first = await runOnce(api, { state: emptyState(), retired: ['MANUAL-1'] });
    expect(first.st.retired).toEqual(['MANUAL-1', 'CODE-2']);
    expect(first.st.state.lessons.M00002.reason).toBe('why; with a semicolon'); // byte-exact in the state
    expect(cell(api, 'Lessons', 3, 'issues')).toBe('team-visible note; removed 2026-01-01: why, with a semicolon');
    api.grid.Lessons[2][LK.indexOf('remove')] = '';
    const second = await runOnce(api, first.st, D2);
    expect(second.p.restored).toEqual([{ kind: 'lesson', key: 'M00002' }]);
    expect(second.st.state.lessons).toEqual({});
    expect(second.st.retired).toEqual(['MANUAL-1']);
    expect(second.st.state.sources).toEqual([]);
    expect(cell(api, 'Lessons', 3, 'issues')).toBe('team-visible note; restored 2026-01-02');
    expect(shownIds(build(api, second.st.state))).toEqual(['c900/CODE-1', 'c900/CODE-2', 'c901/CODE-3']);
    for (const k of ['row_key', 'lesson_id', 'course_id']) expect(api.grid.Lessons.map((r) => r[LK.indexOf(k)])).toEqual(L.map((r) => r[LK.indexOf(k)]));
  });

  it('a re-run writes nothing and changes no state (also after a restore)', async () => {
    const C = courses();
    C[2][CK.indexOf('remove')] = 'remove';
    const L = lessons();
    L[1][LK.indexOf('remove')] = 'remove';
    const api = fakeSheets({ Lessons: L, Courses: C });
    const first = await runOnce(api, START);
    expect(first.ranges.length).toBeGreaterThan(0);
    const n = api.writes.length;
    const second = await runOnce(api, first.st, D2);
    expect(second.ranges).toEqual([]);
    expect(api.writes.length).toBe(n);
    expect(second.st).toEqual(first.st);
    api.grid.Courses[2][CK.indexOf('remove')] = '';
    const third = await runOnce(api, second.st, D2);
    expect(third.ranges.length).toBe(1);
    const fourth = await runOnce(api, third.st, D2);
    expect(fourth.ranges).toEqual([]);
    expect(fourth.st).toEqual(third.st);
  });

  it('R2 and Drive untouched: every call goes to the Sheets API, nothing is deleted', async () => {
    const C = courses();
    C[1][CK.indexOf('remove')] = 'remove';
    const api = fakeSheets({ Lessons: lessons(), Courses: C });
    const first = await runOnce(api, START);
    api.grid.Courses[1][CK.indexOf('remove')] = '';
    await runOnce(api, first.st, D2);
    expect(api.calls.length).toBeGreaterThan(0);
    expect(api.calls.every((c) => c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SHEET'))).toBe(true);
    expect(api.calls.some((c) => c.method === 'DELETE' || /delete/i.test(c.body || ''))).toBe(false);
    const src = readFileSync('scripts/master/removals.mjs', 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/'DELETE'|deleteDimension|deleteSheet|deleteRange|\bR2_|rclone|aws s3|wrangler|googleapis\.com\/drive|unlinkSync|rmSync/);
  });
});

describe('removed items drop out of the queues, autorun, checks and sync', () => {
  const state = { ...emptyState(), courses: { c900: { date: D1, reason: '' } }, sources: [DID('A'), DID('B'), DID('VA')] };
  const rows = objs(lessons(), LK);
  it('audio and video planners skip removed Drive ids (a forced id is still done)', () => {
    const ex = removedSources(state);
    expect(planRun([DID('A'), DID('C')], [], 5, [], ex).toProcess).toEqual([DID('C')]);
    expect(planRun([DID('A'), DID('C')], [], 5, [DID('A')], ex).toProcess).toEqual([DID('A'), DID('C')]);
    expect(planVideoRun([DID('VA'), DID('VX')], [], 5, '480p', ex).toProcess).toEqual([DID('VX')]);
  });
  it('autorun does not pick a queue whose only work is removed', () => {
    const ex = exclusions(state);
    expect(ex.has(DID('A'))).toBe(true);
    const plan = decide({ enabled: true, busy: 0, state: {}, audioQueues: [{ path: 'data/queues/c900.csv', ids: [DID('A'), DID('B')] }], audioManifest: [], exclude: ex });
    expect(plan.action).toBe('empty');
  });
  it('video queue of a removed course is emptied (file kept), restored when cleared; intake does not add removed rows', () => {
    expect(videoQueues(rows, state).get('c900')).toEqual([]);
    expect(videoQueues(rows, emptyState()).get('c900')).toEqual([DID('VA')]);
    const fresh = rows.map((r) => ({ ...r, source_file: '' }));
    expect([...queueAdds(keepRows(fresh, state), new Set(), []).keys()]).toEqual(['c901']);
  });
  it('checks.json and the sync: removed rows have no check item; sync keeps the removal note in issues', () => {
    const c = checksJson({ lessonRows: keepRows(rows.map((r) => ({ ...r, mp3_link: '', mp4_link: '' })), state), courseRows: [], now: 'T' });
    expect(c.items.map((i) => i.course_id)).toEqual(['c901', 'c901']);
    const w = computeSystem(rows, [], { manifest: [], removalLog: { courses: { c900: 'removed 2026-01-01: x' }, lessons: { M00002: 'restored 2026-01-02' } } });
    expect(w.lessons.get('M00001').issues).toContain('removed 2026-01-01: x');
    expect(w.lessons.get('M00002').issues.endsWith('removed 2026-01-01: x; restored 2026-01-02')).toBe(true);
    expect(w.lessons.get('M00003').issues).not.toMatch(/removed|restored/);
  });
  it('the build, sync, queues and autorun all read data/ops/removals.json', () => {
    for (const f of ['scripts/build-courses.mjs', 'scripts/master/sync.mjs', 'scripts/queues/intake-queues.mjs', 'scripts/queues/video-queues.mjs', 'scripts/media/autorun-plan.mjs', 'scripts/media/queue-plan.mjs', 'scripts/media/video-plan.mjs']) {
      expect(readFileSync(f, 'utf-8'), f).toMatch(/from '(\.\.\/|\.\/)(master\/)?removed\.mjs'/);
    }
  });
});

describe('columns and workflow', () => {
  it('columns.json: remove + remove_reason, TEAM, unprotected, light red, at the end of Courses and Lessons', () => {
    for (const list of [columns.added_columns, columns.courses.added_columns]) {
      const [a, b] = list.slice(-2);
      expect(a).toMatchObject({ key: 'remove', owner: 'TEAM', protected: false, dropdown: ['remove'], fill: '#F4CCCC', added_after_seed: true });
      expect(b).toMatchObject({ key: 'remove_reason', owner: 'TEAM', protected: false, dropdown: null, fill: '#F4CCCC', added_after_seed: true });
    }
  });
  it('the columns are added at the end with the fill on header + cells and the dropdown on remove (fake API)', async () => {
    const api = fakeSheets({ Lessons: [LK.slice(0, -2)], Courses: [CK.slice(0, -2)] });
    expect(await ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Courses', columns: allCourseColumns(columns), fetchFn: api.fetchFn })).toEqual(['remove', 'remove_reason']);
    expect(await ensureTrailingColumns({ sheetId: 'SHEET', token: 't', tab: 'Lessons', columns: allLessonColumns(columns), fetchFn: api.fetchFn })).toEqual(['remove', 'remove_reason']);
    expect(api.grid.Courses[0]).toEqual(CK);
    expect(api.grid.Lessons[0]).toEqual(LK);
    const reqs = api.calls.filter((c) => c.url.endsWith(':batchUpdate') && !c.url.includes('/values')).flatMap((c) => JSON.parse(c.body).requests);
    const fills = reqs.filter((r) => r.repeatCell);
    expect(fills).toHaveLength(4);
    for (const f of fills) {
      expect(f.repeatCell.range.startRowIndex).toBe(0);
      expect(f.repeatCell.cell.userEnteredFormat.backgroundColor).toEqual({ red: 244 / 255, green: 204 / 255, blue: 204 / 255 });
      expect(f.repeatCell.fields).toBe('userEnteredFormat.backgroundColor');
    }
    expect(fills.map((f) => f.repeatCell.range.startColumnIndex)).toEqual([CK.length - 2, CK.length - 1, LK.length - 2, LK.length - 1]);
    const dv = reqs.filter((r) => r.setDataValidation);
    expect(dv.map((r) => r.setDataValidation.rule.condition.values)).toEqual([[{ userEnteredValue: 'remove' }], [{ userEnteredValue: 'remove' }]]);
    expect(reqs.some((r) => r.addProtectedRange || r.updateProtectedRange)).toBe(false);
  });
  it('class-renames.yml: removals hourly after the renames, state committed before the sheet write, export when changed', () => {
    const y = readFileSync('.github/workflows/class-renames.yml', 'utf-8');
    expect(y).toMatch(/cron: "29 \* \* \* \*"/);
    const rw = y.indexOf('renames.mjs write');
    const plan = y.indexOf('removals.mjs plan');
    const commit = y.indexOf('git add data/ops/removals.json data/retired-lessons.json');
    const write = y.indexOf('removals.mjs write');
    const exp = y.indexOf('node scripts/master/export.mjs');
    expect(plan).toBeGreaterThan(rw);
    expect(commit).toBeGreaterThan(plan);
    expect(write).toBeGreaterThan(commit);
    expect(exp).toBeGreaterThan(write);
    expect(y).toContain("steps.removals.outputs.changed == 'true'");
    expect(y).not.toMatch(/MASTER_SYNC_MODE|rclone|aws s3|wrangler r2/);
  });
});
