/**
 * scripts/check-verify.ts — the release gate for interface strings.
 *
 * Scans src/strings.ts for any string value still carrying the "[VERIFY] "
 * prefix (an un-reviewed string). Prints each remaining marker with its line
 * number. Exit 0 when none remain (clean), exit 1 otherwise, so it can gate a
 * release. It reads source text only; it never changes any file.
 *
 * Run with: npm run release-check
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stringsPath = join(here, '..', 'src', 'strings.ts');

const src = readFileSync(stringsPath, 'utf-8');
const lines = src.split(/\r?\n/);

// Match a STRING-VALUE still carrying the marker, e.g.  km: '[VERIFY] …' or
// APP_UPDATE: { km: "[VERIFY] …" }. The marker must sit right after an opening
// quote. Comment lines (the docstring that explains the [VERIFY] mechanism, and
// the escaped "\\[VERIFY\\]" in displayString) are skipped so they do not
// produce false positives.
const markerInValue = /:\s*(['"`])\[VERIFY\]\s/;

function isCommentLine(text: string): boolean {
  const s = text.trim();
  return s.startsWith('*') || s.startsWith('//') || s.startsWith('/*');
}

const hits: { line: number; text: string }[] = [];
lines.forEach((text, i) => {
  if (isCommentLine(text)) return;
  if (markerInValue.test(text)) hits.push({ line: i + 1, text: text.trim() });
});

if (hits.length === 0) {
  console.log('release-check: 0 [VERIFY] markers — strings are clean.');
  process.exit(0);
}

console.error(`release-check: ${hits.length} un-reviewed string(s) still marked [VERIFY]:`);
for (const h of hits) console.error(`  src/strings.ts:${h.line}  ${h.text}`);
process.exit(1);
