/**
 * PART 8 — two loudness exceptions, same measured standard (placeholder ids).
 *  a) data/audio/limit-exceptions.json raises the 20 dB limiter-depth cap for listed ids, max 21 dB.
 *  b) true-peak failures of the B3 loop take the true-peak limiter path; the 64 kbps encode can
 *     overshoot the limiter ceiling, so a TP miss lowers the ceiling by the MEASURED excess.
 * Real ffmpeg on a synthetic over-peak file (fs/4 sine bursts: samples 3 dB under the true peak).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, onPre, onMp3, capFor, isQuietCapped, isTruePeakFailure, takesTpPath, depthOf, MAX_DEPTH, MAX_DEPTH_EXCEPTION, MIN_CEIL_DB } from '../tp-decide.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const lib = resolve(here, '..', 'b3-loop.sh').replace(/\\/g, '/');
const LISTED = 'L'.repeat(33);
const OTHER = 'O'.repeat(33);
const ex = { cap_db: 21, ids: [LISTED] };

describe('a) limit exceptions', () => {
  it('a listed id gets cap_db, every other id the default 20 dB', () => {
    expect(capFor(LISTED, ex)).toBe(21);
    expect(capFor(OTHER, ex)).toBe(MAX_DEPTH);
    expect(capFor(LISTED, null)).toBe(MAX_DEPTH);
  });
  it('cap_db above 21 (or not above 20) is refused, never silently used', () => {
    expect(() => capFor(LISTED, { cap_db: 22, ids: [LISTED] })).toThrow(/<= 21/);
    expect(() => capFor(LISTED, { cap_db: 20, ids: [LISTED] })).toThrow(/> 20/);
    expect(init({ I1: -30, TP1: 0, maxDepth: 22 })).toMatchObject({ done: true, result: 'failed' });
    expect(MAX_DEPTH_EXCEPTION).toBe(21);
  });
  // depth = TP1 + Gp − ceiling; ceiling −3: TP1 0 + Gp 17.8 → 20.8 dB; Gp 17.2 → 20.2 dB.
  it('listed id passes at 20.8 dB', () => {
    const s = init({ I1: -35.8, TP1: 0, maxDepth: capFor(LISTED, ex) });
    expect(depthOf(s)).toBe(20.8);
    expect(s.done).toBe(false);
    expect(onPre(s, -18.1)).toMatchObject({ done: false, phase: 'encode' });
  });
  it('unlisted id still refused at 20.2 dB', () => {
    const s = init({ I1: -35.2, TP1: 0, maxDepth: capFor(OTHER, ex) });
    expect(depthOf(s)).toBe(20.2);
    expect(s).toMatchObject({ done: true, result: 'failed' });
    expect(s.reason).toBe('limiter depth 20.2 dB > 20');
  });
  it('the committed file lists ids only, cap 21', () => {
    const f = JSON.parse(readFileSync('data/audio/limit-exceptions.json', 'utf-8'));
    expect(Object.keys(f).sort()).toEqual(['_doc', 'cap_db', 'ids']);
    expect(f.cap_db).toBe(21);
    expect(f.ids.every((x) => /^[A-Za-z0-9_-]{25,}$/.test(x))).toBe(true);
    expect(f.ids.length).toBe(2);
  });
});

describe('b) true-peak failures take the true-peak path', () => {
  it('routing: B3 true-peak failures and quiet+capped ones; not a loud one, not a success', () => {
    const tp = { result: 'failed', reason: 'reached 5 encodes — TP -1.4 > -1.5 (too hot); I -19.8 too quiet (< -18.5)' };
    expect(isQuietCapped(tp)).toBe(false); // the old rule missed it
    expect(isTruePeakFailure(tp)).toBe(true);
    expect(takesTpPath(tp)).toBe(true);
    expect(takesTpPath({ result: 'failed', reason: 'TP -1.2 > -1.5 at limit 0.5 — failed' })).toBe(true);
    expect(takesTpPath({ result: 'failed', reason: 'reached 5 encodes — TP -1.2 > -1.5 (too hot); I -17.2 too loud (> -17.5)' })).toBe(false);
    expect(takesTpPath({ result: 'ok', reason: 'converged' })).toBe(false);
  });
  it('a TP miss lowers the ceiling by the measured excess (encoder overshoot), down to −10 dB', () => {
    const s = { ...init({ I1: -24, TP1: 0.2 }), phase: 'encode' };
    expect(onMp3(s, -18.4, 0.7)).toMatchObject({ done: false, ceilDb: -5.7 }); // −3 − (0.7 − (−2.0))
    expect(onMp3({ ...s, ceilDb: -6 }, -18.4, -0.7)).toMatchObject({ ceilDb: -7.3 });
    expect(onMp3({ ...s, ceilDb: -9.5 }, -18.4, 1)).toMatchObject({ ceilDb: MIN_CEIL_DB });
    expect(onMp3({ ...s, ceilDb: MIN_CEIL_DB }, -18.4, -1)).toMatchObject({ done: true, result: 'failed' });
  });
});

function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) if (existsSync(p)) return p;
  return null;
}
const BASH = findBash();
const HAS_FFMPEG = BASH && spawnSync(BASH, ['-c', 'ffmpeg -version >/dev/null 2>&1']).status === 0;
const run = HAS_FFMPEG ? it : it.skip;

/** 16 s: quiet speech-like noise + every 2 s a 30 ms burst of an fs/4 sine at 45° (true peak 3 dB over its samples). */
function overPeakWav(seconds = 16, rate = 44100) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  let seed = 7;
  let lp = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) ** 2 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.21 * t));
    lp = 0.85 * lp + 0.15 * rnd();
    let v = lp * env * 0.9;
    if (t % 2 < 0.03) v += 0.99 * Math.sin(2 * Math.PI * (i / 4) + Math.PI / 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}

describe('real ffmpeg: synthetic over-peak file', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tpx-'));
    writeFileSync(join(dir, 'src.wav'), overPeakWav());
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sh = (body) => {
    const r = spawnSync(BASH, ['-c', `source "${lib}"; cd "${dir.replace(/\\/g, '/')}"; ${body}`], { encoding: 'utf-8', env: { ...process.env, B3_LOG: 'tpx-test' }, maxBuffer: 16 * 1024 * 1024 });
    return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  run('B3 fails it on true peak (not "G pinned"), so only the new routing sends it to the true-peak path', () => {
    const s = JSON.parse(sh('b3_mp3loop src.wav "" -18 "" b3.mp3').out);
    expect(s.result).toBe('failed');
    expect(isQuietCapped(s)).toBe(false);
    expect(isTruePeakFailure(s)).toBe(true);
  }, 180000);
  run('the true-peak path reaches −18 ±0.5 LUFS, TP ≤ −1.5 dBTP, measured on the mp3', () => {
    const s = JSON.parse(sh('b3_tploop src.wav "" -18 tp.mp3').out);
    expect(s.result).toBe('ok');
    const m = sh('b3_ebur tp.mp3 ""').out.split(' ').map(Number);
    expect(Math.abs(m[0] + 18)).toBeLessThanOrEqual(0.5);
    expect(m[1]).toBeLessThanOrEqual(-1.5);
  }, 300000);
});
