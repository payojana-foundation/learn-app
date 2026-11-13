/**
 * scripts/media/video-precheck.mjs — PART V3: pre-approval check of every video
 * entry in data/video-manifest.json that is not approved yet. Same rules as the
 * audio check (scripts/media/precheck.mjs constants) where they apply to video:
 *   duration   under 5 min or over 4 h;
 *   source     the encoded duration differs > 2 % from the source duration that
 *              transcode-video.sh measured (src_duration_s); missing = flag;
 *   duplicate  same sha256 as another video entry, or the same Drive source
 *              file (source_md5) under another Drive id.
 * No network: every input is in the manifest. The audio check, its state file
 * and its report are not touched.
 *
 * Writes data/queues/approve-video/precheck.json (results.pass/flagged/pending,
 * the shape approve-manifest.mjs `allPassingIds` reads) and FLAGGED.md.
 * Usage: node scripts/media/video-precheck.mjs [--today YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_S, MAX_S, DRIFT } from './precheck.mjs';
import { isVideoKey } from './append-video-manifest.mjs';

const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');
const isRejected = (e) => /^rejected\b/i.test((e && e.status) || '');

/** Unapproved, unrejected video entries. Pure. */
export function videoCandidates(manifest) {
  return (Array.isArray(manifest) ? manifest : []).filter((e) => e && e.kind === 'video' && isVideoKey(e.key) && !isApproved(e) && !isRejected(e));
}

const countBy = (list, f) => {
  const m = new Map();
  for (const e of list) { const k = f(e); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

/** Flags of one entry. Pure. */
export function evaluateVideo(e, sha, md5ById) {
  const flags = [];
  const d = Number(e.duration_s);
  const s = Number(e.src_duration_s);
  if (!(d >= MIN_S)) flags.push(`duration ${d} s is under 5 min`);
  if (d > MAX_S) flags.push(`duration ${d} s is over 4 h`);
  if (!(s > 0)) flags.push('source duration unknown');
  else if (Math.abs(d - s) / s > DRIFT) flags.push(`duration ${d} s differs more than 2 % from the source (${s} s)`);
  if (e.sha256 && (sha.get(e.sha256) || 0) > 1) flags.push('same video (sha256) as another lesson');
  const ids = md5ById.get(e.source_md5) || new Set();
  if (ids.size > 1) flags.push('same source file as another Drive id');
  return flags;
}

/** { pass:[{id,sha256}], flagged:[{id,reasons}], pending:[] }. Pure. */
export function videoResults(manifest) {
  const all = (Array.isArray(manifest) ? manifest : []).filter((e) => e && e.kind === 'video');
  const sha = countBy(all, (e) => e.sha256);
  const md5ById = new Map();
  for (const e of all) {
    if (!e.source_md5) continue;
    if (!md5ById.has(e.source_md5)) md5ById.set(e.source_md5, new Set());
    md5ById.get(e.source_md5).add(e.drive_file_id);
  }
  const pass = [], flagged = [];
  for (const e of videoCandidates(manifest)) {
    const reasons = evaluateVideo(e, sha, md5ById);
    if (reasons.length) flagged.push({ id: e.drive_file_id, key: e.key, reasons });
    else pass.push({ id: e.drive_file_id, key: e.key, sha256: e.sha256 });
  }
  return { pass, flagged, pending: [] };
}

export function renderVideoFlagged(res, today) {
  const L = ['# Video pre-approval check', ''];
  L.push(`Generated ${today} by scripts/media/video-precheck.mjs: **${res.pass.length} pass**, **${res.flagged.length} flagged**.`, '');
  L.push('Flagged videos are never approved by approve-media "all-passing" (media = video); watch and decide per id.', '');
  L.push('| drive id | key | reason |', '| --- | --- | --- |');
  for (const f of res.flagged) L.push(`| ${f.id} | ${f.key} | ${f.reasons.join('; ').replace(/\|/g, '\\|')} |`);
  if (!res.flagged.length) L.push('| — | — | none |');
  return L.join('\n') + '\n';
}

function main() {
  const root = process.cwd();
  const i = process.argv.indexOf('--today');
  const today = i > 0 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
  const mp = join(root, 'data', 'video-manifest.json');
  const manifest = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf-8')) : [];
  const res = videoResults(manifest);
  const dir = join(root, 'data', 'queues', 'approve-video');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'precheck.json'), JSON.stringify({ version: 1, generated: today, rules: { min_s: MIN_S, max_s: MAX_S, drift: DRIFT }, results: res }, null, 2) + '\n', 'utf-8');
  writeFileSync(join(dir, 'FLAGGED.md'), renderVideoFlagged(res, today), 'utf-8');
  console.log(`video precheck: pass ${res.pass.length} · flagged ${res.flagged.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('video-precheck.mjs')) main();
