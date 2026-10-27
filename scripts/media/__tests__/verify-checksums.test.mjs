import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMd5Sums, compareSums, isExactPass } from '../verify-checksums.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sumsText = readFileSync(join(here, 'fixtures', 'MD5SUMS_sample.txt'), 'utf-8');

describe('parseMd5Sums', () => {
  it('parses md5sum-format lines', () => {
    const map = parseMd5Sums(sumsText);
    expect(map.size).toBe(3);
    expect(map.get('023/023.001.001-a.mp3')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('compareSums + isExactPass', () => {
  const expected = parseMd5Sums(sumsText);

  it('passes when every file matches and the count is exact', () => {
    const computed = {
      '023/023.001.001-a.mp3': 'd41d8cd98f00b204e9800998ecf8427e',
      '023/023.001.002-b.mp3': '0cc175b9c0f1b6a831c399e269772661',
      '023/023.001.003-c.mp3': '900150983cd24fb0d6963f7d28e17f72',
    };
    const result = compareSums(expected, computed);
    expect(result.matched).toHaveLength(3);
    expect(isExactPass(result, 3)).toBe(true);
  });

  it('fails on a mismatch', () => {
    const computed = {
      '023/023.001.001-a.mp3': 'd41d8cd98f00b204e9800998ecf8427e',
      '023/023.001.002-b.mp3': 'ffffffffffffffffffffffffffffffff',
      '023/023.001.003-c.mp3': '900150983cd24fb0d6963f7d28e17f72',
    };
    const result = compareSums(expected, computed);
    expect(result.mismatched).toHaveLength(1);
    expect(isExactPass(result, 3)).toBe(false);
  });

  it('fails on a missing file and on a wrong expected count', () => {
    const computed = {
      '023/023.001.001-a.mp3': 'd41d8cd98f00b204e9800998ecf8427e',
      '023/023.001.002-b.mp3': '0cc175b9c0f1b6a831c399e269772661',
    };
    const result = compareSums(expected, computed);
    expect(result.missing).toHaveLength(1);
    expect(isExactPass(result, 3)).toBe(false);
    // Even if all present matched, an expected count of 1366 must still fail.
    expect(isExactPass(compareSums(expected, { ...computed, '023/023.001.003-c.mp3': '900150983cd24fb0d6963f7d28e17f72' }), 1366)).toBe(false);
  });
});
