import { describe, it, expect } from 'vitest';
import { releaseRows } from '../release-report.mjs';

describe('release report buckets', () => {
  it('approved / flagged / failed / waiting per course', () => {
    const queues = [{ course: 'c900', ids: ['a', 'b', 'c', 'd', 'e'] }, { course: 'c901', ids: [] }];
    const manifest = [{ drive_file_id: 'a', status: 'approved' }, { drive_file_id: 'b', status: 'DRAFT' }];
    const precheck = { results: { flagged: [{ id: 'b', reasons: ['duration 0:08 is under 5 min'] }] } };
    const { rows, totals } = releaseRows(queues, manifest, precheck, new Set(['c']), { d: 2 });
    expect(rows.length).toBe(1);
    expect(totals).toEqual({ approved: 1, flagged: 1, failed: 2, waiting: 1, other: 0 });
    expect(rows[0].held.map((h) => h.id)).toEqual(['b', 'c', 'd']);
    expect(rows[0].held[0].reason).toMatch(/under 5 min/);
  });
});
