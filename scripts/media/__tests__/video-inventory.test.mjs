/**
 * PART V1 — video inventory (pure aggregation + metadata fetch with a fake
 * fetch). Placeholder ids/titles only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  videoLessons, uniqueVideoIds, toMeta, fetchMeta, summarize, buildReportMd, buildCsvRows, heightBucket,
} from '../video-inventory.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ID = (n) => `id${String(n).padStart(2, '0')}xxxxxxxxxxxxxxxxxxxxxxx`;
const link = (n) => `https://drive.google.com/open?id=${ID(n)}&usp=drive_copy`;
const rows = [
  { row_key: 'r1', lesson_id: 'c900-l001', course_id: 'c900', lesson_no: '1', mp4_link: link(1), minicourse_link: link(2) },
  { row_key: 'r2', lesson_id: 'c900-l002', course_id: 'c900', lesson_no: '2', mp4_link: '', minicourse_link: link(3) },
  { row_key: 'r3', lesson_id: 'c901-l001', course_id: 'c901', lesson_no: '1', mp4_link: '', minicourse_link: '' },
  { row_key: 'r4', lesson_id: 'c901-l002', course_id: 'c901', lesson_no: '2', mp4_link: link(4), minicourse_link: '' },
  { row_key: 'r5', lesson_id: 'c901-l003', course_id: 'c901', lesson_no: '3', mp4_link: link(4), minicourse_link: '' },
];
const GB = 1024 ** 3;

describe('V1 videoLessons', () => {
  it('keeps only rows with a video link; mp4 first, then MiniCourse', () => {
    const l = videoLessons(rows);
    expect(l.map((x) => x.row_key)).toEqual(['r1', 'r2', 'r4', 'r5']);
    expect(l[0]).toMatchObject({ video_id: ID(1), video_from: 'mp4', minicourse_ids: [ID(2)] });
    expect(l[1]).toMatchObject({ video_id: ID(3), video_from: 'minicourse' });
  });
  it('unique ids cover both columns, de-duplicated', () => {
    expect(uniqueVideoIds(videoLessons(rows))).toEqual([ID(1), ID(2), ID(3), ID(4)]);
  });
});

describe('V1 metadata', () => {
  it('toMeta reads size and videoMediaMetadata', () => {
    expect(toMeta('a', { size: '2048', mimeType: 'video/mp4', videoMediaMetadata: { width: 1280, height: 720, durationMillis: '61500' } }))
      .toMatchObject({ ok: true, size: 2048, width: 1280, height: 720, duration_s: 62 });
    expect(toMeta('a', null, 'HTTP 404')).toEqual({ id: 'a', ok: false, error: 'HTTP 404' });
  });
  it('fetchMeta sends the token, asks metadata fields only, keeps order and records failures', async () => {
    const seen = [];
    const fake = async (url, opt) => {
      seen.push([url, opt.headers.Authorization]);
      if (url.includes('bad')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ size: '10' }) };
    };
    const out = await fetchMeta(['good1', 'bad', 'good2'], 'TKN', { fetchImpl: fake, concurrency: 2 });
    expect(out.map((m) => [m.id, m.ok])).toEqual([['good1', true], ['bad', false], ['good2', true]]);
    expect(seen.every(([u, a]) => a === 'Bearer TKN' && u.includes('fields=') && !u.includes('alt=media'))).toBe(true);
  });
});

describe('V1 summarize + report', () => {
  const lessons = videoLessons(rows);
  const meta = [
    toMeta(ID(1), { size: String(2 * GB), videoMediaMetadata: { height: 720, durationMillis: '3600000' } }),
    toMeta(ID(3), null, 'HTTP 403'),
    toMeta(ID(4), { size: String(1 * GB), videoMediaMetadata: { height: 360, durationMillis: '1800000' } }),
  ];
  const s = summarize(lessons, meta);
  it('totals count a shared file once and list failures', () => {
    expect(s).toMatchObject({ lessons: 4, mp4Lessons: 3, minicourseLessons: 2, files: 2, missing: 1 });
    expect(s.gb).toBeCloseTo(3);
    expect(s.hours).toBeCloseTo(1.5);
    expect(s.resolutions).toEqual({ '720–1079p': 1, '<480p': 1 });
  });
  it('by course', () => {
    expect(s.courses).toEqual([
      expect.objectContaining({ course_id: 'c900', lessons: 2, files: 1, missing: 1 }),
      expect.objectContaining({ course_id: 'c901', lessons: 2, files: 1, missing: 0 }),
    ]);
  });
  it('report + CSV', () => {
    const md = buildReportMd(s);
    expect(md).toContain('Lessons with video: **4**');
    expect(md).toContain('Total size: **3.0 GB**');
    expect(md).toContain('| c901 | 2 | 1 | 1.0 | 0.5 | 0 |');
    const csv = buildCsvRows(lessons, meta);
    expect(csv[1]).toMatchObject({ ok: 'no', error: 'HTTP 403' });
  });
  it('height buckets', () => {
    expect([0, 300, 480, 720, 1080].map(heightBucket)).toEqual(['unknown', '<480p', '480–719p', '720–1079p', '≥1080p']);
  });
});

describe('V1 workflow is read-only', () => {
  const y = readFileSync(join(here, '..', '..', '..', '.github', 'workflows', 'video-inventory.yml'), 'utf8');
  it('manual, drive.readonly, no R2, no commit', () => {
    expect(y).toMatch(/workflow_dispatch/);
    expect(y).not.toMatch(/schedule:/);
    expect(y).toMatch(/drive\.readonly/);
    expect(y).not.toMatch(/rclone|R2_ACCESS_KEY_ID|git push|contents: write/);
  });
});

// ── PART 2 (15 Nov): long runs never 401 ────────────────────────────────────
import { likelyCause, failureRows } from '../video-inventory.mjs';

describe('Drive token refresh in fetchMeta', () => {
  it('a 401 re-mints the token once and retries the same file', async () => {
    const auth = [];
    const fake = async (url, opt) => {
      auth.push(opt.headers.Authorization);
      return opt.headers.Authorization === 'Bearer NEW' ? { ok: true, status: 200, json: async () => ({ size: '1' }) } : { ok: false, status: 401 };
    };
    const out = await fetchMeta(['f1'], 'OLD', { fetchImpl: fake, concurrency: 1, refresh: async () => 'NEW' });
    expect(out[0].ok).toBe(true);
    expect(auth).toEqual(['Bearer OLD', 'Bearer NEW']);
  });
  it('re-mints after refreshMs even without a 401 (runs over 1 h)', async () => {
    let t = 0;
    const auth = [];
    const fake = async (url, opt) => { auth.push(opt.headers.Authorization); t += 30 * 60000; return { ok: true, status: 200, json: async () => ({}) }; };
    let n = 0;
    await fetchMeta(['a', 'b', 'c'], 'T0', { fetchImpl: fake, concurrency: 1, refresh: async () => `T${++n}`, refreshMs: 40 * 60000, now: () => t });
    expect(auth).toEqual(['Bearer T0', 'Bearer T0', 'Bearer T1']);
  });
});

describe('inventory failures CSV', () => {
  it('likely cause by HTTP status', () => {
    expect(likelyCause({ ok: false, error: 'HTTP 404' })).toMatch(/not shared/);
    expect(likelyCause({ ok: false, error: 'HTTP 403' })).toMatch(/permission/);
    expect(likelyCause({ ok: false, error: 'HTTP 401' })).toMatch(/expired/);
    expect(likelyCause({ ok: true, duration_s: 0 })).toMatch(/no video metadata/);
    expect(likelyCause({ ok: true, duration_s: 9 })).toBe('');
  });
  it('one row per lesson with an unusable chosen video', () => {
    const lessons = videoLessons(rows);
    const meta = [toMeta(ID(1), { videoMediaMetadata: { durationMillis: '1000' } }), toMeta(ID(3), null, 'HTTP 404'), toMeta(ID(4), {})];
    const f = failureRows(lessons, meta);
    expect(f.map((r) => [r.lesson_id, r.http_status])).toEqual([['c900-l002', '404'], ['c901-l002', '200'], ['c901-l003', '200']]);
  });
});

describe('video workflows refresh the Drive token', () => {
  const wfp = (n) => readFileSync(join(here, '..', '..', '..', '.github', 'workflows', n), 'utf8');
  it('video-inventory, video-test and course-video set REFRESH_TOKEN_CMD', () => {
    for (const n of ['video-inventory.yml', 'video-test.yml', 'course-video.yml']) expect(wfp(n)).toMatch(/REFRESH_TOKEN_CMD: "gcloud auth print-access-token --scopes=/);
  });
  it('video-test re-mints before each file and retries a failed download once', () => {
    const y = wfp('video-test.yml');
    expect(y).toMatch(/refresh_token\n\s+fetch_src "\$id" \|\| \{ refresh_token; fetch_src "\$id"; \}/);
  });
});
