import { describe, it, expect } from 'vitest';
import { appendEntry, validateEntry, DRAFT_STATUS } from '../append-manifest.mjs';

// Job B v2: key derives from source_md5 (first 16 hex) — B2.
const entry = {
  drive_file_id: '1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT',
  source_md5: '0123456789abcdef0123456789abcdef',
  key: 'audio/0123456789abcdef-a64.mp3',
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
    expect(validateEntry({ ...entry, source_md5: undefined })).toMatch(/source_md5/);
  });
  it('rejects a key that does not derive from source_md5 (B2)', () => {
    expect(validateEntry({ ...entry, key: 'audio/deadbeefdeadbeef-a64.mp3' })).toMatch(/derive from source_md5/);
  });
  it('accepts a -v2 correction key', () => {
    expect(validateEntry({ ...entry, key: 'audio/0123456789abcdef-a64-v2.mp3' })).toBeNull();
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

  it('bug-4: a new B2 md5 entry REPLACES the same id\'s legacy drive-id entry', () => {
    const legacy = { drive_file_id: entry.drive_file_id, key: `audio/${entry.drive_file_id}-a64.mp3`, bytes: 5, duration_s: 9, sha256: 'c'.repeat(64), status: 'approved' };
    const out = appendEntry([legacy], entry); // entry has the B2 md5 key
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(entry.key); // the md5 key row only
    expect(out.some((e) => e.key === legacy.key)).toBe(false); // legacy row dropped
  });

  it('does not drop a DIFFERENT id\'s legacy entry', () => {
    const other = { drive_file_id: 'OTHER', key: 'audio/OTHER-a64.mp3', bytes: 5, duration_s: 9, sha256: 'd'.repeat(64), status: 'approved' };
    const out = appendEntry([other], entry);
    expect(out).toHaveLength(2);
  });
});
