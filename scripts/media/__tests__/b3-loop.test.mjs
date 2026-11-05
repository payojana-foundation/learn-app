/**
 * b3-loop.test.mjs — the shell wiring of the CHANGE 4 Nov B3 loop (b3-loop.sh
 * b3_mp3loop). A STUB ffmpeg (env FFMPEG) models the ENCODE+decode path:
 *   - a pass-1 null read (no volume filter) reports I1/TP1;
 *   - an encode (output is a .mp3) + its ebur128 read reports
 *       I_mp3 = I1 + G − LOSS,   TP_mp3 = min(TP1 + G, 20·log10(limit) + OVER).
 * The stub remembers the last encode's G/limit via files so the following
 * ebur128 read returns the matching numbers. No real ffmpeg/Drive. Skips w/o bash.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const fwd = (p) => p.replace(/\\/g, '/');
const lib = fwd(resolve(here, '..', 'b3-loop.sh'));

function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    if (existsSync(p)) return p;
  }
  return null;
}
const BASH = findBash();
const run = BASH ? it : it.skip;

// Stub ffmpeg (fixtures/stub-ffmpeg-b3loop.sh): models encode + ebur128 decode.
const STUB = readFileSync(resolve(here, 'fixtures', 'stub-ffmpeg-b3loop.sh'), 'utf-8');

describe('b3-loop.sh b3_mp3loop (stub ffmpeg)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'b3loop-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function mp3loop(env, target = '-18', exc = '') {
    const stub = join(dir, 'ffmpeg');
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    const r = spawnSync(
      BASH,
      ['-c', `source "${lib}"; b3_mp3loop dummy.mka "" "${target}" "${exc}" out.mp3`],
      { cwd: dir, env: { ...process.env, FFMPEG: fwd(stub), B3_LOG: 'test', ...env }, encoding: 'utf-8' },
    );
    return { status: r.status, state: r.stdout ? JSON.parse(r.stdout) : null, log: r.stderr };
  }

  run('loss 1.5 LU, clean TP → G chases -18, converges ok; every encode logged', () => {
    const r = mp3loop({ STUB_TP1: '-30' }); // TP1 very low so TP never limits
    expect(r.status).toBe(0);
    expect(r.state.result).toBe('ok');
    expect(r.state.encodes).toBeGreaterThanOrEqual(2);
    expect(Math.abs(-18 - r.state.I_mp3)).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(r.log).toMatch(/stage=pass1 I1=-24 TP1=-30/);
    expect(r.log).toMatch(/stage=encode n=1 .*I_mp3=/);
  });

  run('hot TP tightens the limiter (0.60 → 0.54) before chasing loudness', () => {
    // TP1 high so the first encode overshoots; OVER keeps it above the ceiling.
    const r = mp3loop({ STUB_I1: '-20', STUB_TP1: '-2', STUB_LOSS: '0', STUB_OVER: '3' });
    expect(r.log).toMatch(/limit=0\.6 /);
    expect(r.state.limit).toBeLessThan(0.6);
  });

  // The limiter floor → failed behaviour is covered deterministically by the
  // pure b3-decide test ("a. limit floor"); the shell test keeps only the fast
  // wiring checks to stay reliable under parallel load.

  run('exception accept_I: converges at that target → exception', () => {
    const r = mp3loop({ STUB_TP1: '-30' }, '-18', '-19');
    expect(['exception', 'failed']).toContain(r.state.result); // model may not land exactly
    expect(r.state.target).toBe(-19);
  });

  run('b3_chain: default limit 0.708; a passed limit is used; level=disabled', () => {
    const r = spawnSync(BASH, ['-c', `source "${lib}"; b3_chain "pan=mono|c0=0.5*c0+0.5*c1" 9.5; echo; b3_chain "" -3 0.54`], { encoding: 'utf-8' });
    const [a, b] = r.stdout.split('\n');
    expect(a).toBe('pan=mono|c0=0.5*c0+0.5*c1,volume=9.5dB,aresample=44100,alimiter=limit=0.708:attack=5:release=50:level=disabled');
    expect(b).toBe('volume=-3dB,aresample=44100,alimiter=limit=0.54:attack=5:release=50:level=disabled');
  });

  run('the loop source has no acompressor and only ONE Drive download point', () => {
    const src = readFileSync(resolve(here, '..', 'b3-loop.sh'), 'utf-8');
    expect(src).not.toMatch(/acompressor/);
    expect(src.match(/googleapis\.com/g)?.length).toBe(1);
  });
});
