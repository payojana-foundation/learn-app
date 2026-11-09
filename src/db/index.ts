/**
 * src/db/index.ts
 *
 * IndexedDB schema, versioned migrations, and typed accessors for learn-app.
 *
 * Database name and version come from config.ts — the single source of truth.
 * Browser storage belongs to the ORIGIN, so the database name (`learn-app`) is
 * unique to this app even when several apps share one domain as subpaths.
 *
 * Stores (v1):
 *   - progress   course progress + per-lesson position/completion
 *   - saved      saved courses/lessons
 *   - history    recently opened lessons
 *   - notes      notes with timestamps
 *   - settings   key → value (language, player speed, theme, …)
 *   - files      cached data files (catalog + per-course), by manifest key
 *   - dataHashes stored SHA-256 per manifest key (freshness comparison)
 *
 * P1 creates the schema and the accessors the data loader needs; P4 fills in
 * the progress/saved/history/notes accessors for the screens. User stores hold
 * only stable references (course id, lesson number) — never array positions.
 */

import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import { DB_NAME, DB_VERSION } from '../config';
import { devLog } from '../devlog';

export interface LearnDB extends DBSchema {
  progress: {
    key: string; // course id
    value: {
      courseId: string;
      // Per-lesson progress keyed by lesson ID (stable; disambiguates duplicate nums).
      lessons: Record<string, { pos: number; done: boolean }>;
      updatedAt: number;
    };
  };
  saved: {
    key: string; // course id
    value: { courseId: string; at: number };
  };
  history: {
    key: string; // `${courseId}:${lessonNum}`
    value: { courseId: string; lessonNum: number; lessonId: string; at: number };
  };
  notes: {
    key: number; // autoIncrement
    value: {
      id?: number;
      courseId: string;
      lessonId: string;
      lessonNum: number;
      atS: number;
      text: string;
      createdAt: number;
    };
  };
  leaves: {
    key: string; // course id
    value: { course_id: string; at: number };
  };
  settings: {
    key: string;
    value: unknown;
  };
  files: {
    key: string; // manifest key (e.g. "catalog", "c001")
    value: unknown; // parsed, hash-verified JSON
  };
  dataHashes: {
    key: string; // manifest key
    value: string; // stored sha256
  };
}

let dbPromise: Promise<IDBPDatabase<LearnDB>> | null = null;

/**
 * Called when ANOTHER tab (a newer build) needs to upgrade the database. This
 * tab has already closed its connection; the handler shows the existing
 * "update available" prompt (registered by main.ts). bulk-07 P3.
 */
let versionChangeHandler: () => void = () => {};
export function setVersionChangeHandler(fn: () => void): void {
  versionChangeHandler = fn;
}

export function openLearnDB(): Promise<IDBPDatabase<LearnDB>> {
  if (dbPromise) return dbPromise;
  const opening = openDB<LearnDB>(DB_NAME, DB_VERSION, {
    // Another tab holds an older connection: the open WAITS (the request stays
    // pending and completes by itself once that tab closes). Nothing is deleted
    // or cleared while waiting.
    blocked(currentVersion, blockedVersion) {
      devLog('db open blocked by an older tab', { currentVersion, blockedVersion });
    },
    // A newer tab wants to upgrade: close at once so it is not blocked, forget
    // this connection, and ask the user to reload (existing update prompt).
    blocking(currentVersion, blockedVersion, event) {
      devLog('db: newer version requested, closing this connection', { currentVersion, blockedVersion });
      (event.target as IDBDatabase).close();
      dbPromise = null;
      versionChangeHandler();
    },
    // The browser closed the connection (e.g. storage cleared): reopen next time.
    terminated() {
      dbPromise = null;
    },
    upgrade(db, oldVersion) {
      // Switch by oldVersion so future migrations never delete user stores.
      if (oldVersion < 1) {
        db.createObjectStore('progress', { keyPath: 'courseId' });
        db.createObjectStore('saved');
        db.createObjectStore('history');
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings');
        db.createObjectStore('files');
        db.createObjectStore('dataHashes');
      }
      // v2 (bulk-05): leaves, one per finished course. Adds a store only.
      if (oldVersion < 2) {
        db.createObjectStore('leaves', { keyPath: 'course_id' });
      }
    },
  });
  dbPromise = opening;
  // A failed open (e.g. this old build meets a newer DB: VersionError) is not
  // cached, so the next call tries again instead of failing forever.
  opening.catch((err) => {
    devLog('db open failed', err);
    if (dbPromise === opening) dbPromise = null;
    if (err && (err as DOMException).name === 'VersionError') versionChangeHandler();
  });
  return opening;
}

/** TEST-ONLY: drop the cached connection so a fresh DB can be opened. */
export function resetDbForTests(): void {
  dbPromise = null;
}

// ── Data-file accessors (used by the loader) ────────────────────────────────

/** Read the stored SHA-256 for a manifest key, or undefined if none. */
export async function getDataHash(key: string): Promise<string | undefined> {
  const db = await openLearnDB();
  return db.get('dataHashes', key);
}

/**
 * Store a verified data file and its hash in ONE transaction, so the cached
 * file and its recorded hash can never disagree (an interrupted write leaves
 * both old, never a file with the wrong hash).
 */
export async function putDataFile(key: string, value: unknown, sha256: string): Promise<void> {
  const db = await openLearnDB();
  const tx = db.transaction(['files', 'dataHashes'], 'readwrite');
  await Promise.all([
    tx.objectStore('files').put(value, key),
    tx.objectStore('dataHashes').put(sha256, key),
    tx.done,
  ]);
}

/** Read a cached data file by key, or undefined if not stored yet. */
export async function getDataFile<T>(key: string): Promise<T | undefined> {
  const db = await openLearnDB();
  return (await db.get('files', key)) as T | undefined;
}

// ── Settings accessors ──────────────────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openLearnDB();
  return (await db.get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await openLearnDB();
  await db.put('settings', value, key);
  devLog('setting written', key);
}

// ── User-data accessors (P4) ────────────────────────────────────────────────
//
// All keyed by STABLE references: course id and lesson id (never array
// positions). Because a duplicate lesson num is disambiguated only in the id
// (P3, answer "b"), progress/history/notes key on the lesson id, not the num.

export interface LessonProgress {
  pos: number; // resume-to-the-second position
  done: boolean; // completed at 90% or by the button
}

/** Read one lesson's progress within a course (default: unseen). */
export async function getLessonProgress(courseId: string, lessonId: string): Promise<LessonProgress> {
  const db = await openLearnDB();
  const rec = await db.get('progress', courseId);
  return rec?.lessons?.[lessonId] ?? { pos: 0, done: false };
}

/** Merge a change into one lesson's progress (atomic read-modify-write). */
export async function setLessonProgress(
  courseId: string,
  lessonId: string,
  patch: Partial<LessonProgress>
): Promise<void> {
  const db = await openLearnDB();
  const tx = db.transaction('progress', 'readwrite');
  const store = tx.objectStore('progress');
  const rec = (await store.get(courseId)) ?? { courseId, lessons: {}, updatedAt: 0 };
  rec.lessons = rec.lessons ?? {};
  rec.lessons[lessonId] = { ...(rec.lessons[lessonId] ?? { pos: 0, done: false }), ...patch };
  rec.updatedAt = Date.now();
  await store.put(rec);
  await tx.done;
}

/** Every progress record (read-only; used to derive buds at render time). */
export async function listProgress(): Promise<
  { courseId: string; lessons: Record<string, { pos: number; done: boolean }>; updatedAt: number }[]
> {
  const db = await openLearnDB();
  return db.getAll('progress');
}

/** How many lessons in a course are marked done. */
export async function doneCount(courseId: string): Promise<number> {
  const db = await openLearnDB();
  const rec = await db.get('progress', courseId);
  if (!rec?.lessons) return 0;
  return Object.values(rec.lessons).filter((l) => l.done).length;
}

export async function isSaved(courseId: string): Promise<boolean> {
  const db = await openLearnDB();
  return (await db.get('saved', courseId)) != null;
}
export async function toggleSaved(courseId: string): Promise<boolean> {
  const db = await openLearnDB();
  if (await db.get('saved', courseId)) {
    await db.delete('saved', courseId);
    return false;
  }
  await db.put('saved', { courseId, at: Date.now() }, courseId);
  return true;
}
export async function listSaved(): Promise<string[]> {
  const db = await openLearnDB();
  const all = await db.getAll('saved');
  return all.sort((a, b) => b.at - a.at).map((s) => s.courseId);
}

/** Record that a lesson was opened; newest first, de-duplicated per course, capped at 30. */
export async function pushHistory(courseId: string, lessonId: string, lessonNum: number): Promise<void> {
  const db = await openLearnDB();
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  const all = await store.getAll();
  // Remove any prior entry for this course (one row per course, like the mockup).
  for (const h of all) if (h.courseId === courseId) await store.delete(`${h.courseId}:${h.lessonNum}`);
  await store.put({ courseId, lessonNum, lessonId, at: Date.now() }, `${courseId}:${lessonNum}`);
  // Cap to 30 newest.
  const kept = (await store.getAll()).sort((a, b) => b.at - a.at);
  for (const h of kept.slice(30)) await store.delete(`${h.courseId}:${h.lessonNum}`);
  await tx.done;
}
export interface HistoryEntry {
  courseId: string;
  lessonNum: number;
  lessonId: string;
  at: number;
}
export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await openLearnDB();
  const all = (await db.getAll('history')) as HistoryEntry[];
  return all.sort((a, b) => b.at - a.at);
}

export interface NoteRec {
  id?: number;
  courseId: string;
  lessonId: string;
  lessonNum: number;
  atS: number;
  text: string;
  createdAt: number;
}
export async function addNote(n: Omit<NoteRec, 'id' | 'createdAt'>): Promise<void> {
  const db = await openLearnDB();
  await db.add('notes', { ...n, createdAt: Date.now() } as NoteRec);
}
export async function listNotes(): Promise<NoteRec[]> {
  const db = await openLearnDB();
  const all = (await db.getAll('notes')) as NoteRec[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function listNotesFor(courseId: string, lessonId: string): Promise<NoteRec[]> {
  return (await listNotes()).filter((n) => n.courseId === courseId && n.lessonId === lessonId);
}

// ── Leaves (bulk-05): one per finished course, never removed ────────────────

export interface Leaf {
  course_id: string;
  at: number;
}

/**
 * PURE: is every listed (visible) lesson marked done? An empty list is never
 * "finished". Progress for lessons not in the list is ignored.
 */
export function isCourseFinished(
  lessons: Record<string, { done: boolean }> | undefined,
  visibleLessonIds: string[]
): boolean {
  if (!visibleLessonIds.length) return false;
  return visibleLessonIds.every((id) => lessons?.[id]?.done === true);
}

/**
 * Add the course's leaf once, if every visible lesson is done. One read-write
 * transaction over progress + leaves: a second tab's call sees the existing
 * key and does nothing, so there are never two leaves. An existing leaf is
 * never updated or deleted. Returns true only when a leaf was added now.
 */
export async function awardLeafIfFinished(
  courseId: string,
  visibleLessonIds: string[],
  at: number = Date.now()
): Promise<boolean> {
  const db = await openLearnDB();
  const tx = db.transaction(['progress', 'leaves'], 'readwrite');
  const leaves = tx.objectStore('leaves');
  let added = false;
  if (!(await leaves.get(courseId))) {
    const rec = await tx.objectStore('progress').get(courseId);
    if (isCourseFinished(rec?.lessons, visibleLessonIds)) {
      await leaves.add({ course_id: courseId, at });
      added = true;
    }
  }
  await tx.done;
  return added;
}

/** All leaves, oldest first (the branch order). */
export async function listLeaves(): Promise<Leaf[]> {
  const db = await openLearnDB();
  const all = await db.getAll('leaves');
  return all.sort((a, b) => a.at - b.at || a.course_id.localeCompare(b.course_id));
}

/** Settings key: the first-run leaf backfill has completed. */
export const LEAVES_BACKFILL_KEY = 'leavesBackfilled';

/**
 * First run after the update: add leaves for courses already finished. The
 * lesson ids come from `visibleIdsOf` (the course file, resolved OUTSIDE the
 * transaction because IndexedDB closes a transaction that awaits the network),
 * then ALL leaves are written in ONE transaction, add-if-absent. Marks itself
 * done only when every candidate could be resolved, so an offline first run
 * tries again later. Returns the number of leaves added.
 *
 * @param candidates   course ids worth checking (e.g. progress.done >= lesson_count)
 * @param visibleIdsOf lesson ids of a course, or null if its file is unavailable
 */
export async function backfillLeaves(
  candidates: string[],
  visibleIdsOf: (courseId: string) => Promise<string[] | null>
): Promise<number> {
  const db = await openLearnDB();
  if (await db.get('settings', LEAVES_BACKFILL_KEY)) return 0;

  const resolved: { id: string; ids: string[] }[] = [];
  let allResolved = true;
  for (const id of candidates) {
    const ids = await visibleIdsOf(id);
    if (ids) resolved.push({ id, ids });
    else allResolved = false;
  }

  const tx = db.transaction(['progress', 'leaves', 'settings'], 'readwrite');
  const progress = tx.objectStore('progress');
  const leaves = tx.objectStore('leaves');
  let added = 0;
  for (const { id, ids } of resolved) {
    if (await leaves.get(id)) continue;
    const rec = await progress.get(id);
    if (isCourseFinished(rec?.lessons, ids)) {
      await leaves.add({ course_id: id, at: rec?.updatedAt || Date.now() });
      added++;
    }
  }
  if (allResolved) await tx.objectStore('settings').put(true, LEAVES_BACKFILL_KEY);
  await tx.done;
  return added;
}

// ── Export / Import backup (More tab) ───────────────────────────────────────

export interface Backup {
  app: 'learn-app';
  schema: number;
  exported_at: string;
  progress: unknown[];
  saved: unknown[];
  history: unknown[];
  notes: unknown[];
  /** Added in schema 2. An older backup has none; import then keeps local leaves. */
  leaves?: unknown[];
  settings: Record<string, unknown>;
}

/** Export all USER stores (not cached data files) as one JSON object. */
export async function exportBackup(): Promise<Backup> {
  const db = await openLearnDB();
  const [progress, saved, history, notes, leaves] = await Promise.all([
    db.getAll('progress'),
    db.getAll('saved'),
    db.getAll('history'),
    db.getAll('notes'),
    db.getAll('leaves'),
  ]);
  const settings: Record<string, unknown> = {};
  let cursor = await db.transaction('settings').store.openCursor();
  while (cursor) {
    settings[String(cursor.key)] = cursor.value;
    cursor = await cursor.continue();
  }
  return { app: 'learn-app', schema: DB_VERSION, exported_at: new Date().toISOString(), progress, saved, history, notes, leaves, settings };
}

/** Import a backup, replacing the user stores. Rejects a backup from another app. */
export async function importBackup(backup: Backup): Promise<void> {
  if (!backup || backup.app !== 'learn-app') throw new Error('not a learn-app backup');
  const db = await openLearnDB();
  const tx = db.transaction(['progress', 'saved', 'history', 'notes', 'leaves', 'settings'], 'readwrite');
  // Leaves are MERGED (union by course_id), never cleared: an older backup
  // without `leaves` removes none, and an existing leaf is never overwritten.
  const leavesStore = tx.objectStore('leaves');
  for (const r of (backup.leaves ?? []) as Partial<Leaf>[]) {
    if (r && typeof r.course_id === 'string' && typeof r.at === 'number' && !(await leavesStore.get(r.course_id))) {
      await leavesStore.add({ course_id: r.course_id, at: r.at });
    }
  }
  await tx.objectStore('progress').clear();
  for (const r of backup.progress ?? []) await tx.objectStore('progress').put(r as never);
  await tx.objectStore('saved').clear();
  for (const r of (backup.saved ?? []) as { courseId: string }[]) await tx.objectStore('saved').put(r as never, r.courseId);
  await tx.objectStore('history').clear();
  for (const r of (backup.history ?? []) as { courseId: string; lessonNum: number }[]) await tx.objectStore('history').put(r as never, `${r.courseId}:${r.lessonNum}`);
  await tx.objectStore('notes').clear();
  for (const r of backup.notes ?? []) await tx.objectStore('notes').put(r as never);
  await tx.objectStore('settings').clear();
  for (const [k, v] of Object.entries(backup.settings ?? {})) await tx.objectStore('settings').put(v as never, k);
  await tx.done;
}
