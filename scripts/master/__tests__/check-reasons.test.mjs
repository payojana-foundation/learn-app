/** PART 7a — every checks.json reason has an owner; checks.json may only use listed reasons. */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { REASONS, checksJson, fmt } from '../checks.mjs';

const owners = JSON.parse(readFileSync('data/master/check-reasons.json', 'utf-8'));
const listed = Object.keys(owners.reasons);

describe('data/master/check-reasons.json', () => {
  it('lists exactly the reasons checks.mjs can produce, each with an owner', () => {
    expect([...listed].sort()).toEqual([...REASONS].sort());
    expect(owners.owners).toEqual(['editing team', 'Learn-PE', 'reviewer']);
    for (const r of listed) expect(owners.owners).toContain(owners.reasons[r]);
  });
  it('the committed public/ops/checks.json uses only listed reasons (unknown = fail)', () => {
    if (!existsSync('public/ops/checks.json')) return;
    const used = [...new Set(JSON.parse(readFileSync('public/ops/checks.json', 'utf-8')).items.map((i) => i.reason))];
    expect(used.filter((r) => !listed.includes(r))).toEqual([]);
  });
  it('the Operations descriptions cover the same reasons', () => {
    const d = JSON.parse(readFileSync('public/ops/check-reasons.json', 'utf-8'));
    expect(d.reasons.map((r) => r.reason).sort()).toEqual([...listed].sort());
  });
  it('checks.mjs refuses an unknown reason', () => {
    const row = { row_key: 'M1', course_id: 'c900', lesson_title: 't', source_type: 'mp3', mp3_link: '', mp4_link: '', minicourse_link: '' };
    expect(() => checksJson({ lessonRows: [row], now: 'T', playcheck: { failures: [] }, failed: new Map() })).not.toThrow();
    // a reason produced by a future change that is not listed would throw:
    const bad = { results: { flagged: [{ id: 'X'.repeat(28), reasons: ['brand new reason'] }] } };
    const r2 = { ...row, mp3_link: `https://drive.google.com/file/d/${'X'.repeat(28)}/view` };
    expect(() => checksJson({ lessonRows: [r2], now: 'T', precheck: bad, manifest: [{ drive_file_id: 'X'.repeat(28), key: 'audio/x.mp3' }] })).toThrow(/unknown reason "brand new reason"/);
    void fmt;
  });
});
