import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveAlias,
  rewriteLessonId,
  remapProgress,
  migrateAliases,
  type AliasMap,
} from './aliases';
import {
  openLearnDB,
  setLessonProgress,
  toggleSaved,
  pushHistory,
  addNote,
  getLessonProgress,
  isSaved,
  listHistory,
  listNotes,
} from './index';

// A FIXTURE alias map — no real permanent ids are invented. The "permanent"
// side here is a placeholder string the test controls end to end.
const FIXTURE: AliasMap = { c012: 'perm-course-x', c099: 'perm-course-y' };

describe('resolveAlias (pure)', () => {
  it('maps a provisional id to its permanent id; passes through the rest', () => {
    expect(resolveAlias('c012', FIXTURE)).toBe('perm-course-x');
    expect(resolveAlias('c001', FIXTURE)).toBe('c001');
    expect(resolveAlias('c012', {})).toBe('c012');
  });
});

describe('rewriteLessonId (pure)', () => {
  it('rewrites only the course prefix before -l', () => {
    expect(rewriteLessonId('c012-l003', 'c012', 'perm-course-x')).toBe('perm-course-x-l003');
    expect(rewriteLessonId('c012-l013b', 'c012', 'perm-course-x')).toBe('perm-course-x-l013b');
  });
  it('leaves an unrelated lesson id untouched', () => {
    expect(rewriteLessonId('c001-l001', 'c012', 'perm-course-x')).toBe('c001-l001');
  });
});

describe('remapProgress (pure)', () => {
  it('rewrites courseId and every lesson-id key', () => {
    const out = remapProgress(
      { courseId: 'c012', lessons: { 'c012-l001': { pos: 5, done: true } }, updatedAt: 1 },
      'perm-course-x'
    );
    expect(out.courseId).toBe('perm-course-x');
    expect(out.lessons['perm-course-x-l001']).toEqual({ pos: 5, done: true });
  });
});

describe('migrateAliases (IndexedDB, fixture map)', () => {
  beforeEach(async () => {
    // fake-indexeddb is module-global per worker; clear the user stores between
    // cases rather than deleting the db (a delete blocks on the open connection).
    const db = await openLearnDB();
    const tx = db.transaction(['progress', 'saved', 'history', 'notes'], 'readwrite');
    await Promise.all([
      tx.objectStore('progress').clear(),
      tx.objectStore('saved').clear(),
      tx.objectStore('history').clear(),
      tx.objectStore('notes').clear(),
      tx.done,
    ]);
  });

  it('moves progress/saved/history/notes from the provisional id to the permanent one', async () => {
    await setLessonProgress('c012', 'c012-l001', { pos: 42, done: true });
    await toggleSaved('c012');
    await pushHistory('c012', 'c012-l001', 1);
    await addNote({ courseId: 'c012', lessonId: 'c012-l001', lessonNum: 1, atS: 10, text: 'placeholder note' });

    const moved = await migrateAliases(FIXTURE);
    expect(moved).toBe(4);

    // provisional key is gone, permanent key holds the data
    expect(await getLessonProgress('c012', 'c012-l001')).toEqual({ pos: 0, done: false });
    expect(await getLessonProgress('perm-course-x', 'perm-course-x-l001')).toEqual({ pos: 42, done: true });
    expect(await isSaved('c012')).toBe(false);
    expect(await isSaved('perm-course-x')).toBe(true);

    const hist = await listHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].courseId).toBe('perm-course-x');
    expect(hist[0].lessonId).toBe('perm-course-x-l001');

    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].courseId).toBe('perm-course-x');
    expect(notes[0].lessonId).toBe('perm-course-x-l001');
    expect(notes[0].text).toBe('placeholder note'); // text never touched
  });

  it('is idempotent — a second run moves nothing and does not duplicate', async () => {
    await setLessonProgress('c012', 'c012-l001', { pos: 7, done: false });
    expect(await migrateAliases(FIXTURE)).toBe(1); // only progress present → 1 moved
    expect(await migrateAliases(FIXTURE)).toBe(0); // nothing left under a provisional key
    expect(await getLessonProgress('perm-course-x', 'perm-course-x-l001')).toEqual({ pos: 7, done: false });
  });

  it('an empty alias map is a no-op', async () => {
    await setLessonProgress('c001', 'c001-l001', { pos: 3, done: false });
    expect(await migrateAliases({})).toBe(0);
    expect(await getLessonProgress('c001', 'c001-l001')).toEqual({ pos: 3, done: false });
  });

  it('does not clobber an existing permanent record (permanent wins)', async () => {
    await setLessonProgress('perm-course-x', 'perm-course-x-l001', { pos: 100, done: true });
    await setLessonProgress('c012', 'c012-l001', { pos: 1, done: false });
    const moved = await migrateAliases(FIXTURE);
    expect(moved).toBe(0); // permanent already existed → provisional dropped, not moved
    expect(await getLessonProgress('perm-course-x', 'perm-course-x-l001')).toEqual({ pos: 100, done: true });
    expect(await getLessonProgress('c012', 'c012-l001')).toEqual({ pos: 0, done: false }); // provisional cleaned
  });
});
