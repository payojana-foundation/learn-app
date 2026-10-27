/**
 * scripts/media/queue-plan.mjs — plan a course-audio batch run (Q3,
 * course-audio.yml). Pure + testable: given the queue CSV of Drive file ids,
 * the current media-manifest, and `limit`, it decides which ids to process this
 * run and which to skip (already in the manifest).
 *
 * The transcode loop itself (ffprobe/ffmpeg/rclone, concurrency, the
 * max_minutes time budget) lives in the workflow; this module owns the "what to
 * do" decision so it can be unit-tested with fixtures.
 *
 * Queue CSV format: one `drive_file_id` per line. A header line
 * `drive_file_id` is ignored; blank lines and `#` comments are ignored. An
 * empty queue → an empty plan ("nothing to do").
 */

import { readFileSync, existsSync } from 'node:fs';

/** Parse the queue CSV into an ordered, de-duplicated list of drive_file_ids. */
export function parseQueue(text) {
  const ids = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^drive_file_id$/i.test(line)) continue; // header
    // Tolerate a trailing comma / extra columns: take the first field.
    const id = line.split(',')[0].trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The set of drive_file_ids already present in the media-manifest (any status). */
export function manifestDriveIds(manifest) {
  const set = new Set();
  for (const e of Array.isArray(manifest) ? manifest : []) {
    if (e && e.drive_file_id) set.add(e.drive_file_id);
  }
  return set;
}

/**
 * Decide the plan for this run.
 *   queueIds  — ordered ids from parseQueue
 *   manifest  — current media-manifest array (may be empty/missing)
 *   limit     — max ids to process this run (>=1)
 * Returns { toProcess[], skipped[], remaining[] }:
 *   toProcess — the first `limit` ids not already in the manifest
 *   skipped   — ids skipped because they are already in the manifest
 *   remaining — queued ids left for the next run (beyond `limit`, not skipped)
 */
export function planRun(queueIds, manifest, limit) {
  const have = manifestDriveIds(manifest);
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  const toProcess = [];
  const skipped = [];
  const remaining = [];
  for (const id of Array.isArray(queueIds) ? queueIds : []) {
    if (have.has(id)) {
      skipped.push(id);
      continue;
    }
    if (toProcess.length < lim) toProcess.push(id);
    else remaining.push(id);
  }
  return { toProcess, skipped, remaining };
}

/**
 * Render the end-of-run summary as a Markdown table. Pure.
 *   results — [{ id, status: 'done'|'skipped'|'failed', reason? }]
 */
export function summaryTable(results) {
  const list = Array.isArray(results) ? results : [];
  const L = [];
  L.push('| drive_file_id | status | reason |');
  L.push('| --- | --- | --- |');
  for (const r of list) {
    const reason = (r.reason ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    L.push(`| ${r.id} | ${r.status} | ${reason} |`);
  }
  const counts = list.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  L.push('');
  L.push(`done ${counts.done || 0} · skipped ${counts.skipped || 0} · failed ${counts.failed || 0}`);
  return L.join('\n') + '\n';
}

/** Load + plan from file paths (used by the workflow via CLI). */
export function planFromFiles(queuePath, manifestPath, limit) {
  const queueText = existsSync(queuePath) ? readFileSync(queuePath, 'utf-8') : '';
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : [];
  return planRun(parseQueue(queueText), manifest, limit);
}

function main() {
  const [, , queuePath, manifestPath, limitArg] = process.argv;
  if (!queuePath) {
    console.error('Usage: node scripts/media/queue-plan.mjs <queue.csv> <manifest.json> [limit]');
    process.exit(1);
  }
  const plan = planFromFiles(queuePath, manifestPath ?? 'data/media-manifest.json', Number(limitArg ?? 5));
  process.stdout.write(JSON.stringify(plan) + '\n');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('queue-plan.mjs')) main();
