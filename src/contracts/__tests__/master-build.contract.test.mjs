import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { buildFromMaster, shownRows, khmerNumber, approvedIdGuard, isHardFail } from '../../../scripts/build-courses.mjs';
import { parseCsvObjects } from '../../../scripts/master/csv.mjs';
// Contract tests for bulk 09 (P-14 r2 only, P-19 per-lesson release, P-29 master source).
// Placeholder ids and strings only, never real titles. Real-data checks read the committed
// public/data and data/master (data-check keeps public/data a faithful build of them).

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const teachers = [{ slug: 't-one', name_km: 'teacher-one-name' }, { slug: 't-two', name_km: 'teacher-two-name' }];
const lessonCols = ['row_key', 'lesson_id', 'course_id', 'teacher', 'course_title_km', 'lesson_no', 'lesson_title', 'mp3_link', 'mp4_link', 'minicourse_link', 'source_type', 'learn_live'];
let seq = 0;
const row = (o) => ({ ...Object.fromEntries(lessonCols.map((k) => [k, ''])), row_key: `M${++seq}`, teacher: 'teacher-one-name', course_title_km: 'course title', source_type: 'mp3', ...o });
const man = (id, status = 'approved', extra = {}) => ({ drive_file_id: DID(id), key: `audio/${id}-a64.mp3`, duration_s: 60, status, ...extra });
const course = (course_id, extra = {}) => ({ course_id, course_title_km: `title ${course_id}`, teacher: 'teacher-one-name', lesson_count: '0', course_status: '', ...extra });
const build = (rows, courses, manifest) => buildFromMaster(rows, courses, teachers, manifest);

describe('P-19 per-lesson release: only approved lessons appear', () => {
  const rows = [
    row({ course_id: 'c001', lesson_id: 'L1', lesson_no: '1', mp3_link: url('A') }),
    row({ course_id: 'c001', lesson_id: 'L2', lesson_no: '2', mp3_link: url('B') }),
    row({ course_id: 'c001', lesson_id: 'L3', lesson_no: '3', mp3_link: url('C') }),
    row({ course_id: 'c001', lesson_id: 'L4', lesson_no: '4' }), // no source
  ];
  const manifest = [man('A'), man('B', 'DRAFT – needs reviewer approval'), man('Z')];
  const out = build(rows, [course('c001')], manifest);
  it('shows the approved lesson only (DRAFT, missing and sourceless rows stay hidden)', () => {
    expect(out.courses.map((c) => c.id)).toEqual(['c001']);
    expect(out.courses[0].lessons.map((l) => l.id)).toEqual(['L1']);
    expect(out.issues.filter((i) => i.kind === 'lesson_hidden').map((i) => i.detail).sort()).toEqual(['no approved media yet', 'no approved media yet', 'no source']);
  });
  it('a course with ONE approved lesson appears with only that lesson', () => {
    expect(out.catalog.courses[0].lesson_count).toBe(1);
    expect(out.catalog.courses[0].all_shown).toBe(false);
    expect(out.courses[0].lessons[0]).toEqual({ id: 'L1', num: 1, title_km: '', topic: '', media: [{ kind: 'r2', src: 'audio/A-a64.mp3', duration_s: 60 }] });
  });
  it('a course with no approved lesson is hidden and reported', () => {
    const o = build([row({ course_id: 'c002', lesson_id: 'M1', lesson_no: '1', mp3_link: url('Q') })], [course('c002')], []);
    expect(o.courses).toEqual([]);
    expect(o.issues.some((i) => i.kind === 'course_hidden' && i.course_id === 'c002')).toBe(true);
  });
  it('all_shown is true only when every lesson row of the course is shown', () => {
    const o = build([row({ course_id: 'c001', lesson_id: 'L1', lesson_no: '1', mp3_link: url('A') })], [course('c001')], [man('A')]);
    expect(o.catalog.courses[0].all_shown).toBe(true);
  });
  it('the media is the Drive id of the source_type link; the first row wins a shared source', () => {
    const r = [
      row({ course_id: 'c001', lesson_id: 'X1', lesson_no: '1', source_type: 'minicourse', mp3_link: url('A'), minicourse_link: url('B') }),
      row({ course_id: 'c001', lesson_id: 'X2', lesson_no: '2', source_type: 'mp3', mp3_link: url('B') }),
      row({ course_id: 'c002', lesson_id: 'Y1', lesson_no: '1', source_type: 'mp3', mp3_link: url('B') }),
    ];
    const o = build(r, [course('c001'), course('c002')], [man('B')]);
    expect(o.courses.map((c) => [c.id, c.lessons.map((l) => l.id)])).toEqual([['c001', ['X1']]]);
    expect(shownRows(r, [man('B')]).hidden.get(r[1])).toMatch(/duplicate source/);
  });
  it('rows without a course id (the hidden tab) are never shown and claim no source', () => {
    const r = [row({ course_id: '', lesson_id: 'H', lesson_no: '1', mp3_link: url('A') }), row({ course_id: 'c001', lesson_id: 'L1', lesson_no: '1', mp3_link: url('A') })];
    expect(build(r, [course('c001')], [man('A')]).courses[0].lessons.map((l) => l.id)).toEqual(['L1']);
  });
});

describe('lesson order', () => {
  it('lesson_no as a number (Khmer digits count); ties and non-numbers by sheet row', () => {
    const k = (n) => [...String(n)].map((d) => String.fromCodePoint(0x17e0 + Number(d))).join('');
    const r = ['10', k(2), '2', 'x', '1'].map((no, i) => row({ course_id: 'c001', lesson_id: `L${i}`, lesson_no: no, mp3_link: url(`S${i}`) }));
    const o = build(r, [course('c001')], r.map((_, i) => man(`S${i}`)));
    expect(o.courses[0].lessons.map((l) => l.id)).toEqual(['L4', 'L1', 'L2', 'L0', 'L3']);
    expect(o.courses[0].lessons.map((l) => l.num)).toEqual([1, 2, 2, 10, 5]);
    expect(o.issues.some((i) => i.kind === 'lesson_no_not_number')).toBe(true);
    expect(o.issues.some((i) => i.kind === 'duplicate-num')).toBe(true);
    expect(khmerNumber(k(10))).toBe(10);
    expect(khmerNumber('abc')).toBe(-1);
  });
});

describe('ongoing label data (P-29)', () => {
  it('ongoing is true only for course_status = ongoing', () => {
    const r = ['c001', 'c002', 'c003'].map((c, i) => row({ course_id: c, lesson_id: `L${i}`, lesson_no: '1', mp3_link: url(`S${i}`) }));
    const o = build(r, [course('c001', { course_status: 'ongoing' }), course('c002', { course_status: 'complete' }), course('c003')], r.map((_, i) => man(`S${i}`)));
    expect(o.catalog.courses.map((c) => c.ongoing)).toEqual([true, false, false]);
    expect(o.courses.map((c) => c.ongoing)).toEqual([true, false, false]);
  });
});

describe('teacher', () => {
  const r = [row({ course_id: 'c001', lesson_id: 'L1', lesson_no: '1', mp3_link: url('A') })];
  it('pending teacher: the course is hidden and reported (not a failure)', () => {
    const o = build(r, [course('c001', { teacher: 'pending' })], [man('A')]);
    expect(o.courses).toEqual([]);
    const i = o.issues.find((x) => x.detail.includes('pending'));
    expect(i.kind).toBe('course_hidden');
    expect(isHardFail(i)).toBe(false);
  });
  it('a teacher name that maps to no slug is a hard fail; a mapped one gets its slug', () => {
    const bad = build(r, [course('c001', { teacher: 'nobody' })], [man('A')]);
    expect(bad.issues.some((i) => isHardFail(i))).toBe(true);
    expect(build(r, [course('c001', { teacher: 'teacher-two-name' })], [man('A')]).courses[0].teacher_slug).toBe('t-two');
  });
});

describe('Khmer / title byte equality', () => {
  it('titles are copied exactly (zero-width, NBSP, outer spaces, quotes)', () => {
    const odd = ' \u1780\u17B6\u200B\u00A0"x",y ';
    const r = [row({ course_id: 'c001', lesson_id: 'L1', lesson_no: '1', lesson_title: odd, mp3_link: url('A') })];
    const o = build(r, [course('c001', { course_title_km: odd })], [man('A')]);
    expect(o.courses[0].title_km).toBe(odd);
    expect(o.courses[0].lessons[0].title_km).toBe(odd);
    expect(o.catalog.courses[0].title_km).toBe(odd);
    expect(o.catalog.courses[0].title_en).toBeNull();
  });
});

describe('id guard (gap 8)', () => {
  const prev = [{ id: 'c001', lessons: [{ id: 'L1', media: [{ kind: 'r2' }] }, { id: 'L2', media: [{ kind: 'r2' }] }] }];
  const now = [{ id: 'c001', lessons: [{ id: 'L1' }] }];
  it('an approved lesson id that disappears is reported, unless it is a key of id-aliases', () => {
    expect(approvedIdGuard(prev, now, {})).toEqual([{ course_id: 'c001', lesson_id: 'L2' }]);
    expect(approvedIdGuard(prev, now, { L2: 'L9' })).toEqual([]);
    expect(approvedIdGuard([], now, {})).toEqual([]);
    expect(approvedIdGuard([{ id: 'c1', lessons: [{ id: 'old', media: [] }] }], now, {})).toEqual([]); // no approved media before
  });
  it('X: a removed lesson is accepted when its id is in the retired list; an unlisted one still fails', () => {
    expect(approvedIdGuard(prev, now, {}, ['L2'])).toEqual([]);
    expect(approvedIdGuard(prev, now, {}, ['other'])).toEqual([{ course_id: 'c001', lesson_id: 'L2' }]);
    expect(approvedIdGuard(prev, now, {}, [])).toEqual([{ course_id: 'c001', lesson_id: 'L2' }]);
    expect(approvedIdGuard(prev, now, {}, undefined)).toEqual([{ course_id: 'c001', lesson_id: 'L2' }]);
  });
  it('X: aliases stay for real id changes, retired is separate (each works alone, neither covers the other)', () => {
    expect(approvedIdGuard(prev, now, { L2: 'L9' }, [])).toEqual([]);
    expect(approvedIdGuard(prev, now, {}, ['L2'])).toEqual([]);
    const both = [{ id: 'c001', lessons: [{ id: 'L2', media: [{ kind: 'r2' }] }, { id: 'L3', media: [{ kind: 'r2' }] }] }];
    expect(approvedIdGuard(both, [{ id: 'c001', lessons: [] }], { L2: 'L9' }, ['L3'])).toEqual([]);
    expect(approvedIdGuard(both, [{ id: 'c001', lessons: [] }], { L2: 'L9' }, [])).toEqual([{ course_id: 'c001', lesson_id: 'L3' }]);
  });
  it('X: data/retired-lessons.json is a list of strings (empty now)', () => {
    const r = JSON.parse(readFileSync('data/retired-lessons.json', 'utf-8'));
    expect(Array.isArray(r)).toBe(true);
    expect(r.every((x) => typeof x === 'string' && x !== '')).toBe(true);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe('real served data (public/data) vs the master export', () => {
  const dir = 'public/data/courses';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const courses = files.map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8')));
  const catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf-8'));
  it('no acast / youtube / drive media kind anywhere; src is a bare R2 key', () => {
    for (const c of courses) for (const l of c.lessons) for (const m of l.media) {
      expect(m.kind).toBe('r2');
      expect(m.src).not.toMatch(/^https?:/);
    }
    for (const c of catalog.courses) expect(c.media_kinds).toEqual(['r2']);
    expect(readFileSync('public/data/manifest.json', 'utf-8')).not.toMatch(/acast\.com|youtube|drive\.google/);
  });
  it('catalog and course files agree; the folder holds exactly the catalog courses', () => {
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual(catalog.courses.map((c) => c.id).sort());
    for (const cc of catalog.courses) {
      const c = courses.find((x) => x.id === cc.id);
      expect(cc.lesson_count).toBe(c.lessons.length);
      expect(c.lessons.length).toBeGreaterThan(0); // a course is shown only with >= 1 shown lesson
    }
  });
  it('Khmer byte equality: every title equals the master export byte for byte', () => {
    if (!existsSync('data/master/lessons.csv')) return;
    const lessons = new Map(parseCsvObjects(readFileSync('data/master/lessons.csv', 'utf-8')).map((r) => [r.lesson_id, r]));
    const crs = new Map(parseCsvObjects(readFileSync('data/master/courses.csv', 'utf-8')).map((r) => [r.course_id, r]));
    for (const c of courses) {
      expect(c.title_km).toBe(crs.get(c.id).course_title_km);
      for (const l of c.lessons) expect(l.title_km).toBe(lessons.get(l.id).lesson_title);
    }
  });
  it('P-14: public/_headers frames nothing (frame-src none, no embed host)', () => {
    const h = readFileSync('public/_headers', 'utf-8');
    expect(h).toMatch(/frame-src 'none'/);
    expect(h).not.toMatch(/acast|youtube|drive\.google/i);
  });
  it('P-19: the served catalog marks ongoing and all_shown for every course', () => {
    for (const c of catalog.courses) {
      expect(typeof c.ongoing).toBe('boolean');
      expect(typeof c.all_shown).toBe('boolean');
    }
  });
  it('every shown lesson is approved in the media manifest (same key), nothing else', () => {
    const manifest = JSON.parse(readFileSync('data/media-manifest.json', 'utf-8'));
    const approved = new Set(manifest.filter((e) => /^approved\b/i.test(e.status || '')).map((e) => e.key));
    for (const c of courses) for (const l of c.lessons) expect(approved.has(l.media[0].src)).toBe(true);
  });
});
