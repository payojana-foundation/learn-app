/**
 * b3-loop.test.mjs — the shell wiring of the approved B3 G loop (b3-loop.sh).
 * A STUB ffmpeg (env FFMPEG) models a limiter that costs `LOSS` LU: pass-1 (no
 * volume filter) reports I1/TP1; a null pass with volume=<G>dB reports
 * I = I1 + G − LOSS. No real ffmpeg/Drive needed. Skips without bash.
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

const STUB = `#!/usr/bin/env bash
af=""; prev=""
for a in "$@"; do [ "$prev" = "-af" ] && af="$a"; prev="$a"; done
g="$(printf '%s' "$af" | sed -n 's/.*volume=\\(-\\{0,1\\}[0-9.]*\\)dB.*/\\1/p')"
i1="\${STUB_I1:--24}"; tp="\${STUB_TP:--9}"; loss="\${STUB_LOSS:-1.5}"
if [ -z "$g" ]; then I="$i1"; else I="$(awk -v i="$i1" -v g="$g" -v l="$loss" 'BEGIN{printf "%.4f", i + g - l}')"; fi
cat >&2 <<EOT
  Integrated loudness:
    I:         $I LUFS
    Threshold: -34.0 LUFS

  Loudness range:
    LRA:         5.0 LU

  True peak:
    Peak:       $tp dBFS
EOT
`;

describe('b3-loop.sh b3_gloop (stub ffmpeg)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'b3loop-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function gloop(env, target = '-18', exc = '') {
    const stub = join(dir, 'ffmpeg');
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    const r = spawnSync(
      BASH,
      ['-c', `source "${lib}"; b3_gloop dummy.mka "" "${target}" "${exc}"`],
      { cwd: dir, env: { ...process.env, FFMPEG: fwd(stub), B3_LOG: 'test', ...env }, encoding: 'utf-8' },
    );
    return { status: r.status, state: r.stdout ? JSON.parse(r.stdout) : null, log: r.stderr };
  }

  run('limiter loses 1.5 LU → 2 loops, G corrected, every G and I_lim logged', () => {
    const r = gloop({});
    expect(r.status).toBe(0);
    expect(r.state.result).toBe('ok');
    expect(r.state.loop).toBe(2);
    expect(r.state.G).toBeCloseTo(7.5, 3);
    expect(r.log).toMatch(/stage=pass1 I1=-24 TP1=-9/);
    expect(r.log).toMatch(/stage=gloop phase=loop loop=1 G=6 I_lim=-19\.5/);
    expect(r.log).toMatch(/loop=2 G=7\.5 I_lim=-18/);
  });

  run('depth over 12, measured I -18.8 after the cap → cap', () => {
    const r = gloop({ STUB_I1: '-23', STUB_TP: '4', STUB_LOSS: '0.8' });
    expect(r.state.result).toBe('cap');
    expect(r.state.G).toBeCloseTo(5.0, 1);
    expect(r.log).toMatch(/phase=cap/);
  });

  run('I below -19.0 after the cap → failed', () => {
    const r = gloop({ STUB_I1: '-23', STUB_TP: '8', STUB_LOSS: '0.5' });
    expect(r.state.result).toBe('failed');
  });

  run('exception accept_I runs the loop at that target and ignores depth', () => {
    const r = gloop({ STUB_I1: '-23', STUB_TP: '8', STUB_LOSS: '0.5' }, '-18', '-18.5');
    expect(r.state.result).toBe('exception');
    expect(r.state.target).toBe(-18.5);
  });
  run('b3_chain builds pan → volume → aresample → alimiter 0.708', () => {
    const r = spawnSync(BASH, ['-c', `source "${lib}"; b3_chain "pan=mono|c0=0.5*c0+0.5*c1" 9.5; echo; b3_chain "" -3`], { encoding: 'utf-8' });
    const [a, b] = r.stdout.split('\n');
    expect(a).toBe('pan=mono|c0=0.5*c0+0.5*c1,volume=9.5dB,aresample=44100,alimiter=limit=0.708:attack=5:release=50:level=disabled');
    expect(b).toBe('volume=-3dB,aresample=44100,alimiter=limit=0.708:attack=5:release=50:level=disabled');
  });

  run('the loop source has no acompressor and no per-pass Drive download', () => {
    const src = readFileSync(resolve(here, '..', 'b3-loop.sh'), 'utf-8');
    expect(src).not.toMatch(/acompressor/);
    expect(src.match(/googleapis\.com/g)?.length).toBe(1); // only b3_fetch_audio downloads
  });
});
