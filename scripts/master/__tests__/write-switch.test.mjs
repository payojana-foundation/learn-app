/** PART 12 — write-switch checks (pure parts; placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { previewCheck, unprotected, teamDiff } from '../write-switch.mjs';

describe('write switch checks', () => {
  it('preview: TEAM changes counted per tab (course_title_km is TEAM in Lessons, SYSTEM in Courses)', () => {
    const r = previewCheck([
      { tab: 'Lessons', column: 'issues' }, { tab: 'Lessons', column: 'row_key' },
      { tab: 'Courses', column: 'course_title_km' }, { tab: 'Courses', column: '(new row)' },
    ]);
    expect(r).toMatchObject({ total: 4, team: 0 });
    expect(previewCheck([{ tab: 'Lessons', column: 'course_title_km' }]).team).toBe(1);
    expect(previewCheck([{ tab: 'Lessons', column: 'notes' }]).team).toBe(1);
  });
  it('protections: a SYSTEM column outside every protected range is reported', () => {
    expect(unprotected(['a', 'b', 'c'], ['a', 'c'], [{ startColumnIndex: 0, endColumnIndex: 1, startRowIndex: 0 }])).toEqual(['c']);
    expect(unprotected(['a', 'b', 'c'], ['a', 'c'], [{ startColumnIndex: 0, endColumnIndex: 3 }])).toEqual([]);
  });
  it('verify: TEAM cells compared by key, byte for byte', () => {
    const a = { header: ['row_key', 'notes', 'issues'], rows: [['M1', 'x', 'i'], ['M2', 'y', '']] };
    const b = { header: ['row_key', 'notes', 'issues'], rows: [['M1', 'x', 'changed'], ['M2', 'y\u200B', '']] };
    expect(teamDiff(a, b, 'row_key', ['notes'])).toEqual([{ key: 'M2', column: 'notes' }]);
    expect(teamDiff(a, a, 'row_key', ['notes'])).toEqual([]);
  });
  it('workflow: manual only, Drive + Sheets scopes, same lock as the sheet writers', () => {
    const y = readFileSync('.github/workflows/master-write-switch.yml', 'utf-8');
    expect(y).not.toMatch(/schedule:/);
    expect(y).toContain('group: data-rebuild-main');
    expect(y).toContain('https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive');
  });
});
