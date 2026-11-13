/**
 * scripts/media/append-video-manifest.mjs — PART V3: append ONE course-video
 * entry to data/video-manifest.json (course-video.yml). Separate from the audio
 * manifest on purpose: every audio reader keys data/media-manifest.json by
 * drive_file_id, and a lesson's video can share its Drive id with its approved
 * audio, so mixing kinds there could replace an audio entry.
 *
 * Every new entry is `kind: "video"` and DRAFT until a reviewer approves it
 * (approve-media.yml, media = video). A key is never overwritten: if the key is
 * already listed the manifest stays unchanged, except that a poster_key can be
 * filled in on an entry whose poster_key is still null (same key, same file).
 *
 * Usage: node scripts/media/append-video-manifest.mjs <manifest.json> <entry.json>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DRAFT_STATUS } from './append-manifest.mjs';

export const RENDITION_RE = '(480p|720p)';

/** video/<16 hex>-<rendition>[-vN].mp4 */
export function isVideoKey(key) {
  return new RegExp(`^video/[0-9a-f]{16}-${RENDITION_RE}(-v\\d+)?\\.mp4$`).test(String(key || ''));
}

export function validateVideoEntry(e) {
  const req = { kind: 'string', drive_file_id: 'string', source_md5: 'string', key: 'string', rendition: 'string', bytes: 'number', duration_s: 'number', src_duration_s: 'number', sha256: 'string' };
  for (const [f, t] of Object.entries(req)) if (typeof e?.[f] !== t) return `field "${f}" must be a ${t}`;
  if (e.kind !== 'video') return 'kind must be "video"';
  if (!/^[0-9a-f]{64}$/.test(e.sha256)) return 'sha256 must be 64 lowercase hex chars';
  const want = e.source_md5.toLowerCase().slice(0, 16);
  const m = new RegExp(`^video/${want}-${RENDITION_RE}(-v\\d+)?\\.mp4$`).exec(e.key);
  if (!m) return `key "${e.key}" must be video/${want}-<rendition>.mp4`;
  if (m[1] !== e.rendition) return `rendition "${e.rendition}" does not match the key`;
  if (e.poster_key != null && e.poster_key !== e.key.replace(/\.mp4$/, '.webp')) return 'poster_key must sit next to the video key (.webp)';
  return null;
}

/** Pure, idempotent append. */
export function appendVideoEntry(manifest, entry) {
  const list = Array.isArray(manifest) ? manifest : [];
  const i = list.findIndex((e) => e && e.key === entry.key);
  if (i >= 0) {
    if (list[i].poster_key == null && entry.poster_key) {
      const next = list.slice();
      next[i] = { ...list[i], poster_key: entry.poster_key };
      return next;
    }
    return list;
  }
  return [...list, { ...entry, status: DRAFT_STATUS }];
}

function main() {
  const [, , manifestPath, entryPath] = process.argv;
  if (!manifestPath || !entryPath) { console.error('Usage: append-video-manifest.mjs <manifest.json> <entry.json>'); process.exit(1); }
  const entry = JSON.parse(readFileSync(entryPath, 'utf-8'));
  const err = validateVideoEntry(entry);
  if (err) { console.error('bad entry:', err); process.exit(1); }
  const cur = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : [];
  const next = appendVideoEntry(cur, entry);
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  console.log(next === cur ? `key ${entry.key} already present — unchanged` : `video entry ${entry.key} saved (${next.length} entries)`);
}

if (process.argv[1] && process.argv[1].endsWith('append-video-manifest.mjs')) main();
