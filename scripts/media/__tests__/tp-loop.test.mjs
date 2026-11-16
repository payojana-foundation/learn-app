/**
 * PART 5 — loudness fix for quiet, peaky recordings. Pure decisions (tp-decide.mjs) and the
 * REAL ffmpeg chain on a SYNTHETIC file: quiet speech-like noise (≈ −30 LUFS) with loud
 * clicks near 0 dBFS. The B3 loop must fail it ("G pinned … too quiet"); the true-peak
 * limiter + two-pass loudnorm must reach −18 ±0.5 LUFS with TP ≤ −1.5 dBTP, measured on the
 * mp3. Skips without bash or ffmpeg.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, onPre, onMp3, classify, isQuietCapped, parseLoudnorm, depthOf, MAX_DEPTH, MIN_CEIL_DB } from '../tp-decide.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const lib = resolve(here, '..', 'b3-loop.sh').replace(/\\/g, '/');

describe('tp-decide (pure)', () => {
  it('only the loudness-only B3 failure (too quiet, G pinned) takes this path', () => {
    expect(isQuietCapped({ result: 'failed', reason: 'G pinned at 8.36 (G_max), limit 0.6 — no further change — I -19.3 too quiet (< -18.5)' })).toBe(true);
    expect(isQuietCapped({ result: 'failed', reason: 'TP -1.2 > -1.5 at limit 0.5 — failed' })).toBe(false);
    expect(isQuietCapped({ result: 'cap', reason: 'G pinned … too quiet' })).toBe(false);
    expect(isQuietCapped({ result: 'failed', reason: 'I -19.3 too quiet after 5 encodes' })).toBe(false);
  });
  it('start: full gain, ceiling −3 dB; a depth over the cap fails before any work', () => {
    const s = init({ I1: -30, TP1: -0.5 });
    expect(s).toMatchObject({ Gp: 12, ceilDb: -3, phase: 'pre', done: false });
    expect(depthOf(s)).toBe(14.5);
    expect(init({ I1: -40, TP1: 0 })).toMatchObject({ done: true, result: 'failed' });
    expect(init({ I1: -40, TP1: 0 }).reason).toContain(`> ${MAX_DEPTH}`);
  });
  it('pass-1 of the limited signal corrects Gp until it sits at the target, then encodes', () => {
    let s = init({ I1: -30, TP1: -0.5 });
    s = onPre(s, -18.9);
    expect(s).toMatchObject({ Gp: 13.12, phase: 'pre' }); // 12 + 0.9 × 1.25, rounded (limiting eats some loudness)
    s = onPre(s, -18.1);
    expect(s.phase).toBe('encode');
  });
  it('mp3: ok only in −18 ±0.5 with TP ≤ −1.5; hot TP lowers the ceiling; quiet raises Gp', () => {
    let s = { ...init({ I1: -30, TP1: -0.5 }), phase: 'encode' };
    expect(onMp3(s, -18.2, -1.9).result).toBe('ok');
    const hot = onMp3(s, -18.0, -1.2);
    expect(hot).toMatchObject({ done: false, ceilDb: -4, phase: 'pre' });
    const quiet = onMp3(s, -18.8, -2.5);
    expect(quiet).toMatchObject({ done: false, lnI: -17.2, Gp: 12.8, phase: 'pre' }); // after loudnorm, only its target moves the output
    s = { ...s, ceilDb: MIN_CEIL_DB };
    expect(onMp3(s, -18, -1.0)).toMatchObject({ done: true, result: 'failed' });
    expect(classify(-18.6, -2)).toEqual({ ok: false, reason: 'I -18.6 too quiet (< -18.5)' });
  });
  it('a pass on the edge of the band is kept, the loop aims for the middle, the best pass is used', () => {
    const s0 = { ...init({ I1: -30, TP1: -0.5 }), phase: 'encode' };
    const edge = onMp3(s0, -18.5, -1.5);
    expect(edge).toMatchObject({ done: false, phase: 'pre', lnI: -17.5, ceilDb: -3.5 });
    expect(edge.best).toMatchObject({ encode: 1, I_mp3: -18.5, TP_mp3: -1.5 });
    const worse = onMp3({ ...edge, phase: 'encode' }, -17.2, -1.0); // over the band: not better
    expect(worse.done).toBe(false);
    const third = onMp3({ ...worse, phase: 'encode' }, -18.3, -1.6); // passes, still not centred, 3rd encode
    expect(third).toMatchObject({ done: true, result: 'ok', I_mp3: -18.3, TP_mp3: -1.6, best_encode: 3 });
    const centred = onMp3({ ...edge, phase: 'encode' }, -18.05, -2.1);
    expect(centred).toMatchObject({ done: true, result: 'ok', best_encode: 2 });
  });
  it('at most 5 encodes', () => {
    let s = { ...init({ I1: -30, TP1: -0.5 }), phase: 'encode', encodes: 4 };
    expect(onMp3(s, -19, -3)).toMatchObject({ done: true, result: 'failed' });
  });
  it('parses the loudnorm json block', () => {
    expect(parseLoudnorm('x\n[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-18.10",\n\t"normalization_type" : "linear"\n}\n')).toEqual({ input_i: '-18.10', normalization_type: 'linear' });
    expect(parseLoudnorm('nothing')).toBe(null);
  });
});

// ── real ffmpeg on a synthetic quiet / peaky file ────────────────────────────
function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) if (existsSync(p)) return p;
  return null;
}
const BASH = findBash();
const HAS_FFMPEG = BASH && spawnSync(BASH, ['-c', 'ffmpeg -version >/dev/null 2>&1']).status === 0;
const run = HAS_FFMPEG ? it : it.skip;

/** 24 s mono 44.1 kHz: syllable-modulated noise at a low level (≈ −30 LUFS) + a 4 ms thump near 0 dBFS every 6 s. */
function quietPeakyWav(seconds = 24, rate = 44100) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) ** 2 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.21 * t));
    lp = 0.85 * lp + 0.15 * rnd(); // soft low-pass: speech-like spectrum
    let v = lp * env * 0.6;
    const tc = t % 6; // a 4 ms mic thump (windowed 800 Hz burst) near 0 dBFS every 6 s
    if (tc < 0.004) v += 0.88 * Math.sin(Math.PI * tc / 0.004) ** 2 * Math.sin(2 * Math.PI * 800 * tc);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}

describe('real ffmpeg: synthetic quiet + peaky file', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tp-'));
    writeFileSync(join(dir, 'src.wav'), quietPeakyWav());
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sh = (body) => {
    const r = spawnSync(BASH, ['-c', `source "${lib}"; cd "${dir.replace(/\\/g, '/')}"; ${body}`], { encoding: 'utf-8', env: { ...process.env, B3_LOG: 'tp-test' }, maxBuffer: 16 * 1024 * 1024 });
    return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
  };

  run('the B3 loop fails it: gain capped, too quiet, true peak to spare', () => {
    const r = sh('b3_mp3loop src.wav "" -18 "" b3.mp3');
    const s = JSON.parse(r.out);
    expect(s.result).toBe('failed');
    expect(isQuietCapped(s)).toBe(true);
    expect(s.TP_mp3).toBeLessThan(-1.5); // the ceiling is not what stops it
  }, 180000);

  run('the true-peak limiter + two-pass loudnorm reaches −18 ±0.5 LUFS, TP ≤ −1.5, measured on the mp3', () => {
    const r = sh('b3_tploop src.wav "" -18 tp.mp3');
    const s = JSON.parse(r.out);
    expect(s.result, r.err.split('\n').filter((l) => /tp-/.test(l)).join('\n')).toBe('ok');
    expect(Math.abs(s.I_mp3 + 18)).toBeLessThanOrEqual(0.5);
    expect(s.TP_mp3).toBeLessThanOrEqual(-1.5);
    // independent measurement of the file that would be uploaded
    const m = sh('b3_ebur tp.mp3 ""').out.split(' ').map(Number);
    expect(Math.abs(m[0] + 18)).toBeLessThanOrEqual(0.5);
    expect(m[1]).toBeLessThanOrEqual(-1.5);
    expect(s.norm).toBe('linear'); // no extra compression from loudnorm
    expect(s.depth).toBeLessThanOrEqual(MAX_DEPTH); // the uploaded file's own limiter depth
    expect(readFileSync(join(dir, 'tp.mp3')).length).toBeGreaterThan(1000);
    console.log(`[tp-test] synthetic: I1 ${s.I1} TP1 ${s.TP1} -> mp3 I ${m[0]} TP ${m[1]} (encodes ${s.encodes}, Gp ${s.Gp}, lnI ${s.lnI}, ceiling ${s.ceilDb}, depth ${s.depth} dB)`);
    expect(existsSync(join(dir, 'tp.mp3.lim.flac'))).toBe(false); // local work files removed
  }, 300000);
});
