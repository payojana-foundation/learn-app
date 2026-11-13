/** PART V4 — course autopilot: pick-next-queue, skip-when-busy, stop-when-empty, off-switch, red auto-off. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decide, applyReport, countBusy, leftIds, LIMIT, MAX_ATTEMPTS } from '../autorun-plan.mjs';

// Audio entries need a B2 key: audio/<16 lowercase hex>-a64.mp3.
const audioEntry = (id, n) => ({ drive_file_id: id, key: `audio/${String(n).padStart(16, '0')}-a64.mp3` });
const videoEntry = (id, n, r = '480p') => ({ kind: 'video', drive_file_id: id, rendition: r, key: `video/${String(n).padStart(16, '0')}-${r}.mp4` });
const base = (o = {}) => ({
  enabled: true, videoEnabled: false, rendition: '', busy: 0, reset: false, state: {},
  audioQueues: [{ path: 'data/queues/c001.csv', ids: ['a1', 'a2'] }, { path: 'data/queues/c002.csv', ids: ['b1', 'b2'] }],
  audioManifest: [], videoQueues: [{ path: 'data/queues/video/c001.csv', ids: ['v1', 'v2'] }], videoManifest: [], exclude: new Set(), ...o,
});

describe('V4 off-switch', () => {
  it('AUTORUN_ENABLED not "true" = off, nothing runs', () => {
    expect(decide(base({ enabled: false })).action).toBe('off');
    expect(decide(base({ enabled: undefined })).action).toBe('off');
  });
  it('a stop after a red run holds until reset', () => {
    const state = { disabled: true, reason: 'audio run on data/queues/c001.csv was red' };
    expect(decide(base({ state })).action).toBe('disabled');
    expect(decide(base({ state, reset: true })).action).toBe('run');
  });
});

describe('V4 skip-when-busy', () => {
  it('any course-audio/course-video run in progress = skip', () => {
    expect(decide(base({ busy: 1 }))).toMatchObject({ action: 'busy' });
  });
  it('countBusy sums the API pages', () => {
    expect(countBusy([{ workflow_runs: [{}, {}] }, { workflow_runs: [] }, { total_count: 1 }])).toBe(3);
    expect(countBusy([])).toBe(0);
  });
});

describe('V4 pick-next-queue', () => {
  it('first audio queue with unconverted lessons, limit 40', () => {
    const p = decide(base({ audioManifest: [audioEntry('a1', 1), audioEntry('a2', 2)] }));
    expect(p).toMatchObject({ action: 'run', kind: 'audio', queue: 'data/queues/c002.csv', toProcess: ['b1', 'b2'], left: 2 });
    expect(LIMIT).toBe(40);
  });
  it('caps toProcess at 40', () => {
    const ids = Array.from({ length: 55 }, (_, i) => `x${i}`);
    const p = decide(base({ audioQueues: [{ path: 'q', ids }] }));
    expect(p.toProcess.length).toBe(40);
    expect(p.left).toBe(55);
  });
  it('passes by a queue whose only missing ids are failed-review, duplicates, or tried twice', () => {
    const p = decide(base({ exclude: new Set(['a1']), state: { attempts: { a2: MAX_ATTEMPTS } } }));
    expect(p.queue).toBe('data/queues/c002.csv');
  });
  it('video only after audio is done and only when VIDEO_ENABLED with a rendition', () => {
    const done = [audioEntry('a1', 1), audioEntry('a2', 2), audioEntry('b1', 3), audioEntry('b2', 4)];
    expect(decide(base({ audioManifest: done })).action).toBe('empty');
    expect(decide(base({ audioManifest: done, videoEnabled: true, rendition: '' })).action).toBe('empty');
    const p = decide(base({ audioManifest: done, videoEnabled: true, rendition: '480p', videoManifest: [videoEntry('v1', 1)] }));
    expect(p).toMatchObject({ action: 'run', kind: 'video', queue: 'data/queues/video/c001.csv', toProcess: ['v2'] });
    // a video of another rendition does not count as done
    expect(decide(base({ audioManifest: done, videoEnabled: true, rendition: '720p', videoManifest: [videoEntry('v1', 1)] })).toProcess).toEqual(['v1', 'v2']);
  });
});

describe('V4 stop-when-empty', () => {
  it('nothing left = empty (no-op)', () => {
    expect(decide(base({ audioQueues: [], videoQueues: [] }))).toMatchObject({ action: 'empty' });
  });
  it('leftIds excludes converted, excluded and over-tried ids', () => {
    expect(leftIds(['a', 'b', 'c', 'd'], new Set(['a']), new Set(['b']), { c: 2 })).toEqual(['d']);
  });
});

describe('V4 report: summary line, attempts, red turns it off', () => {
  const plan = { action: 'run', kind: 'audio', queue: 'q.csv', toProcess: ['a', 'b', 'c'] };
  it('one line with queue, done, failed, left; failed ids get an attempt', () => {
    const r = applyReport({}, { plan, result: 'success', have: new Set(['a', 'b']), queueIds: ['a', 'b', 'c', 'd'], at: 'T' });
    expect(r.line).toBe('T · audio q.csv · done 2 · failed 1 · left 2');
    expect(r.state.attempts).toEqual({ c: 1 });
    expect(r.red).toBe(false);
    expect(r.state.disabled).toBeFalsy();
  });
  it('a red run sets disabled with a notice line', () => {
    const r = applyReport({}, { plan, result: 'failure', have: new Set(), queueIds: ['a', 'b', 'c'], at: 'T' });
    expect(r.red).toBe(true);
    expect(r.state.disabled).toBe(true);
    expect(r.line).toMatch(/RED: autorun turned itself off$/);
    expect(decide(base({ state: r.state })).action).toBe('disabled');
  });
  it('a failed plan step turns it off too; reset clears it', () => {
    expect(applyReport({}, { plan: null, planFailed: true, at: 'T' }).state.disabled).toBe(true);
    const r = applyReport({ disabled: true, reason: 'x' }, { plan: { action: 'empty' }, reset: true, at: 'T' });
    expect(r.state.disabled).toBe(false);
    expect(r.line).toMatch(/reset/);
  });
  it('idle runs change no state', () => {
    const prev = { attempts: { z: 1 } };
    const r = applyReport(prev, { plan: { action: 'busy' }, at: 'T' });
    expect(r.line).toBe(null);
    expect(r.state).toEqual(prev);
  });
});

describe('V4 workflow', () => {
  const y = readFileSync('.github/workflows/course-autorun.yml', 'utf-8');
  it('every 2 h at :41 + dispatch; one at a time, never cancelled', () => {
    expect(y).toContain('- cron: "41 */2 * * *"');
    expect(y).toMatch(/workflow_dispatch:/);
    expect(y).toMatch(/concurrency:\n {2}group: course-autorun\n {2}cancel-in-progress: false/);
  });
  it('one course-audio / course-video job, limit 40, dry_run false', () => {
    expect(y).toContain('uses: ./.github/workflows/course-audio.yml');
    expect(y).toContain('uses: ./.github/workflows/course-video.yml');
    expect((y.match(/limit: "40"/g) || []).length).toBe(2);
    expect((y.match(/dry_run: \$\{\{ 'false' \}\}/g) || []).length).toBe(2);
  });
  it('busy check covers course-audio, course-audio-batch and course-video', () => {
    expect(y).toContain('for wf in course-audio.yml course-audio-batch.yml course-video.yml');
  });
});
