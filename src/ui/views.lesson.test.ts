import { describe, it, expect } from 'vitest';
import { lessonView } from './views';
import type { Course, Lesson } from '../data/catalog';

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

function lesson(kind: Lesson['media'][number]['kind'], src: string, title = 'x'): Lesson {
  return { id: 'c001-l001', num: 1, title_km: title, topic: '', media: [{ kind, src }] };
}

const render = (l: Lesson) => lessonView(courseWith(l), l, {}, state, [], false, 1, 0, false);

describe('P-14 real embed', () => {
  it('acast lesson renders an iframe with the stored embed src', () => {
    const src = 'https://embed.acast.com/abc/def?subscribe=false';
    const html = render(lesson('acast', src));
    expect(html).toContain(`<iframe src="${src}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allow="autoplay; encrypted-media; fullscreen"');
    expect(html).toContain(`href="${src}"`);
    expect(html).toContain('target="_blank"');
  });

  it('drive lesson NEVER embeds: shows the coming-soon notice, no iframe, no link', () => {
    const src = 'https://drive.google.com/file/d/ABC123/preview';
    const html = render(lesson('drive', src));
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain(src);
    expect(html).toContain('កំពុងរៀបចំ');
  });

  it('youtube lesson renders an iframe with the stored embed src', () => {
    const src = 'https://www.youtube.com/embed/PmLkMEU2eOs';
    const html = render(lesson('youtube', src));
    expect(html).toContain(`<iframe src="${src}"`);
  });

  it('a lesson with no media still shows the offline notice', () => {
    const l: Lesson = { id: 'c001-l001', num: 1, title_km: 'x', topic: '', media: [] };
    expect(render(l)).toContain('class="empty"');
  });
});

describe('display-only .mp4/.mp3 trimming in the lesson title', () => {
  it('hides a trailing .mp4 in the lesson heading', () => {
    const html = render(lesson('youtube', 'https://www.youtube.com/embed/x', 'talk one.mp4'));
    expect(html).toContain('talk one');
    expect(html).not.toContain('talk one.mp4');
  });
});
