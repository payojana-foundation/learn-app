import { describe, it, expect } from 'vitest';
import { homeView } from '../../ui/views';
import { pathCourseIds } from '../../data/companion';
import { readFileSync } from 'node:fs';
import { pathsShapeErrors, guideLinesShapeErrors, companionIssues } from '../../../scripts/companion-check.mjs';

// Placeholder data only (testing rule 6).
const course = (id: string) => ({
  id, provisional: true, title_km: `t-${id}`, title_en: null, teacher: 'x', teacher_slug: 's',
  topics: [], lesson_count: 1, media_kinds: ['r2'],
});
const catalog = { generated: 'g', provisional: true, courses: [course('c1'), course('c2')] };
const state = { lang: 'en' as const, topic: 'all', savedIds: new Set<string>() };
const render = (startHere: string[]) =>
  homeView(catalog as never, [], new Map(), {}, state as never, startHere, []);

// P-10 (changed in bulk-05 P1): the Start here row is driven by data/paths.json
// path "start-here"; empty or approved=false = row hidden.
describe('P-10 Start here row reads the start-here path', () => {
  const known = new Set(['c1', 'c2']);
  const file = (ids: string[], approved: boolean) => ({
    version: 1,
    paths: [{ id: 'start-here', title_km: null, title_en: null, course_ids: ids, approved }],
  });

  it('shows the row only for an approved, non-empty path', () => {
    expect(render(pathCourseIds(file(['c2', 'c1'], true), 'start-here', known))).toContain('Start here');
    expect(render(pathCourseIds(file(['c1'], false), 'start-here', known))).not.toContain('Start here');
    expect(render(pathCourseIds(file([], true), 'start-here', known))).not.toContain('Start here');
    expect(render(pathCourseIds(file(['nope'], true), 'start-here', known))).not.toContain('Start here');
  });

  it('the committed data/paths.json is well-formed and ships hidden (empty, not approved)', () => {
    const p = JSON.parse(readFileSync('data/paths.json', 'utf-8'));
    expect(pathsShapeErrors(p)).toEqual([]);
    const sh = p.paths.find((x: { id: string }) => x.id === 'start-here');
    expect(sh).toBeTruthy();
    expect(sh.approved === false || sh.course_ids.length === 0).toBe(true);
  });

  it('the committed guide-lines.json is well-formed and the three lines are approved (coordinator, bulk-07 P1)', () => {
    const g = JSON.parse(readFileSync('data/guide-lines.json', 'utf-8'));
    expect(guideLinesShapeErrors(g)).toEqual([]);
    expect(Object.keys(g.lines).sort()).toEqual(['course.finished', 'home.start_here', 'my.branch.empty']);
    expect(Object.values(g.lines).every((l) => (l as { approved: boolean }).approved === true)).toBe(true);
  });
});

describe('build-time companion check', () => {
  it('flags a bad shape', () => {
    expect(pathsShapeErrors({ version: 1, paths: [{ id: 1 }] }).length).toBeGreaterThan(0);
    expect(pathsShapeErrors(null)).not.toEqual([]);
    expect(guideLinesShapeErrors({ version: 1, default_sign: 'a.svg', course_signs: {}, lines: { k: { km: 'a' } } }).length).toBeGreaterThan(0);
  });
  it('lists unknown path ids and unknown course_signs keys (an alias target counts as known)', () => {
    const rows = companionIssues(
      { version: 1, paths: [{ id: 'p', title_km: null, title_en: null, course_ids: ['c1', 'cZ'], approved: true }] },
      { version: 1, default_sign: 'a.svg', course_signs: { c1: 'h.svg', cOld: 'h.svg', cGone: 'h.svg' }, lines: {} },
      new Set(['c1', 'perm-1']),
      { cOld: 'perm-1' }
    );
    expect(rows.map((r) => `${r.file}:${r.id}`)).toEqual(['paths.json:cZ', 'guide-lines.json:cGone']);
  });
});
