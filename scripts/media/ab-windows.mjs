/**
 * scripts/media/ab-windows.mjs — Job B v2 · B6 helper.
 *
 * Parse an ffmpeg ebur128 frame log and print two integers on one line:
 *   <loudest-90s-window-start> <first-pause>=3s-start>
 * both in whole seconds, for ab-clips.sh to slice.
 *
 * ebur128 prints lines like:
 *   [Parsed_ebur128_0 @ ..] t: 12.3   M: -20.1 S: -19.8 I: -18.2 LUFS ...
 * We use the per-frame Momentary (M) loudness at time t. The loudest 90 s
 * window is the 90 s span with the highest mean M; a "pause" is a run of ≥ 3 s
 * where M is very low (≤ -50 LUFS, i.e. near silence).
 *
 * Usage: node scripts/media/ab-windows.mjs <ebur128-frames.log>
 * Exported parse/compute fns are unit-tested without a real log.
 */
import { readFileSync } from 'node:fs';

/** Parse "t: <sec> ... M: <lufs>" frames → [{ t, m }]. */
export function parseFrames(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const mt = /t:\s*([0-9.]+)/.exec(line);
    const mm = /M:\s*(-?[0-9.]+|-inf)/.exec(line);
    if (!mt || !mm) continue;
    const m = mm[1] === '-inf' ? -70 : parseFloat(mm[1]);
    out.push({ t: parseFloat(mt[1]), m });
  }
  return out;
}

/** Start second of the 90 s window with the highest mean Momentary loudness. */
export function loudestWindowStart(frames, win = 90) {
  if (!frames.length) return 0;
  let best = { start: 0, mean: -Infinity };
  for (let i = 0; i < frames.length; i++) {
    const t0 = frames[i].t;
    const span = frames.filter((f) => f.t >= t0 && f.t < t0 + win);
    if (!span.length) continue;
    const mean = span.reduce((s, f) => s + f.m, 0) / span.length;
    if (mean > best.mean) best = { start: Math.floor(t0), mean };
  }
  return best.start;
}

/** Start second of the first run of ≥ minLen s with M ≤ quiet (near silence). */
export function firstPauseStart(frames, minLen = 3, quiet = -50) {
  let runStart = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.m <= quiet) {
      if (runStart === null) runStart = f.t;
      if (f.t - runStart >= minLen) return Math.floor(runStart);
    } else {
      runStart = null;
    }
  }
  return 0; // no clear pause found → fall back to the start
}

function main() {
  const [, , logPath] = process.argv;
  const frames = parseFrames(readFileSync(logPath, 'utf-8'));
  process.stdout.write(`${loudestWindowStart(frames)} ${firstPauseStart(frames)}\n`);
}
if (process.argv[1] && process.argv[1].endsWith('ab-windows.mjs')) main();
