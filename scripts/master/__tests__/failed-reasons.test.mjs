/** PART 4 — the recorded conversion-failure reason reaches issues (placeholders only). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeSystem, failedReasonsFrom } from '../sync.mjs';
import { failedMap } from '../checks.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = columns.columns.map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (o) => ({ ...Object.fromEntries(LK.map((k) => [k, ''])), course_id: 'c900', lesson_title: 't', source_type: 'mp3', source_file: 'F', ...o });
const csv = `drive_file_id,course_id,reason\n${DID('A')},c900,too quiet: loudness -19.3 LUFS vs at least -18.5\n${DID('B')},c900,\n`;

describe('conversion failure reason', () => {
  it('failed-review.csv reasons are read; an empty reason is not', () => {
    expect([...failedReasonsFrom(csv)]).toEqual([[DID('A'), 'too quiet: loudness -19.3 LUFS vs at least -18.5']]);
    expect(failedReasonsFrom('drive_file_id,course_id\nX,c1\n').size).toBe(0);
  });
  it('goes into issues as CONVERSION FAILED, only while there is no converted file', () => {
    const rows = [row({ row_key: 'M1', mp3_link: url('A') }), row({ row_key: 'M2', mp3_link: url('B') })];
    const w = computeSystem(rows, [], { manifest: [], failedReview: new Set([DID('A'), DID('B')]), failedReasons: failedReasonsFrom(csv) });
    expect(w.lessons.get('M1').issues).toContain('CONVERSION FAILED: too quiet: loudness -19.3 LUFS vs at least -18.5');
    expect(w.lessons.get('M1').audio_status).toBe('needs review');
    expect(w.lessons.get('M2').issues).not.toContain('CONVERSION FAILED');
    const later = computeSystem(rows, [], { manifest: [{ drive_file_id: DID('A'), status: 'DRAFT' }], failedReasons: failedReasonsFrom(csv) });
    expect(later.lessons.get('M1').issues).not.toContain('CONVERSION FAILED');
  });
  it('and into checks.json detail', () => {
    expect(failedMap(csv, {}).get(DID('A'))).toBe('too quiet: loudness -19.3 LUFS vs at least -18.5');
  });
});
