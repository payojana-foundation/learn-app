import { describe, it, expect } from 'vitest';
import { lessonView, courseCard, courseView, homeView } from './views';
import type { Course, Lesson, Catalog, CatalogCourse } from '../data/catalog';
const state = { lang: 'km' as const, topic: 'all', savedIds: new Set<string>() };
function courseWith(l: Lesson): Course {
  return {
    id: 'c001',
    provisional: false,
    title_km: 'x',
    title_en: null,
    teacher: 't',
    teacher_slug: 't',
    topics: [],
    lessons: [l],
  };
}
function lesson(src: string, title = 'x'): Lesson {
  return { id: 'c001-l001', num: 1, title_km: title, topic: '', media: [{ kind: 'r2', src, duration_s: 60 }] };
}
const render = (l: Lesson) => lessonView(courseWith(l), l, {}, state, [], false, 1, 0, false);
// bulk 09 (P-14): Learn plays its own R2 audio only and renders no iframe.
describe('P-14 r2 only, no iframe', () => {
  it('an r2 lesson renders the own player and never an iframe or an external link', () => {
    const html = render(lesson('audio/abc-a64.mp3'));
    expect(html).toContain('data-player');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('data-embed');
    expect(html).not.toContain('target="_blank"');
  });
  it('a lesson with no media shows the offline notice (and still no iframe)', () => {
    const l: Lesson = { id: 'c001-l001', num: 1, title_km: 'x', topic: '', media: [] };
    const html = render(l);
    expect(html).toContain('class="empty"');
    expect(html).not.toContain('<iframe');
  });
});
describe('display-only .mp4/.mp3 trimming in the lesson title', () => {
  it('hides a trailing .mp4 in the lesson heading', () => {
    const html = render(lesson('audio/x-a64.mp3', 'talk one.mp4'));
    expect(html).toContain('talk one');
    expect(html).not.toContain('talk one.mp4');
  });
});
// bulk 09 (P-29): the ongoing label shows only for an ongoing course.
const cc = (over: Partial<CatalogCourse> = {}): CatalogCourse => ({
  id: 'c001', provisional: false, title_km: 'x', title_en: null, teacher: 't', teacher_slug: 't',
  topics: [], lesson_count: 1, media_kinds: ['r2'], ...over,
});
describe('ongoing label', () => {
  it('course card: shown only when ongoing', () => {
    expect(courseCard(cc({ ongoing: true }), undefined, {}, 'km')).toContain('class="ongoing"');
    expect(courseCard(cc({ ongoing: false }), undefined, {}, 'km')).not.toContain('ongoing');
    expect(courseCard(cc(), undefined, {}, 'km')).not.toContain('ongoing');
    expect(courseCard(cc({ ongoing: true }), undefined, {}, 'en')).toContain('>Ongoing<');
  });
  it('course page: shown only when ongoing', () => {
    const c = (ongoing?: boolean): Course => ({ ...courseWith(lesson('audio/a-a64.mp3')), ongoing });
    expect(courseView(c(true), undefined, {}, state, '', null)).toContain('class="ongoing"');
    expect(courseView(c(false), undefined, {}, state, '', null)).not.toContain('class="ongoing"');
    expect(courseView(c(), undefined, {}, state, '', null)).not.toContain('class="ongoing"');
  });
});
// bulk 09 (P-07, Q5): topic chips only when some course has topics.
describe('topic chips', () => {
  const home = (courses: CatalogCourse[]) => {
    const catalog: Catalog = { generated: 'g', provisional: false, courses };
    return homeView(catalog, [], new Map(), {}, state, [], []);
  };
  it('hidden when no course has topics', () => {
    expect(home([cc()])).not.toContain('class="chip"');
  });
  it('shown when a course has topics', () => {
    expect(home([cc({ topics: ['x'] })])).toContain('class="chip"');
  });
  it('a topic selection is ignored when no course has topics', () => {
    const catalog: Catalog = { generated: 'g', provisional: false, courses: [cc({ title_km: 'visible-title' })] };
    const html = homeView(catalog, [], new Map(), {}, { ...state, topic: 'some-topic' }, [], []);
    expect(html).toContain('visible-title');
  });
});
