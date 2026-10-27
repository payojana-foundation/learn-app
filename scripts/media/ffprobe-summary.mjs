/**
 * scripts/media/ffprobe-summary.mjs — summarise ffprobe JSON for the media
 * inventory (Q2, media-inventory.yml). Reads ffprobe `-show_streams
 * -show_format` JSON on stdin and prints one line:
 *
 *   <duration_s>|<has_video>|<has_audio>|<codec>
 *
 * - duration_s: integer seconds from format.duration (0 if absent/unreadable).
 * - has_video: true when a real video stream exists (cover-art pictures do NOT
 *   count — same rule as ffprobe-decide.mjs).
 * - has_audio: true when any audio stream exists.
 * - codec: the first audio stream's codec_name, else the first real video's,
 *   else "".
 *
 * Pure `summarise` is exported for fixture tests; `main` wires stdin → stdout.
 */

/** Attached-picture video streams (cover art) are not "real" video. */
function isCoverArt(stream) {
  return !!(stream.disposition && stream.disposition.attached_pic === 1);
}

/** @returns { duration_s, has_video, has_audio, codec } */
export function summarise(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const audio = streams.find((s) => s.codec_type === 'audio');
  const realVideo = streams.find((s) => s.codec_type === 'video' && !isCoverArt(s));
  const durRaw = Number(probe?.format?.duration);
  const duration_s = Number.isFinite(durRaw) ? Math.floor(durRaw) : 0;
  const codec = audio?.codec_name ?? realVideo?.codec_name ?? '';
  return {
    duration_s,
    has_video: !!realVideo,
    has_audio: !!audio,
    codec,
  };
}

/** Format the summary as the pipe-delimited line the workflow parses. */
export function summaryLine(probe) {
  const s = summarise(probe);
  return `${s.duration_s}|${s.has_video}|${s.has_audio}|${s.codec}`;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let probe = {};
    try {
      probe = JSON.parse(input || '{}');
    } catch {
      probe = {};
    }
    process.stdout.write(summaryLine(probe) + '\n');
    process.exit(0);
  });
}

if (process.argv[1] && process.argv[1].endsWith('ffprobe-summary.mjs')) main();
