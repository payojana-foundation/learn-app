import { describe, it, expect } from 'vitest';
import {
  applyDecision,
  approveCourse,
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

describe('approveCourse (Job B v2 "course" mode)', () => {
  const m = [
    { drive_file_id: 'OK1', key: 'audio/OK1-a64.mp3', sha256: 'a'.repeat(64), status: 'DRAFT', loudness: { result: 'ok' } },
    { drive_file_id: 'OK2', key: 'audio/OK2-a64.mp3', sha256: 'b'.repeat(64), status: 'DRAFT', loudness: { result: 'ok' } },
    { drive_file_id: 'CAP', key: 'audio/CAP-a64.mp3', sha256: 'c'.repeat(64), status: 'DRAFT', loudness: { result: 'cap' } },
    { drive_file_id: 'EXC', key: 'audio/EXC-a64.mp3', sha256: 'd'.repeat(64), status: 'DRAFT', loudness: { result: 'exception' } },
    { drive_file_id: 'FAIL', key: 'audio/FAIL-a64.mp3', sha256: 'e'.repeat(64), status: 'DRAFT', loudness: { result: 'failed' } },
  ];
  const ids = ['OK1', 'OK2', 'CAP', 'EXC', 'FAIL', 'MISSING'];

  it('approves ONLY result=ok entries; buckets the rest for the coordinator', () => {
    const { manifest: out, approved, skipped } = approveCourse(m, ids, 'Rev', AT);
    expect(approved.sort()).toEqual(['OK1', 'OK2']);
    expect(skipped.cap).toEqual(['CAP']);
    expect(skipped.exception).toEqual(['EXC']);
    expect(skipped.failed).toEqual(['FAIL']);
    expect(skipped.notFound).toEqual(['MISSING']);
    expect(out.find((e) => e.drive_file_id === 'OK1').status).toBe(APPROVED_STATUS);
    expect(out.find((e) => e.drive_file_id === 'OK1').reviewer).toBe('Rev');
    // a cap entry is NEVER auto-approved
    expect(out.find((e) => e.drive_file_id === 'CAP').status).toBe('DRAFT');
  });

  it('does not mutate the input and requires a reviewer', () => {
    const copy = JSON.parse(JSON.stringify(m));
    approveCourse(m, ids, 'Rev', AT);
    expect(m).toEqual(copy);
    expect(() => approveCourse(m, ids, '', AT)).toThrow(/reviewer/);
  });
});
