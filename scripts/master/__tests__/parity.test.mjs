import { describe, it, expect } from 'vitest';
import { LABELS } from '../../catalogue/sheets-map.mjs';
import { HIDDEN_TABS } from '../../catalogue/catalogue-build.mjs';
import { buildMaster, loadColumns, masterCsv } from '../seed.mjs';
import { parseCsvObjects } from '../csv.mjs';
import { fromTeacherFiles, fromMasterRows, diffCatalogues, renderParity } from '../parity.mjs';

const columns = loadColumns();
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const F1 = 'FILEONE00000000000000000000000001';
const teachers = [{ slug: 't-one', name_km: 'Teacher One Display', name_en: 'Teacher One' }];
// cols: 0 number · 1 teacher · 2 title · 3 code · 4 MP3 · 5 MP4 · 6 MiniCourse link
function tab(name, rows) {
  const text = [['', '', '', '', 'MP3 link', 'MP4 link', 'Video for MiniCourse'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, '', '', ''],
    ...rows.map((r) => [r.num, 'tc', r.title ?? '', r.code ?? '', r.mp3 ?? '', r.mp4 ?? '', r.mini ?? ''])];
  return { name, text, links: text.map((r) => r.map(() => '')) };
}
const files = [{
  file_id: F1,
  file_name: '',
  tabs: [
    tab('T1', [
      { num: '0', title: 'Section' },
      { num: '1', title: 'one', code: 'CODE0001', mp3: url('A') },
      { num: '2', title: 'two', code: 'CODE0002', mp4: url('B') },
      { num: '3', title: 'three' },
      { num: '4', title: '', code: 'CODE0004', mini: url('C') },
    ]),
    tab(HIDDEN_TABS[0], [{ num: '1', title: 'h', code: 'CODE0100', mp3: url('H') }]),
  ],
}];
const ctx = {
  teacherFiles: { [F1]: 't-one' }, pending: [], teachers, courseIds: { [`${F1}\tT1`]: 'c001' },
  manifest: [{ drive_file_id: DID('A'), status: 'approved' }], failedReview: new Set(), aliases: null,
};
const master = () => parseCsvObjects(masterCsv(columns, buildMaster(files, ctx).rows));

describe('PART 3 parity', () => {
  it('master seeded from the same files = 0 differences; the hidden tab is an expected extra', () => {
    const res = diffCatalogues(fromTeacherFiles(files, ctx), fromMasterRows(master()));
    expect(res.differences).toEqual([]);
    expect(res.rowsCatalogue).toBe(4);
    expect(res.rowsMaster).toBe(5);
    expect(res.expectedExtras).toBe(1);
    expect(renderParity(res)).toContain('**Differences: 0**');
  });
  it('media ids are re-read from the link column named by source_type; visibility from learn_live', () => {
    const b = fromMasterRows(master());
    const k = (row) => `${F1}\tT1\t${row}`;
    expect(b.get(k(4)).media_id).toBe(DID('A'));
    expect(b.get(k(4)).visible).toBe(true);
    expect(b.get(k(5)).media_id).toBe(DID('B')); // mp4 row
    expect(b.get(k(7)).media_id).toBe(DID('C')); // minicourse row
    expect(b.get(k(6)).media_id).toBe(''); // no source
  });
  it('every kind of drift is reported with its field', () => {
    const rows = master();
    const t = (fn) => { const c = structuredClone(rows); fn(c); return diffCatalogues(fromTeacherFiles(files, ctx), fromMasterRows(c)); };
    const t1 = (c) => c.filter((r) => r.source_tab === 'T1');
    expect(t((c) => { t1(c)[0].course_id = 'c999'; }).byField.course_id).toBe(1);
    expect(t((c) => { t1(c)[0].lesson_id = 'X'; }).byField.lesson_id).toBe(1);
    expect(t((c) => { t1(c)[1].course_title_km = 'other'; }).byField.course_title).toBe(1);
    expect(t((c) => { t1(c)[1].lesson_title = 'other'; }).byField.lesson_title).toBe(1);
    expect(t((c) => { t1(c)[0].mp3_link = url('Z'); }).byField.media_id).toBe(1);
    expect(t((c) => { t1(c)[2].learn_live = 'yes'; }).byField.visible).toBe(1);
    const missing = t((c) => { c.splice(c.indexOf(t1(c)[3]), 1); });
    expect(missing.byField.row).toBe(1);
    const extra = t((c) => { c.push({ ...c[0], source_row: '99' }); });
    expect(extra.byField.row).toBe(1);
    expect(extra.differences[0].master).toBe('present');
  });
  it('the report lists differences with file · tab · row', () => {
    const rows = master();
    rows.find((r) => r.source_tab === 'T1').lesson_id = 'X';
    const md = renderParity(diffCatalogues(fromTeacherFiles(files, ctx), fromMasterRows(rows)), { csv: 'x.csv' });
    expect(md).toContain('**Differences: 1**');
    expect(md).toContain(`${F1} · T1 · 4`);
  });
});
