/**
 * P-14 (15 Nov, change protected: P-14): Learn plays only its own R2 media: audio,
 * and video when an approved entry exists. Watch / Listen toggle, Listen default,
 * no embed or iframe in any state; nothing visible when there is no video (switch off).
 * Placeholder titles and keys only.
 */
import { describe, it, expect } from 'vitest';
import { lessonView, courseCard, courseView } from './views';
import type { Course, Lesson, CatalogCourse } from '../data/catalog';
import { carryPosition } from '../audio/carry';

const state = { lang: 'en' as const, topic: 'all', savedIds: new Set<string>() };
const audioOnly: Lesson = { id: 'c900-l001', num: 1, title_km: 'x', topic: '', media: [{ kind: 'r2', src: 'audio/0000000000000001-a64.mp3', duration_s: 60 }] };
const withVideo: Lesson = { ...audioOnly, video: { src: 'video/0000000000000001-480p.mp4', poster: 'video/0000000000000001-480p.webp', duration_s: 60 } };
const course = (l: Lesson): Course => ({ id: 'c900', provisional: false, title_km: 'x', title_en: null, teacher: 't', teacher_slug: 't', topics: [], lessons: [l] });
const view = (l: Lesson, mode?: 'listen' | 'watch') => lessonView(course(l), l, {}, state, [], false, 1, 0, false, mode);

describe('P-14 video off (no approved video / switch off): nothing visible changes', () => {
  it('no toggle, no video slot, audio player as before', () => {
    const h = view(audioOnly);
    expect(h).not.toContain('data-mode');
    expect(h).not.toContain('data-video-slot');
    expect(h).toContain('data-player');
    expect(h).toContain('♪ MP3');
    expect(view(audioOnly, 'watch')).not.toContain('data-video-slot'); // a stale mode cannot show video
  });
  it('course card and lesson row carry no video mark', () => {
    const cc: CatalogCourse = { id: 'c900', provisional: false, title_km: 'x', title_en: null, teacher: 't', teacher_slug: 't', topics: [], lesson_count: 1, media_kinds: ['r2'] };
    expect(courseCard(cc, undefined, {}, 'en')).not.toContain('vmark');
    expect(courseView(course(audioOnly), undefined, {}, state, '', null)).not.toContain('▶');
  });
});

describe('P-14 video on: Watch / Listen toggle', () => {
  it('Listen is the default; the audio player shows, no video slot', () => {
    const h = view(withVideo);
    expect(h).toMatch(/data-mode="listen" aria-pressed="true"/);
    expect(h).toMatch(/data-mode="watch" aria-pressed="false"/);
    expect(h).not.toContain('data-video-slot');
    expect(h).toContain('♪ MP3');
  });
  it('Watch shows the video slot inside the same player controls (speed, sleep, skip kept)', () => {
    const h = view(withVideo, 'watch');
    expect(h).toMatch(/data-mode="watch" aria-pressed="true"/);
    expect(h).toContain('data-video-slot');
    expect(h).toContain('▶ MP4');
    for (const s of ['data-pp', 'data-skip="15"', 'data-speed', 'data-sleep', 'data-scrub']) expect(h).toContain(s);
  });
  it('never an iframe, embed or outside link', () => {
    for (const h of [view(withVideo), view(withVideo, 'watch')]) {
      expect(h).not.toContain('<iframe');
      expect(h).not.toContain('data-embed');
      expect(h).not.toContain('target="_blank"');
    }
  });
  it('video mark on the course card (has_video) and on the lesson row', () => {
    const cc: CatalogCourse = { id: 'c900', provisional: false, title_km: 'x', title_en: null, teacher: 't', teacher_slug: 't', topics: [], lesson_count: 1, media_kinds: ['r2'], has_video: true };
    expect(courseCard(cc, undefined, {}, 'en')).toContain('class="vmark"');
    expect(courseView(course(withVideo), undefined, {}, state, '', null)).toContain('♪ ▶');
  });
});

describe('position carries over when switching', () => {
  it('uses the element clock, else the saved point, never 0 by accident', () => {
    expect(carryPosition(42.5, 10)).toBe(42.5);
    expect(carryPosition(0, 37)).toBe(37);
    expect(carryPosition(NaN, 12)).toBe(12);
    expect(carryPosition(0, 0)).toBe(0);
  });
});
