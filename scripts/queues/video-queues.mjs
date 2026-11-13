/**
 * scripts/queues/video-queues.mjs — PART V3: write one video queue per course,
 * data/queues/video/<course_id>.csv (header drive_file_id), from
 * data/master/lessons.csv. A lesson's video = first Drive id in mp4_link, else
 * in minicourse_link (scripts/media/video-inventory.mjs `videoLessons`). Rows
 * without a course id are left out; an id is listed once per course, in lesson
 * order. Audio queues (data/queues/c###.csv) are not touched. A file is only
 * (re)written, never deleted.
 *
 * Usage: node scripts/queues/video-queues.mjs [--check]
 *   --check  exit 1 when a written file would change (CI drift check)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../master/csv.mjs';
import { videoLessons } from '../media/video-inventory.mjs';

/** Map course_id → ordered unique video ids. Pure. */
export function videoQueues(rows) {
  const out = new Map();
  for (const l of videoLessons(rows)) {
    if (!/^c\d{3}$/.test(l.course_id || '')) continue;
    if (!out.has(l.course_id)) out.set(l.course_id, []);
    const ids = out.get(l.course_id);
    if (!ids.includes(l.video_id)) ids.push(l.video_id);
  }
  return new Map([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

export const queueText = (ids) => ['drive_file_id', ...ids].join('\n') + '\n';

function main() {
  const root = process.cwd();
  const check = process.argv.includes('--check');
  const rows = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'lessons.csv'), 'utf-8'));
  const dir = join(root, 'data', 'queues', 'video');
  mkdirSync(dir, { recursive: true });
  let changed = 0, total = 0;
  const qs = videoQueues(rows);
  for (const [cid, ids] of qs) {
    total += ids.length;
    const p = join(dir, `${cid}.csv`);
    const text = queueText(ids);
    if (existsSync(p) && readFileSync(p, 'utf-8') === text) continue;
    changed++;
    if (!check) writeFileSync(p, text, 'utf-8');
  }
  console.log(`video queues: ${qs.size} courses, ${total} videos, ${changed} file(s) ${check ? 'would change' : 'written'}`);
  if (check && changed) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('video-queues.mjs')) main();
