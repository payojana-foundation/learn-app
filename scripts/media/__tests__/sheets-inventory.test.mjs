import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  looksLikeIdColumn,
  isIdShaped,
  columnLetter,
  flagIdColumns,
  buildReport,
  mdCell,
} from '../sheets-inventory.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'));

describe('isIdShaped', () => {
  it('matches provisional ids, numbers, and alnum codes with a digit', () => {
    expect(isIdShaped('c012')).toBe(true);
    expect(isIdShaped('c007-l013b')).toBe(true);
    expect(isIdShaped('42')).toBe(true);
    expect(isIdShaped('1AbCdEf9')).toBe(true);
  });
  it('rejects prose and values with spaces', () => {
    expect(isIdShaped('a title with spaces')).toBe(false);
    expect(isIdShaped('')).toBe(false);
    expect(isIdShaped('word')).toBe(false); // no digit, too short for a code
  });
});

describe('looksLikeIdColumn', () => {
  it('flags an id-like header', () => {
    expect(looksLikeIdColumn('Course ID', [])).toMatch(/header/);
    expect(looksLikeIdColumn('code', [])).toMatch(/header/);
  });
  it('flags when a majority of sample values are id-shaped even with a plain header', () => {
    expect(looksLikeIdColumn('x', ['c001', 'c002', 'hello'])).toMatch(/id-shaped/);
  });
  it('does not flag a prose column', () => {
    expect(looksLikeIdColumn('Title', ['a long lesson title', 'another title'])).toBeNull();
  });
});

describe('columnLetter', () => {
  it('maps indices to spreadsheet letters', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
  });
});

describe('flagIdColumns', () => {
  it('flags only the id/code columns of a tab', () => {
    const tab = {
      name: 'Sheet1',
      header: ['Code', 'Title', 'Lessons'],
      sample: [
        ['c001', 'a title', '12'],
        ['c002', 'another', '8'],
      ],
    };
    const flags = flagIdColumns(tab);
    const cols = flags.map((f) => f.column);
    expect(cols).toContain('A'); // Code
    expect(cols).toContain('C'); // Lessons (numbers)
    expect(cols).not.toContain('B'); // Title is prose
  });
});

describe('mdCell', () => {
  it('escapes pipes and flattens newlines so a table row survives', () => {
    expect(mdCell('a|b')).toBe('a\\|b');
    expect(mdCell('a\nb')).toBe('a b');
  });
});

describe('buildReport (fixture)', () => {
  const md = buildReport(load('sheets-dump.json'));

  it('is discovery-only and states the file count', () => {
    expect(md).toMatch(/structure discovery only/i);
    expect(md).toMatch(/Files found: \*\*2\*\*/);
  });
  it('lists every file id and tab', () => {
    expect(md).toContain('drive-file-id-1');
    expect(md).toContain('drive-file-id-2');
    expect(md).toContain('### Tab:');
  });
  it('renders a sample table and the id-column flags', () => {
    expect(md).toMatch(/Sample \(up to 3 rows\)/);
    expect(md).toMatch(/LOOK like ids\/codes/);
  });
  it('handles an empty dump without throwing', () => {
    expect(buildReport([])).toMatch(/Files found: \*\*0\*\*/);
  });
});
