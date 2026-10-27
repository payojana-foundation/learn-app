import { describe, it, expect } from 'vitest';
import { appendEntry, validateEntry, DRAFT_STATUS } from '../append-manifest.mjs';

const entry = {
  drive_file_id: '1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT',
  key: 'audio/1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT-a64.mp3',
  bytes: 123456,
  duration_s: 1800,
  sha256: 'a'.repeat(64),
};

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(entry)).toBeNull();
  });
  it('rejects a missing/typed field', () => {
    expect(validateEntry({ ...entry, bytes: '123' })).toMatch(/bytes/);
    expect(validateEntry({ ...entry, sha256: 'xyz' })).toMatch(/sha256/);
  });
});

describe('appendEntry', () => {
  it('appends with the DRAFT status', () => {
    const out = appendEntry([], entry);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe(DRAFT_STATUS);
    expect(out[0].key).toBe(entry.key);
  });

  it('is idempotent — never overwrites an existing key (immutable)', () => {
    const first = appendEntry([], entry);
    const second = appendEntry(first, { ...entry, bytes: 999 });
    expect(second).toHaveLength(1);
    expect(second[0].bytes).toBe(entry.bytes); // unchanged
  });

  it('appends a distinct -v2 correction as a new entry', () => {
    const first = appendEntry([], entry);
    const v2 = { ...entry, key: entry.key.replace('.mp3', '-v2.mp3') };
    const out = appendEntry(first, v2);
    expect(out).toHaveLength(2);
  });
});
