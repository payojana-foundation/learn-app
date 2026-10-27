/**
 * src/data/types.ts — shapes for the learn-app data files.
 *
 * The app only CONSUMES these files; they are produced by the build script
 * (scripts/build-courses.mjs, P3) from the frozen source catalogue + teacher
 * file + media manifest. The app never writes or "fixes" data (see tech.md).
 *
 * The data manifest lists every published data file with its SHA-256 so the
 * loader can download only changed files and verify each one byte-for-byte
 * before storing it (the SPA-200 host returns index.html with status 200 for a
 * missing file, so a 200 is never, by itself, proof a file exists).
 */

/** One entry in the data manifest: a data file and its verification hash. */
export interface ManifestEntry {
  /** File name relative to the data base path, e.g. "catalog.json". */
  file: string;
  /** Last-updated marker (informational only; freshness is decided by sha256). */
  updated: string;
  /** Lowercase hex SHA-256 of the file's exact bytes. */
  sha256: string;
}

/**
 * The data manifest. `files` maps a logical key (e.g. "catalog" or a course id
 * like "c001") to its entry. The catalog file and each course file have an
 * entry; the loader fetches by key and verifies the hash before storing.
 */
export interface Manifest {
  /** When the manifest was generated (informational). */
  generated: string;
  /** key → entry. */
  files: Record<string, ManifestEntry>;
}
