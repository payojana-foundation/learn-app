/**
 * scripts/queues/intake-queues.mjs — PART 3 (16 Nov): put lessons the team added in the master
 * sheet into the conversion queues, so course-autorun converts them and auto-release releases
 * them when they pass. Run by master-export after the export (data/master/lessons.csv).
 *
 * Audio: every row the team added (no source_file) with a course_id and a source file id that
 * is not in data/media-manifest.json and not already in any audio queue is APPENDED to
 * data/queues/<course_id>.csv (created with the header drive_file_id). Existing lines are never
 * reordered or removed; seeded rows are left to the catalogue's queues as they are.
 * Video: data/queues/video/*.csv are rebuilt by scripts/queues/video-queues.mjs (separately).
 *
 * Usage: node scripts/queues/intake-queues.mjs   (prints how many ids were appended)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../master/csv.mjs';
import { sourceIdOf } from '../master/sync.mjs';
import { parseQueue } from '../media/queue-plan.mjs';

/** -> Map(course_id -> [ids to append]) in sheet order. Pure. */
export function queueAdds(rows, manifestIds, queued) {
  const out = new Map();
  const seen = new Set(queued);
  for (const r of rows) {
    if (String(r.source_file || '').trim() || !/^c\d{3}$/.test(r.course_id || '')) continue;
    const id = sourceIdOf(r);
    if (!id || manifestIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (!out.has(r.course_id)) out.set(r.course_id, []);
    out.get(r.course_id).push(id);
  }
  return out;
}

/** New text of a queue file: the old text (untouched) + the ids. Pure. */
export function appendText(oldText, ids) {
  const base = oldText && oldText.length ? (oldText.endsWith('\n') ? oldText : oldText + '\n') : 'drive_file_id\n';
  return base + ids.map((x) => x + '\n').join('');
}

function main() {
  const root = process.cwd();
  const rows = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'lessons.csv'), 'utf-8'));
  const manifest = JSON.parse(readFileSync(join(root, 'data', 'media-manifest.json'), 'utf-8'));
  const dir = join(root, 'data', 'queues');
  const queued = [];
  for (const f of readdirSync(dir).filter((x) => /^c\d{3}\.csv$/.test(x))) queued.push(...parseQueue(readFileSync(join(dir, f), 'utf-8')));
  const adds = queueAdds(rows, new Set(manifest.map((e) => e && e.drive_file_id)), queued);
  let n = 0;
  for (const [cid, ids] of adds) {
    const p = join(dir, `${cid}.csv`);
    writeFileSync(p, appendText(existsSync(p) ? readFileSync(p, 'utf-8') : '', ids), 'utf-8');
    n += ids.length;
  }
  console.log(`intake queues: appended ${n} id(s) to ${adds.size} queue(s)${adds.size ? ': ' + [...adds].map(([c, i]) => `${c} +${i.length}`).join(', ') : ''}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `queued=${n}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('intake-queues.mjs')) main();
