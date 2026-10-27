import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseFoldersCsv,
  csvField,
  buildInventoryCsv,
  INVENTORY_COLUMNS,
  nameSaysMp3,
  computeGaps,
  buildGapsMd,
} from '../media-inventory.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'));

describe('parseFoldersCsv', () => {
  it('parses rows, drops the header and blank/short lines', () => {
    const rows = parseFoldersCsv('teacher_slug,drive_folder_id\nslug-a,folderA\n\nslug-b,folderB\nbroken\n');
    expect(rows).toEqual([
      { teacher_slug: 'slug-a', drive_folder_id: 'folderA' },
      { teacher_slug: 'slug-b', drive_folder_id: 'folderB' },
    ]);
  });
  it('an empty file (or header only) yields nothing to do', () => {
    expect(parseFoldersCsv('')).toEqual([]);
    expect(parseFoldersCsv('teacher_slug,drive_folder_id\n')).toEqual([]);
  });
});

describe('csvField', () => {
  it('quotes fields with commas, quotes, or newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField(null)).toBe('');
  });
});

describe('buildInventoryCsv', () => {
  it('writes the fixed column header and one row per entry', () => {
    const csv = buildInventoryCsv(load('media-entries.json'));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(INVENTORY_COLUMNS.join(','));
    expect(lines).toHaveLength(1 + 6); // header + 6 entries
  });
});

describe('nameSaysMp3', () => {
  it('detects an .mp3 name case-insensitively', () => {
    expect(nameSaysMp3('a.mp3')).toBe(true);
    expect(nameSaysMp3('a.MP3')).toBe(true);
    expect(nameSaysMp3('a.mp4')).toBe(false);
  });
});

describe('computeGaps (fixture)', () => {
  const g = computeGaps(load('media-entries.json'));

  it('flags files with no audio track', () => {
    expect(g.noAudio.map((e) => e.id).sort()).toEqual(['file-noaudio', 'file-zero']);
  });
  it('flags an .mp3 name that is actually a video', () => {
    expect(g.mp3WithVideo.map((e) => e.id)).toContain('file-mp3video');
  });
  it('flags a zero-size file', () => {
    expect(g.zeroSize.map((e) => e.id)).toContain('file-zero');
  });
  it('groups duplicates by md5 (two files share one md5)', () => {
    expect(g.duplicates).toHaveLength(1);
    expect(g.duplicates[0].files.map((e) => e.id).sort()).toEqual(['file-dup-a', 'file-dup-b']);
  });
});

describe('buildGapsMd', () => {
  it('is read-only, states the count, and renders every section', () => {
    const md = buildGapsMd(load('media-entries.json'));
    expect(md).toMatch(/READ-ONLY/);
    expect(md).toMatch(/Files inspected: \*\*6\*\*/);
    expect(md).toMatch(/## No audio track \(2\)/);
    expect(md).toMatch(/## Name says \.mp3 but has video \(1\)/);
    expect(md).toMatch(/## Zero-size files \(1\)/);
    expect(md).toMatch(/## Duplicates by md5 \(1\)/);
  });
  it('an empty inventory renders cleanly with zero counts', () => {
    const md = buildGapsMd([]);
    expect(md).toMatch(/Files inspected: \*\*0\*\*/);
    expect(md).toMatch(/## No audio track \(0\)/);
  });
});
