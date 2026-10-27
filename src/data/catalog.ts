/**
 * src/data/catalog.ts — typed access to the served course data.
 *
 * Flow: fetch the manifest, then for each needed file use the hash-verified
 * loader (loadFile) to store it in IndexedDB, and read it back. The catalog and
 * teachers load at startup; a course file loads on first open and is cached.
 *
 * Every fetched file is verified against its manifest SHA-256 before use
 * (P-01/P-02): the host returns index.html with 200 for a missing file, so a
 * 200 is never proof — only the hash is.
 */

import type { Manifest } from './types';
import { fetchManifest } from './manifest';
import { loadFile } from './loader';
import { getDataFile } from '../db';
import { devLog } from '../devlog';

export interface CatalogCourse {
  id: string;
  provisional: boolean;
  title_km: string;
  title_en: string | null;
  teacher: string;
  teacher_slug: string;
  topics: string[];
  lesson_count: number;
  media_kinds: string[];
}
export interface Catalog {
  generated: string;
  provisional: boolean;
  courses: CatalogCourse[];
}

export type MediaKind = 'r2' | 'acast' | 'youtube' | 'drive';
export interface LessonMedia {
  kind: MediaKind;
  src: string;
  /** Real audio length in seconds, from the media manifest. r2 media only (Q4). */
  duration_s?: number;
}
export interface Lesson {
  id: string;
  num: number;
  title_km: string;
  topic: string;
  media: LessonMedia[];
}
export interface Course {
  id: string;
  provisional: boolean;
  title_km: string;
  title_en: string | null;
  teacher: string;
  teacher_slug: string;
  topics: string[];
  lessons: Lesson[];
}

export interface Teacher {
  slug: string;
  name_km: string;
  name_en: string | null;
  bio_km: string | null;
  bio_en: string | null;
  topics: string[];
  photo: string | null;
}
export interface Teachers {
  teachers: Teacher[];
}

let manifestPromise: Promise<Manifest | null> | null = null;

function manifest(): Promise<Manifest | null> {
  if (!manifestPromise) manifestPromise = fetchManifest();
  return manifestPromise;
}

/**
 * Sync one file by key via the hash-verified loader, then read the cached copy.
 * If the manifest is unavailable (offline, first run blocked) we still try the
 * cached copy, so the app works offline once a file has been stored.
 */
async function syncAndRead<T>(key: string): Promise<T | null> {
  const m = await manifest();
  if (m) {
    const r = await loadFile<T>(m, key);
    if (r.status === 'failed') devLog('catalog: sync failed for', key, r.reason);
  }
  return (await getDataFile<T>(key)) ?? null;
}

export function getCatalog(): Promise<Catalog | null> {
  return syncAndRead<Catalog>('catalog');
}
export function getTeachersFile(): Promise<Teachers | null> {
  return syncAndRead<Teachers>('teachers');
}
export function getCourse(id: string): Promise<Course | null> {
  return syncAndRead<Course>(id);
}

/** TEST-ONLY: drop the cached manifest promise so a test can re-sync. */
export function __resetCatalogForTest(): void {
  manifestPromise = null;
}
