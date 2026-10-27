/**
 * scripts/data-integrity-diff.ts — READ-ONLY diff of two data-file JSON exports.
 *
 * Adapted from vacana-app/scripts/data-integrity-diff.ts. The vacana version
 * was scripture-specific (one vol023.json with pali/khmer verse rows); this
 * learn-app version is generic: it compares two JSON files and reports what
 * changed, so a reviewer can confirm a rebuilt catalog.json or a course file
 * changed only what was intended.
 *
 * It never writes; it only reads the two files and prints a diff. It never
 * reformats Khmer/Pāḷi titles — it compares them byte-for-byte as stored.
 *
 * Usage:
 *   npx tsx scripts/data-integrity-diff.ts <old.json> <new.json>
 *
 * Exit 0 when the files are structurally equal, 1 when they differ (so it can
 * gate a rebuild review).
 */

import { readFileSync } from 'node:fs';

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error('Usage: npx tsx scripts/data-integrity-diff.ts <old.json> <new.json>');
  process.exit(1);
}

function load(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Stable JSON stringify (sorted keys) so key ORDER never shows as a diff. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

/** Collect leaf paths → value for a deep comparison report. */
function flatten(value: unknown, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

const a = load(oldPath);
const b = load(newPath);

if (stable(a) === stable(b)) {
  console.log('data-integrity-diff: files are structurally identical — PASS.');
  process.exit(0);
}

const fa = flatten(a);
const fb = flatten(b);
const added: string[] = [];
const removed: string[] = [];
const changed: string[] = [];

for (const [k, v] of fb) {
  if (!fa.has(k)) added.push(k);
  else if (fa.get(k) !== v) changed.push(k);
}
for (const k of fa.keys()) if (!fb.has(k)) removed.push(k);

console.log('data-integrity-diff: files DIFFER.');
console.log(`  added   : ${added.length}`);
console.log(`  removed : ${removed.length}`);
console.log(`  changed : ${changed.length}`);
for (const k of added.slice(0, 50)) console.log(`  + ${k} = ${fb.get(k)}`);
for (const k of removed.slice(0, 50)) console.log(`  - ${k} = ${fa.get(k)}`);
for (const k of changed.slice(0, 50)) console.log(`  ~ ${k}: ${fa.get(k)} -> ${fb.get(k)}`);
if (added.length + removed.length + changed.length > 150) console.log('  … (truncated to first 50 of each)');

process.exit(1);
