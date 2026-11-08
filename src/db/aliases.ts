/**
 * src/db/aliases.ts — provisional → permanent id migration (Q5, bulk-02).
 *
 * Course ids are provisional (`c###`) until the teacher sheets give permanent
 * ids. `data/id-aliases.json` is the SOURCE map (`{ "<provisional>":
 * "<permanent>", … }`, empty now); the build merges it into the served
 * `public/data/aliases.json`. On app start the app reads the served file and
 * moves any IndexedDB user data keyed by a provisional id to the permanent key,
 * ONCE, inside ONE transaction, idempotently.
 *
 * Idempotent + safe:
 *   - A record is moved only if it still lives under the provisional key.
 *   - If the permanent key already holds data, the provisional copy is dropped
 *     (the permanent record wins) — never clobbered, never duplicated.
 *   - After a run the provisional keys are gone, so a second run is a no-op.
 *
 * User stores hold only STABLE references (course id, lesson id, lesson num) —
 * never array positions — so rewriting the course-id prefix is sufficient.
 */

import { openLearnDB } from './index';
import { devLog } from '../devlog';

/** The alias map shape: provisional course id → permanent course id. */
export type AliasMap = Record<string, string>;

/** PURE: resolve a (possibly provisional) course id to its permanent id. */
export function resolveAlias(id: string, aliases: AliasMap): string {
  return (aliases && aliases[id]) || id;
}

/**
 * PURE: rewrite the course-id prefix of a lesson id. Lesson ids are
 * `<courseId>-l<nnn>[suffix]`; only the part before the first `-l` is the
 * course id, so a permanent id that itself contains `-l` is handled correctly.
 * A lesson id that does not start with `<from>-l` is returned unchanged.
 */
export function rewriteLessonId(lessonId: string, from: string, to: string): string {
  const prefix = `${from}-l`;
  if (!lessonId.startsWith(prefix)) return lessonId;
  return `${to}-l${lessonId.slice(prefix.length)}`;
}

/** PURE: rewrite a progress record's embedded course id + lesson-id keys. */
export function remapProgress<V>(
  rec: { courseId: string; lessons?: Record<string, V>; updatedAt?: number },
  to: string
): { courseId: string; lessons: Record<string, V>; updatedAt: number } {
  const from = rec.courseId;
  const lessons: Record<string, V> = {};
  for (const [lid, v] of Object.entries(rec.lessons ?? {})) {
    lessons[rewriteLessonId(lid, from, to)] = v;
  }
  return { ...rec, courseId: to, lessons, updatedAt: rec.updatedAt ?? Date.now() };
}

/**
 * Migrate all user data from provisional ids to permanent ids. One read-write
 * transaction over every user store. Returns the number of records moved.
 *
 * Only entries whose course id is a KEY in `aliases` (and maps to a different
 * id) are touched. Everything else is left exactly as it is.
 */
export async function migrateAliases(aliases: AliasMap): Promise<number> {
  const pairs = Object.entries(aliases || {}).filter(([from, to]) => from && to && from !== to);
  if (pairs.length === 0) return 0;
  const aliasOf = new Map(pairs);

  const db = await openLearnDB();
  const tx = db.transaction(['progress', 'saved', 'history', 'notes', 'leaves'], 'readwrite');
  const leaves = tx.objectStore('leaves');
  const progress = tx.objectStore('progress');
  const saved = tx.objectStore('saved');
  const history = tx.objectStore('history');
  const notes = tx.objectStore('notes');
  let moved = 0;

  // progress (keyPath courseId): move the record, remap its lesson-id keys.
  for (const rec of await progress.getAll()) {
    const to = aliasOf.get(rec.courseId);
    if (!to) continue;
    const exists = await progress.get(to);
    await progress.delete(rec.courseId); // leave the provisional key clean
    if (!exists) {
      await progress.put(remapProgress(rec, to));
      moved++;
    }
  }

  // saved (key = courseId, value { courseId, at }).
  for (const rec of await saved.getAll()) {
    const to = aliasOf.get(rec.courseId);
    if (!to) continue;
    const exists = await saved.get(to);
    await saved.delete(rec.courseId);
    if (!exists) {
      await saved.put({ ...rec, courseId: to }, to);
      moved++;
    }
  }

  // history (key = `${courseId}:${lessonNum}`, value has courseId + lessonId).
  for (const rec of await history.getAll()) {
    const to = aliasOf.get(rec.courseId);
    if (!to) continue;
    const oldKey = `${rec.courseId}:${rec.lessonNum}`;
    const newKey = `${to}:${rec.lessonNum}`;
    const exists = await history.get(newKey);
    await history.delete(oldKey);
    if (!exists) {
      await history.put({ ...rec, courseId: to, lessonId: rewriteLessonId(rec.lessonId, rec.courseId, to) }, newKey);
      moved++;
    }
  }

  // notes (autoIncrement key; value has courseId + lessonId): update in place.
  for (const rec of await notes.getAll()) {
    const to = aliasOf.get(rec.courseId);
    if (!to) continue;
    await notes.put({ ...rec, courseId: to, lessonId: rewriteLessonId(rec.lessonId, rec.courseId, to) });
    moved++;
  }

  // leaves (bulk-05; key = course_id): the leaf moves to the permanent key. If
  // the permanent key already has a leaf, that one stays (a leaf is never
  // lost: one leaf per course either way).
  for (const rec of await leaves.getAll()) {
    const to = aliasOf.get(rec.course_id);
    if (!to) continue;
    const exists = await leaves.get(to);
    await leaves.delete(rec.course_id);
    if (!exists) {
      await leaves.put({ ...rec, course_id: to });
      moved++;
    }
  }

  await tx.done;
  devLog('migrateAliases: moved', moved, 'record(s)');
  return moved;
}
