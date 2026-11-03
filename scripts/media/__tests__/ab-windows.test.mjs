import { describe, it, expect } from 'vitest';
import { parseFrames, loudestWindowStart, firstPauseStart, loudestWindowBounded, pauseClipWindow } from '../ab-windows.mjs';

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

describe('ab-windows rev 2', () => {
  // 600 s file, short-term loud peak around t=300; frames every 10 s.
  const frames = [];
  for (let t = 0; t <= 600; t += 10) {
    const s = t >= 290 && t <= 320 ? -8 : -24;
    frames.push(`t: ${t} M: ${s} S: ${s} I: -18 LUFS`);
  }
  const f = parseFrames(frames.join('\n'));

  it('loudestWindowBounded respects start ≥120 and end ≤ dur-120', () => {
    const w = loudestWindowBounded(f, 600, { win: 90, minStart: 120, endPad: 120 });
    expect(w.start).toBeGreaterThanOrEqual(120);
    expect(w.start + w.dur).toBeLessThanOrEqual(600 - 120);
  });

  it('pauseClipWindow finds a ≥3 s pause past 300 s and centres a 30 s clip', () => {
    const q = [];
    for (let t = 0; t <= 600; t += 1) {
      const m = t >= 400 && t <= 404 ? -60 : -20; // 5 s pause at 400 s
      q.push(`t: ${t} M: ${m} S: ${m} LUFS`);
    }
    const w = pauseClipWindow(parseFrames(q.join('\n')), 600, { minAt: 300, clip: 30 });
    expect(w).not.toBeNull();
    expect(w.dur).toBe(30);
    expect(w.start).toBeLessThan(402);
    expect(w.start + 30).toBeGreaterThan(402);
  });

  it('pauseClipWindow returns null when the only pause is before 300 s', () => {
    const q = [];
    for (let t = 0; t <= 600; t += 1) q.push(`t: ${t} M: ${t >= 100 && t <= 104 ? -60 : -20} S: -20 LUFS`);
    expect(pauseClipWindow(parseFrames(q.join('\n')), 600, { minAt: 300 })).toBeNull();
  });
});
