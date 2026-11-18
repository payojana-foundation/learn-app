/**
 * scripts/queues/link-changes.mjs — PART 11e (18 Nov): a lesson's file link changed.
 *
 * data/master/lesson-sources.json remembers, per lesson ROW (row_key: stable even when the
 * lesson_id is d-<drive id>), the Drive file id and R2 key it was last released with.
 * Each master-export (before the build):
 *   - row with a remembered source whose current source id (sourceIdOf) differs → a link change:
 *       new id not converted yet → appended to data/queues/<course>.csv (once) for course-autorun;
 *       new id converted, not approved → waits (pre-check + auto-release as any new file);
 *       new id APPROVED → the remembered source becomes the new one, and the OLD R2 key is listed
 *         in data/queues/orphans-pending.txt (never deleted here) unless another lesson still uses it.
 *   - row with an approved source and nothing remembered → remembered.
 * Pending changes go to data/queues/link-changes.json (row_key, course, old → new, state).
 * Old media stays live only if the app is allowed to show it (protected P-19: today a lesson is
 * shown only by its CURRENT link's approved file — see the report).
 *
 * Usage: node scripts/queues/link-changes.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../master/csv.mjs';
import { sourceIdOf } from '../master/sync.mjs';
import { parseQueue } from '../media/queue-plan.mjs';
import { appendText } from './intake-queues.mjs';

const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');

/**
 * Pure. rows: master rows; manifest; prev: {row_key: {drive_file_id, key}}; queued: Set(ids);
 * orphansListed: Set(keys). → { sources, queueAdds: [{course_id, id}], orphans: [key], pending: [...] }
 */
export function linkChanges(rows, manifest, prev = {}, queued = new Set(), orphansListed = new Set()) {
  const byId = new Map((manifest || []).filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const sources = { ...prev };
  const queueAdds = [];
  const orphans = [];
  const pending = [];
  const q = new Set(queued);
  for (const r of rows || []) {
    if (!r.row_key || !r.course_id) continue;
    const id = sourceIdOf(r);
    const e = id && byId.get(id);
    const old = prev[r.row_key];
    if (!old) {
      if (e && isApproved(e)) sources[r.row_key] = { drive_file_id: id, key: e.key };
      continue;
    }
    if (!id || id === old.drive_file_id) continue;
    if (e && isApproved(e)) {
      sources[r.row_key] = { drive_file_id: id, key: e.key };
      continue; // old key decided after the loop (another row may still use it)
    }
    let state;
    if (!e) {
      state = 'converting';
      if (!q.has(id) && /^c\d{3}$/.test(r.course_id)) { queueAdds.push({ course_id: r.course_id, id }); q.add(id); }
    } else state = 'waiting for approval';
    pending.push({ row_key: r.row_key, course_id: r.course_id, old: old.drive_file_id, new: id, old_key: old.key, state });
  }
  const stillUsed = new Set(Object.values(sources).map((s) => s.key));
  for (const [rk, old] of Object.entries(prev)) {
    const now = sources[rk];
    if (now && now.drive_file_id !== old.drive_file_id && old.key && !stillUsed.has(old.key) && !orphansListed.has(old.key) && !orphans.includes(old.key)) orphans.push(old.key);
  }
  return { sources, queueAdds, orphans, pending };
}

function main() {
  const root = process.cwd();
  const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
  const rows = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'lessons.csv'), 'utf-8'));
  const manifest = read(join(root, 'data', 'media-manifest.json'), []);
  const srcPath = join(root, 'data', 'master', 'lesson-sources.json');
  const prevFile = read(srcPath, { sources: {} });
  const dir = join(root, 'data', 'queues');
  const queued = new Set();
  for (const f of readdirSync(dir).filter((x) => /^c\d{3}\.csv$/.test(x))) for (const id of parseQueue(readFileSync(join(dir, f), 'utf-8'))) queued.add(id);
  const orphPath = join(dir, 'orphans-pending.txt');
  const listed = new Set(existsSync(orphPath) ? readFileSync(orphPath, 'utf-8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')) : []);
  const r = linkChanges(rows, manifest, prevFile.sources || {}, queued, listed);
  for (const { course_id, id } of r.queueAdds) {
    const p = join(dir, `${course_id}.csv`);
    writeFileSync(p, appendText(existsSync(p) ? readFileSync(p, 'utf-8') : '', [id]), 'utf-8');
  }
  if (r.orphans.length) {
    const head = existsSync(orphPath) ? '' : '# R2 keys no lesson uses any more after a link change (scripts/queues/link-changes.mjs). Never deleted automatically.\n';
    appendFileSync(orphPath, head + r.orphans.map((k) => k + '\n').join(''), 'utf-8');
  }
  const sorted = Object.fromEntries(Object.entries(r.sources).sort((a, b) => a[0].localeCompare(b[0])));
  writeFileSync(srcPath, JSON.stringify({ _doc: 'Per lesson row (row_key): the Drive file id and R2 key it was last released with. Written by scripts/queues/link-changes.mjs.', sources: sorted }, null, 2) + '\n', 'utf-8');
  writeFileSync(join(dir, 'link-changes.json'), JSON.stringify({ pending: r.pending }, null, 2) + '\n', 'utf-8');
  console.log(`link changes: ${r.pending.length} pending (${r.queueAdds.length} queued now), ${r.orphans.length} old key(s) listed as orphans-pending`);
}

if (process.argv[1] && process.argv[1].endsWith('link-changes.mjs')) main();
