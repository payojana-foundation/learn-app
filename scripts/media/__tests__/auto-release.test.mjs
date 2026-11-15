/** PART 5 — auto-release of passing lessons (audio, then video only with approved audio). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { autoRelease, summaryLine, audioIdsByVideo, REVIEWER } from '../auto-release.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const row = (o) => ({ row_key: o.k, course_id: 'c900', lesson_id: o.k, lesson_no: '1', source_type: 'mp3', mp3_link: url(o.a), mp4_link: o.v ? url(o.v) : '', minicourse_link: '' });
const rows = [row({ k: 'R1', a: 'A1', v: 'V1' }), row({ k: 'R2', a: 'A2', v: 'V2' }), row({ k: 'R3', a: 'A3', v: 'V3' })];
const sha = (c) => c.repeat(64);
const audioManifest = [
  { drive_file_id: DID('A1'), sha256: sha('a'), status: 'DRAFT' }, // passes
  { drive_file_id: DID('A2'), sha256: sha('b'), status: 'DRAFT' }, // flagged
  { drive_file_id: DID('A3'), sha256: sha('c'), status: 'approved' }, // already approved
];
const audioPrecheck = { results: { pass: [{ id: DID('A1'), sha256: sha('a') }], flagged: [{ id: DID('A2'), reasons: ['x'] }], pending: [] } };
const videoManifest = [
  { kind: 'video', drive_file_id: DID('V1'), sha256: sha('d'), status: 'DRAFT' },
  { kind: 'video', drive_file_id: DID('V2'), sha256: sha('e'), status: 'DRAFT' },
  { kind: 'video', drive_file_id: DID('V3'), sha256: sha('f'), status: 'DRAFT' },
];
const videoPrecheck = { results: { pass: [DID('V1'), DID('V2'), DID('V3')].map((id, i) => ({ id, sha256: sha('def'[i]) })), flagged: [], pending: [] } };
const run = (o = {}) => autoRelease({ audioManifest, audioPrecheck, videoManifest, videoPrecheck, rows, date: '2026-01-01', ...o });

describe('auto-release', () => {
  it('approves passing audio only; flagged stays held', () => {
    const r = run();
    expect(r.audio.ids).toEqual([DID('A1')]);
    const st = Object.fromEntries(r.audio.manifest.map((e) => [e.drive_file_id, e.status]));
    expect(st[DID('A2')]).toBe('DRAFT');
    expect(r.audio.manifest.find((e) => e.drive_file_id === DID('A1')).reviewer).toBe(REVIEWER);
  });
  it('a video is released only when its lesson audio is approved (incl. this run)', () => {
    const r = run();
    expect(r.video.ids.sort()).toEqual([DID('V1'), DID('V3')].sort());
    expect(r.video.waitingAudio).toEqual([DID('V2')]);
  });
  it('never approves a flagged or not-checked video', () => {
    const r = run({ videoPrecheck: { results: { pass: [], flagged: [{ id: DID('V1'), reasons: ['x'] }], pending: [{ id: DID('V3') }] } } });
    expect(r.video.ids).toEqual([]);
  });
  it('video off = video untouched', () => {
    const r = run({ video: false });
    expect(r.video.ids).toEqual([]);
    expect(r.video.manifest).toBe(videoManifest);
    expect(summaryLine(r, 'D', false)).toMatch(/video off$/);
  });
  it('one summary line', () => {
    expect(summaryLine(run(), 'D', true)).toBe('D · auto-release · audio approved 1 (held: flagged 1, not checked 0, re-converted 0) · video approved 2 (held: flagged 0, audio not approved 1)');
  });
  it('audioIdsByVideo maps the video of each row to its audio source', () => {
    expect([...audioIdsByVideo(rows).get(DID('V2'))]).toEqual([DID('A2')]);
  });
});

describe('auto-release workflow', () => {
  const y = readFileSync('.github/workflows/auto-release.yml', 'utf-8');
  it('after approve-check and video-approve-check; off unless AUTO_APPROVE_PASSING', () => {
    expect(y).toContain('workflows: [approve-check, video-approve-check]');
    expect(y).toContain("vars.AUTO_APPROVE_PASSING == 'true'");
    expect(y).toContain("github.event.workflow_run.conclusion == 'success'");
  });
  it('rebase-proof: each push attempt restarts from origin/main and re-applies the release', () => {
    expect(y).toContain('for attempt in 1 2 3 4 5 6 7 8; do');
    expect(y).toMatch(/git reset -q origin\/main\n\s+for p in \$FILES; do git checkout origin\/main -- "\$p"/);
    expect(y).toMatch(/git checkout origin\/main[\s\S]*?node scripts\/media\/auto-release\.mjs \$V[\s\S]*?git push origin HEAD:main/);
    expect(y).not.toContain('push-with-retry.sh');
  });
  it('video only when VIDEO_ENABLED; it starts master-export after a release', () => {
    expect(y).toMatch(/VIDEO_ENABLED:-\}" = "true" \]; then V="--video"/);
    expect(y).toContain('gh workflow run master-export.yml --ref main');
    expect(y).toContain('actions: write');
  });
});
