/**
 * src/data/manifest.ts
 *
 * Fetches and parses data/manifest.json — the authoritative source of
 * freshness. The app compares each file's manifest sha256 against its stored
 * hash to decide what to re-download; it never uses `updated` timestamps for
 * freshness.
 *
 * This module only fetches and validates STRUCTURE. Hash comparison and the
 * atomic IndexedDB store live in loader.ts.
 *
 * Adapted from vacana-app/src/data/manifest.ts: the volume-pair shape is
 * replaced by learn-app's flat `files` map, but the network-first fetch, the
 * SPA-200 rejection (an HTML body returned as 200 fails the shape check), and
 * the pure `parseManifest` variant are kept unchanged.
 */

import type { Manifest, ManifestEntry } from './types';

/**
 * Default manifest location. ORIGIN-ABSOLUTE ("/data/…") on purpose: a deep
 * link such as /courses/c001/5 makes the document path "/courses/c001/5", and a
 * relative "data/manifest.json" would resolve against that path and hit the SPA
 * HTML fallback. A leading slash anchors it to the origin root for every route.
 */
export const MANIFEST_URL = '/data/manifest.json';

function isManifestEntry(v: unknown): v is ManifestEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.file === 'string' &&
    typeof e.updated === 'string' &&
    typeof e.sha256 === 'string'
  );
}

function isManifest(v: unknown): v is Manifest {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  if (typeof m.generated !== 'string') return false;
  if (typeof m.files !== 'object' || m.files === null) return false;

  for (const key of Object.keys(m.files as Record<string, unknown>)) {
    if (!isManifestEntry((m.files as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Fetch and parse the manifest.
 *
 * @returns the parsed, structurally-validated Manifest, or null on any network
 *   error, non-2xx response, unparseable JSON, or shape mismatch. Callers treat
 *   null as "manifest unavailable" and retain previously stored data.
 */
export async function fetchManifest(
  url: string = MANIFEST_URL,
  fetchImpl: typeof fetch = fetch
): Promise<Manifest | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, { cache: 'no-store' }); // never serve a stale manifest
  } catch {
    return null; // network error
  }

  if (!res.ok) return null; // non-2xx

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null; // unparseable JSON (e.g. the SPA HTML fallback)
  }

  return isManifest(json) ? json : null;
}

/** Pure parser for an already-fetched JSON value. Returns the typed Manifest or null. */
export function parseManifest(json: unknown): Manifest | null {
  return isManifest(json) ? json : null;
}
