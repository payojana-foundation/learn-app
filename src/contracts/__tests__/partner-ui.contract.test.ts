/**
 * Contract (bulk 10 P3): P-07 partner routes, P-11 partner class page exemption, partner data
 * shape, the hash-verified partner class file, partner search texts. Placeholders only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parseRoute, routePath, tabForRoute } from '../../router';
import { partnerData, isPartnerClassFile, classSearchTexts, partnerTeacherSlugs, EMPTY_PARTNERS } from '../../data/partners';
import { partnerClassView, partnersView, partnerView, partnerSearchHits } from '../../ui/partners';
import { courseView, teacherView, searchView, myView } from '../../ui/views';
import { sha256Hex, loadFile } from '../../data/loader';
import { resetDbForTests, getDataFile } from '../../db';
import type { Catalog, Course, Teacher } from '../../data/catalog';
import type { Manifest } from '../../data/types';

const U = 'a21376b7-12b0-45bc-9a7b-6f594534cb09';
const T: Teacher = { slug: 't-one', name_km: 'teacher placeholder', name_en: null, bio_km: null, bio_en: null, topics: [], photo: null };
const TB = new Map([[T.slug, T]]);
const PARTNER = { slug: 'p-one', name_km: 'partner km placeholder', name_en: 'partner en placeholder', teacher_slugs: ['t-one'], course_ids: ['yt-pl-PLx1'] };
const PCOURSE = { id: 'yt-pl-PLx1', kind: 'partner' as const, partner_slug: 'p-one', title: 'class placeholder', teacher_slugs: ['t-one'], lesson_count: 25, teaching_points: ['T1'] };
const TERM = { term_id: 'T1', term_km: 'term km', term_pali: 'term pali', term_en: 'term en', other_spellings: ['alt one'] };
const catalog = (extra: Record<string, unknown> = {}): Catalog => ({ generated: '', provisional: false, courses: [], ...extra }) as Catalog;
const ON = () => catalog({ partners: [PARTNER], partner_courses: [PCOURSE], partner_terms: [TERM], partner_retired: { courses: {}, lessons: {} } });
const lessons = Array.from({ length: 25 }, (_, i) => ({ id: `yt-${String(i).padStart(11, 'v')}`, num: i + 1, title: `lesson ${i + 1}`, duration_s: 60 }));
const FILE = { id: 'yt-pl-PLx1', kind: 'partner', partner_slug: 'p-one', title: 'class placeholder', teacher_slugs: ['t-one'], playlist_uuid: U, teaching_points: ['T1'], lessons };

describe('P-07 partner routes', () => {
  it('/partners, /partners/<slug>, /partners/<slug>/<classId> parse and round-trip; deeper = notfound', () => {
    for (const [path, route] of [
      ['/partners', { name: 'partners' }],
      ['/partners/p-one', { name: 'partner', slug: 'p-one' }],
      ['/partners/p-one/yt-pl-PLx1', { name: 'partnerClass', slug: 'p-one', classId: 'yt-pl-PLx1' }],
    ] as const) {
      expect(parseRoute(path, '')).toEqual(route);
      expect(routePath(route)).toBe(path);
      expect(tabForRoute(route)).toBe('home');
    }
    expect(parseRoute('/partners/p-one/yt-pl-PLx1/x', '')).toEqual({ name: 'notfound' });
  });
  it('existing routes unchanged', () => {
    expect(parseRoute('/courses/c001', '')).toEqual({ name: 'course', id: 'c001' });
    expect(parseRoute('/teachers/t-one', '')).toEqual({ name: 'teacher', slug: 't-one' });
    expect(parseRoute('/nope', '')).toEqual({ name: 'notfound' });
  });
});

describe('partner data shape (switch off = no partner keys = nothing)', () => {
  it('absent keys → empty; valid → data; any bad entry → empty', () => {
    expect(partnerData(catalog())).toBe(EMPTY_PARTNERS);
    expect(partnerData(null)).toBe(EMPTY_PARTNERS);
    expect(partnerData(ON()).courses.map((k) => k.id)).toEqual(['yt-pl-PLx1']);
    expect([...partnerTeacherSlugs(partnerData(ON()))]).toEqual(['t-one']);
    for (const bad of [
      { partner_courses: [{ ...PCOURSE, id: 'c001' }], partners: [PARTNER] },
      { partner_courses: [PCOURSE], partners: [{ ...PARTNER, slug: 'Bad Slug' }] },
      { partner_courses: [{ ...PCOURSE, partner_slug: 'other' }], partners: [PARTNER] },
      { partner_courses: [PCOURSE, PCOURSE], partners: [PARTNER] },
      { partner_courses: [{ ...PCOURSE, teacher_slugs: [] }], partners: [PARTNER] },
      { partner_courses: 'x', partners: [PARTNER] },
    ]) expect(partnerData(catalog(bad))).toBe(EMPTY_PARTNERS);
  });
  it('a class file is used only with the right id and a strict uuid v4', () => {
    expect(isPartnerClassFile(FILE, 'yt-pl-PLx1')).toBe(true);
    expect(isPartnerClassFile(FILE, 'yt-pl-other')).toBe(false);
    expect(isPartnerClassFile({ ...FILE, playlist_uuid: 'javascript:alert(1)' }, 'yt-pl-PLx1')).toBe(false);
    expect(isPartnerClassFile({ ...FILE, playlist_uuid: U.replace('-45bc', '-15bc') }, 'yt-pl-PLx1')).toBe(false);
    expect(isPartnerClassFile({ ...FILE, lessons: [{ id: 'c001-l001', num: 1, title: 'x' }] }, 'yt-pl-PLx1')).toBe(false);
  });
  it('search texts: title + the teaching points (term_km, term_pali, term_en, other spellings)', () => {
    expect(classSearchTexts(PCOURSE, [TERM])).toEqual(['class placeholder', 'term km', 'term pali', 'term en', 'alt one']);
  });
});

describe('P-01 partner class file through the same hash-verified loader', () => {
  beforeEach(() => resetDbForTests());
  it('stores a verified partner file under its class id; a mismatch stores nothing', async () => {
    const body = JSON.stringify(FILE);
    const sha = await sha256Hex(new TextEncoder().encode(body).buffer as ArrayBuffer);
    const m: Manifest = { generated: '', files: { 'yt-pl-PLx1': { file: 'partners/yt-pl-PLx1.json', updated: '', sha256: sha } } };
    const urls: string[] = [];
    const ok = (async (u: string) => { urls.push(u); return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    expect((await loadFile(m, 'yt-pl-PLx1', ok)).status).not.toBe('failed');
    expect(urls[0]).toBe(`/data/partners/yt-pl-PLx1.json?h=${sha}`);
    expect(await getDataFile('yt-pl-PLx1')).toEqual(FILE);
    const bad: Manifest = { generated: '', files: { 'yt-pl-PLx2': { file: 'partners/yt-pl-PLx2.json', updated: '', sha256: 'deadbeef' } } };
    expect((await loadFile(bad, 'yt-pl-PLx2', ok)).status).toBe('failed');
    expect(await getDataFile('yt-pl-PLx2')).toBeUndefined();
  });
});

describe('P-11 partner class page exemption; own course page unchanged', () => {
  const course: Course = { id: 'c900', provisional: false, title_km: 'own placeholder', title_en: null, teacher: 'x', teacher_slug: 't-one', topics: [], lessons: [{ id: 'L1', num: 1, title_km: 'l1', topic: '', media: [{ kind: 'r2', src: 'audio/x.mp3' }] }] };
  it('own course page: progress bar, percent, ticks, Start/Continue (as before)', () => {
    const h = courseView(course, T, { c900: { L1: { pos: 0, done: true } } }, { lang: 'en', topic: 'all', savedIds: new Set() }, '', null);
    expect(h).toContain('class="pbar"');
    expect(h).toContain('class="tick on"');
    expect(h).toContain('data-nav="lesson"');
  });
  it('partner class page: no progress bar, no ticks, no leaf/bud, no lesson links; sections of 20; find-in-course', () => {
    const h = partnerClassView(FILE as never, PARTNER, TB, 'en', '', undefined, 'cover');
    for (const no of ['pbar', 'class="tick', 'data-nav="lesson"', 'leaf', 'bud', '<iframe', '<script']) expect(h).not.toContain(no);
    expect((h.match(/<details/g) || []).length).toBe(2);
    expect((h.match(/<li>/g) || []).length).toBe(25);
    expect(h).toContain('from YouTube, needs internet');
    expect(h).toContain('data-kp-play');
    const f = partnerClassView(FILE as never, PARTNER, TB, 'en', 'lesson 2', undefined);
    expect((f.match(/<li>/g) || []).length).toBe(7); // 2, 20–25
    expect((partnerClassView(FILE as never, PARTNER, TB, 'en', '7', undefined).match(/<li>/g) || []).length).toBe(2); // num 7 + "lesson 17" (same rule as own courses)
  });
  it('started / mark class done only after a start; aria-pressed reflects done', () => {
    expect(partnerClassView(FILE as never, PARTNER, TB, 'en', '', undefined)).not.toContain('data-pdone');
    expect(partnerClassView(FILE as never, PARTNER, TB, 'en', '', { course_id: FILE.id, started_at: 1, done_at: null })).toContain('aria-pressed="false"');
    expect(partnerClassView(FILE as never, PARTNER, TB, 'en', '', { course_id: FILE.id, started_at: 1, done_at: 2 })).toContain('aria-pressed="true"');
  });
});

describe('partner list, partner page, teacher page, search, My Learning', () => {
  const d = partnerData(ON());
  it('names exactly as stored; km shows the DRAFT placeholder labels', () => {
    expect(partnersView(d, TB, 'km')).toContain('partner km placeholder');
    expect(partnersView(d, TB, 'en')).toContain('partner en placeholder');
    expect(partnerView(PARTNER, d, TB, 'km', {})).toContain('DRAFT – needs reviewer approval');
    expect(partnerView(PARTNER, d, TB, 'en', {})).toContain('data-nav="pclass"');
  });
  it('teacher page lists partner classes; with none the page is as before', () => {
    const own = teacherView(T, [], TB, {}, 'en');
    expect(teacherView(T, [], TB, {}, 'en', '')).toBe(own);
    expect(teacherView(T, [], TB, {}, 'en', '<section>partner</section>')).toContain('<section>partner</section>');
  });
  it('search: partner hits counted and drawn; without them the view is unchanged', () => {
    const base = searchView('zz', catalog(), [], [], [], TB, 'en');
    expect(searchView('zz', catalog(), [], [], [], TB, 'en', { count: 0, html: () => 'x' })).toBe(base);
    const h = searchView('class', catalog(), [], [], [], TB, 'en', { count: 1, html: (hl) => partnerSearchHits([PCOURSE], TB, 'en', hl) });
    expect(h).toContain('<mark>class</mark>');
    expect(h).not.toContain('Vacana');
  });
  it('My Learning: no partner cards → the In progress tab is as before', () => {
    const st = { lang: 'en' as const, topic: 'all', savedIds: new Set<string>() };
    expect(myView('inprog', catalog(), TB, {}, st, [], [], [], undefined, '')).toBe(myView('inprog', catalog(), TB, {}, st, [], [], []));
  });
});
