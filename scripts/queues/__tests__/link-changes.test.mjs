/** PART 11e — link change of an approved lesson (placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { linkChanges } from '../link-changes.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (link, o = {}) => ({ row_key: 'M1', course_id: 'c900', source_type: 'mp3', mp3_link: url(link), mp4_link: '', minicourse_link: '', ...o });
const A = (id, key, status = 'approved') => ({ drive_file_id: DID(id), key, status });

describe('link change', () => {
  it('first sight: an approved lesson is remembered (row_key → id + key)', () => {
    const r = linkChanges([row('OLD')], [A('OLD', 'audio/old.mp3')], {});
    expect(r.sources).toEqual({ M1: { drive_file_id: DID('OLD'), key: 'audio/old.mp3' } });
    expect(r.pending).toEqual([]);
  });
  const prev = { M1: { drive_file_id: DID('OLD'), key: 'audio/old.mp3' } };
  it('new link, not converted: re-queued once, old source kept, nothing orphaned', () => {
    const r = linkChanges([row('NEW')], [A('OLD', 'audio/old.mp3')], prev);
    expect(r.queueAdds).toEqual([{ course_id: 'c900', id: DID('NEW') }]);
    expect(r.sources).toEqual(prev);
    expect(r.orphans).toEqual([]);
    expect(r.pending[0]).toMatchObject({ state: 'converting', old: DID('OLD'), new: DID('NEW') });
    expect(linkChanges([row('NEW')], [A('OLD', 'audio/old.mp3')], prev, new Set([DID('NEW')])).queueAdds).toEqual([]);
  });
  it('new file converted but not approved: waits, old kept', () => {
    const r = linkChanges([row('NEW')], [A('OLD', 'audio/old.mp3'), A('NEW', 'audio/new.mp3', 'DRAFT')], prev);
    expect(r.queueAdds).toEqual([]);
    expect(r.sources).toEqual(prev);
    expect(r.pending[0].state).toBe('waiting for approval');
  });
  it('new file approved: switched to the new key; the old key goes to orphans-pending (once, never deleted)', () => {
    const r = linkChanges([row('NEW')], [A('OLD', 'audio/old.mp3'), A('NEW', 'audio/new.mp3')], prev);
    expect(r.sources).toEqual({ M1: { drive_file_id: DID('NEW'), key: 'audio/new.mp3' } });
    expect(r.orphans).toEqual(['audio/old.mp3']);
    expect(r.pending).toEqual([]);
    expect(linkChanges([row('NEW')], [A('OLD', 'audio/old.mp3'), A('NEW', 'audio/new.mp3')], prev, new Set(), new Set(['audio/old.mp3'])).orphans).toEqual([]);
  });
  it('an old key still used by another lesson is not an orphan', () => {
    const p2 = { ...prev, M2: { drive_file_id: DID('OLD'), key: 'audio/old.mp3' } };
    const r = linkChanges([row('NEW'), row('OLD', { row_key: 'M2' })], [A('OLD', 'audio/old.mp3'), A('NEW', 'audio/new.mp3')], p2);
    expect(r.orphans).toEqual([]);
  });
  it('master-export runs it before the build and commits its files', () => {
    const y = readFileSync('.github/workflows/master-export.yml', 'utf-8');
    expect(y).toMatch(/node scripts\/queues\/link-changes\.mjs\n[\s\S]*?npm run build-courses/);
    expect(y).toContain('git add data/queues');
    expect(y).toContain('data/master public/data');
  });
});
