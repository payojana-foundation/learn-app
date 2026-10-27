/**
 * src/data/loader.ts
 *
 * Data loader with hash verification (adapted from vacana-app/src/data/loader.ts).
 *
 * Flow for one data file:
 *   1. Read its manifest entry (file + SHA-256).
 *   2. Fetch `{file}?h={sha256}` with { cache: 'no-store' }.
 *        - `no-store` stops the browser serving a stale HTTP-cached copy.
 *        - `?h=` busts any CDN edge copy keyed by URL.
 *   3. Compute SHA-256 of the downloaded bytes and compare to the manifest hash
 *      BEFORE any IndexedDB write.
 *   4. Only a verified file is stored.
 *
 * On any hash mismatch, fetch error, or parse error: discard the download,
 * retain whatever is already stored, devLog the reason, and report failure.
 *
 * DATA INTEGRITY: this module never inspects, normalises, or modifies the data.
 * It verifies bytes and stores the parsed JSON exactly as received.
 */

import type { Manifest, ManifestEntry } from './types';
import { getDataHash, putDataFile } from '../db';
import { devLog } from '../devlog';

/** Outcome of a load attempt for one data file. */
export type LoadResult =
  | { status: 'updated' }
  | { status: 'unchanged' }
  | { status: 'failed'; reason: string };

/** Convert raw bytes to a lowercase hex SHA-256 string using SubtleCrypto. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the cache-busted URL for a data file: `{basePath}{file}?h={sha256}`.
 * basePath is ORIGIN-ABSOLUTE ("/data/") so fetches resolve to the origin root
 * even when the app booted at a deep link where a relative "data/" would
 * resolve against the route path and hit the SPA HTML fallback.
 */
export function dataUrl(file: string, sha256: string, basePath = '/data/'): string {
  return `${basePath}${file}?h=${sha256}`;
}

/**
 * Fetch one data file, verify its SHA-256 against the manifest entry, and
 * return the parsed JSON. Returns null (and devLogs) on any failure:
 * network error, non-2xx, unparseable JSON, or hash mismatch.
 *
 * NOTHING is written here — verification happens before any store write.
 */
export async function fetchAndVerify<T>(
  entry: ManifestEntry,
  fetchImpl: typeof fetch = fetch,
  basePath = '/data/'
): Promise<T | null> {
  const url = dataUrl(entry.file, entry.sha256, basePath);

  let res: Response;
  try {
    res = await fetchImpl(url, { cache: 'no-store' });
  } catch (err) {
    devLog('fetchAndVerify: network error', entry.file, err);
    return null;
  }

  if (!res.ok) {
    devLog('fetchAndVerify: non-2xx', entry.file, res.status);
    return null;
  }

  // Read bytes once: hash the exact bytes, then decode the same bytes to JSON.
  let bytes: ArrayBuffer;
  try {
    bytes = await res.arrayBuffer();
  } catch (err) {
    devLog('fetchAndVerify: body read error', entry.file, err);
    return null;
  }

  const actual = await sha256Hex(bytes);
  if (actual !== entry.sha256) {
    devLog('fetchAndVerify: HASH MISMATCH', entry.file, { expected: entry.sha256, actual });
    return null; // never store unverified bytes
  }

  try {
    const text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text) as T;
  } catch (err) {
    devLog('fetchAndVerify: JSON parse error', entry.file, err);
    return null;
  }
}

/**
 * Load one file by its manifest key, verifying the hash before storing it.
 *
 * Short-circuit: if the stored hash already equals the manifest hash, the file
 * is unchanged and is not re-downloaded. Freshness is decided solely by SHA-256
 * (never timestamps).
 *
 * @param manifest  parsed manifest (from fetchManifest)
 * @param key       the file's key in manifest.files, e.g. "catalog" or "c001"
 */
export async function loadFile<T>(
  manifest: Manifest,
  key: string,
  fetchImpl: typeof fetch = fetch,
  basePath = '/data/'
): Promise<LoadResult> {
  const entry = manifest.files[key];
  if (!entry) {
    const reason = `manifest has no file "${key}"`;
    devLog('loadFile:', reason);
    return { status: 'failed', reason };
  }

  try {
    const stored = await getDataHash(key);
    if (stored === entry.sha256) {
      devLog('loadFile: hash unchanged, skipping download for', key);
      return { status: 'unchanged' };
    }
  } catch (err) {
    // The short-circuit is an optimisation, never a gate: fall through to fetch.
    devLog('loadFile: stored-hash read failed, proceeding with download', err);
  }

  const parsed = await fetchAndVerify<T>(entry, fetchImpl, basePath);
  if (parsed === null) {
    const reason = `verification failed for "${key}"`;
    devLog('loadFile: retaining previous data —', reason);
    return { status: 'failed', reason };
  }

  try {
    await putDataFile(key, parsed, entry.sha256);
  } catch (err) {
    const reason = `store write failed for "${key}"`;
    devLog('loadFile:', reason, err);
    return { status: 'failed', reason };
  }

  devLog('loadFile: stored', key);
  return { status: 'updated' };
}
