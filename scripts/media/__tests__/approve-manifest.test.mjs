import { describe, it, expect } from 'vitest';
import {
  applyDecision,
  statusForDecision,
  parseIds,
  APPROVED_STATUS,
  REJECTED_STATUS,
  DECISIONS,
} from '../approve-manifest.mjs';

// Fixture manifest (placeholder ids/keys — never real data).
const manifest = [
  { drive_file_id: 'ID_A', key: 'audio/ID_A-a64.mp3', bytes: 1, duration_s: 10, sha256: 'a'.repeat(64), status: 'DRAFT – needs reviewer approval' },
  { drive_file_id: 'ID_B', key: 'audio/ID_B-a64.mp3', bytes: 2, duration_s: 20, sha256: 'b'.repeat(64), status: 'DRAFT – needs reviewer approval' },
];
const AT = '2026-10-27';

describe('statusForDecision / parseIds', () => {
  it('maps decisions to statuses', () => {
    expect(statusForDecision('approved')).toBe(APPROVED_STATUS);
    expect(statusForDecision('rejected')).toBe(REJECTED_STATUS);
    expect(statusForDecision('maybe')).toBeNull();
    expect(DECISIONS).toEqual(['approved', 'rejected']);
  });
  it('splits on commas/space/newlines, trims, de-dupes', () => {
    expect(parseIds('ID_A, ID_B\nID_A  ID_C')).toEqual(['ID_A', 'ID_B', 'ID_C']);
    expect(parseIds('')).toEqual([]);
  });
});

describe('applyDecision', () => {
  it('approves present ids: sets status/reviewer/reviewed_at, leaves others untouched', () => {
    const { manifest: out, applied, notFound } = applyDecision(manifest, ['ID_A'], 'Reviewer One', 'approved', AT);
    expect(applied).toEqual(['ID_A']);
    expect(notFound).toEqual([]);
    const a = out.find((e) => e.drive_file_id === 'ID_A');
    expect(a.status).toBe('approved');
    expect(a.reviewer).toBe('Reviewer One');
    expect(a.reviewed_at).toBe(AT);
    // untouched entry keeps its DRAFT status and gains no reviewer field
    const b = out.find((e) => e.drive_file_id === 'ID_B');
    expect(b.status).toBe('DRAFT – needs reviewer approval');
    expect(b.reviewer).toBeUndefined();
  });

  it('rejects present ids with the rejected status (kept, not deleted)', () => {
    const { manifest: out, applied } = applyDecision(manifest, ['ID_B'], 'Reviewer Two', 'rejected', AT);
    expect(applied).toEqual(['ID_B']);
    const b = out.find((e) => e.drive_file_id === 'ID_B');
    expect(b.status).toBe('rejected');
    expect(out).toHaveLength(2); // kept for the audit trail, never removed
  });

  it('reports unknown ids as not found but still applies the known ones (job succeeds)', () => {
    const { applied, notFound } = applyDecision(manifest, ['ID_A', 'UNKNOWN'], 'R', 'approved', AT);
    expect(applied).toEqual(['ID_A']);
    expect(notFound).toEqual(['UNKNOWN']);
  });

  it('does not mutate the input manifest', () => {
    const copy = JSON.parse(JSON.stringify(manifest));
    applyDecision(manifest, ['ID_A'], 'R', 'approved', AT);
    expect(manifest).toEqual(copy);
  });

  it('throws on a bad decision or a missing reviewer', () => {
    expect(() => applyDecision(manifest, ['ID_A'], 'R', 'nope', AT)).toThrow(/unknown decision/);
    expect(() => applyDecision(manifest, ['ID_A'], '', 'approved', AT)).toThrow(/reviewer/);
  });
});
