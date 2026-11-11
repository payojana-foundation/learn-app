import { describe, it, expect } from 'vitest';
import { planCatalogue, unmappedTeacherFiles, lessonIdSnapshot, guardLessonIds, resolveTeacher, NON_COURSE_FILES } from '../catalogue-build.mjs';
import { LABELS, renderReport, buildCatalogue } from '../sheets-map.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const d = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
function tab(name, rows) {
  const text = [['', '', '', '', 'MP3 link'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, '']];
  for (const r of rows) text.push([r.num, 't', `title ${r.num}`, r.code ?? '', r.mp3 ? d(r.mp3) : '']);
  return { name, text, links: text.map((x) => x.map(() => '')) };
}
const OLD = 'OLDFILEID0000000000000000000000001';
const NEW = 'NEWFILEID0000000000000000000000002';
const file = (id, rows = [{ num: '1', code: 'CODE0001', mp3: 'A' }]) => ({ file_id: id, file_name: '', tabs: [tab('T', rows)] });

describe('Part B: teacher error after aliases', () => {
  it('a file with no teacher entry is listed', () => {
    const u = unmappedTeacherFiles([file(NEW)], { teacherFiles: { [OLD]: 'x' } });
    expect(u).toEqual([{ file_id: NEW, canonical_id: NEW, file_name: '' }]);
  });
  it('an alias to a mapped old id clears it', () => {
    const aliases = { files: { [NEW]: OLD }, tabs: {} };
    expect(unmappedTeacherFiles([file(NEW)], { teacherFiles: { [OLD]: 'x' }, aliases })).toEqual([]);
    expect(resolveTeacher(file(NEW), { teacherFiles: { [OLD]: 'x' }, aliases }).slug).toBe('x');
  });
  it('a non-course file is never an error', () => {
    const nc = [...NON_COURSE_FILES][0];
    expect(unmappedTeacherFiles([file(nc)], {})).toEqual([]);
  });
  it('the report carries an ERROR section naming the file and file-aliases.json', () => {
    const cat = buildCatalogue([file(NEW)]);
    const md = renderReport(cat, null, { unmappedTeacherFiles: [{ file_id: NEW, file_name: 'N' }] });
    expect(md).toMatch(/\*\*ERROR\*\*/);
    expect(md).toContain(NEW);
    expect(md).toContain('file-aliases.json');
    expect(renderReport(cat, null, {})).not.toMatch(/ERRORS/);
  });
});

describe('Part B: id guard', () => {
  const approved = new Set([DID('A')]);
  const opts = { teacherFiles: { [OLD]: 't' }, approved };
  const snap = (rows) => lessonIdSnapshot(planCatalogue([file(OLD, rows)], opts));
  const base = snap([{ num: '1', code: 'CODE0001', mp3: 'A' }]);

  it('snapshot holds only lessons with approved media', () => {
    expect(Object.keys(base)).toEqual(['CODE0001']);
    expect(base.CODE0001.source_id).toBe(DID('A'));
  });
  it('no change → no problem; first run (no baseline) → no problem', () => {
    expect(guardLessonIds(base, base, {})).toEqual([]);
    expect(guardLessonIds(null, base, {})).toEqual([]);
  });
  it('a renamed code (id disappears) fails and is listed', () => {
    const now = snap([{ num: '1', code: 'CODE0002', mp3: 'A' }]);
    expect(guardLessonIds(base, now, {})).toMatchObject([{ id: 'CODE0001', problem: 'disappeared' }]);
  });
  it('same id on a different source fails as changed', () => {
    const now = { CODE0001: { ...base.CODE0001, source_id: DID('Z') } };
    expect(guardLessonIds(base, now, {})).toMatchObject([{ id: 'CODE0001', problem: 'changed' }]);
  });
  it('an id listed in id-aliases.json is allowed to change or go', () => {
    expect(guardLessonIds(base, {}, { CODE0001: 'CODE0002' })).toEqual([]);
  });
  it('a new approved lesson is not a problem', () => {
    expect(guardLessonIds({}, base, {})).toEqual([]);
  });
});
