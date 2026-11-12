import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEGACY_LESSON_MAP, legacyLessonId, cutProgress, cutLessonRef, cutBackup, keepCourse } from './legacy';
import { DB_VERSION } from '../config';
import { openLearnDB, importBackup, getLessonProgress, isSaved, listLeaves, listNotes } from './index';
import { courseCanFinish, startedCourseIds } from '../data/companion';

// bulk 09 (P-20 clean cut, P-23, P-27). Placeholder ids only (except the c080 map, which is data).

describe('P-20 the lesson map equals data/id-aliases.json', () => {
  it('same keys and values (so the in-app map and the build guard cannot drift)', () => {
    const json = JSON.parse(readFileSync('data/id-aliases.json', 'utf-8'));
    expect({ ...LEGACY_LESSON_MAP }).toEqual(json);
  });
  it('only c080 lessons are mapped; everything else returns null', () => {
    expect(legacyLessonId('c080', 'c080-l001')).toBe(LEGACY_LESSON_MAP['c080-l001']);
    expect(legacyLessonId('c080', 'c080-l099')).toBeNull();
    expect(legacyLessonId('c013', 'c080-l001')).toBeNull();
    expect(legacyLessonId('c013', 'c013-l001')).toBeNull();
    expect(keepCourse('c080')).toBe(true);
    expect(keepCourse('c013')).toBe(false);
  });
});

describe('P-20 pure cuts', () => {
  it('progress: other courses vanish; c080 keeps only mapped lessons under their new ids; empty -> null', () => {
    expect(cutProgress({ courseId: 'cX', lessons: { a: { done: true } } })).toBeNull();
    const kept = cutProgress({ courseId: 'c080', lessons: { 'c080-l001': { pos: 1 }, 'c080-l099': { pos: 2 } }, updatedAt: 7 });
    expect(kept).toEqual({ courseId: 'c080', lessons: { [LEGACY_LESSON_MAP['c080-l001']]: { pos: 1 } }, updatedAt: 7 });
    expect(cutProgress({ courseId: 'c080', lessons: { 'c080-l099': { pos: 2 } } })).toBeNull();
  });
  it('history / notes records', () => {
    expect(cutLessonRef({ courseId: 'cX', lessonId: 'cX-l001' })).toBeNull();
    expect(cutLessonRef({ courseId: 'c080', lessonId: 'c080-l002', extra: 1 })).toEqual({ courseId: 'c080', lessonId: LEGACY_LESSON_MAP['c080-l002'], extra: 1 });
  });
  it('a whole backup', () => {
    const b = cutBackup({
      progress: [{ courseId: 'cX', lessons: {} }, { courseId: 'c080', lessons: { 'c080-l001': { done: true } } }],
      saved: [{ courseId: 'cX' }, { courseId: 'c080' }],
      history: [{ courseId: 'cX', lessonId: 'cX-l001' }],
      notes: [{ courseId: 'c080', lessonId: 'c080-l001' }, { courseId: 'c080', lessonId: 'nope' }],
      leaves: [{ course_id: 'cX', at: 1 }, { course_id: 'c080', at: 2 }],
    });
    expect(b.progress).toHaveLength(1);
    expect(b.saved).toEqual([{ courseId: 'c080' }]);
    expect(b.history).toEqual([]);
    expect(b.notes).toEqual([{ courseId: 'c080', lessonId: LEGACY_LESSON_MAP['c080-l001'] }]);
    expect(b.leaves).toEqual([{ course_id: 'c080', at: 2 }]);
  });
});

describe('P-20 importing a backup written before bulk 09', () => {
  it('a schema 2 backup is cut; a schema 3 backup is imported as it is', async () => {
    await openLearnDB();
    const old = {
      app: 'learn-app' as const, schema: 2, exported_at: 'x',
      progress: [{ courseId: 'cOld', lessons: { 'cOld-l001': { pos: 1, done: true } }, updatedAt: 1 }, { courseId: 'c080', lessons: { 'c080-l001': { pos: 5, done: true } }, updatedAt: 1 }],
      saved: [{ courseId: 'cOld', at: 1 }], history: [], notes: [{ courseId: 'cOld', lessonId: 'cOld-l001', lessonNum: 1, atS: 0, text: 'old', createdAt: 1 }],
      leaves: [{ course_id: 'cOld', at: 1 }], settings: {},
    };
    await importBackup(old);
    expect(await getLessonProgress('cOld', 'cOld-l001')).toEqual({ pos: 0, done: false });
    expect(await isSaved('cOld')).toBe(false);
    expect(await listNotes()).toEqual([]);
    expect(await listLeaves()).toEqual([]);
    expect(await getLessonProgress('c080', LEGACY_LESSON_MAP['c080-l001'])).toEqual({ pos: 5, done: true });
    const fresh = { ...old, schema: 3, progress: [{ courseId: 'cNew', lessons: { 'cNew-l001': { pos: 2, done: true } }, updatedAt: 1 }], saved: [{ courseId: 'cNew', at: 1 }], notes: [], leaves: [] };
    await importBackup(fresh);
    expect(await getLessonProgress('cNew', 'cNew-l001')).toEqual({ pos: 2, done: true });
    expect(await isSaved('cNew')).toBe(true);
    expect(DB_VERSION).toBe(3);
  });
});

describe('P-23 leaf rule and P-27 buds (Q4)', () => {
  it('a course can finish only when every lesson is shown AND it is not ongoing', () => {
    expect(courseCanFinish({ all_shown: true, ongoing: false })).toBe(true);
    expect(courseCanFinish({ all_shown: true })).toBe(true);
    expect(courseCanFinish({ all_shown: true, ongoing: true })).toBe(false);
    expect(courseCanFinish({ all_shown: false })).toBe(false);
    expect(courseCanFinish({})).toBe(false); // missing flags: cannot finish
  });
  it('a started course without a leaf is a bud (an ongoing course stays a bud)', () => {
    const rec = [{ courseId: 'c1', lessons: { a: { done: true } }, updatedAt: 1 }, { courseId: 'c2', lessons: { a: { done: true } }, updatedAt: 2 }];
    expect(startedCourseIds(rec, new Set(['c1', 'c2']), new Set(['c2']))).toEqual(['c1']);
  });
});
