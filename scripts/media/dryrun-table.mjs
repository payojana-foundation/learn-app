/**
 * scripts/media/dryrun-table.mjs — course-audio dry-run summary table (3 Nov).
 * One row per part: part | I1 | TP1 | loops | final G | I_lim or I_cap | depth |
 * busy | expected result. `part` is the id's 1-based position in the queue CSV
 * (pilot queue = lesson order); an id not in the queue shows its id instead.
 *
 * Usage: node scripts/media/dryrun-table.mjs <queue.csv> [dir-with-dryrun-*.json]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseQueue } from './queue-plan.mjs';

const f2 = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2));

/** Pure: rows = parsed dryrun-<id>.json objects; queueIds = ordered ids. */
export function dryTable(rows, queueIds = []) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => {
    const idx = queueIds.indexOf(r.id);
    return { r, idx: idx < 0 ? Infinity : idx, part: idx < 0 ? r.id : String(idx + 1) };
  });
  list.sort((a, b) => a.idx - b.idx);
  const L = [];
  L.push('| part | I1 | TP1 | loops | final G | I_lim or I_cap | depth | busy | expected result |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { r, part } of list) {
    L.push(`| ${part} | ${f2(r.I1)} | ${f2(r.TP1)} | ${r.loop ?? '—'} | ${f2(r.G)} | ${f2(r.I_final)} | ${f2(r.depth)} | ${f2(r.busy)} | ${r.result ?? '—'} |`);
  }
  return L.join('\n') + '\n';
}

function main() {
  const [, , queuePath, dir = '.'] = process.argv;
  if (!queuePath) {
    console.error('Usage: node scripts/media/dryrun-table.mjs <queue.csv> [dir]');
    process.exit(1);
  }
  const queue = existsSync(queuePath) ? parseQueue(readFileSync(queuePath, 'utf-8')) : [];
  const rows = readdirSync(dir)
    .filter((f) => /^dryrun-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')));
  process.stdout.write(dryTable(rows, queue));
}
if (process.argv[1] && process.argv[1].endsWith('dryrun-table.mjs')) main();
