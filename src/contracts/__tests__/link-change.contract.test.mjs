/**
 * P-19 (18 Nov, change protected: P-19) — a lesson that already has approved media stays visible
 * and keeps playing it while a new link converts; the new media replaces it only once approved;
 * never-approved lessons stay hidden; the id guard never fails on a link change. Placeholders.
 */
import { describe, it, expect } from 'vitest';
import { buildFromMaster, shownRows, approvedIdGuard } from '../../../scripts/build-courses.mjs';
import { computeSystem } from '../../../scripts/master/sync.mjs';
import { linkChanges } from '../../../scripts/queues/link-changes.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const teachers = [{ slug: 't', name_km: 'tn' }];
const courses = [{ course_id: 'c900', course_title_km: 'x', teacher: 'tn', course_status: '' }];
const row = (link, o = {}) => ({ row_key: 'M1', lesson_id: 'CODE1', course_id: 'c900', teacher: 'tn', course_title_km: 'x', lesson_no: '1', lesson_title: 't', lesson_code: 'CODE1', mp3_link: url(link), mp4_link: '', minicourse_link: '', source_type: 'mp3', source_file: 'F', ...o });
const A = (id, key, status = 'approved') => ({ drive_file_id: DID(id), key, duration_s: 60, status });
const sources = { sources: { M1: { drive_file_id: DID('OLD'), key: 'audio/old-a64.mp3' } } };
const media = (out) => out.courses[0]?.lessons[0]?.media[0]?.src;

describe('P-19 link change', () => {
  it('link change keeps the lesson live with the old media; the id guard passes', () => {
    const before = buildFromMaster([row('OLD')], courses, teachers, [A('OLD', 'audio/old-a64.mp3')], null, null, sources);
    const after = buildFromMaster([row('NEW')], courses, teachers, [A('OLD', 'audio/old-a64.mp3')], null, null, sources);
    expect(media(after)).toBe('audio/old-a64.mp3');
    expect(after.issues.some((i) => i.kind === 'link_change_kept')).toBe(true);
    expect(approvedIdGuard(before.courses, after.courses, {}, [])).toEqual([]);
  });
  it('the new media replaces it only once approved', () => {
    const draft = buildFromMaster([row('NEW')], courses, teachers, [A('OLD', 'audio/old-a64.mp3'), A('NEW', 'audio/new-a64.mp3', 'DRAFT')], null, null, sources);
    expect(media(draft)).toBe('audio/old-a64.mp3');
    const ok = buildFromMaster([row('NEW')], courses, teachers, [A('OLD', 'audio/old-a64.mp3'), A('NEW', 'audio/new-a64.mp3')], null, null, sources);
    expect(media(ok)).toBe('audio/new-a64.mp3');
    const lc = linkChanges([row('NEW')], [A('OLD', 'audio/old-a64.mp3'), A('NEW', 'audio/new-a64.mp3')], sources.sources);
    expect(lc.orphans).toEqual(['audio/old-a64.mp3']);
  });
  it('a failed new file leaves the old media live with "CHECK: new file failed: <reason>"', () => {
    const m = [A('OLD', 'audio/old-a64.mp3')];
    const out = buildFromMaster([row('NEW')], courses, teachers, m, null, null, sources);
    expect(media(out)).toBe('audio/old-a64.mp3');
    const w = computeSystem([row('NEW')], courses, { manifest: m, sources, failedReview: new Set([DID('NEW')]), failedReasons: new Map([[DID('NEW'), 'too quiet: I -19.3 LUFS']]) });
    expect(w.lessons.get('M1').issues).toContain('CHECK: new file failed: too quiet: I -19.3 LUFS');
    expect(w.lessons.get('M1').issues).not.toContain('no approved media yet');
  });
  it('a lesson never approved stays hidden as before', () => {
    const r = shownRows([row('NEW', { row_key: 'M9' })], [A('OLD', 'audio/old-a64.mp3')], sources);
    expect(r.shown.size).toBe(0);
    expect([...r.hidden.values()]).toEqual(['no approved media yet']);
  });
  it('a remembered key that no longer matches the manifest is not kept (never a guessed key)', () => {
    const r = shownRows([row('NEW')], [A('OLD', 'audio/other-a64.mp3')], sources);
    expect(r.shown.size).toBe(0);
  });
  it('data updates never freeze: other lessons and courses still build alongside a pending link change', () => {
    const rows = [row('NEW'), row('B', { row_key: 'M2', lesson_id: 'CODE2', lesson_code: 'CODE2', lesson_no: '2' })];
    const out = buildFromMaster(rows, courses, teachers, [A('OLD', 'audio/old-a64.mp3'), A('B', 'audio/b-a64.mp3')], null, null, sources);
    expect(out.courses[0].lessons.map((l) => l.media[0].src)).toEqual(['audio/old-a64.mp3', 'audio/b-a64.mp3']);
  });
});
