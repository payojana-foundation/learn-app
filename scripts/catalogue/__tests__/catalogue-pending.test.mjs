import { describe, it, expect } from 'vitest';
import { planCatalogue, unmappedTeacherFiles, pendingSet } from '../catalogue-build.mjs';
import { LABELS } from '../sheets-map.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const d = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const PEND = 'PENDFILE0000000000000000000000001';
const OTHER = 'OTHRFILE0000000000000000000000002';
const MAPPED = 'MAPDFILE0000000000000000000000003';
function file(id) {
  const text = [['', '', '', '', 'MP3 link'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, ''], ['1', 't', 'title 1', `CODE${String(id.charCodeAt(0)).padStart(4, '0')}`, d(`M${id.slice(0, 4)}`)]];
  return { file_id: id, file_name: '', tabs: [{ name: 'T', text, links: text.map((r) => r.map(() => '')) }] };
}
const pending = [{ file_id: PEND, name: 'placeholder name' }];
const opts = { teacherFiles: { [MAPPED]: 'teacher-x' }, pending, approved: new Set() };

describe('Part E: pending teachers', () => {
  it('pendingSet accepts objects, ids and junk', () => {
    expect([...pendingSet([{ file_id: 'A' }, 'B', null, {}])]).toEqual(['A', 'B']);
    expect(pendingSet(undefined).size).toBe(0);
  });

  it('a pending file: lessons hidden as PENDING TEACHER, not an error', () => {
    const files = [file(PEND), file(MAPPED)];
    const plan = planCatalogue(files, opts);
    expect(plan.unmappedFiles).toEqual([]);
    expect(plan.pendingFiles.map((p) => p.file_id)).toEqual([PEND]);
    expect(plan.hidden.filter((h) => h.reason === 'PENDING TEACHER')).toHaveLength(1);
    expect(plan.hidden.some((h) => h.reason === 'teacher file not mapped')).toBe(false);
    // the mapped file is unaffected
    expect(plan.courses.find((c) => c.teacher === 'teacher-x').queueable).toHaveLength(1);
    // and the pending file produces no failure
    expect(unmappedTeacherFiles(files, opts)).toEqual([]);
  });

  it('an unmapped file NOT in pending: ERROR (listed, would fail the job)', () => {
    const files = [file(PEND), file(OTHER)];
    const plan = planCatalogue(files, opts);
    expect(plan.unmappedFiles.map((u) => u.file_id)).toEqual([OTHER]);
    expect(plan.hidden.some((h) => h.reason === 'teacher file not mapped')).toBe(true);
    expect(unmappedTeacherFiles(files, opts).map((u) => u.file_id)).toEqual([OTHER]);
  });

  it('a pending file that gets a teacher entry is treated as mapped', () => {
    const files = [file(PEND)];
    const o = { ...opts, teacherFiles: { [PEND]: 'teacher-y' } };
    const plan = planCatalogue(files, o);
    expect(plan.pendingFiles).toEqual([]);
    expect(plan.courses[0].teacher).toBe('teacher-y');
  });
});
