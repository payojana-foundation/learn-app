/** PART 11 — editing hand-off: lessons marked "in editing" without a file link (placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checksJson, inEditing, REASONS } from '../checks.mjs';
import { computeSystem } from '../sync.mjs';
import { allLessonColumns, plan as exportPlan, rowsFromValues } from '../export.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = allLessonColumns(columns).map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (o) => ({ ...Object.fromEntries(LK.map((k) => [k, ''])), course_id: 'c900', course_title_km: 'ct', lesson_title: 't', source_type: 'mp3', source_file: 'F', ...o });
const run = (rows, extra = {}) => checksJson({ lessonRows: rows, courseRows: [], wanted: new Map(), manifest: [], now: 'T', ...extra });
const R = 'editing: lessons waiting to be cut';

describe('the column', () => {
  it('a TEAM column added at the end, dropdown exactly "in editing" (empty = not set)', () => {
    const c = allLessonColumns(columns).find((x) => x.key === 'editing_status');
    expect(c).toMatchObject({ owner: 'TEAM', protected: false, dropdown: ['in editing'], added_after_seed: true });
    expect(LK[LK.length - 1]).toBe('editing_status');
    expect(rowsFromValues('Lessons', [LK.slice(0, -1), ['M1']], exportPlan(columns)[0].readKeys, exportPlan(columns)[0].optional)[0].editing_status).toBe('');
  });
});

describe('checks.json', () => {
  it('in editing + no link: no "no file link" item; one summary per course with the count', () => {
    const o = run([
      row({ row_key: 'M1', editing_status: 'in editing' }),
      row({ row_key: 'M2', editing_status: 'in editing' }),
      row({ row_key: 'M3' }), // not in editing: still "no file link"
      row({ row_key: 'M4', course_id: 'c901', editing_status: 'in editing' }),
    ]);
    const by = o.items.map((i) => [i.row_key, i.course_id, i.reason]);
    expect(by.filter((x) => x[2] === 'no file link')).toEqual([['M3', 'c900', 'no file link']]);
    expect(by.filter((x) => x[2] === R)).toEqual([['M1', 'c900', R], ['M4', 'c901', R]]);
    expect(o.items.find((i) => i.course_id === 'c900' && i.reason === R).detail).toBe('2 lessons marked "in editing" with no file link yet');
    expect(o.items.find((i) => i.course_id === 'c901' && i.reason === R).detail).toBe('1 lesson marked "in editing" with no file link yet');
  });
  it('a course fully in editing is not "no approved lesson" (a person is on it)', () => {
    const o = run([row({ row_key: 'M1', editing_status: 'in editing' }), row({ row_key: 'M2', editing_status: 'in editing' })]);
    expect(o.items.some((i) => i.reason === 'no approved lesson')).toBe(false);
  });
  it('when a link appears the status is ignored', () => {
    const o = run([row({ row_key: 'M1', editing_status: 'in editing', mp3_link: url('A') })]);
    expect(o.items.some((i) => i.reason === R || i.reason === 'no file link')).toBe(false);
    expect(inEditing({ editing_status: ' in editing ' })).toBe(true);
    expect(inEditing({ editing_status: '' })).toBe(false);
  });
  it('the reason is in check-reasons.json with a CHANGE note', () => {
    const f = JSON.parse(readFileSync('public/ops/check-reasons.json', 'utf-8'));
    expect(REASONS).toContain(R);
    expect(f.reasons.map((r) => r.reason)).toContain(R);
    expect(f.changes.find((c) => c.reason === R).change).toMatch(/^CHANGE for Operations/);
  });
});

describe('issues in the sheet', () => {
  it('no "CHECK: no file link" for a row in editing; a plain note instead; normal once linked', () => {
    const w = computeSystem([
      row({ row_key: 'M1', editing_status: 'in editing' }),
      row({ row_key: 'M2' }),
      row({ row_key: 'M3', editing_status: 'in editing', mp3_link: url('A') }),
    ], [], { manifest: [] });
    expect(w.lessons.get('M1').issues).toContain('in editing: no file link yet');
    expect(w.lessons.get('M1').issues).not.toContain('CHECK: no file link');
    expect(w.lessons.get('M2').issues).toContain('CHECK: no file link');
    expect(w.lessons.get('M3').issues).not.toMatch(/no file link/);
  });
});
