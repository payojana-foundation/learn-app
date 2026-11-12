/**
 * src/db/legacy.ts — the CLEAN CUT of bulk 09 (P-20, IndexedDB version 3).
 *
 * Until bulk 09 the app's course/lesson ids were positions in the old website file
 * (`c013`, `c013-l004`). The app now reads the master sheet, whose `c###` ids are a
 * DIFFERENT numbering (only c080 is the same course in both). Anything a learner saved
 * under an old id would point at another course or lesson, so the version-3 upgrade
 * (and the import of a schema < 3 backup) KEEPS ONLY the pilot course c080, and inside
 * it only the lessons in LEGACY_LESSON_MAP, rewritten to their new lesson ids. Everything
 * else keyed by an old id is dropped, once. Nothing is ever pointed at a different lesson.
 *
 * The map is the same as data/id-aliases.json (a contract test keeps them equal).
 */

/** The one course whose id means the same course before and after the switch. */
export const LEGACY_KEEP_COURSE = 'c080' as const;

/** Old lesson id -> new lesson id, for the pilot course c080 only. */
export const LEGACY_LESSON_MAP: Readonly<Record<string, string>> = {
  'c080-l001': 'AJAD00YYX0101',
  'c080-l002': 'AJAD00YYX0102',
  'c080-l003': 'AJAD00YYX0103',
  'c080-l004': 'AJAD00YYX0104',
  'c080-l005': 'AJAD00YYX0105',
  'c080-l006': 'AJAD00YYX0106',
  'c080-l007': 'AJAD00YYX0107',
  'c080-l008': 'AJAD00YYX0108',
  'c080-l009': 'AJAD00YYX0109',
  'c080-l010': 'AJAD00YYX0110',
  'c080-l011': 'AJAD00YYX0111',
  'c080-l012': 'AJAD00YYX0112',
  'c080-l013': 'AJAD00YYX0113',
  'c080-l014': 'AJAD00YYX0114',
  'c080-l015': 'AJAD00YYX0115',
};

/** PURE: the new id of an old c080 lesson id, or null (unknown / not a c080 lesson). */
export function legacyLessonId(courseId: string, lessonId: string): string | null {
  if (courseId !== LEGACY_KEEP_COURSE) return null;
  return Object.prototype.hasOwnProperty.call(LEGACY_LESSON_MAP, lessonId) ? LEGACY_LESSON_MAP[lessonId] : null;
}

/** PURE: a progress record after the cut, or null when nothing of it survives. */
export function cutProgress<V>(rec: {
  courseId: string;
  lessons?: Record<string, V>;
  updatedAt?: number;
}): { courseId: string; lessons: Record<string, V>; updatedAt: number } | null {
  if (rec.courseId !== LEGACY_KEEP_COURSE) return null;
  const lessons: Record<string, V> = {};
  for (const [lid, v] of Object.entries(rec.lessons ?? {})) {
    const to = legacyLessonId(rec.courseId, lid);
    if (to) lessons[to] = v;
  }
  if (Object.keys(lessons).length === 0) return null;
  return { ...rec, courseId: rec.courseId, lessons, updatedAt: rec.updatedAt ?? Date.now() };
}

/** PURE: a history/notes record after the cut (same course, lessonId rewritten), or null. */
export function cutLessonRef<T extends { courseId: string; lessonId: string }>(rec: T): T | null {
  const to = legacyLessonId(rec.courseId, rec.lessonId);
  return to ? { ...rec, lessonId: to } : null;
}

/** PURE: keep a saved/leaf record only for the kept course. */
export function keepCourse(courseId: string): boolean {
  return courseId === LEGACY_KEEP_COURSE;
}

/** A backup (any schema) after the cut. Used when an older backup is imported. */
export interface CutBackup {
  progress: unknown[];
  saved: unknown[];
  history: unknown[];
  notes: unknown[];
  leaves?: unknown[];
}
export function cutBackup<B extends CutBackup>(b: B): B {
  const rec = (x: unknown) => x as { courseId: string; lessonId: string; lessons?: Record<string, never>; course_id?: string };
  return {
    ...b,
    progress: (b.progress ?? []).map((r) => cutProgress(rec(r) as never)).filter((r) => r !== null),
    saved: (b.saved ?? []).filter((r) => keepCourse(rec(r).courseId)),
    history: (b.history ?? []).map((r) => cutLessonRef(rec(r))).filter((r) => r !== null),
    notes: (b.notes ?? []).map((r) => cutLessonRef(rec(r))).filter((r) => r !== null),
    leaves: (b.leaves ?? []).filter((r) => keepCourse(String(rec(r).course_id))),
  };
}
