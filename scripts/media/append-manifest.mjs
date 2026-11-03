/**
 * scripts/media/append-manifest.mjs — append ONE course-audio entry to
 * data/media-manifest.json (Job B, course-audio.yml).
 *
 * Every new entry starts as a DRAFT: `status: "DRAFT – needs reviewer
 * approval"`. The media pipeline is upload-only; a human reviewer approves the
 * recording before the app uses it.
 *
 * Immutability: a key is never overwritten. If the manifest already has the
 * entry's key, the script leaves it unchanged and exits 0 (a re-run is a no-op,
 * so the workflow is safe to re-run). Corrections get a new key with a `-v2`
 * suffix at the caller, not an overwrite here.
 *
 * Usage:
 *   node scripts/media/append-manifest.mjs <manifest.json> <entry.json>
 * where entry.json is { drive_file_id, key, bytes, duration_s, sha256 }.
 *
 * Exit 0 on append or no-op; exit 1 on a bad entry.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const DRAFT_STATUS = 'DRAFT – needs reviewer approval';

/** Validate an entry has the required fields with the right types. */
export function validateEntry(entry) {
  const required = {
    drive_file_id: 'string',
    source_md5: 'string', // Job B v2: the key derives from this (B2)
    key: 'string',
    bytes: 'number',
    duration_s: 'number',
    sha256: 'string',
  };
  for (const [field, type] of Object.entries(required)) {
    if (typeof entry?.[field] !== type) return `field "${field}" must be a ${type}`;
  }
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) return 'sha256 must be 64 lowercase hex chars';
  // B2: key = audio/<first 16 hex of md5>-a64.mp3 (optionally -v2 before .mp3).
  const want = entry.source_md5.toLowerCase().slice(0, 16);
  if (!new RegExp(`^audio/${want}-a64(-v\\d+)?\\.mp3$`).test(entry.key)) {
    return `key "${entry.key}" must derive from source_md5 (audio/${want}-a64.mp3)`;
  }
  return null;
}

/**
 * Pure append: returns the new manifest array. Idempotent — if `key` already
 * exists the manifest is returned UNCHANGED (never overwritten).
 */
export function appendEntry(manifest, entry) {
  const list = Array.isArray(manifest) ? manifest : [];
  if (list.some((e) => e.key === entry.key)) return list; // immutable: no overwrite
  return [...list, { ...entry, status: DRAFT_STATUS }];
}

function main() {
  const [, , manifestPath, entryPath] = process.argv;
  if (!manifestPath || !entryPath) {
    console.error('Usage: node scripts/media/append-manifest.mjs <manifest.json> <entry.json>');
    process.exit(1);
  }
  const entry = JSON.parse(readFileSync(entryPath, 'utf-8'));
  const err = validateEntry(entry);
  if (err) {
    console.error('bad entry:', err);
    process.exit(1);
  }
  const current = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : [];
  const before = Array.isArray(current) ? current.length : 0;
  const next = appendEntry(current, entry);
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  console.log(
    next.length > before
      ? `appended ${entry.key} as DRAFT (${next.length} entries)`
      : `key ${entry.key} already present — left unchanged (immutable)`
  );
  process.exit(0);
}

// Run only when invoked directly (so tests can import the pure functions).
if (process.argv[1] && process.argv[1].endsWith('append-manifest.mjs')) main();
