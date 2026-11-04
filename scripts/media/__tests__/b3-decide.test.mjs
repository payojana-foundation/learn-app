import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initState, step, depthOf, capGain, classifyI, mp3Verdict, tpFixGain, CEIL_DB, TARGET_I, TH } from '../b3-decide.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Drive the state machine with a fake limited-signal measurement I(G). */
function run({ I1, TP1, target = TARGET_I, exception = null, measure }) {
  let s = initState({ target, I1, TP1, exception });
  let guard = 0;
  while (!s.done && guard++ < 20) s = step(s, measure(s.G, s));
  return s;
}

describe('final standard (4 Nov): constants', () => {
  it('target is -18 (one constant, all courses) and the shell default matches', () => {
    expect(TARGET_I).toBe(-18);
    const sh = readFileSync(join(here, '..', 'transcode-one.sh'), 'utf-8');
    expect(sh).toMatch(/TARGET_I="\$\{TARGET_I:--18\}"/);
  });
  it('thresholds: max 5 loops, aim ±0.2, ok ±0.5, cap band 1.0, depth 12, TP -1.5', () => {
    expect(TH).toMatchObject({ depthMax: 12, aim: 0.2, accept: 0.5, capFloor: 1.0, maxLoops: 5, tpMax: -1.5 });
  });
  it('depth = TP1 + G − 20·log10(0.708); capGain puts depth exactly on 12', () => {
    expect(CEIL_DB).toBeCloseTo(-2.9993, 3);
    expect(depthOf(-9, 9.5)).toBeCloseTo(-9 + 9.5 + 2.9993, 3);
    expect(depthOf(2, capGain(2))).toBeCloseTo(12, 6);
  });
  it('part 1 key rule: only the md5 key, no -v2 path in transcode-one.sh', () => {
    const sh = readFileSync(join(here, '..', 'transcode-one.sh'), 'utf-8');
    expect(sh).toMatch(/key="audio\/\$\{md5hex\}-a64\.mp3"/);
    expect(sh).not.toMatch(/-a64-v2/);
  });
});

describe('I bands (target -18): ok ±0.5 / cap -19.0..-18.5 / failed < -19.0', () => {
  it('-18.4 → ok', () => expect(classifyI(-18.4)).toBe('ok'));
  it('-18.6 → cap', () => expect(classifyI(-18.6)).toBe('cap'));
  it('-19.1 → failed', () => expect(classifyI(-19.1)).toBe('failed'));
  it('edges: -17.5 and -18.5 are ok; -19.0 is cap; -17.4 is failed (too loud)', () => {
    expect(classifyI(-17.5)).toBe('ok');
    expect(classifyI(-18.5)).toBe('ok');
    expect(classifyI(-18.51)).toBe('cap');
    expect(classifyI(-19.0)).toBe('cap');
    expect(classifyI(-19.01)).toBe('failed');
    expect(classifyI(-17.4)).toBe('failed');
  });
  it('NaN → failed', () => expect(classifyI(NaN)).toBe('failed'));
  it('bands are relative to the target (ab-test runs -16 too)', () => {
    expect(classifyI(-16.6, -16)).toBe('cap');
    expect(classifyI(-17.1, -16)).toBe('failed');
  });
});

describe('G loop', () => {
  it('starts at G = target − I1', () => {
    expect(initState({ I1: -24, TP1: -9 }).G).toBe(6);
  });

  it('limiter costs 1.5 LU: loop 1 off, loop 2 within ±0.2 → ok, G corrected', () => {
    const s = run({ I1: -24, TP1: -9, measure: (G) => -24 + G - 1.5 });
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(2);
    expect(s.G).toBeCloseTo(7.5, 6);
    expect(s.history.map((h) => h.G)).toEqual([6, 7.5]);
    expect(s.history[0].I_lim).toBeCloseTo(-19.5, 6);
  });

  it('stops after ONE loop when the first measurement is within ±0.2', () => {
    const s = run({ I1: -24, TP1: -9, measure: (G) => -24 + G - 0.1 });
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(1);
  });

  it('allows up to 5 loops: a slow converger (half-step limiter) still reaches ±0.2', () => {
    // each correction only gets 60% of the way (nonlinear limiter): the
    // measurement moves 60% toward the target after every G change.
    let cur = -22; let st = initState({ I1: -24, TP1: -9 });
    while (!st.done) { st = step(st, cur); cur += (st.target - cur) * 0.6; }
    expect(st.result).toBe('ok');
    expect(st.loop).toBeGreaterThan(3); // would have failed with the old 3-loop limit
    expect(st.loop).toBeLessThanOrEqual(5);
  });

  it('5 loops not within 0.2 but within 0.5 → ok', () => {
    const s = run({ I1: -24, TP1: -9, measure: () => -18.4 });
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(5);
  });

  it('5 loops and still > 0.5 off → failed', () => {
    const s = run({ I1: -24, TP1: -9, measure: () => -18.7 });
    expect(s.result).toBe('failed');
    expect(s.loop).toBe(5);
    expect(s.reason).toMatch(/> 0\.5/);
  });

  it('busy is not an input anywhere (logged only)', () => {
    expect(Object.keys(initState({ I1: -24, TP1: -9 }))).not.toContain('busy');
  });
});

describe('depth > 12 → G for depth 12, then ONE measured I against the bands', () => {
  // TP1 = 4, I1 = -23: loop 1 pushes depth over 12 → cap phase at G = 12 + ceil − 4.
  const base = { I1: -23, TP1: 4 };

  it('I = -18.0 → ok', () => {
    const s = run({ ...base, measure: (G) => -23 + G - 0.0 });
    // loop: G0=5 → I=-18 → within aim → depth 11.9993 ≤ 12 → ok directly
    expect(s.result).toBe('ok');
  });

  it('I -18.4 after the cap → ok', () => {
    const s = run({ ...base, measure: (G) => -23 + G - 0.5 + (G < 5.2 ? 0.1 : 0) });
    // loop1: G=5 → I=-18.4 → d=.4 → G=5.4 → depth 12.4 > 12 → cap G=5.0007 → I≈-18.4
    expect(s.phase).toBe('cap');
    expect(s.G).toBeCloseTo(12 + CEIL_DB - 4, 6);
    expect(s.result).toBe('ok');
  });

  it('I -18.6 after the cap → cap', () => {
    const s = run({ ...base, measure: (G) => -23 + G - 0.6 });
    expect(s.phase).toBe('cap');
    expect(s.result).toBe('cap');
    expect(s.I_final).toBeCloseTo(-23 + (12 + CEIL_DB - 4) - 0.6, 6);
    expect(s.depth).toBeCloseTo(12, 6);
  });

  it('I -19.1 after the cap → failed (exception route)', () => {
    const s = run({ ...base, measure: (G) => -23 + G - 1.1 });
    expect(s.phase).toBe('cap');
    expect(s.result).toBe('failed');
    expect(s.reason).toMatch(/exception route/);
  });

  it('the cap measurement is MEASURED, not computed (history has the cap I)', () => {
    const s = run({ ...base, measure: (G) => -23 + G - 0.6 });
    const last = s.history[s.history.length - 1];
    expect(last.phase).toBe('cap');
    expect(Number.isFinite(last.I)).toBe(true);
  });
});

describe('finished mp3: TP and the same I bands', () => {
  it('TP over -1.5 → failed; exactly -1.5 passes', () => {
    expect(mp3Verdict({ I: -18, TP: -1.4 }).result).toBe('failed');
    expect(mp3Verdict({ I: -18, TP: -1.5 }).result).toBe('ok');
  });
  it('I bands on the mp3: -18.4 ok, -18.6 cap, -19.1 failed', () => {
    expect(mp3Verdict({ I: -18.4, TP: -2 }).result).toBe('ok');
    expect(mp3Verdict({ I: -18.6, TP: -2 }).result).toBe('cap');
    expect(mp3Verdict({ I: -19.1, TP: -2 }).result).toBe('failed');
  });
  it('an exception is accepted at accept_I ±0.5 (TP still enforced)', () => {
    expect(mp3Verdict({ I: -19.3, TP: -2, exception: { accept_I: -19 } }).result).toBe('exception');
    expect(mp3Verdict({ I: -19.8, TP: -2, exception: { accept_I: -19 } }).result).toBe('failed');
    expect(mp3Verdict({ I: -19, TP: -1, exception: { accept_I: -19 } }).result).toBe('failed');
  });
  it('tpFixGain lowers G by (TP + 1.5) dB', () => {
    expect(tpFixGain(5, -0.7)).toBeCloseTo(4.2, 6);
  });
  it('after the TP fix the I bands are re-checked on the new measurement', () => {
    // first encode TP -0.7 (over) → G 5 → 4.2; re-encode measures I -18.6 → cap (not ok)
    expect(tpFixGain(5, -0.7)).toBeCloseTo(4.2, 6);
    expect(mp3Verdict({ I: -18.6, TP: -1.6 }).result).toBe('cap');
    // TP still over after the one retry → failed
    expect(mp3Verdict({ I: -18.1, TP: -1.2 }).result).toBe('failed');
  });
});

describe('exception route', () => {
  it('runs the same loop at accept_I and IGNORES depth → exception', () => {
    const s = run({ I1: -23, TP1: 8, exception: { accept_I: -18.5 }, measure: (G) => -23 + G - 0.5 });
    expect(s.result).toBe('exception');
    expect(s.target).toBe(-18.5);
  });
  it('accept_I below the -19.0 floor → failed up front', () => {
    const s = initState({ I1: -24, TP1: -9, exception: { accept_I: -19.5 } });
    expect(s.done).toBe(true);
    expect(s.result).toBe('failed');
  });
});

describe('robustness', () => {
  it('a missing pass-1 measurement fails cleanly', () => {
    expect(initState({ I1: 'NaN', TP1: -9 }).result).toBe('failed');
  });
  it('a null pass with no loudness fails cleanly', () => {
    expect(step(initState({ I1: -24, TP1: -9 }), 'NaN').result).toBe('failed');
  });
});
