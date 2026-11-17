/** PART 10 — playback check of all live media (placeholders; no network). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { entries, shard, judge, summarize, boxOrder, parseBoxHeader, DRIFT } from '../playcheck.mjs';
import { checksJson, REASONS } from '../../master/checks.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const A = { kind: 'audio', id: DID('A'), key: 'audio/a-a64.mp3', bytes: 1000, duration_s: 600 };
const V = { kind: 'video', id: DID('V'), key: 'video/v-480p.mp4', bytes: 5000, duration_s: 600, poster_key: 'video/v-480p.webp' };
const good = { status: 200, type: 'audio/mpeg', length: '1000', decodeErrors: '', duration: 600.4 };
const goodV = { status: 200, type: 'video/mp4', length: '5000', decodeErrors: '', duration: 601, order: 'faststart', posterStatus: 200, posterType: 'image/webp' };

describe('what is checked', () => {
  it('approved audio and video only', () => {
    const e = entries(
      [{ drive_file_id: 'a', key: 'audio/1.mp3', status: 'approved', bytes: 1, duration_s: 9 }, { drive_file_id: 'b', key: 'audio/2.mp3', status: 'DRAFT' }],
      [{ kind: 'video', drive_file_id: 'v', key: 'video/1.mp4', status: 'approved', poster_key: null }, { kind: 'video', drive_file_id: 'w', key: 'video/2.mp4', status: 'DRAFT' }],
    );
    expect(e.map((x) => [x.kind, x.id])).toEqual([['audio', 'a'], ['video', 'v']]);
    expect(shard([1, 2, 3, 4, 5].map((i) => ({ i })), 2).map((x) => x.shard)).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('judge', () => {
  it('a good audio and a good video pass', () => {
    expect(judge(A, good)).toEqual({ ok: true, causes: [], detail: '' });
    expect(judge(V, goodV).ok).toBe(true);
  });
  it('each cause on its own', () => {
    expect(judge(A, { status: 404 }).causes).toEqual(['http']);
    // a dropped download (after retries) is a network fault, never a decode error
    expect(judge(A, { ...good, downloadError: 'curl: (56) Recv failure' })).toMatchObject({ causes: ['http'], detail: 'download failed after retries: curl: (56) Recv failure' });
    expect(judge(A, { ...good, type: 'text/html' }).causes).toEqual(['content-type']);
    expect(judge(A, { ...good, length: '999' }).causes).toEqual(['size']);
    expect(judge(A, { ...good, decodeErrors: '[mp3 @ 0x1] Header missing' }).causes).toEqual(['decode']);
    expect(judge(A, { ...good, duration: 600 * (1 + DRIFT) + 1 }).causes).toEqual(['duration']);
    expect(judge(V, { ...goodV, order: 'not faststart' }).causes).toEqual(['not faststart']);
    expect(judge(V, { ...goodV, posterStatus: 404 }).causes).toEqual(['poster']);
    expect(judge({ ...V, poster_key: null }, goodV).causes).toEqual(['poster']);
  });
  it('summary by cause and by kind', () => {
    const s = summarize([{ ...A, ...judge(A, good) }, { ...V, ...judge(V, { ...goodV, order: 'not faststart' }) }], 'T');
    expect(s).toMatchObject({ checked: 2, passed: 1, failed: 1, by_cause: { 'not faststart': 1 }, by_kind: { audio: { checked: 1, passed: 1, failed: 0 }, video: { checked: 1, passed: 0, failed: 1 } } });
    expect(s.failures[0]).toMatchObject({ id: DID('V'), causes: ['not faststart'] });
  });
});

describe('mp4 box order (faststart)', () => {
  const box = (size, type) => { const b = Buffer.alloc(16); b.writeUInt32BE(size, 0); b.write(type, 4, 'latin1'); return b; };
  it('moov before mdat = faststart; mdat first = not', async () => {
    const file = (boxes) => { const at = []; let o = 0; for (const [s, t] of boxes) { at.push([o, s, t]); o += s; } return async (off) => { const f = at.find((x) => x[0] === off); return f ? parseBoxHeader(box(f[1], f[2])) : null; }; };
    expect(await boxOrder(file([[24, 'ftyp'], [500, 'moov'], [9000, 'mdat']]))).toBe('faststart');
    expect(await boxOrder(file([[24, 'ftyp'], [9000, 'mdat'], [500, 'moov']]))).toBe('not faststart');
    expect(await boxOrder(async () => null)).toBe('unknown');
  });
  it('64-bit box size', () => {
    const b = Buffer.alloc(16); b.writeUInt32BE(1, 0); b.write('mdat', 4, 'latin1'); b.writeBigUInt64BE(5000000000n, 8);
    expect(parseBoxHeader(b)).toEqual({ size: 5000000000, type: 'mdat' });
  });
});

describe('checks.json + check-reasons.json', () => {
  it('a failure becomes "media: does not play" on the lesson row, with the cause', () => {
    const row = { row_key: 'M1', lesson_id: 'L', course_id: 'c900', course_title_km: 't', lesson_title: 't', source_type: 'mp3', mp3_link: url('A'), mp4_link: url('V'), minicourse_link: '', check_decision: '' };
    const o = checksJson({
      lessonRows: [row], courseRows: [], wanted: new Map(), now: 'T',
      manifest: [{ drive_file_id: DID('A'), key: A.key, status: 'approved' }],
      playcheck: { failures: [{ id: DID('V'), kind: 'video', key: V.key, causes: ['not faststart'], detail: 'moov box: not faststart' }] },
    });
    const it0 = o.items.find((i) => i.reason === 'media: does not play');
    expect(it0).toMatchObject({ row_key: 'M1', media_type: 'video', detail: 'not faststart: moov box: not faststart', play_url: 'https://media.84000.digital/video/v-480p.mp4' });
  });
  it('every reason checks.json can carry is described; the new one has a CHANGE note; no sheet id/URL', () => {
    const f = JSON.parse(readFileSync('public/ops/check-reasons.json', 'utf-8'));
    expect(f.reasons.map((r) => r.reason).sort()).toEqual([...REASONS].sort());
    expect(f.changes.find((c) => c.reason === 'media: does not play').change).toMatch(/^CHANGE for Operations/);
    expect(JSON.stringify(f)).not.toMatch(/docs\.google\.com|spreadsheets\/d\/|12MOXAOH/);
  });
});

describe('workflow', () => {
  const y = readFileSync('.github/workflows/media-playcheck.yml', 'utf-8');
  it('manual + weekly, sharded, read-only on media, refreshes checks.json with a dry sync', () => {
    expect(y).toMatch(/workflow_dispatch:/);
    expect(y).toMatch(/cron: "37 2 \* \* 1"/);
    expect(y).toContain('max-parallel: 20');
    expect(y).not.toMatch(/rclone|R2_ACCESS_KEY_ID/);
    expect(y).toContain('gh workflow run master-sync.yml --ref main -R "$GITHUB_REPOSITORY" -f mode=dry');
  });
});
