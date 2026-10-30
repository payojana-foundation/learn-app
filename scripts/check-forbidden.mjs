/**
 * scripts/check-forbidden.mjs — forbidden-strings guard (bulk-04 S1).
 *
 * Fails if any TRACKED file's contents contain a retired name/domain. Prevents
 * the old study-84000 / beref.org / *.workers.dev / r2.dev identifiers from
 * leaking back into the repo now that the app is learn-app at
 * learn.84000.digital and the foundation domain is payojana.org.
 *
 * Scope:
 *   - Tracked files only (`git ls-files`); untracked and gitignored files
 *     (reports/, course-issues.csv, node_modules/, dist/) are never scanned.
 *   - Excluded by path: docs/archive/**, reports/**, node_modules/**,
 *     data/source/** (committed byte-for-byte; never edited).
 *   - Binary files are skipped (NUL byte in the first chunk).
 *
 * Allowances (task S1):
 *   - The git-metadata email sansombucks@gmail.com is in commit metadata, not
 *     file contents, so it is out of scope by construction.
 *   - The bare word `sansombucks` (no `.workers.dev`) is allowed. The pattern
 *     only matches `sansombucks.workers.dev`.
 *   - docs/kiro-bulk-*.md task files legitimately quote the forbidden strings
 *     to describe this guard, so they are excluded too.
 *
 * Usage:
 *   node scripts/check-forbidden.mjs
 * Exit code: 0 clean; 1 if any hit; 2 on a tooling error (e.g. not a git repo).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Retired identifiers that must not appear in tracked file contents. */
const FORBIDDEN = [
  'beref.org',
  'sansombucks.workers.dev',
  'study-84000',
  'study.84000.digital',
  'r2.dev',
];

/** Path prefixes/globs excluded from the scan. */
const EXCLUDE_PREFIXES = ['docs/archive/', 'reports/', 'node_modules/', 'data/source/'];

/**
 * This guard and its test legitimately list the retired strings as the terms
 * to catch, so they must be excluded by name — otherwise the guard flags
 * itself and `npm run check` can never be clean.
 */
const EXCLUDE_EXACT = new Set([
  'scripts/check-forbidden.mjs',
  'scripts/__tests__/check-forbidden.test.mjs',
]);

/** Task files that quote the forbidden strings on purpose. */
const isTaskFile = (p) => /^docs\/kiro-bulk-[^/]*\.md$/.test(p);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function isExcluded(path) {
  if (EXCLUDE_EXACT.has(path)) return true;
  if (EXCLUDE_PREFIXES.some((pre) => path.startsWith(pre))) return true;
  if (isTaskFile(path)) return true;
  return false;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Scan one file's bytes. Returns an array of {term, line} hits. */
export function scanText(text, terms = FORBIDDEN) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const term of terms) {
      if (lines[i].includes(term)) hits.push({ term, line: i + 1, text: lines[i] });
    }
  }
  return hits;
}

/** Decide whether a path is in scope. Exported for tests. */
export function inScope(path) {
  return !isExcluded(path);
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    console.error(`check-forbidden: could not list tracked files: ${err?.message ?? err}`);
    process.exit(2);
  }

  const problems = [];
  for (const path of files) {
    if (!inScope(path)) continue;
    let buf;
    try {
      buf = readFileSync(path);
    } catch {
      continue; // deleted-but-staged or unreadable; skip
    }
    if (isBinary(buf)) continue;
    const hits = scanText(buf.toString('utf8'));
    for (const h of hits) problems.push({ path, ...h });
  }

  if (problems.length === 0) {
    console.log(`check-forbidden: clean — ${files.length} tracked files scanned, 0 hits.`);
    process.exit(0);
  }

  console.error(`check-forbidden: ${problems.length} forbidden-string hit(s):`);
  for (const p of problems) {
    console.error(`  ${p.path}:${p.line}  [${p.term}]`);
  }
  console.error(
    '\nThese identifiers are retired. Fix the files above, or add a documented ' +
      'exclusion if the occurrence is legitimate.'
  );
  process.exit(1);
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
