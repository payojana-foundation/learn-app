import { describe, it, expect } from 'vitest';
import {
  planCatalogue, pickSource, lessonIdOf, courseTitle, queueFor, pilotAliases,
  khmerToInt, codePrefix, isSectionRow, matchTeacher, HIDDEN_TABS, NON_COURSE_FILES,
} from '../catalogue-build.mjs';

const T = { title: 'ចំណងជើង មេរៀន', code: 'លេខកូដមេរៀន', teacher: 'ឈ្មោះគ្រូ' };
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const d = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;

/** A tab with an optional section row (num 0 + a title cell) above the lessons.
 * cols: 0 number · 1 teacher · 2 title · 3 code · 4 MP3 · 5 MP4 · 6 MiniCourse. */
function tab(name, lessons, { section = null } = {}) {
  const text = [['', '', '', '', 'MP3 link', 'MP4 link', 'Video for MiniCourse'],
    ['ល.រ', T.teacher, T.title, T.code, '', '', '']];
  if (section) text.push(['0', '', section.title ?? '', section.code ?? '', '', '', '']);
  for (const l of lessons) {
    text.push([l.num, 'tc', l.title ?? `title ${l.num}`, l.code ?? '', l.mp3 ? d(l.mp3) : '', l.mp4 ? d(l.mp4) : '', l.mini ? d(l.mini) : '']);
  }
  return { name, text, links: text.map((r) => r.map(() => '')) };
}

describe('khmerToInt / codePrefix / isSectionRow (decisions 2 & 4)', () => {
  it('Khmer and ASCII digits → int; non-numeric → -1', () => {
    expect(khmerToInt('1')).toBe(1);
    expect(khmerToInt('១០')).toBe(10);
    expect(khmerToInt('៥.')).toBe(5);
    expect(khmerToInt('')).toBe(-1);
    expect(khmerToInt('abc')).toBe(-1);
  });
  it('codePrefix strips a trailing digit run (section rows have no lesson suffix)', () => {
    expect(codePrefix('ASUT017YY0003')).toBe('ASUT017YY');
    expect(codePrefix('ASUT017YY')).toBe('ASUT017YY'); // no digits → unchanged (section row)
    // the key property: a bare course code equals its own prefix (→ section row),
    // while a lesson code with a numeric suffix does not.
    expect(codePrefix('ASUT017YY') === 'ASUT017YY').toBe(true);
    expect(codePrefix('ASUT017YY0003') === 'ASUT017YY0003').toBe(false);
  });
  it('a row with num 0/០/empty is a section row', () => {
    expect(isSectionRow({ number: '0', lesson_code: '' })).toBe(true);
    expect(isSectionRow({ number: '០', lesson_code: '' })).toBe(true);
    expect(isSectionRow({ number: '', lesson_code: '' })).toBe(true);
  });
  it('a row whose code equals the course prefix (no lesson suffix) is a section row', () => {
    expect(isSectionRow({ number: '1', lesson_code: 'ASUT017YY' })).toBe(true);
    expect(isSectionRow({ number: '1', lesson_code: 'ASUT017YY0003' })).toBe(false);
  });
});

describe('matchTeacher (decision 6: existing teacher name, exact after trim)', () => {
  const teachers = [
    { slug: 'peng-dina', name_km: 'លោកម្ចាស់គ្រូ ពុទ្ធិកាលង្ការ ផេង ឌីណា', name_en: 'Ven. Puthikalongkar Peng Dina' },
    { slug: 'sor-ratha', name_km: 'លោកម្ចាស់គ្រូ សុភប្បញ្ញោ ស រដ្ឋា', name_en: 'Ven. Subhapanyo Sor Ratha' },
  ];
  it('matches when the full teacher name_en appears in the sheet name', () => {
    expect(matchTeacher('Ven. Subhapanyo Sor Ratha.xlsx', teachers)).toMatchObject({ slug: 'sor-ratha' });
  });
  it('does NOT match a partial/short name (never guesses)', () => {
    expect(matchTeacher('លោកម្ចាស់ ផេង ឌីណា.xlsx', teachers)).toBeNull(); // not the full name_km
    expect(matchTeacher('Ven. Sor.xlsx', teachers)).toBeNull();
  });
  it('an empty / unknown name → null', () => {
    expect(matchTeacher('', teachers)).toBeNull();
    expect(matchTeacher('E-Book.xlsx', teachers)).toBeNull();
  });
});

describe('courseTitle (decision 1/3: TITLE column of the section row, not the code cell)', () => {
  it('reads the title cell of the section row (num 0) above the first lesson', () => {
    const t = tab('Tab', [{ num: '1', code: 'C0001', mp3: 'A' }], { section: { title: 'កុមារ វេស្សន្តរ', code: 'C00' } });
    // rows: 1 link-labels, 2 header, 3 section(num 0), 4 first lesson
    const cols = { number: 0, title: 2 };
    expect(courseTitle(t.text, cols, 2, 4, 'Tab')).toEqual({ title: 'កុមារ វេស្សន្តរ', missing: false });
  });
  it('empty title cell → tab name, flagged missing', () => {
    const t = tab('My Tab', [{ num: '1', code: 'C0001', mp3: 'A' }]); // no section row
    const cols = { number: 0, title: 2 };
    expect(courseTitle(t.text, cols, 2, 3, 'My Tab')).toEqual({ title: 'My Tab', missing: true });
  });
});

describe('pickSource / lessonIdOf', () => {
  it('MP3 → MP4 → MiniCourse; pilot keeps MiniCourse', () => {
    expect(pickSource({ mp3: ['A'], mp4: ['B'], minicourse: ['C'], original: ['O'] })).toEqual({ id: 'A', from: 'mp3' });
    expect(pickSource({ mp3: ['A'], mp4: [], minicourse: ['C'], original: [] }, { pilot: true })).toEqual({ id: 'C', from: 'minicourse' });
  });
  it('lesson id = code, else d-<source id>, else null', () => {
    expect(lessonIdOf({ lesson_code: 'AJAD0001' }, 'DRV')).toBe('AJAD0001');
    expect(lessonIdOf({ lesson_code: '' }, 'DRV')).toBe('d-DRV');
    expect(lessonIdOf({ lesson_code: '' }, null)).toBeNull();
  });
});

describe('planCatalogue (decisions 1–6)', () => {
  const teachers = [{ slug: 'yon-yi', name_km: 'x', name_en: 'Ven. Aggacitto Yon Yi' }];
  const files = [{
    file_id: 'FILE_Y', file_name: 'Ven.Yon Yi.xlsx',
    tabs: [
      tab('Course A', [
        { num: '1', code: 'AJAD0001', mp3: 'MP3A' },
        { num: '2', code: 'AJAD0002', mp4: 'MP4B' },
        { num: '3', code: '', mp3: 'MP3C' },            // no code → d-<id>
        { num: '4', code: 'AJAD0004' },                  // no source → hidden
        { num: '5', code: 'AJAD0005', mp3: 'MP3A' },      // duplicate source id → hidden
      ], { section: { title: 'Course A Title', code: 'AJAD00' } }),
      tab('7-មលិន្ទប្បញ្ហា', [{ num: '1', code: 'X1', mp3: 'Z1' }]), // hidden tab
    ],
  }, {
    file_id: 'FILE_UNMAPPED', file_name: 'Someone Unknown.xlsx',
    tabs: [tab('Course B', [{ num: '1', code: 'B0001', mp3: 'MP3Z' }])],
  }, {
    file_id: '1KjWMiLWRJM2wqleHzNAH23sdYRRvUVX3', file_name: 'E-Book.xlsx', // non-course
    tabs: [tab('E-Book', [{ num: '1', code: 'E1', mp3: 'MP3E' }])],
  }];
  const opts = {
    teacherFiles: { FILE_Y: 'yon-yi' },
    teachers,
    courseIds: { 'FILE_Y\tCourse A': 'c042' },
    approved: new Set([DID('MP3A'), DID('MP4B')]),
    inManifest: new Set([DID('MP3A')]),
  };

  it('reuses a registered id; title from the section row; pilot untouched', () => {
    const { courses } = planCatalogue(files, opts);
    const a = courses.find((c) => c.tab === 'Course A');
    expect(a.course_id).toBe('c042');
    expect(a.title).toBe('Course A Title');
    expect(a.title_missing).toBe(false);
  });

  it('decision 5: a non-course file is excluded entirely', () => {
    const { courses, unmappedFiles } = planCatalogue(files, opts);
    expect(courses.some((c) => c.file_id === '1KjWMiLWRJM2wqleHzNAH23sdYRRvUVX3')).toBe(false);
    expect(unmappedFiles.some((u) => u.file_id === '1KjWMiLWRJM2wqleHzNAH23sdYRRvUVX3')).toBe(false);
    expect(NON_COURSE_FILES.has('1KjWMiLWRJM2wqleHzNAH23sdYRRvUVX3')).toBe(true);
  });

  it('decision 2: a section row (num 0) is not a lesson', () => {
    const { courses } = planCatalogue(files, opts);
    const a = courses.find((c) => c.tab === 'Course A');
    // 5 numbered rows (1..5); the section row (num 0) is NOT counted.
    expect(a.lessons).toBe(5);
  });

  it('decision 3: dup checks run before the teacher check; first kept, later hidden', () => {
    const { hidden } = planCatalogue(files, opts);
    expect(hidden.find((h) => h.num === '5').reason).toMatch(new RegExp(`duplicate source id ${DID('MP3A')}`));
    expect(hidden.find((h) => h.num === '4').reason).toMatch(/no source/);
  });

  it('decision 1: ids = code, else d-<id>; visible = approved only; queueable incl. unapproved', () => {
    const { courses } = planCatalogue(files, opts);
    const a = courses.find((c) => c.tab === 'Course A');
    expect(a.visible.map((l) => l.lesson_id)).toEqual(['AJAD0001', 'AJAD0002']);
    expect(a.queueable.map((l) => l.lesson_id)).toEqual(['AJAD0001', 'AJAD0002', `d-${DID('MP3C')}`]);
    expect(a.queueable[0].num_sort).toBe(1); // decision 4 numeric sort value
  });

  it('decision 6: an unmapped file (no registry, no name match) → listed, no visible', () => {
    const { courses, unmappedFiles } = planCatalogue(files, opts);
    const b = courses.find((c) => c.tab === 'Course B');
    expect(b.teacher).toBeNull();
    expect(b.visible).toEqual([]);
    expect(unmappedFiles.map((u) => u.file_id)).toContain('FILE_UNMAPPED');
  });

  it('decision 6: a name-matched file gets its slug (from matchTeacher), recorded', () => {
    const files2 = [{ file_id: 'FX', file_name: 'Ven. Aggacitto Yon Yi.xlsx', tabs: [tab('C', [{ num: '1', code: 'Z0001', mp3: 'ZZ' }])] }];
    const { matchedFiles, courses } = planCatalogue(files2, { teachers, approved: new Set(), inManifest: new Set() });
    expect(matchedFiles.FX).toMatchObject({ slug: 'yon-yi' });
    expect(courses[0].teacher).toBe('yon-yi');
  });

  it('decision 3: a duplicate code across courses is caught by the dup check, so no id collision reaches the build-fail guard', () => {
    // The dup-code check (global, before teacher) hides the 2nd SAME-coded row,
    // so only one becomes visible → the backstop idCollisions stays empty.
    const dupFiles = [{
      file_id: 'F1', file_name: 'Ven. Aggacitto Yon Yi.xlsx',
      tabs: [
        tab('T1', [{ num: '1', code: 'SAME0001', mp3: 'S1' }]),
        tab('T2', [{ num: '1', code: 'SAME0001', mp3: 'S2' }]),
      ],
    }];
    const { idCollisions, hidden } = planCatalogue(dupFiles, { teachers, approved: new Set([DID('S1'), DID('S2')]), inManifest: new Set() });
    expect(idCollisions.length).toBe(0); // the dup guard prevented it
    expect(hidden.some((h) => /duplicate lesson code SAME0001/.test(h.reason))).toBe(true);
  });

  it('hidden tab 7-មលិន្ទប្បញ្ហា is excluded and in HIDDEN_TABS', () => {
    expect(HIDDEN_TABS).toContain('7-មលិន្ទប្បញ្ហា');
    const { courses } = planCatalogue(files, opts);
    expect(courses.some((c) => c.tab === '7-មលិន្ទប្បញ្ហា')).toBe(false);
  });
});

describe('queueFor / pilotAliases (decisions 7 & 1)', () => {
  it('queue excludes ids already in the manifest, keeps order', () => {
    expect(queueFor({ queueable: [{ source_id: 'A' }, { source_id: 'B' }, { source_id: 'C' }] }, new Set(['B']))).toEqual(['A', 'C']);
  });
  it('pilot aliases map c080-l0NN → the lesson id in order (all lessons)', () => {
    expect(pilotAliases({ queueable: [{ lesson_id: 'AJAD00YYX0101' }, { lesson_id: 'AJAD00YYX0102' }] }))
      .toEqual({ 'c080-l001': 'AJAD00YYX0101', 'c080-l002': 'AJAD00YYX0102' });
  });
  it('no pilot course → empty alias map', () => {
    expect(pilotAliases(undefined)).toEqual({});
  });
});
