import { describe, it, expect } from 'vitest';
import { childrenQuery } from '../sheets-query.mjs';

describe('childrenQuery', () => {
  it("uses `trashed = false` (NOT the invalid `trimmed`) and quotes the parent id", () => {
    const q = childrenQuery('1GT0HCp6iQgJmu92dPnLPK4gJvNG7Wv-Y');
    expect(q).toBe("'1GT0HCp6iQgJmu92dPnLPK4gJvNG7Wv-Y' in parents and trashed = false");
    expect(q).not.toMatch(/trimmed/);
  });
  it('rejects an id with a quote/backslash (query-injection guard)', () => {
    expect(() => childrenQuery("x' or '1")).toThrow();
    expect(() => childrenQuery('')).toThrow();
  });
});
