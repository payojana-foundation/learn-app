/** PART 5 — the one-time re-run of conversion failures (placeholder ids). */
import { describe, it, expect } from 'vitest';
import { readFailed, rerunIds, reasonsFromLogs, groupedCsv, splitParts } from '../loudness-rerun.mjs';

const ID = (c) => c.repeat(28);

describe('loudness re-run', () => {
  it('re-runs failed-review and autorun-exhausted ids that still have no converted file', () => {
    const failed = readFailed(`drive_file_id,course_id,reason\n${ID('a')},c900,too quiet\n${ID('b')},c900,\n`);
    expect(failed[0]).toEqual({ id: ID('a'), course: 'c900', reason: 'too quiet' });
    expect(rerunIds(failed, { [ID('c')]: 2, [ID('b')]: 1 }, new Set([ID('b')]))).toEqual([ID('a'), ID('c')]);
  });
  it('splits into parts round-robin', () => {
    expect(splitParts(['1', '2', '3', '4', '5'], 2)).toEqual([['1', '3', '5'], ['2', '4']]);
    expect(splitParts(['1'], 6)).toEqual([['1']]);
  });
  it('reads the exact reason from the run log', () => {
    const log = [
      `x [${ID('a')}] FAILED stage=accept: I -18.9 too quiet (< -18.5) after 5 encodes — 5 loudest peaks above ceiling at s: 1.0`,
      `x [${ID('b')}] FAILED stage=accept: limiter depth 22.4 dB > 20 — 5 loudest peaks above ceiling at s: none`,
      `x [${ID('c')}] FAILED stage=drive-meta: HTTP 404 (token expired or no access)`,
      `x [${ID('d')}] FAILED stage=accept: TP -1.2 over -1.5 at ceiling -6 dB`,
      `x [${ID('e')}] duration 100s vs source 3600s (> ±1 s) → failed`,
    ].join('\n');
    const r = reasonsFromLogs([log]);
    expect(r.get(ID('a'))).toBe('too quiet: I -18.9 LUFS after the true-peak path (< -18.5)');
    expect(r.get(ID('b'))).toBe('too quiet: needs limiter depth 22.4 dB (> 20 dB cap of the true-peak path)');
    expect(r.get(ID('c'))).toMatch(/^file not readable from Drive \(drive-meta\): HTTP 404/);
    expect(r.get(ID('d'))).toBe('true peak too hot: TP -1.2 dBTP (> -1.5)');
    expect(r.get(ID('e'))).toBe('duration 100 s vs source 3600 s (> ±1 s)');
  });
  it('rewrites failed-review.csv: still failing only, grouped by reason, no commas in the reason', () => {
    const failed = [{ id: ID('a'), course: 'c900', reason: 'old' }, { id: ID('z'), course: 'c901', reason: 'old, kept' }];
    const reasons = new Map([[ID('a'), 'b reason'], [ID('c'), 'a reason']]);
    const csv = groupedCsv(failed, new Map([[ID('c'), 'c902']]), reasons, new Set([ID('z')]), [ID('a'), ID('c'), ID('d')]);
    expect(csv).toBe(`drive_file_id,course_id,reason\n${ID('c')},c902,a reason\n${ID('a')},c900,b reason\n${ID('d')},,failed again with the fixed pipeline (reason not in the log)\n`);
  });
});
