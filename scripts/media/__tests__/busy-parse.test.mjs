/**
 * busy-parse.test.mjs — bug-1 regression: busy% is parsed from the PER-FRAME
 * ametadata print (lavfi.astats.Overall.Peak_level=…), not the astats stderr
 * summary (which never carried per-frame values → busy was always 0).
 *
 * Exercises the exact node snippet transcode-one.sh uses for busy, over a stub
 * ffmpeg log of ametadata lines, so the parse is verified without ffmpeg.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// The busy snippet from measure_depth_busy: count frames whose Peak_level > ceil.
const BUSY = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=s.split(/\\n/).filter(Boolean).map(x=>x==="-inf"?-120:parseFloat(x));const c=parseFloat(process.argv[1]);const over=v.filter(x=>x>c).length;process.stdout.write(String(v.length?(100*over/v.length):0))})';

// The grep step keeps only the numeric value after Peak_level=; emulate it.
function grepPeak(log) {
  return log
    .split('\n')
    .map((l) => /lavfi\.astats\.Overall\.Peak_level=(-?[0-9.]+|-inf)/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])
    .join('\n');
}

function busy(log, ceil) {
  const peaks = grepPeak(log);
  const r = spawnSync(process.execPath, ['-e', BUSY, '--', String(ceil)], { input: peaks, encoding: 'utf-8' });
  return parseFloat(r.stdout);
}

describe('bug-1 busy% from per-frame ametadata', () => {
  const ceil = -3; // 20*log10(0.708) ≈ -3 dBFS
  const log = [
    'frame:0  lavfi.astats.Overall.Peak_level=-1.0', // over
    'frame:1  lavfi.astats.Overall.Peak_level=-2.5', // over
    'frame:2  lavfi.astats.Overall.Peak_level=-6.0', // under
    'frame:3  lavfi.astats.Overall.Peak_level=-inf', // under (silence)
  ].join('\n');

  it('counts frames above the ceiling (2 of 4 = 50%)', () => {
    expect(busy(log, ceil)).toBeCloseTo(50, 5);
  });
  it('is 0 when no frame exceeds the ceiling', () => {
    const quiet = 'x lavfi.astats.Overall.Peak_level=-10\ny lavfi.astats.Overall.Peak_level=-20';
    expect(busy(quiet, ceil)).toBe(0);
  });
  it('is 0 (not NaN) when there are no frames — the old stderr-only bug', () => {
    expect(busy('astats summary with no per-frame values', ceil)).toBe(0);
  });
});
