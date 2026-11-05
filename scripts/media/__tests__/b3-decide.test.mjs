import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initState, step, classify, gMax, TARGET_I, START_LIMIT, MIN_LIMIT, TH } from '../b3-decide.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ceil = (l) => 20 * Math.log10(l);

/** Drive the loop with a model: mp3 I = I1 + G − loss(G,limit); mp3 TP = TP1 + G
 * clamped to 20·log10(limit) + overshoot. */
function run({ I1, TP1, target = TARGET_I, exception = null, loss = 1.5, overshoot = 0 }) {
  let s = initState({ I1, TP1, target, exception });
  let guard = 0;
  while (!s.done && guard++ < 20) {
    const I = I1 + s.G - loss;
    const TP = Math.min(TP1 + s.G, ceil(s.limit) + overshoot);
    s = step(s, I, TP);
  }
  return s;
}

describe('final standard (4 Nov): constants', () => {
  it('target -18, start limit 0.60, min 0.50; shell default and alimiter level', () => {
    expect(TARGET_I).toBe(-18);
    expect(START_LIMIT).toBe(0.6);
    expect(MIN_LIMIT).toBe(0.5);
    const sh = readFileSync(join(here, '..', 'transcode-one.sh'), 'utf-8');
    expect(sh).toMatch(/TARGET_I="\$\{TARGET_I:--18\}"/);
    const lib = readFileSync(join(here, '..', 'b3-loop.sh'), 'utf-8');
    expect(lib).toMatch(/B3_ALIMITER_LEVEL="disabled"/);
  });
  it('thresholds: max 5 encodes, aim ±0.2, ok ±0.5, cap band 1.0, step ×0.9, depth 12', () => {
    expect(TH).toMatchObject({ depthMax: 12, tpMax: -1.5, aim: 0.2, okBand: 0.5, capFloor: 1.0, maxEncodes: 5, limitStep: 0.9 });
  });
  it('G_max = 12 + 20·log10(limit) − TP1 (drops when the limit drops)', () => {
    expect(gMax(0.6, -9)).toBeCloseTo(12 + ceil(0.6) + 9, 6);
    expect(gMax(0.54, -9)).toBeLessThan(gMax(0.6, -9));
  });
});

describe('classify (bands at target -18)', () => {
  it('-18.4 → ok', () => expect(classify(-18.4, -2)).toBe('ok'));
  it('-18.6 → cap', () => expect(classify(-18.6, -2)).toBe('cap'));
  it('-19.1 → failed', () => expect(classify(-19.1, -2)).toBe('failed'));
  it('edges: -17.5/-18.5 ok; -18.51 cap; -19.0 cap; -19.01 failed; -17.4 failed', () => {
    expect(classify(-17.5, -2)).toBe('ok');
    expect(classify(-18.5, -2)).toBe('ok');
    expect(classify(-18.51, -2)).toBe('cap');
    expect(classify(-19.0, -2)).toBe('cap');
    expect(classify(-19.01, -2)).toBe('failed');
    expect(classify(-17.4, -2)).toBe('failed');
  });
  it('TP over -1.5 is failed even when I is perfect; exactly -1.5 is kept', () => {
    expect(classify(-18.0, -1.4)).toBe('failed');
    expect(classify(-18.0, -1.5)).toBe('ok');
  });
  it('NaN → failed', () => expect(classify(NaN, -2)).toBe('failed'));
});

describe('loop decisions (fixed I/TP inputs)', () => {
  it('starting G from the null pass is capped at G_max', () => {
    // I1 -40 wants G +22, but G_max at limit .6, TP1 -9 is much less.
    const s = initState({ I1: -40, TP1: -9 });
    expect(s.G).toBeCloseTo(gMax(0.6, -9), 6);
    expect(s.limit).toBe(0.6);
  });

  it('b. loudness low → G rises toward -18, converges, result ok', () => {
    const s = run({ I1: -24, TP1: -9, loss: 1.5 });
    expect(s.result).toBe('ok');
    expect(s.encodes).toBeGreaterThanOrEqual(2);
    expect(s.encodes).toBeLessThanOrEqual(5);
    expect(Math.abs(-18 - s.I_mp3)).toBeLessThanOrEqual(0.2 + 1e-9);
    // every encode logged G/limit/I/TP
    expect(s.history[0]).toHaveProperty('G');
    expect(s.history[0]).toHaveProperty('limit');
    expect(s.history[0]).toHaveProperty('I_mp3');
    expect(s.history[0]).toHaveProperty('TP_mp3');
  });

  it('a. TP over -1.5 → limit ×0.9 and G re-capped to the LOWER G_max', () => {
    // Fixed inputs: first encode TP hot; capture the state after one step.
    let s = initState({ I1: -24, TP1: -9 });
    const g0 = s.G;
    s = step(s, -18.0, -1.0); // I ok but TP = -1.0 > -1.5
    expect(s.limit).toBeCloseTo(0.54, 6); // 0.6 × 0.9
    expect(s.G).toBeLessThanOrEqual(gMax(0.54, -9) + 1e-9);
    expect(s.G).toBeLessThanOrEqual(g0 + 1e-9); // never raised by a TP cut
    expect(s.done).toBe(false);
  });

  it('a. limit floor: TP still over at 0.50 → failed', () => {
    // Feed a TP that is always hot (0.0 dBTP) and an on-target I, so only rule a
    // ever fires. limit walks 0.60 → 0.54 → 0.50, then a hot TP at 0.50 fails.
    let s = initState({ I1: -24, TP1: -9 });
    let guard = 0;
    while (!s.done && guard++ < 10) s = step(s, -18.0, 0.0);
    expect(s.result).toBe('failed');
    expect(s.limit).toBe(0.5);
  });

  it('TP cut is tried BEFORE the loudness move (order a before b)', () => {
    let s = initState({ I1: -24, TP1: -9 });
    s = step(s, -20.0, -0.5); // both wrong: I low AND TP hot → TP wins this round
    expect(s.limit).toBeCloseTo(0.54, 6);
    expect(s.reason).toMatch(/TP .* > -1\.5/);
  });

  it('stops after 5 encodes and judges the last mp3 (no 6th adjustment)', () => {
    const s = run({ I1: -24, TP1: -9, loss: 0.6 }); // never settles exactly
    expect(s.encodes).toBeLessThanOrEqual(5);
    if (s.encodes === 5) expect(['ok', 'cap', 'failed']).toContain(s.result);
  });

  it('converges to cap when the best reachable I sits in -19.0..-18.5', () => {
    // force I to land at -18.7 regardless of G chase: model returns a fixed I.
    let s = initState({ I1: -24, TP1: -9 });
    let guard = 0;
    while (!s.done && guard++ < 10) s = step(s, -18.7, -2.0);
    expect(s.result).toBe('cap');
  });
});

describe('exception route', () => {
  it('accepts within accept_I ±0.5 (TP ok) → exception', () => {
    let s = initState({ I1: -24, TP1: -9, exception: { accept_I: -19 } });
    let guard = 0;
    while (!s.done && guard++ < 10) s = step(s, -19.0, -2.0);
    expect(s.result).toBe('exception');
    expect(s.target).toBe(-19);
  });
});

describe('robustness', () => {
  it('a missing pass-1 fails cleanly', () => {
    expect(initState({ I1: 'NaN', TP1: -9 }).result).toBe('failed');
  });
  it('an mp3 measurement that fails to parse → failed', () => {
    expect(step(initState({ I1: -24, TP1: -9 }), 'NaN', 'NaN').result).toBe('failed');
  });
});
