import { describe, it, expect } from 'vitest';
import { decide, depthRuleHolds, capReduction, TARGET_I } from '../b3-decide.mjs';

describe('B3 rule (3 Nov): accept = depth ≤ 12; busy never used', () => {
  it('depth rule holds at ≤ 12 only', () => {
    expect(depthRuleHolds(12)).toBe(true);
    expect(depthRuleHolds(12.1)).toBe(false);
  });
  it('capReduction = depth − 12 (0 when within)', () => {
    expect(capReduction(10)).toBe(0);
    expect(capReduction(12.6)).toBeCloseTo(0.6, 5);
  });
  it('TARGET_I defaults to -16', () => {
    expect(TARGET_I).toBe(-16);
  });
});

describe('B3 decide', () => {
  it('part 4: depth 10.5, busy 5.9 → ok (busy ignored)', () => {
    const r = decide({ depth: 10.5, busy: 5.9, G: 3, I: -16 });
    expect(r.verdict).toBe('accept');
  });
  it('part 8: depth 12.6 → cap, cut 0.6, capI -16.6', () => {
    const r = decide({ depth: 12.6, busy: 0, G: -7, I: -9 });
    expect(r.verdict).toBe('cap');
    expect(r.capG).toBeCloseTo(-7.6, 5);
    expect(r.capI).toBeCloseTo(-16.6, 5);
  });
  it('busy has no effect on the verdict', () => {
    expect(decide({ depth: 12.6, busy: 99, G: 0, I: -16 }).verdict).toBe('cap');
    expect(decide({ depth: 5, busy: 99, G: 0, I: -16 }).verdict).toBe('accept');
  });
  it('capI uses the target constant (switchable to -18 for a course)', () => {
    const r = decide({ depth: 12.5, G: 0, I: -18, target: -18 });
    expect(r.verdict).toBe('fail'); // -18 - 0.5 = -18.5 < floor
    const ok = decide({ depth: 12, G: 0, I: -18, target: -18 });
    expect(ok.verdict).toBe('accept');
  });
  it('fails when the cap would go below the -18 floor', () => {
    expect(decide({ depth: 15, G: 3, I: -16 }).verdict).toBe('fail'); // cut 3 → -19
  });
  it('routes an exception to its accept_I (≥ -18)', () => {
    const r = decide({ depth: 30, G: 3, I: -16, exception: { accept_I: -18 } });
    expect(r.verdict).toBe('exception');
    expect(r.capG).toBe(1);
  });
  it('fails an exception below the -18 floor', () => {
    expect(decide({ depth: 1, G: 3, I: -16, exception: { accept_I: -20 } }).verdict).toBe('fail');
  });
});
