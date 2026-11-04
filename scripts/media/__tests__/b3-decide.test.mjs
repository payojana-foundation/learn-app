import { describe, it, expect } from 'vitest';
import { initState, step, depthOf, capGain, CEIL_DB, TARGET_I, TH } from '../b3-decide.mjs';

/** Drive the state machine with a fake limited-signal measurement I_lim(G). */
function run({ I1, TP1, target = TARGET_I, exception = null, measure }) {
  let s = initState({ target, I1, TP1, exception });
  let guard = 0;
  while (!s.done && guard++ < 10) s = step(s, measure(s.G, s));
  return s;
}

describe('B3 G loop constants (approved 3 Nov)', () => {
  it('target default -16; ceiling = 20*log10(0.708); depth formula', () => {
    expect(TARGET_I).toBe(-16);
    expect(CEIL_DB).toBeCloseTo(-2.9993, 3);
    expect(depthOf(-9, 9.5)).toBeCloseTo(-9 + 9.5 + 2.9993, 3);
  });
  it('capGain puts depth exactly on 12 dB', () => {
    expect(depthOf(2, capGain(2))).toBeCloseTo(12, 6);
  });
});

describe('G loop', () => {
  it('starts at G = target − I1', () => {
    expect(initState({ I1: -24, TP1: -9 }).G).toBe(8);
  });

  it('limiter costs 1.5 LU: loop 1 off, loop 2 within ±0.2 → ok, G corrected (2 loops)', () => {
    const s = run({ I1: -24, TP1: -9, measure: (G) => -24 + G - 1.5 });
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(2);
    expect(s.G).toBeCloseTo(9.5, 6);
    expect(s.history.map((h) => h.G)).toEqual([8, 9.5]);
    expect(s.history[0].I_lim).toBeCloseTo(-17.5, 6);
    expect(s.expectI).toBe(-16);
  });

  it('stops after ONE loop when the first measurement is within ±0.2', () => {
    const s = run({ I1: -24, TP1: -9, measure: (G) => -24 + G - 0.1 });
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(1);
  });

  it('3 loops not within 0.2 but within 0.5 → ok', () => {
    const s = run({ I1: -24, TP1: -9, measure: () => -16.4 }); // never moves
    expect(s.result).toBe('ok');
    expect(s.loop).toBe(3);
  });

  it('3 loops and still > 0.5 off → failed', () => {
    const s = run({ I1: -24, TP1: -9, measure: () => -16.8 });
    expect(s.result).toBe('failed');
    expect(s.loop).toBe(3);
    expect(s.reason).toMatch(/> 0\.5/);
  });

  it('depth > 12 → CAP: G = 12 + 20log10(0.708) − TP1, then one MEASURED I_cap ≥ -18 → cap', () => {
    // TP1 = 2 dB: depth at G≈7.5 is 12.5 → cap.
    const s = run({ I1: -23, TP1: 2, measure: (G) => -23 + G - 0.5 });
    expect(s.result).toBe('cap');
    expect(s.G).toBeCloseTo(12 + CEIL_DB - 2, 6);
    expect(s.phase).toBe('cap');
    const last = s.history[s.history.length - 1];
    expect(last.phase).toBe('cap');
    expect(s.I_final).toBeCloseTo(-23 + s.G - 0.5, 6); // the MEASURED I_cap
    expect(s.expectI).toBe(s.I_final); // accept on the mp3 at I_cap ±0.5
    expect(s.depth).toBeCloseTo(12, 6);
  });

  it('part-8-like: depth only just over 12 → cap with a small cut', () => {
    // depth = TP1 + G − ceil; pick TP1 so the loop's G gives 12.6.
    const TP1 = -1;
    const s = run({ I1: -26, TP1, measure: (G) => -26 + G - 1.2 });
    expect(s.result).toBe('cap');
    expect(s.I_final).toBeGreaterThanOrEqual(-18);
  });

  it('I_cap below -18 → failed (exception route)', () => {
    const s = run({ I1: -23, TP1: 8, measure: (G) => -23 + G - 0.5 });
    expect(s.result).toBe('failed');
    expect(s.reason).toMatch(/-18/);
  });

  it('busy never matters (state machine has no busy input)', () => {
    expect(Object.keys(initState({ I1: -24, TP1: -9 }))).not.toContain('busy');
  });

  it('target is switchable to -18 for a whole course', () => {
    const s = run({ I1: -24, TP1: -9, target: -18, measure: (G) => -24 + G - 1.0 });
    expect(s.result).toBe('ok');
    expect(s.expectI).toBe(-18);
    expect(s.G).toBeCloseTo(7, 6);
  });
});

describe('exception route', () => {
  it('runs the same loop at accept_I and IGNORES depth → exception', () => {
    const s = run({ I1: -23, TP1: 8, exception: { accept_I: -18 }, measure: (G) => -23 + G - 0.5 });
    expect(s.result).toBe('exception');
    expect(s.target).toBe(-18);
    expect(s.expectI).toBe(-18);
  });
  it('accept_I below the floor → failed up front', () => {
    const s = initState({ I1: -24, TP1: -9, exception: { accept_I: -20 } });
    expect(s.done).toBe(true);
    expect(s.result).toBe('failed');
  });
});

describe('robustness', () => {
  it('a missing pass-1 measurement fails cleanly', () => {
    expect(initState({ I1: 'NaN', TP1: -9 }).result).toBe('failed');
  });
  it('a null pass with no loudness fails cleanly', () => {
    const s = step(initState({ I1: -24, TP1: -9 }), 'NaN');
    expect(s.result).toBe('failed');
  });
  it('thresholds are the approved ones', () => {
    expect(TH).toMatchObject({ depthMax: 12, iFloor: -18, aim: 0.2, accept: 0.5, maxLoops: 3 });
  });
});
