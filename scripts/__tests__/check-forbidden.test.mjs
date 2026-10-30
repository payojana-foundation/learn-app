import { describe, it, expect } from 'vitest';
import { scanText, inScope } from '../check-forbidden.mjs';

describe('scanText', () => {
  it('reports each forbidden term with its 1-based line', () => {
    const text = 'ok line\nsee study-84000 here\nand beref.org too\n';
    const hits = scanText(text);
    expect(hits.map((h) => ({ term: h.term, line: h.line }))).toEqual([
      { term: 'study-84000', line: 2 },
      { term: 'beref.org', line: 3 },
    ]);
  });

  it('matches every retired identifier', () => {
    const text = [
      'beref.org',
      'sansombucks.workers.dev',
      'study-84000',
      'study.84000.digital',
      'r2.dev',
    ].join('\n');
    const terms = scanText(text).map((h) => h.term);
    expect(new Set(terms)).toEqual(
      new Set(['beref.org', 'sansombucks.workers.dev', 'study-84000', 'study.84000.digital', 'r2.dev'])
    );
  });

  it('allows the bare word sansombucks (only *.workers.dev is forbidden)', () => {
    expect(scanText('user sansombucks sent a note')).toEqual([]);
  });

  it('allows the sansombucks@gmail.com email in file contents', () => {
    expect(scanText('contact sansombucks@gmail.com')).toEqual([]);
  });

  it('is clean on text with no forbidden terms', () => {
    expect(scanText('learn.84000.digital payojana.org media.84000.digital')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const hits = scanText('a\r\nstudy-84000\r\nb');
    expect(hits).toEqual([{ term: 'study-84000', line: 2, text: 'study-84000' }]);
  });
});

describe('inScope', () => {
  it('excludes the four excluded prefixes', () => {
    expect(inScope('docs/archive/2026-10-18-study/DEPLOY.md')).toBe(false);
    expect(inScope('reports/kiro-bulk-04-report.md')).toBe(false);
    expect(inScope('node_modules/foo/index.js')).toBe(false);
    expect(inScope('data/source/website-courses-2026-09-28.json')).toBe(false);
  });

  it('excludes kiro-bulk task files that quote the strings on purpose', () => {
    expect(inScope('docs/kiro-bulk-04.md')).toBe(false);
    expect(inScope('docs/kiro-bulk-01.md')).toBe(false);
  });

  it('excludes this guard and its own test (they list the terms on purpose)', () => {
    expect(inScope('scripts/check-forbidden.mjs')).toBe(false);
    expect(inScope('scripts/__tests__/check-forbidden.test.mjs')).toBe(false);
  });

  it('includes ordinary source and docs files', () => {
    expect(inScope('src/app.ts')).toBe(true);
    expect(inScope('docs/SETUP-coordinator.md')).toBe(true);
    expect(inScope('docs/DEPLOY.md')).toBe(true);
  });
});
