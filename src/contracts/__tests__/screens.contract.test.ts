import { describe, it, expect } from 'vitest';
import { parseRoute, routePath } from '../../router';
import { cleanForSearch } from '../../format';
import { importBackup, resetDbForTests, exportBackup, type Backup } from '../../db';

// P-07 / P-08 — routing over real paths; lesson URL uses the lesson id.
describe('P-07/P-08 routing', () => {
  it('lesson route round-trips on the lesson id', () => {
    const r = parseRoute('/courses/c007/c007-l013b', '');
    expect(r).toEqual({ name: 'lesson', id: 'c007', lessonId: 'c007-l013b' });
    expect(routePath(r)).toBe('/courses/c007/c007-l013b');
  });
  it('legacy /courses/ params still work', () => {
    expect(parseRoute('/courses/', '?q=x')).toEqual({ name: 'search', q: 'x' });
    expect(parseRoute('/courses/', '?teacher=yon-yi')).toEqual({ name: 'teacher', slug: 'yon-yi' });
  });
});

// P-16 — search cleans U+200B and lowercases; display text is never mutated here.
describe('P-16 search cleaning', () => {
  it('removes U+200B and lowercases for comparison', () => {
    expect(cleanForSearch('A\u200BB c')).toBe('ab c');
  });
});

// P-15 — backup import rejects a backup from another app.
describe('P-15 backup app guard', () => {
  it('round-trips a learn-app backup and rejects a foreign one', async () => {
    resetDbForTests();
    const empty = await exportBackup();
    expect(empty.app).toBe('learn-app');
    await importBackup(empty); // own backup imports fine
    await expect(importBackup({ ...(empty as Backup), app: 'vacana-app' as never })).rejects.toThrow(/learn-app/);
  });
});
