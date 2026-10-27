/**
 * scripts/media/verify-checksums.mjs — verify a set of files against an
 * MD5SUMS manifest and assert an EXACT count (Job A, word-audio-upload.yml).
 *
 * The word-audio batch 023 must be exactly 1366 files, each matching its MD5 in
 * MD5SUMS_023.txt. The workflow runs `rclone checksum md5` for the real check
 * against disk and R2; this script is the testable parser/asserter: given a
 * parsed MD5SUMS text and a map of computed sums, it reports matches,
 * mismatches, missing, and extra files, and fails unless the match count equals
 * the expected count.
 *
 * Usage (CLI, for the workflow log):
 *   node scripts/media/verify-checksums.mjs <MD5SUMS.txt> <computed.json> <expectedCount>
 * where computed.json is { "<filename>": "<md5>", … }.
 *
 * Exit 0 only when matches === expectedCount AND there are no mismatches.
 */

import { readFileSync } from 'node:fs';

/** Parse `md5sum`-format text into a Map<filename, md5>. */
export function parseMd5Sums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "<32-hex>  <filename>" (two spaces) or "<32-hex> *<filename>".
    const m = /^([0-9a-fA-F]{32})\s[ *](.+)$/.exec(trimmed);
    if (!m) continue;
    map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

/**
 * Compare expected (from MD5SUMS) against computed sums.
 * Returns { matched, mismatched[], missing[], extra[] }.
 */
export function compareSums(expected, computed) {
  const matched = [];
  const mismatched = [];
  const missing = [];
  for (const [file, md5] of expected) {
    if (!(file in computed)) missing.push(file);
    else if (computed[file].toLowerCase() === md5) matched.push(file);
    else mismatched.push({ file, expected: md5, actual: computed[file].toLowerCase() });
  }
  const extra = Object.keys(computed).filter((f) => !expected.has(f));
  return { matched, mismatched, missing, extra };
}

/** True only when every expected file matched, none mismatched, and the count is exact. */
export function isExactPass(result, expectedCount) {
  return (
    result.mismatched.length === 0 &&
    result.missing.length === 0 &&
    result.matched.length === expectedCount
  );
}

function main() {
  const [, , sumsPath, computedPath, expectedCountArg] = process.argv;
  if (!sumsPath || !computedPath || !expectedCountArg) {
    console.error('Usage: node scripts/media/verify-checksums.mjs <MD5SUMS.txt> <computed.json> <expectedCount>');
    process.exit(1);
  }
  const expectedCount = Number(expectedCountArg);
  const expected = parseMd5Sums(readFileSync(sumsPath, 'utf-8'));
  const computed = JSON.parse(readFileSync(computedPath, 'utf-8'));
  const result = compareSums(expected, computed);

  console.log(`expected files : ${expected.size}`);
  console.log(`matched        : ${result.matched.length}`);
  console.log(`mismatched     : ${result.mismatched.length}`);
  console.log(`missing        : ${result.missing.length}`);
  console.log(`extra          : ${result.extra.length}`);
  for (const m of result.mismatched.slice(0, 20)) {
    console.log(`  MISMATCH ${m.file}: expected ${m.expected}, got ${m.actual}`);
  }

  if (isExactPass(result, expectedCount)) {
    console.log(`PASS — ${expectedCount} matching`);
    process.exit(0);
  }
  console.error(`FAIL — expected exactly ${expectedCount} matching, got ${result.matched.length}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('verify-checksums.mjs')) main();
