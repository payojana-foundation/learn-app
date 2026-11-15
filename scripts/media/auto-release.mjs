/**
 * scripts/media/auto-release.mjs — PART 5 (coordinator decision 15 Nov): release every
 * converted lesson that passed the pre-check, audio AND video, after each approve-check /
 * video-approve-check run, when the repo variable AUTO_APPROVE_PASSING is "true"
 * (workflow .github/workflows/auto-release.yml; off = nothing automatic).
 *
 * Audio: approve-manifest `allPassingIds` on data/media-manifest.json +
 *        data/queues/approve/precheck.json (same rule as approve-media all-passing).
 * Video: `allPassingIds` on data/video-manifest.json + data/queues/approve-video/precheck.json,
 *        and ONLY when the video's lesson AUDIO is approved (after this run's audio step).
 *        A lesson's video = mp4_link, else minicourse_link (video queues rule).
 * Never approves a flagged, pending, re-converted or failed (no entry) lesson.
 * Reviewer recorded: "auto-release".
 *
 * Usage: node scripts/media/auto-release.mjs [--dry-run] [--video]
 * Prints ONE summary line (also to the step summary) and AUDIO_APPROVED=/VIDEO_APPROVED=.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { allPassingIds, applyDecision } from './approve-manifest.mjs';
import { parseCsvObjects } from '../master/csv.mjs';
import { sourceIdOf } from '../master/sync.mjs';
import { videoLessons } from './video-inventory.mjs';

export const REVIEWER = 'auto-release';
const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');

/** video drive id -> audio source ids of the lessons that use it. Pure. */
export function audioIdsByVideo(rows) {
  const audioOf = new Map(); // row_key -> audio source id
  for (const r of rows || []) audioOf.set(r.row_key, sourceIdOf(r));
  const out = new Map();
  for (const l of videoLessons(rows)) {
    const a = audioOf.get(l.row_key);
    if (!out.has(l.video_id)) out.set(l.video_id, new Set());
    if (a) out.get(l.video_id).add(a);
  }
  return out;
}

/**
 * Pure. → { audio: {manifest, ids, skipped}, video: {manifest, ids, skipped, waitingAudio} }
 * A video is released only when at least one lesson that uses it has approved audio.
 */
export function autoRelease({ audioManifest, audioPrecheck, videoManifest, videoPrecheck, rows, date, video = true }) {
  const a = allPassingIds(audioManifest, audioPrecheck);
  const aRes = applyDecision(audioManifest, a.ids, REVIEWER, 'approved', date);
  const approvedAudio = new Set(aRes.manifest.filter(isApproved).map((e) => e.drive_file_id));
  let v = { manifest: videoManifest, ids: [], skipped: {}, waitingAudio: [] };
  if (video && Array.isArray(videoManifest) && videoPrecheck) {
    const p = allPassingIds(videoManifest, videoPrecheck);
    const byVideo = audioIdsByVideo(rows);
    const ok = [];
    const waitingAudio = [];
    for (const id of p.ids) {
      const audios = byVideo.get(id) || new Set();
      if ([...audios].some((x) => approvedAudio.has(x))) ok.push(id);
      else waitingAudio.push(id);
    }
    const vRes = applyDecision(videoManifest, ok, REVIEWER, 'approved', date);
    v = { manifest: vRes.manifest, ids: vRes.applied, skipped: p.skipped, waitingAudio };
  }
  return { audio: { manifest: aRes.manifest, ids: aRes.applied, skipped: a.skipped }, video: v };
}

/** One-line run summary. Pure. */
export function summaryLine(r, date, video) {
  const s = r.audio.skipped;
  const a = `audio approved ${r.audio.ids.length} (held: flagged ${s.flagged.length}, not checked ${s.pending.length}, re-converted ${s.changed.length})`;
  if (!video) return `${date} · auto-release · ${a} · video off`;
  const vs = r.video.skipped || {};
  const v = `video approved ${r.video.ids.length} (held: flagged ${(vs.flagged || []).length}, audio not approved ${r.video.waitingAudio.length})`;
  return `${date} · auto-release · ${a} · ${v}`;
}

const json = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);

function main() {
  const dry = process.argv.includes('--dry-run');
  const video = process.argv.includes('--video');
  const date = new Date().toISOString().slice(0, 10);
  const AM = 'data/media-manifest.json';
  const VM = 'data/video-manifest.json';
  const r = autoRelease({
    audioManifest: json(AM, []),
    audioPrecheck: json('data/queues/approve/precheck.json', null),
    videoManifest: json(VM, []),
    videoPrecheck: json('data/queues/approve-video/precheck.json', null),
    rows: parseCsvObjects(readFileSync('data/master/lessons.csv', 'utf-8')),
    date,
    video,
  });
  if (!dry) {
    if (r.audio.ids.length) writeFileSync(AM, JSON.stringify(r.audio.manifest, null, 2) + '\n', 'utf-8');
    if (video && r.video.ids.length) writeFileSync(VM, JSON.stringify(r.video.manifest, null, 2) + '\n', 'utf-8');
  }
  const line = (dry ? 'DRY RUN · ' : '') + summaryLine(r, date, video);
  console.log(line);
  console.log(`AUDIO_APPROVED=${dry ? 0 : r.audio.ids.length}`);
  console.log(`VIDEO_APPROVED=${dry ? 0 : r.video.ids.length}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `audio=${dry ? 0 : r.audio.ids.length}\nvideo=${dry ? 0 : r.video.ids.length}\nline=${line}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('auto-release.mjs')) main();
