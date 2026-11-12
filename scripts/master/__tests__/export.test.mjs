import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadColumns, rowsFromValues, plan, exportMaster, fetchTab, HeaderMismatchError, EmptyTabError } from '../export.mjs';
import { parseCsvObjects } from '../csv.mjs';

const columns = loadColumns();
const [LESSONS, COURSES] = plan(columns);
const blank = (keys) => Object.fromEntries(keys.map((k) => [k, '']));
const asValues = (keys, objs) => [keys, ...objs.map((o) => keys.map((k) => o[k] ?? ''))];
const lesson = (o) => ({ ...blank(LESSONS.keys), ...o });
const course = (o) => ({ ...blank(COURSES.keys), ...o });

/** A fake Sheets API: tab name -> values. Records every request. */
function fakeApi(tabs, { status = 200 } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: decodeURIComponent(url), init });
    const m = /\/values\/([^?]+)/.exec(url);
    const tab = decodeURIComponent(m[1]);
    if (status !== 200) return { ok: false, status, text: async () => 'denied' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ range: tab, majorDimension: 'ROWS', values: tabs[tab] }) };
  };
  return { fetchFn, calls };
}
const good = () => ({
  Lessons: asValues(LESSONS.keys, [lesson({ row_key: 'M00001', lesson_id: 'CODE0001', course_id: 'c001', lesson_no: '1', lesson_title: 'a,"b"\nc \u200B\u1780' })]),
  Courses: asValues(COURSES.keys, [course({ course_id: 'c001', course_title_km: 'T', teacher: 'x', lesson_count: '1' })]),
});

describe('P1 plan', () => {
  it('headers come from columns.json: Lessons = columns, Courses = courses.columns', () => {
    expect(LESSONS.keys).toEqual(columns.columns.map((c) => c.key));
    expect(COURSES.keys).toEqual(columns.courses.columns.map((c) => c.key));
    expect([LESSONS.file, COURSES.file]).toEqual(['lessons.csv', 'courses.csv']);
  });
});

describe('P1 rowsFromValues: header check', () => {
  it('accepts the exact header; pads short rows; drops empty rows', () => {
    const v = [LESSONS.keys, ['M00001', 'X'], [], ['', '', ''], ['M00002']];
    const rows = rowsFromValues('Lessons', v, LESSONS.keys);
    expect(rows.map((r) => r.row_key)).toEqual(['M00001', 'M00002']);
    expect(rows[0].lesson_id).toBe('X');
    expect(rows[0].source_row).toBe('');
    expect(Object.keys(rows[0])).toEqual(LESSONS.keys);
  });
  it('a renamed header fails loudly and names the column', () => {
    const head = [...LESSONS.keys];
    head[3] = 'teacher_name';
    expect(() => rowsFromValues('Lessons', [head, ['M1']], LESSONS.keys)).toThrow(HeaderMismatchError);
    try { rowsFromValues('Lessons', [head, ['M1']], LESSONS.keys); } catch (e) {
      expect(e.message).toContain('missing: teacher');
      expect(e.message).toContain('unexpected: teacher_name');
      expect(e.tab).toBe('Lessons');
    }
  });
  it('a reordered, missing or extra column fails', () => {
    const swapped = [...LESSONS.keys]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(() => rowsFromValues('Lessons', [swapped, ['x']], LESSONS.keys)).toThrow(/different order/);
    expect(() => rowsFromValues('Lessons', [LESSONS.keys.slice(1), ['x']], LESSONS.keys)).toThrow(/missing: row_key/);
    expect(() => rowsFromValues('Lessons', [[...LESSONS.keys, 'extra'], ['x']], LESSONS.keys)).toThrow(/unexpected: extra/);
  });
  it('a header with a trailing space is a mismatch (no trimming)', () => {
    const head = [...LESSONS.keys]; head[0] = 'row_key ';
    expect(() => rowsFromValues('Lessons', [head, ['x']], LESSONS.keys)).toThrow(HeaderMismatchError);
  });
  it('no data rows -> refuses (an empty export must not wipe the site)', () => {
    expect(() => rowsFromValues('Lessons', [LESSONS.keys], LESSONS.keys)).toThrow(EmptyTabError);
    expect(() => rowsFromValues('Lessons', [], LESSONS.keys)).toThrow(HeaderMismatchError);
  });
});

describe('P1 exportMaster', () => {
  it('writes both CSV files byte-exact (round trip, Khmer, zero-width, quotes, newlines); header = column keys', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mx-'));
    const api = fakeApi(good());
    const r = await exportMaster({ sheetId: 'SHEET_ID', token: 'tok', columns, outDir: out, fetchFn: api.fetchFn });
    expect(r.changed).toBe(true);
    expect(r.files).toEqual([{ file: 'lessons.csv', rows: 1, changed: true }, { file: 'courses.csv', rows: 1, changed: true }]);
    const text = readFileSync(join(out, 'lessons.csv'), 'utf-8');
    expect(text.split('\n')[0]).toBe(LESSONS.keys.join(','));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('\r');
    const back = parseCsvObjects(text);
    expect(back[0].lesson_title).toBe('a,"b"\nc \u200B\u1780');
    expect(parseCsvObjects(readFileSync(join(out, 'courses.csv'), 'utf-8'))[0].course_id).toBe('c001');
  });
  it('a second identical export changes nothing (no rewrite, changed=false)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mx-'));
    await exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(good()).fetchFn });
    const before = readFileSync(join(out, 'lessons.csv'), 'utf-8');
    const r = await exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(good()).fetchFn });
    expect(r.changed).toBe(false);
    expect(r.files.every((f) => !f.changed)).toBe(true);
    expect(readFileSync(join(out, 'lessons.csv'), 'utf-8')).toBe(before);
  });
  it('a changed cell is reported as changed', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mx-'));
    await exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(good()).fetchFn });
    const g = good(); g.Courses[1][COURSES.keys.indexOf('course_status')] = 'ongoing';
    const r = await exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(g).fetchFn });
    expect(r.files).toEqual([{ file: 'lessons.csv', rows: 1, changed: false }, { file: 'courses.csv', rows: 1, changed: true }]);
  });
  it('a header mismatch in the SECOND tab writes NOTHING (neither file)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mx-'));
    const g = good(); g.Courses[0][0] = 'id';
    await expect(exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(g).fetchFn })).rejects.toBeInstanceOf(HeaderMismatchError);
    expect(existsSync(join(out, 'lessons.csv'))).toBe(false);
    expect(existsSync(join(out, 'courses.csv'))).toBe(false);
  });
  it('an existing file is kept when the export fails', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mx-'));
    writeFileSync(join(out, 'lessons.csv'), 'KEEP\n');
    const g = good(); g.Lessons = [LESSONS.keys];
    await expect(exportMaster({ sheetId: 'S', token: 't', columns, outDir: out, fetchFn: fakeApi(g).fetchFn })).rejects.toBeInstanceOf(EmptyTabError);
    expect(readFileSync(join(out, 'lessons.csv'), 'utf-8')).toBe('KEEP\n');
  });
});

describe('P1 fetchTab', () => {
  it('GET with a bearer token, FORMATTED_VALUE, the tab name encoded; read-only', async () => {
    const api = fakeApi(good());
    await fetchTab({ sheetId: 'SHEET_ID', tab: 'Lessons', token: 'tok', fetchFn: api.fetchFn });
    expect(api.calls[0].init.method).toBe('GET');
    expect(api.calls[0].init.body).toBeUndefined();
    expect(api.calls[0].init.headers.Authorization).toBe('Bearer tok');
    expect(api.calls[0].url).toContain('/spreadsheets/SHEET_ID/values/Lessons?');
    expect(api.calls[0].url).toContain('valueRenderOption=FORMATTED_VALUE');
  });
  it('API errors, a missing token and a bad sheet id throw', async () => {
    await expect(fetchTab({ sheetId: 'S', tab: 'Lessons', token: 't', fetchFn: fakeApi(good(), { status: 403 }).fetchFn })).rejects.toThrow(/403/);
    await expect(fetchTab({ sheetId: 'S', tab: 'Lessons', token: '', fetchFn: fakeApi(good()).fetchFn })).rejects.toThrow(/ACCESS_TOKEN/);
    await expect(fetchTab({ sheetId: '../x', tab: 'Lessons', token: 't', fetchFn: fakeApi(good()).fetchFn })).rejects.toThrow(/sheet id/);
  });
});

describe('P1 workflow file', () => {
  const wf = readFileSync('.github/workflows/master-export.yml', 'utf-8');
  it('has the triggers, scope, concurrency group and the build step the coordinator asked for', () => {
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/cron: "17 3 \* \* \*"/);
    expect(wf).toMatch(/workflow_run:\s*\n\s*workflows: \[approve-media\]/);
    expect(wf).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
    expect(wf).not.toMatch(/auth\/spreadsheets(?!\.readonly)/);
    expect(wf).toMatch(/group: data-rebuild-main/);
    expect(wf).toMatch(/cancel-in-progress: false/);
    expect(wf).toContain('npm run build-courses');
    expect(wf).toContain('git add data/master public/data');
    expect(wf).toContain('scripts/ci/push-with-retry.sh');
  });
});
