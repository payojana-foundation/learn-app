import { describe, it, expect } from 'vitest';
import { planCatalogue, pickSource, lessonIdOf, courseTitle, queueFor, pilotAliases, HIDDEN_TABS } from '../catalogue-build.mjs';

const T = { title: 'ចំណងជើង មេរៀន', code: 'លេខកូដមេរៀន', teacher: 'ឈ្មោះគ្រូ' };
// Drive ids must be ≥ 20 chars to be recognised (sheets-map ID regex); pad.
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const d = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;

/** A tab: optional section title row, link labels, header row, then lessons.
 * cols: 0 number · 1 teacher · 2 title · 3 code · 4 MP3 · 5 MP4 · 6 MiniCourse. */
function tab(name, lessons, { section = 'Course Title Row', labelRow = true } = {}) {
  const text = [];
  if (section !== null) text.push([section, '', '', '', '', '', '']);
  text.push(['', '', '', '', 'MP3 link', 'MP4 link', 'Video for MiniCourse']);
  if (labelRow) text.push(['ល.រ', T.teacher, T.title, T.code, '', '', '']);
  for (const l of lessons) {
    text.push([l.num, 'teacher cell', l.title ?? `title ${l.num}`, l.code ?? '', l.mp3 ? d(l.mp3) : '', l.mp4 ? d(l.mp4) : '', l.mini ? d(l.mini) : '']);
  }
  const links = text.map((r) => r.map(() => ''));
  return { name, text, links };
}

describe('pickSource (decision 5: MP3 → MP4 → MiniCourse; pilot keeps MiniCourse)', () => {
  it('prefers cut MP3, then MP4, then MiniCourse; never the original', () => {
    expect(pickSource({ mp3: ['A'], mp4: ['B'], minicourse: ['C'], original: ['O'] })).toEqual({ id: 'A', from: 'mp3' });
    expect(pickSource({ mp3: [], mp4: ['B'], minicourse: ['C'], original: ['O'] })).toEqual({ id: 'B', from: 'mp4' });
    expect(pickSource({ mp3: [], mp4: [], minicourse: ['C'], original: ['O'] })).toEqual({ id: 'C', from: 'minicourse' });
    expect(pickSource({ mp3: [], mp4: [], minicourse: [], original: ['O'] })).toEqual({ id: null, from: null });
  });
  it('the pilot course takes the MiniCourse id even when a cut MP3 exists', () => {
    expect(pickSource({ mp3: ['A'], mp4: [], minicourse: ['C'], original: [] }, { pilot: true })).toEqual({ id: 'C', from: 'minicourse' });
  });
});

describe('lessonIdOf (decision 1)', () => {
  it('uses the audio lesson code when present', () => {
    expect(lessonIdOf({ lesson_code: 'AJAD00YYX0101' }, 'DRV')).toBe('AJAD00YYX0101');
  });
  it('falls back to d-<drive id> when there is no code', () => {
    expect(lessonIdOf({ lesson_code: '' }, 'DRV')).toBe('d-DRV');
  });
  it('null when neither code nor source id', () => {
    expect(lessonIdOf({ lesson_code: '' }, null)).toBeNull();
  });
});

describe('courseTitle (decision 3)', () => {
  it('reads the single-cell section row above the first lesson, byte-for-byte', () => {
    const t = tab('Tab', [{ num: '1', code: 'C1', mp3: 'A' }]);
    const first = 4; // section row 1, labels 2, header 3, lesson row 4
    expect(courseTitle(t.text, first, 'Tab')).toEqual({ title: 'Course Title Row', missing: false });
  });
  it('falls back to the tab name and flags missing when there is no section row', () => {
    const t = tab('My Tab', [{ num: '1', code: 'C1', mp3: 'A' }], { section: null });
    const first = 3;
    expect(courseTitle(t.text, first, 'My Tab')).toEqual({ title: 'My Tab', missing: true });
  });
});

describe('planCatalogue (decisions 1–6)', () => {
  const files = [{
    file_id: 'FILE_Y',
    file_name: 'Ven.Yon Yi.xlsx',
    tabs: [
      tab('Course A', [
        { num: '1', code: 'AJAD0001', mp3: 'MP3A' },
        { num: '2', code: 'AJAD0002', mp4: 'MP4B' },
        { num: '3', code: '', mp3: 'MP3C' },            // no code → d-<id>
        { num: '4', code: 'AJAD0004' },                  // no source → hidden
        { num: '5', code: 'AJAD0005', mp3: 'MP3A' },      // duplicate source id → hidden
      ]),
      tab('7-មលិន្ទប្បញ្ហា', [{ num: '1', code: 'X', mp3: 'Z' }]), // hidden tab
    ],
  }, {
    file_id: 'FILE_UNMAPPED',
    file_name: 'Someone.xlsx',
    tabs: [tab('Course B', [{ num: '1', code: 'B1', mp3: 'MP3Z' }])],
  }];
  const opts = {
    teacherFiles: { FILE_Y: 'yon-yi' },              // FILE_UNMAPPED is NOT mapped
    courseIds: { 'FILE_Y\tCourse A': 'c042' },        // reuse an existing id
    approved: new Set([DID('MP3A'), DID('MP4B')]),    // lesson 3's d- source not approved
    inManifest: new Set([DID('MP3A')]),
  };

  it('reuses a registered course id and assigns the next free for new tabs', () => {
    const { courses, registry } = planCatalogue(files, opts);
    const a = courses.find((c) => c.tab === 'Course A');
    expect(a.course_id).toBe('c042'); // reused, never renumbered
    expect(registry['FILE_Y\tCourse A']).toBe('c042');
  });

  it('decision 1 lesson ids: code when present, else d-<source id>', () => {
    const { courses } = planCatalogue(files, opts);
    const a = courses.find((c) => c.tab === 'Course A');
    expect(a.visible.map((l) => l.lesson_id)).toEqual(['AJAD0001', 'AJAD0002']); // only approved are visible
    expect(a.queueable.map((l) => l.lesson_id)).toEqual(['AJAD0001', 'AJAD0002', `d-${DID('MP3C')}`]); // sourced, incl. not-yet-approved
    // lesson 3 (no code) is hidden-until-approved but its id is d-<MP3C id>
    const { hidden } = planCatalogue(files, opts);
    expect(hidden.find((h) => h.num === '3').lesson_id).toBe(`d-${DID('MP3C')}`);
  });

  it('decision 6 hidden reasons: no source, duplicate source, hidden tab, unmapped file, not-approved', () => {
    const { hidden, unmappedFiles } = planCatalogue(files, opts);
    expect(hidden.find((h) => h.num === '4').reason).toMatch(/no source/);
    expect(hidden.find((h) => h.num === '5').reason).toMatch(new RegExp(`duplicate source id ${DID('MP3A')}`));
    expect(hidden.some((h) => /hidden tab/.test(h.reason))).toBe(true);
    expect(hidden.find((h) => h.num === '3').reason).toMatch(/no approved manifest entry/);
    expect(unmappedFiles.map((u) => u.file_id)).toEqual(['FILE_UNMAPPED']);
    // every lesson of the unmapped file is hidden "teacher file not mapped"
    expect(hidden.some((h) => h.reason === 'teacher file not mapped')).toBe(true);
  });

  it('decision 4: an unmapped file yields NO visible lessons (slug never guessed)', () => {
    const { courses } = planCatalogue(files, opts);
    const b = courses.find((c) => c.tab === 'Course B');
    expect(b.teacher).toBeNull();
    expect(b.visible).toEqual([]);
  });

  it('hidden tab 7-មលិន្ទប្បញ្ហា is in HIDDEN_TABS and produces no course rows', () => {
    expect(HIDDEN_TABS).toContain('7-មលិន្ទប្បញ្ហា');
    const { courses } = planCatalogue(files, opts);
    expect(courses.some((c) => c.tab === '7-មលិន្ទប្បញ្ហា')).toBe(false);
  });
});

describe('queueFor / pilotAliases (decisions 7 & 1)', () => {
  it('queue excludes ids already in the manifest, keeps lesson order', () => {
    const course = { queueable: [{ source_id: 'A' }, { source_id: 'B' }, { source_id: 'C' }] };
    expect(queueFor(course, new Set(['B']))).toEqual(['A', 'C']);
  });
  it('pilot aliases map c080-l0NN → the lesson id in order (all lessons)', () => {
    const pilot = { queueable: [{ lesson_id: 'AJAD00YYX0101' }, { lesson_id: 'AJAD00YYX0102' }] };
    expect(pilotAliases(pilot)).toEqual({ 'c080-l001': 'AJAD00YYX0101', 'c080-l002': 'AJAD00YYX0102' });
  });
  it('no pilot course → empty alias map', () => {
    expect(pilotAliases(undefined)).toEqual({});
  });
});
