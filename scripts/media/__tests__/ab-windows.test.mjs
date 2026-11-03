import { describe, it, expect } from 'vitest';
import { parseFrames, loudestWindowStart, firstPauseStart } from '../ab-windows.mjs';

const log = [
  't: 0    M: -18.0 S: -18 I: -18 LUFS',
  't: 1    M: -17.0 S: -18 I: -18 LUFS',
  't: 2    M: -60.0 S: -18 I: -18 LUFS',
  't: 3    M: -60.0 S: -18 I: -18 LUFS',
  't: 4    M: -60.0 S: -18 I: -18 LUFS',
  't: 5    M: -60.0 S: -18 I: -18 LUFS',
  't: 6    M: -8.0  S: -18 I: -18 LUFS',
  't: 7    M: -inf  S: -18 I: -18 LUFS',
].join('\n');

describe('ab-windows', () => {
  it('parses t + M frames, mapping -inf to a very low value', () => {
    const f = parseFrames(log);
    expect(f).toHaveLength(8);
    expect(f[7].m).toBeLessThanOrEqual(-70);
  });
  it('loudest window prefers the region with the highest mean M', () => {
    // 1 s window → the single loudest frame is t=6 (M -8).
    expect(loudestWindowStart(parseFrames(log), 1)).toBe(6);
  });
  it('finds the first ≥3 s near-silent pause (starts at t=2)', () => {
    expect(firstPauseStart(parseFrames(log), 3, -50)).toBe(2);
  });
  it('no pause → 0', () => {
    expect(firstPauseStart(parseFrames('t: 0 M: -10 LUFS'), 3, -50)).toBe(0);
  });
});
