/**
 * scripts/media/video-plan.mjs — PART V3: plan a course-video run. Same rules as
 * queue-plan.mjs (queue order, skip ids already done, cap at limit) but "done"
 * means an entry in data/video-manifest.json with a video key of THIS rendition.
 *
 * Usage: node scripts/media/video-plan.mjs <queue.csv> <video-manifest.json> <limit> <rendition>
 */
import { readFileSync, existsSync } from 'node:fs';
import { parseQueue, checkQueue } from './queue-plan.mjs';
import { isVideoKey } from './append-video-manifest.mjs';

/** drive ids with a video entry of `rendition`. Pure. */
export function videoManifestIds(manifest, rendition) {
  const s = new Set();
  for (const e of Array.isArray(manifest) ? manifest : []) {
    if (e && e.drive_file_id && isVideoKey(e.key) && (!rendition || e.rendition === rendition)) s.add(e.drive_file_id);
  }
  return s;
}

/** { toProcess, skipped, remaining }. Pure. */
export function planVideoRun(queueIds, manifest, limit, rendition) {
  const have = videoManifestIds(manifest, rendition);
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  const toProcess = [], skipped = [], remaining = [];
  for (const id of queueIds || []) {
    if (have.has(id)) skipped.push(id);
    else if (toProcess.length < lim) toProcess.push(id);
    else remaining.push(id);
  }
  return { toProcess, skipped, remaining };
}

function main() {
  const [, , q, m, lim, rendition] = process.argv;
  const text = q && existsSync(q) ? readFileSync(q, 'utf-8') : null;
  const err = checkQueue(q, text, []);
  if (err) { console.error('::error title=Queue file::' + err); process.exit(1); }
  if (!/^(480p|720p)$/.test(rendition || '')) { console.error('::error title=Rendition::set the repo variable VIDEO_RENDITION to 480p or 720p'); process.exit(1); }
  const manifest = m && existsSync(m) ? JSON.parse(readFileSync(m, 'utf-8')) : [];
  process.stdout.write(JSON.stringify(planVideoRun(parseQueue(text), manifest, Number(lim), rendition)) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('video-plan.mjs')) main();
