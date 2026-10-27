/**
 * scripts/media/ffprobe-decide.mjs — decide a Drive file's real media type
 * from ffprobe JSON (Job B, course-audio.yml).
 *
 * Some course files on Drive are named `.mp3` but are actually videos. ffprobe
 * is the source of truth: if there is any video stream (that is not just album
 * art), the file is a VIDEO and only its audio track is streamed and
 * transcoded; otherwise it is AUDIO.
 *
 * Usage:
 *   ffprobe -v quiet -print_format json -show_streams <input> > probe.json
 *   node scripts/media/ffprobe-decide.mjs probe.json
 * prints "audio" or "video" and exits 0; exits 1 if there is no audio stream
 * at all (nothing to transcode).
 */

import { readFileSync } from 'node:fs';

/** Attached-picture video streams (cover art) are not "real" video. */
function isCoverArt(stream) {
  return stream.disposition && stream.disposition.attached_pic === 1;
}

/**
 * Decide the media type from parsed ffprobe output.
 * @returns 'video' | 'audio'
 * @throws if there is no audio stream to transcode.
 */
export function decideType(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  if (!hasAudio) throw new Error('no audio stream found — nothing to transcode');
  const hasRealVideo = streams.some((s) => s.codec_type === 'video' && !isCoverArt(s));
  return hasRealVideo ? 'video' : 'audio';
}

function main() {
  const [, , probePath] = process.argv;
  if (!probePath) {
    console.error('Usage: node scripts/media/ffprobe-decide.mjs <probe.json>');
    process.exit(1);
  }
  let type;
  try {
    type = decideType(JSON.parse(readFileSync(probePath, 'utf-8')));
  } catch (err) {
    console.error(err?.message ?? String(err));
    process.exit(1);
  }
  console.log(type);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('ffprobe-decide.mjs')) main();
