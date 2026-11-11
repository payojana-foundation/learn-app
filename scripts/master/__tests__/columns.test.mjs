import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadColumns, listsTable, protectedRuns, colLetter } from '../seed.mjs';

const columns = loadColumns();
const doc = readFileSync('docs/master-sheet.md', 'utf-8');

describe('PART 1: data/master/columns.json', () => {
  const keys = columns.columns.map((c) => c.key);

  it('keys are unique, owner is TEAM or SYSTEM, dropdowns are non-empty lists', () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of columns.columns) {
      expect(['TEAM', 'SYSTEM']).toContain(c.owner);
      expect(typeof c.source).toBe('string');
      if (c.dropdown !== null) expect(c.dropdown.length).toBeGreaterThan(0);
    }
  });
  it('every SYSTEM column and lesson_code is protected; no other column is', () => {
    for (const c of columns.columns) {
      expect(c.protected).toBe(c.owner === 'SYSTEM' || c.key === 'lesson_code');
    }
  });
  it('has the columns from the spec and the 10 Nov decisions', () => {
    for (const k of ['row_key', 'lesson_id', 'course_id', 'teacher', 'video_code', 'details', 'minicourse_status', 'audio_status', 'learn_live', 'acast_embed', 'issues', 'source_file', 'source_tab', 'source_row']) {
      expect(keys).toContain(k);
    }
    expect(keys[0]).toBe('row_key');
    expect(columns.columns.find((c) => c.key === 'audio_status').dropdown).toEqual(['not started', 'converted', 'needs review', 'approved']);
    expect(columns.columns.find((c) => c.key === 'teacher').owner).toBe('SYSTEM');
    expect(columns.columns.find((c) => c.key === 'lesson_code').owner).toBe('TEAM');
  });
  it('the doc lists every column in order', () => {
    let at = -1;
    for (const k of keys) {
      const i = doc.indexOf(`\`${k}\``, at + 1);
      expect(i, `docs/master-sheet.md must list ${k} after the previous column`).toBeGreaterThan(at);
      at = i;
    }
    expect(doc).toContain('## CSV format');
  });
  it('Lists tab: one column per dropdown column; protected runs are contiguous and cover all protected columns', () => {
    const grid = listsTable(columns);
    expect(grid[0]).toEqual(columns.columns.filter((c) => c.dropdown).map((c) => c.key));
    const covered = new Set();
    for (const [a, b] of protectedRuns(columns)) for (let i = a; i < b; i++) covered.add(i);
    expect([...covered].sort((x, y) => x - y)).toEqual(columns.columns.flatMap((c, i) => (c.protected ? [i] : [])));
  });
  it('colLetter', () => {
    expect([0, 25, 26, 27, 51, 52].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});
