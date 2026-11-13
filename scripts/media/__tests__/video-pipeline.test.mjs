/**
 * PART V3 — video pipeline behind VIDEO_ENABLED: keys, manifest (kind video,
 * DRAFT, immutable), plan, queues, pre-check, approve via allPassingIds, poster
 * hook, transcode-video.sh guards (stubbed rclone/curl, DRY_RUN), and the
 * workflow switch in both states. Placeholder ids only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVideoKey, validateVideoEntry, appendVideoEntry } from '../append-video-manifest.mjs';
import { planVideoRun, videoManifestIds } from '../video-plan.mjs';
import { videoQueues, queueText } from '../../queues/video-queues.mjs';
import { videoResults, videoCandidates } from '../video-precheck.mjs';
import { allPassingIds, applyDecision } from '../approve-manifest.mjs';
import { posterSource } from '../video-poster.mjs';
import { DRAFT_STATUS } from '../append-manifest.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const wfDir = resolve(here, '..', '..', '..', '.github', 'workflows');
const wf = (n) => readFileSync(join(wfDir, n), 'utf-8');
const MD5 = '0123456789abcdef0123456789abcdef';
const SHA = 'a'.repeat(64);
const entry = (o = {}) => ({
  kind: 'video', drive_file_id: 'vid1', source_md5: MD5, key: 'video/0123456789abcdef-480p.mp4', poster_key: null,
  rendition: '480p', bytes: 10, duration_s: 1800, src_duration_s: 1800, sha256: SHA, ...o,
});

describe('V3 keys + manifest entry', () => {
  it('video key = video/<md5 16>-<rendition>.mp4', () => {
    expect(isVideoKey('video/0123456789abcdef-480p.mp4')).toBe(true);
    expect(isVideoKey('video/0123456789abcdef-720p-v2.mp4')).toBe(true);
    expect(isVideoKey('audio/0123456789abcdef-a64.mp3')).toBe(false);
    expect(isVideoKey('video/0123456789abcdef-1080p.mp4')).toBe(false);
  });
  it('validates kind, key from md5, rendition, poster next to the key', () => {
    expect(validateVideoEntry(entry())).toBe(null);
    expect(validateVideoEntry(entry({ kind: 'audio' }))).toMatch(/kind/);
    expect(validateVideoEntry(entry({ key: 'video/ffffffffffffffff-480p.mp4' }))).toMatch(/must be video/);
    expect(validateVideoEntry(entry({ rendition: '720p' }))).toMatch(/rendition/);
    expect(validateVideoEntry(entry({ poster_key: 'video/0123456789abcdef-480p.webp' }))).toBe(null);
    expect(validateVideoEntry(entry({ poster_key: 'video/other.webp' }))).toMatch(/poster_key/);
  });
  it('appends as DRAFT, never overwrites a key, only fills a missing poster', () => {
    const m1 = appendVideoEntry([], entry());
    expect(m1[0].status).toBe(DRAFT_STATUS);
    expect(appendVideoEntry(m1, entry({ bytes: 99 }))).toBe(m1);
    const m2 = appendVideoEntry(m1, entry({ poster_key: 'video/0123456789abcdef-480p.webp', bytes: 99 }));
    expect(m2[0]).toMatchObject({ poster_key: 'video/0123456789abcdef-480p.webp', bytes: 10, status: DRAFT_STATUS });
  });
});

describe('V3 plan + queues', () => {
  it('skips ids that have a video of this rendition, caps at limit', () => {
    const m = [entry({ drive_file_id: 'a' }), entry({ drive_file_id: 'b', rendition: '720p', key: 'video/0123456789abcdef-720p.mp4' }), { drive_file_id: 'c', key: 'audio/0123456789abcdef-a64.mp3' }];
    expect([...videoManifestIds(m, '480p')]).toEqual(['a']);
    expect(planVideoRun(['a', 'b', 'c', 'd'], m, 2, '480p')).toEqual({ toProcess: ['b', 'c'], skipped: ['a'], remaining: ['d'] });
  });
  it('one queue per course, lesson order, unique, rows without a course id left out', () => {
    const L = 'zzzzzzzzzzzzzzzzzzzzzzzz';
    const l = (c, id) => ({ course_id: c, mp4_link: `https://drive.google.com/file/d/${id}${L}/view`, minicourse_link: '' });
    const q = videoQueues([l('c902', 'B'), l('c901', 'A'), l('c901', 'A'), l('', 'X'), l('c901', 'C')]);
    expect([...q.keys()]).toEqual(['c901', 'c902']);
    expect(q.get('c901')).toEqual([`A${L}`, `C${L}`]);
    expect(queueText(['x'])).toBe('drive_file_id\nx\n');
  });
});

describe('V3 pre-check + approve (same rules as audio)', () => {
  const m = [
    entry({ drive_file_id: 'ok' }),
    entry({ drive_file_id: 'short', duration_s: 60, src_duration_s: 60, sha256: 'b'.repeat(64), source_md5: '1'.repeat(32), key: 'video/1111111111111111-480p.mp4' }),
    entry({ drive_file_id: 'drift', src_duration_s: 2000, sha256: 'c'.repeat(64), source_md5: '2'.repeat(32), key: 'video/2222222222222222-480p.mp4' }),
    entry({ drive_file_id: 'dupA', sha256: 'd'.repeat(64), source_md5: '3'.repeat(32), key: 'video/3333333333333333-480p.mp4' }),
    entry({ drive_file_id: 'dupB', sha256: 'd'.repeat(64), source_md5: '3'.repeat(32), key: 'video/3333333333333333-480p-v2.mp4' }),
    entry({ drive_file_id: 'done', status: 'approved', sha256: 'e'.repeat(64), source_md5: '4'.repeat(32), key: 'video/4444444444444444-480p.mp4' }),
  ];
  // "ok" shares its md5 with nothing else; give it a unique one.
  m[0] = entry({ drive_file_id: 'ok', source_md5: '5'.repeat(32), key: 'video/5555555555555555-480p.mp4', sha256: 'f'.repeat(64) });
  const res = videoResults(m);
  it('flags duration, drift, duplicates; skips approved', () => {
    expect(videoCandidates(m).map((e) => e.drive_file_id)).not.toContain('done');
    expect(res.pass.map((p) => p.id)).toEqual(['ok']);
    const why = Object.fromEntries(res.flagged.map((f) => [f.id, f.reasons.join('; ')]));
    expect(why.short).toMatch(/under 5 min/);
    expect(why.drift).toMatch(/differs more than 2 %/);
    expect(why.dupA).toMatch(/same video \(sha256\)/);
    expect(why.dupB).toMatch(/same source file/);
  });
  it('approve-manifest all-passing works on the video manifest unchanged', () => {
    const { ids } = allPassingIds(m, { results: res });
    expect(ids).toEqual(['ok']);
    const { manifest } = applyDecision(m, ids, 'reviewer', 'approved', '2026-01-01');
    expect(manifest.find((e) => e.drive_file_id === 'ok').status).toBe('approved');
    expect(manifest.filter((e) => e.status === 'approved').length).toBe(2);
  });
});

describe('V3 poster hook', () => {
  it('team thumbnail_link wins, else the grabbed frame, else none', () => {
    const tid = 'T'.repeat(28);
    expect(posterSource({ thumbnail_link: `https://drive.google.com/file/d/${tid}/view` }, entry({ poster_key: 'p.webp' }))).toEqual({ from: 'team', drive_file_id: tid });
    expect(posterSource({}, entry({ poster_key: 'p.webp' }))).toEqual({ from: 'frame', key: 'p.webp' });
    expect(posterSource({}, entry())).toBe(null);
  });
});

describe('V3 workflows: switch off and on', () => {
  const cv = wf('course-video.yml');
  it('course-video: off job when VIDEO_ENABLED != true, transcode job only when == true', () => {
    expect(cv).toMatch(/ {2}off:\n {4}if: \$\{\{ vars\.VIDEO_ENABLED != 'true' \}\}/);
    expect(cv).toMatch(/ {2}transcode:\n {4}if: \$\{\{ vars\.VIDEO_ENABLED == 'true' \}\}/);
  });
  it('course-video: queue, limit, dry_run, manifest-first save, orphan guard, video manifest', () => {
    for (const s of ['list:', 'limit:', 'dry_run:', 'workflow_call:', 'MANIFEST: data/video-manifest.json', 'RENDITION: ${{ vars.VIDEO_RENDITION }}',
      "SAVE_CMD: ${{ inputs.dry_run == 'true' && '' || 'bash scripts/ci/save-video-manifest.sh' }}",
      'TRANSCODE_ONE: scripts/media/transcode-video.sh', 'Fail on R2 objects without a manifest entry']) expect(cv).toContain(s);
  });
  it('the audio pipeline does not know about video', () => {
    const ca = wf('course-audio.yml');
    expect(ca).not.toMatch(/video-manifest|transcode-video|VIDEO_/);
    expect(readFileSync(resolve(here, '..', 'transcode-one.sh'), 'utf-8')).not.toMatch(/video\//);
    expect(readFileSync(resolve(here, '..', '..', 'ci', 'save-manifest.sh'), 'utf-8')).not.toMatch(/video/);
  });
  it('approve-media: media input defaults to audio; video needs VIDEO_ENABLED', () => {
    const am = wf('approve-media.yml');
    expect(am).toMatch(/media:\n[\s\S]*?options:\n\s+- audio\n\s+- video\n\s+default: audio/);
    expect(am).toContain('media video needs the repo variable VIDEO_ENABLED=true');
    expect(am).toContain('data/queues/approve-video/precheck.json');
  });
  it('video-approve-check is skipped when off', () => {
    expect(wf('video-approve-check.yml')).toMatch(/if: \$\{\{ vars\.VIDEO_ENABLED == 'true' \}\}/);
  });
});

// ── transcode-video.sh guards with stub curl/rclone (DRY_RUN: no ffmpeg) ──
function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) if (existsSync(p)) return p;
  return null;
}
const BASH = findBash();
const run = BASH ? it : it.skip;
const script = resolve(here, '..', 'transcode-video.sh').replace(/\\/g, '/');

describe('V3 transcode-video.sh', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tv-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const go = ({ size = 0, manifest = [], rendition = '480p' } = {}) => {
    const rclone = join(dir, 'rclone');
    const curl = join(dir, 'curl');
    writeFileSync(rclone, `#!/usr/bin/env bash\nif [ "$1" = lsjson ]; then echo '[{"Size":${size}}]'; fi\nexit 0\n`);
    writeFileSync(curl, `#!/usr/bin/env bash\nprintf '%s\\n%s' '{"name":"n","md5Checksum":"${MD5.toUpperCase()}"}' 200\n`);
    chmodSync(rclone, 0o755); chmodSync(curl, 0o755);
    writeFileSync(join(dir, 'vm.json'), JSON.stringify(manifest));
    const r = spawnSync(BASH, [script, 'vid1'], {
      cwd: dir, encoding: 'utf-8',
      env: { ...process.env, ACCESS_TOKEN: 't', RCLONE: rclone.replace(/\\/g, '/'), CURL: curl.replace(/\\/g, '/'), RENDITION: rendition, MANIFEST: 'vm.json', DRY_RUN: '1', REFRESH_TOKEN_CMD: '' },
    });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  run('needs a rendition', () => { expect(go({ rendition: '' }).status).toBe(2); });
  run('dry run: derives the key and poster key from the Drive md5, uploads nothing', () => {
    const r = go();
    expect(r.status).toBe(0);
    expect(r.out).toContain('video/0123456789abcdef-480p.mp4');
    expect(r.out).toContain('video/0123456789abcdef-480p.webp');
    expect(existsSync(join(dir, 'entry-vid1.json'))).toBe(false);
  });
  run('key on R2 and in the video manifest = skip (3)', () => {
    expect(go({ size: 5, manifest: [{ key: 'video/0123456789abcdef-480p.mp4' }] }).status).toBe(3);
  });
  run('key on R2 without a manifest entry = orphan (4)', () => {
    expect(go({ size: 5 }).status).toBe(4);
  });
});
