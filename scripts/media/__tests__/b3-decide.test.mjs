import { describe, it, expect } from 'vitest';
import { decide, depthRuleHolds } from '../b3-decide.mjs';

describe('B3 depthRuleHolds', () => {
  it('holds when depth ≤ 6 regardless of busy', () => {
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

describe('B3 decide', () => {
  const ok = { I: -16, TP: -1.6, depth: 5, busy: 0.1, G: 3, loops: 1 };
  it('accepts when loudness, TP and depth all hold', () => {
    expect(decide(ok).verdict).toBe('accept');
  });
  it('adjusts (lowers G) when depth too high but above the -18 floor', () => {
    const r = decide({ ...ok, depth: 15, loops: 1 });
    expect(r.verdict).toBe('adjust');
    expect(r.nextG).toBeLessThan(ok.G);
  });
  it('caps at loop 3 when depth rule still unmet but TP ok and above -18', () => {
    expect(decide({ ...ok, depth: 15, loops: 3 }).verdict).toBe('cap');
  });
  it('fails when even I ≤ -18 breaks the depth rule', () => {
    expect(decide({ ...ok, I: -18, depth: 15, loops: 2 }).verdict).toBe('fail');
  });
  it('adjusts on a hot true peak', () => {
    const r = decide({ ...ok, TP: -0.5, loops: 1 });
    expect(r.verdict).toBe('adjust');
    expect(r.nextG).toBe(ok.G - 1);
  });
  it('fails loudness/TP not reached by loop 3', () => {
    expect(decide({ ...ok, TP: -0.5, loops: 3 }).verdict).toBe('fail');
  });
});
