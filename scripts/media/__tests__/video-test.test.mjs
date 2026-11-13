/** PART V2 — test encode picks, aggregation, recommendation, no-R2 guard. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickMixed, aggregate, recommend, buildReport, parseSsim, chosenMetas } from '../video-test.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const meta = (id, size) => ({ id, ok: true, size });

describe('V2 pickMixed', () => {
  it('spreads picks from smallest to largest, skipping failed/zero', () => {
    const ms = Array.from({ length: 21 }, (_, i) => meta(`f${i}`, (i + 1) * 100));
    ms.push({ id: 'bad', ok: false }, meta('zero', 0));
    const p = pickMixed(ms, 5).map((m) => m.id);
    expect(p).toEqual(['f0', 'f5', 'f10', 'f15', 'f20']);
  });
  it('returns all when fewer than n', () => {
    expect(pickMixed([meta('a', 1), meta('b', 2)], 10).length).toBe(2);
  });
  it('chosenMetas keeps only each lesson\'s chosen video', () => {
    const L = 'yyyyyyyyyyyyyyyyyyyyyyyy';
    const rows = [{ course_id: 'c900', mp4_link: `https://drive.google.com/file/d/A${L}/view`, minicourse_link: `https://drive.google.com/file/d/B${L}/view` }];
    expect(chosenMetas(rows, [meta(`A${L}`, 1), meta(`B${L}`, 1)]).map((m) => m.id)).toEqual([`A${L}`]);
  });
});

const res = (id, r, o) => ({ id, rendition: r, src_bytes: 1e9, src_height: 720, duration_s: 1800, out_bytes: 100e6, out_height: Number(r.slice(0, 3)), encode_s: 300, ssim: 0.97, ...o });

describe('V2 aggregate + recommend', () => {
  it('MB per hour and encode minutes per hour', () => {
    const a = aggregate([res('a', '480p'), res('b', '480p', { out_bytes: 300e6, encode_s: 900 }), res('a', '720p', { out_bytes: 200e6 })]);
    expect(a['480p'].mbPerHour).toBeCloseTo(400); // 400 MB / 1 h
    expect(a['480p'].encodeMinPerHour).toBeCloseTo(20); // 20 min / 1 h
    expect(a['720p'].mbPerHour).toBeCloseTo(400); // 200 MB / 0.5 h
  });
  it('picks the smaller rendition that passes; else 720p; else none', () => {
    expect(recommend(aggregate([res('a', '480p'), res('a', '720p')]))).toBe('480p');
    expect(recommend(aggregate([res('a', '480p', { ssim: 0.9 }), res('a', '720p')]))).toBe('720p');
    expect(recommend(aggregate([res('a', '480p', { ssim: 0.9 }), res('a', '720p', { ssim: 0.9 })]))).toBe(null);
    expect(recommend(aggregate([]))).toBe(null);
  });
  it('report states the rule and the result', () => {
    const { md } = buildReport([res('a', '480p'), res('a', '720p')], { crf: '23', audio: '96k', ssimSeconds: '300' });
    expect(md).toContain('Nothing was uploaded to R2');
    expect(md).toContain('**480p**');
    expect(md).toContain('| 480p | 1 | 0.50 | 200 | 10.0 | 0.970 |');
  });
  it('parseSsim reads the last SSIM line', () => {
    expect(parseSsim('x\n[Parsed_ssim_1 @ 0x1] SSIM Y:0.98 U:0.99 V:0.99 All:0.981234 (17.26)\n')).toBeCloseTo(0.981234);
    expect(Number.isNaN(parseSsim('nothing'))).toBe(true);
  });
});

describe('V2 workflow uploads nothing', () => {
  const y = readFileSync(join(here, '..', '..', '..', '.github', 'workflows', 'video-test.yml'), 'utf8');
  it('no R2 secret, no rclone, no push; veryfast + faststart + AAC', () => {
    expect(y).not.toMatch(/rclone|R2_ACCESS_KEY_ID|R2_SECRET|git push|contents: write/);
    expect(y).toMatch(/-preset veryfast/);
    expect(y).toMatch(/-movflags \+faststart/);
    expect(y).toMatch(/-c:a aac/);
    expect(y).toMatch(/drive\.readonly/);
  });
});
