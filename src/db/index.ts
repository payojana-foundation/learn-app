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
      lastLessonNum: number;
      positionS: number; // resume-to-the-second position
      completed: number[]; // lesson nums marked complete
      updatedAt: number;
    };
  };
  saved: {
    key: string; // `${courseId}` or `${courseId}:${lessonNum}`
    value: { courseId: string; lessonNum?: number; at: number };
  };
  history: {
    key: string; // `${courseId}:${lessonNum}`
    value: { courseId: string; lessonNum: number; at: number };
  };
  notes: {
    key: number; // autoIncrement
    value: { courseId: string; lessonNum: number; atS: number; text: string; createdAt: number };
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

export function openLearnDB(): Promise<IDBPDatabase<LearnDB>> {
  if (dbPromise) return dbPromise;
  dbPromise = openDB<LearnDB>(DB_NAME, DB_VERSION, {
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
    },
  });
  return dbPromise;
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
