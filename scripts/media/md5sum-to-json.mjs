/**
 * scripts/media/md5sum-to-json.mjs — convert `md5sum`/rclone-md5sum output into
 * the { "<filename>": "<md5>" } JSON that verify-checksums.mjs reads.
 *
 * Usage:
 *   node scripts/media/md5sum-to-json.mjs <sums.txt>   # prints JSON to stdout
 */

import { readFileSync } from 'node:fs';
import { parseMd5Sums } from './verify-checksums.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/media/md5sum-to-json.mjs <sums.txt>');
  process.exit(1);
}
const map = parseMd5Sums(readFileSync(path, 'utf-8'));
process.stdout.write(JSON.stringify(Object.fromEntries(map)));
