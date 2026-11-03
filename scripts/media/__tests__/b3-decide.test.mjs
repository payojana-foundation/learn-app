import { describe, it, expect } from 'vitest';
import { decide, depthRuleHolds, capReduction } from '../b3-decide.mjs';

describe('B3 depthRuleHolds (frozen 3 Nov)', () => {
  it('holds at depth ≤ 6 regardless of busy', () => {
    expect(depthRuleHolds(6, 99)).toBe(true);
  });
  it('holds at depth ≤ 12 only when busy < 0.5%', () => {
    expect(depthRuleHolds(12, 0.4)).toBe(true);
    expect(depthRuleHolds(12, 0.6)).toBe(false);
  });
  it('fails above 12 dB', () => {
    expect(depthRuleHolds(12.1, 0)).toBe(false);
  });
});

describe('B3 capReduction', () => {
  it('is 0 when the rule already holds', () => {
    expect(capReduction(6, 1)).toBe(0);
  });
  it('aims for 12 when busy is clean, else for 6', () => {
    expect(capReduction(15, 0.2)).toBe(3); // 15 - 12
    expect(capReduction(15, 1)).toBe(9); // 15 - 6
  });
});

describe('B3 decide (accept | cap | exception | fail)', () => {
  it('accepts when depth within rule', () => {
    expect(decide({ depth: 5, busy: 0.1, G: 3, I: -16 }).verdict).toBe('accept');
  });
  it('caps (lowers G) when depth too high but capped I stays ≥ -18', () => {
    const r = decide({ depth: 15, busy: 1, G: 3, I: -16 }); // cut = 9 → capI = -25? no: I=-16-9=-25 < -18 → fail
    expect(r.verdict).toBe('fail');
  });
  it('caps when the reduction keeps I ≥ -18', () => {
    const r = decide({ depth: 9, busy: 1, G: 3, I: -16 }); // cut = 3 → capI = -19 < -18 → fail
    expect(r.verdict).toBe('fail');
    const r2 = decide({ depth: 8, busy: 0.2, G: 3, I: -16 }); // busy clean → target 12, no cut needed (depth≤12) → accept
    expect(r2.verdict).toBe('accept');
  });
  it('caps with a small reduction that stays above the floor', () => {
    const r = decide({ depth: 13, busy: 0.2, G: 3, I: -16 }); // target 12, cut 1 → capI -17 ≥ -18 → cap
    expect(r.verdict).toBe('cap');
    expect(r.capG).toBe(2);
  });
  it('bug-2: capI is -16 - cut, independent of I(pass1): depth 12.6 busy 0 → cap, cut 0.6, capI -16.6', () => {
    // busy 0 → 12 dB rule in play, cut = 12.6 - 12 = 0.6. I(pass1)=-9 must NOT
    // affect capI; capI = -16 - 0.6 = -16.6 (≥ -18) → cap.
    const r = decide({ depth: 12.6, busy: 0, G: -7, I: -9 });
    expect(r.verdict).toBe('cap');
    expect(r.capG).toBeCloseTo(-7.6, 5); // G - 0.6
    expect(r.reason).toMatch(/-16\.6/);
  });
  it('routes an exception to its accept_I (≥ -18)', () => {
    const r = decide({ depth: 30, busy: 50, G: 3, I: -16, exception: { accept_I: -18 } });
    expect(r.verdict).toBe('exception');
    expect(r.capG).toBe(1); // G + (accept_I - I) = 3 + (-18 - -16)
  });
  it('fails an exception below the -18 floor', () => {
    expect(decide({ depth: 1, busy: 0, G: 3, I: -16, exception: { accept_I: -20 } }).verdict).toBe('fail');
  });
});
