import { describe, it, expect } from 'vitest';
import { planCatalogue, NON_COURSE_FILES, HIDDEN_TABS } from '../catalogue-build.mjs';
import { LABELS } from '../sheets-map.mjs';
import { canonicalFileId, canonicalTab, normalizeAliases } from '../file-aliases.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const d = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
/** cols: 0 number · 1 teacher · 2 title · 3 code · 4 MP3 */
function tab(name, rows) {
  const text = [['', '', '', '', 'MP3 link'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, '']];
  for (const r of rows) text.push([r.num, 't', `title ${r.num}`, r.code ?? '', r.mp3 ? d(r.mp3) : '']);
  return { name, text, links: text.map((x) => x.map(() => '')) };
}
const OLD_FILE = 'OLDFILEID0000000000000000000000001';
const NEW_FILE = 'NEWFILEID0000000000000000000000002';
const rows = [{ num: '1', code: 'CODE0001', mp3: 'A' }, { num: '2', mp3: 'B' }];
const opts = {
  teacherFiles: { [OLD_FILE]: 'teacher-x' },
  courseIds: { [`${OLD_FILE}\tOld Tab`]: 'c042' },
  approved: new Set([DID('A')]),
};
const summary = (plan) => ({
  courses: plan.courses.map((c) => ({ id: c.course_id, teacher: c.teacher, visible: c.visible.map((l) => l.lesson_id), queue: c.queueable.map((l) => l.lesson_id) })),
  hidden: plan.hidden.map((h) => [h.course_id, h.teacher, h.lesson_id, h.reason]),
  unmapped: plan.unmappedFiles.length,
  registry: Object.keys(plan.registry),
});

describe('file-aliases helpers', () => {
  it('empty / malformed maps resolve to themselves', () => {
    expect(canonicalFileId('X', normalizeAliases(null))).toBe('X');
    expect(canonicalFileId('X', normalizeAliases({ files: [] }))).toBe('X');
    expect(canonicalTab('F', 'T', normalizeAliases({}))).toBe('T');
  });
  it('follows a chain and survives a loop', () => {
    expect(canonicalFileId('C', { files: { C: 'B', B: 'A' } })).toBe('A');
    expect(canonicalFileId('A', { files: { A: 'B', B: 'A' } })).toBe('B');
  });
});

describe('Part A: aliased file id + renamed tab give identical catalogue output', () => {
  const base = planCatalogue([{ file_id: OLD_FILE, file_name: '', tabs: [tab('Old Tab', rows)] }], opts);

  it('baseline resolves the registered course id and teacher', () => {
    expect(base.courses[0].course_id).toBe('c042');
    expect(base.courses[0].teacher).toBe('teacher-x');
  });
  it('new file id + alias → same c###, lesson ids, teacher', () => {
    const aliases = { files: { [NEW_FILE]: OLD_FILE }, tabs: {} };
    const p = planCatalogue([{ file_id: NEW_FILE, file_name: '', tabs: [tab('Old Tab', rows)] }], { ...opts, aliases });
    expect(summary(p)).toEqual(summary(base));
  });
  it('renamed tab + alias → same c###, lesson ids, teacher', () => {
    const aliases = { files: {}, tabs: { [`${OLD_FILE}\tNew Tab`]: `${OLD_FILE}\tOld Tab` } };
    const p = planCatalogue([{ file_id: OLD_FILE, file_name: '', tabs: [tab('New Tab', rows)] }], { ...opts, aliases });
    expect(summary(p)).toEqual(summary(base));
  });
  it('both renamed (tab key written with the new file id) → identical', () => {
    const aliases = { files: { [NEW_FILE]: OLD_FILE }, tabs: { [`${NEW_FILE}\tNew Tab`]: `${OLD_FILE}\tOld Tab` } };
    const p = planCatalogue([{ file_id: NEW_FILE, file_name: '', tabs: [tab('New Tab', rows)] }], { ...opts, aliases });
    expect(summary(p)).toEqual(summary(base));
  });
  it('without the alias the same sheet is NOT identical (proves the alias does the work)', () => {
    const p = planCatalogue([{ file_id: NEW_FILE, file_name: '', tabs: [tab('Old Tab', rows)] }], opts);
    expect(p.unmappedFiles.map((u) => u.file_id)).toEqual([NEW_FILE]);
    expect(p.courses[0].course_id).not.toBe('c042');
  });
  it('NON_COURSE_FILES and HIDDEN_TABS are matched on the canonical id / tab', () => {
    const nc = [...NON_COURSE_FILES][0];
    const p = planCatalogue([{ file_id: NEW_FILE, file_name: '', tabs: [tab('Old Tab', rows)] }], { ...opts, aliases: { files: { [NEW_FILE]: nc }, tabs: {} } });
    expect(p.courses).toHaveLength(0);
    const ht = HIDDEN_TABS[0];
    const p2 = planCatalogue([{ file_id: OLD_FILE, file_name: '', tabs: [tab('Renamed', rows)] }], { ...opts, aliases: { files: {}, tabs: { [`${OLD_FILE}\tRenamed`]: `${OLD_FILE}\t${ht}` } } });
    expect(p2.courses).toHaveLength(0);
  });
});
