/**
 * P-14 (15 Nov, change protected: P-14) — build contract for R2 video.
 * Learn plays only its own R2 media: audio, and video when an APPROVED kind:"video"
 * entry exists in data/video-manifest.json and video is switched on
 * (data/video-switch.json, synced from the VIDEO_ENABLED repo variable).
 * P-19 is unchanged: a lesson shows only when its AUDIO is approved.
 * Placeholder ids and strings only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { buildFromMaster, videoLookup } from '../../../scripts/build-courses.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const teachers = [{ slug: 't-one', name_km: 'teacher-one-name' }];
let seq = 0;
const row = (o) => ({ row_key: `V${++seq}`, lesson_id: '', course_id: 'c900', teacher: 'teacher-one-name', course_title_km: 'course title', lesson_no: '1', lesson_title: '', mp3_link: '', mp4_link: '', minicourse_link: '', source_type: 'mp3', ...o });
const audio = (id, status = 'approved') => ({ drive_file_id: DID(id), key: `audio/${id}-a64.mp3`, duration_s: 60, status });
const hex = (n) => String(n).padStart(16, '0');
const vid = (id, n, status = 'approved', extra = {}) => ({ kind: 'video', drive_file_id: DID(id), key: `video/${hex(n)}-480p.mp4`, poster_key: `video/${hex(n)}-480p.webp`, rendition: '480p', duration_s: 61, status, ...extra });
const courses = [{ course_id: 'c900', course_title_km: 'title', teacher: 'teacher-one-name', course_status: '' }];
const rows = [
  row({ lesson_id: 'L1', lesson_no: '1', mp3_link: url('A1'), mp4_link: url('V1') }),
  row({ lesson_id: 'L2', lesson_no: '2', mp3_link: url('A2'), minicourse_link: url('V2') }),
  row({ lesson_id: 'L3', lesson_no: '3', mp3_link: url('A3'), mp4_link: url('V3') }), // video DRAFT
  row({ lesson_id: 'L4', lesson_no: '4', mp3_link: url('A4'), mp4_link: url('V4') }), // audio not approved
];
const audioM = [audio('A1'), audio('A2'), audio('A3'), audio('A4', 'DRAFT')];
const videoM = [vid('V1', 1), vid('V2', 2), vid('V3', 3, 'DRAFT'), vid('V4', 4)];
const build = (video) => buildFromMaster(rows, courses, teachers, audioM, video);

describe('P-14 video switch OFF: served data unchanged', () => {
  for (const [name, v] of [['no video arg', undefined], ['enabled false', { enabled: false, manifest: videoM }]]) {
    it(`${name}: no lesson.video, no has_video`, () => {
      const out = build(v);
      expect(out.courses[0].lessons.some((l) => 'video' in l)).toBe(false);
      expect('has_video' in out.catalog.courses[0]).toBe(false);
    });
  }
});

describe('P-14 video switch ON', () => {
  const out = build({ enabled: true, manifest: videoM });
  const byId = Object.fromEntries(out.courses[0].lessons.map((l) => [l.id, l]));
  it('approved video attached (mp4_link first, else MiniCourse), bare R2 key + poster', () => {
    expect(byId.L1.video).toEqual({ src: `video/${hex(1)}-480p.mp4`, poster: `video/${hex(1)}-480p.webp`, duration_s: 61 });
    expect(byId.L2.video.src).toBe(`video/${hex(2)}-480p.mp4`);
    expect(out.catalog.courses[0].has_video).toBe(true);
  });
  it('a DRAFT video is not shown; audio stays', () => {
    expect(byId.L3.video).toBeUndefined();
    expect(byId.L3.media).toEqual([{ kind: 'r2', src: 'audio/A3-a64.mp3', duration_s: 60 }]);
  });
  it('P-19 unchanged: an approved video never shows a lesson whose audio is not approved', () => {
    expect(byId.L4).toBeUndefined();
  });
  it('media stays audio only (kind r2); video is a separate field', () => {
    for (const l of out.courses[0].lessons) expect(l.media.map((m) => m.kind)).toEqual(['r2']);
    expect(out.catalog.courses[0].media_kinds).toEqual(['r2']);
  });
});

describe('poster: thumbnail_link hook', () => {
  const look = videoLookup({ enabled: true, manifest: [vid('V1', 1)] });
  it('an R2 image key in thumbnail_link overrides the grabbed frame', () => {
    const issues = [];
    expect(look(row({ mp4_link: url('V1'), thumbnail_link: 'video/team-poster.webp' }), issues, 'c900').poster).toBe('video/team-poster.webp');
    expect(issues).toEqual([]);
  });
  it('a Drive thumbnail link is not played from Drive: frame used, issue reported', () => {
    const issues = [];
    expect(look(row({ mp4_link: url('V1'), thumbnail_link: url('T1') }), issues, 'c900').poster).toBe(`video/${hex(1)}-480p.webp`);
    expect(issues.map((i) => i.kind)).toEqual(['thumbnail_not_on_r2']);
  });
});

describe('P-14 real data: video only from approved R2 entries, only when switched on', () => {
  const sw = existsSync('data/video-switch.json') ? JSON.parse(readFileSync('data/video-switch.json', 'utf-8')) : { enabled: false };
  const vm = existsSync('data/video-manifest.json') ? JSON.parse(readFileSync('data/video-manifest.json', 'utf-8')) : [];
  const approved = new Set(vm.filter((e) => e.kind === 'video' && /^approved\b/i.test(e.status || '')).map((e) => e.key));
  const files = existsSync('public/data/courses') ? readdirSync('public/data/courses').filter((f) => f.endsWith('.json')) : [];
  const served = files.map((f) => JSON.parse(readFileSync(`public/data/courses/${f}`, 'utf-8')));
  const catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf-8'));
  it('the switch file is {enabled: boolean}', () => {
    expect(typeof sw.enabled).toBe('boolean');
  });
  it('every served lesson.video is an approved bare video/ key; none when off', () => {
    for (const c of served) for (const l of c.lessons) {
      if (!l.video) continue;
      expect(sw.enabled).toBe(true);
      expect(l.video.src).toMatch(/^video\/[0-9a-f]{16}-(480p|720p)(-v\d+)?\.mp4$/);
      expect(approved.has(l.video.src)).toBe(true);
    }
  });
  it('catalog has_video agrees with the course files', () => {
    for (const cc of catalog.courses) {
      const c = served.find((x) => x.id === cc.id);
      expect(!!cc.has_video).toBe(c.lessons.some((l) => !!l.video));
    }
  });
  it('public/_headers still frames nothing', () => {
    expect(readFileSync('public/_headers', 'utf-8')).toMatch(/frame-src 'none'/);
  });
});
