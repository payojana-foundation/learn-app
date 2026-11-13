/**
 * scripts/media/video-test.mjs — PART V2: test encode of a few lessons.
 *
 * Picks N lessons of mixed Drive size (evenly spaced over the size order), the
 * workflow (video-test.yml) encodes each to 480p and 720p (H.264 libx264
 * `-preset veryfast`, AAC, `-movflags +faststart`, never upscaled), measures
 * output size, encode wall time and SSIM against the source scaled to the same
 * frame size, and this script writes reports/video-test.md. NOTHING is uploaded
 * to R2.
 *
 * Usage:
 *   node scripts/media/video-test.mjs pick <lessons.csv> <meta.json> <n> <out picks.tsv>
 *   node scripts/media/video-test.mjs report <results.ndjson> <out.md>
 *
 * results.ndjson line: { id, rendition, src_bytes, src_height, duration_s,
 *   out_bytes, out_height, encode_s, ssim }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects } from '../master/csv.mjs';
import { videoLessons } from './video-inventory.mjs';

export const RENDITIONS = ['480p', '720p'];
export const SSIM_OK = 0.95;

/** Evenly spaced picks over the size order (smallest … largest), unique ids. Pure. */
export function pickMixed(metas, n) {
  const list = (metas || []).filter((m) => m && m.ok && m.size > 0).sort((a, b) => a.size - b.size || String(a.id).localeCompare(String(b.id)));
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Map(out.map((m) => [m.id, m])).values()];
}

/** Only the chosen video files of lessons (not the second column). Pure. */
export function chosenMetas(rows, metas) {
  const want = new Set(videoLessons(rows).map((l) => l.video_id));
  return (metas || []).filter((m) => want.has(m.id));
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Aggregate per rendition. Pure. */
export function aggregate(results) {
  const by = {};
  for (const r of RENDITIONS) {
    const rs = (results || []).filter((x) => x.rendition === r && x.duration_s > 0 && x.out_bytes > 0);
    const hours = rs.reduce((a, x) => a + x.duration_s, 0) / 3600;
    const mb = rs.reduce((a, x) => a + x.out_bytes, 0) / 1e6;
    const enc = rs.reduce((a, x) => a + x.encode_s, 0) / 60;
    by[r] = {
      files: rs.length,
      hours,
      mbPerHour: hours ? mb / hours : NaN,
      encodeMinPerHour: hours ? enc / hours : NaN,
      ssimMedian: median(rs.map((x) => x.ssim)),
      ssimMin: rs.length ? Math.min(...rs.map((x) => x.ssim).filter(Number.isFinite)) : NaN,
      upscaleAvoided: rs.filter((x) => x.src_height && x.src_height < Number(r.replace('p', ''))).length,
    };
  }
  return by;
}

/**
 * Recommendation rule (stated in the report): the smaller rendition whose
 * median SSIM ≥ SSIM_OK; none passing → "review by eye". Pure.
 */
export function recommend(agg) {
  for (const r of RENDITIONS) if (agg[r] && agg[r].files && agg[r].ssimMedian >= SSIM_OK) return r;
  return null;
}

const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

/** Markdown report. Pure. */
export function buildReport(results, opts = {}) {
  const agg = aggregate(results);
  const rec = recommend(agg);
  const L = [];
  L.push('# Video test encode (PART V2)');
  L.push('');
  L.push(`Encoder: H.264 libx264 \`-preset veryfast\` CRF ${opts.crf ?? 'n/a'}, AAC ${opts.audio ?? 'n/a'}, \`-movflags +faststart\`;`);
  L.push('never upscaled (a source below the target keeps its height). Measured on a GitHub');
  L.push('`ubuntu-latest` runner. Nothing was uploaded to R2.');
  L.push('');
  L.push('| rendition | files | hours | MB per hour | encode min per hour of video | SSIM median | SSIM min | sources below target |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of RENDITIONS) {
    const a = agg[r];
    L.push(`| ${r} | ${a.files} | ${f(a.hours, 2)} | ${f(a.mbPerHour, 0)} | ${f(a.encodeMinPerHour, 1)} | ${f(a.ssimMedian, 3)} | ${f(a.ssimMin, 3)} | ${a.upscaleAvoided} |`);
  }
  L.push('');
  L.push('## Quality note');
  L.push('');
  L.push(`SSIM compares each output with its source scaled to the same frame size (first ${opts.ssimSeconds ?? 'n/a'} s).`);
  L.push('1.000 = identical; it measures encode loss, not how sharp the picture looks on a phone.');
  L.push('A person should still watch one 480p and one 720p file on a phone before approving.');
  L.push('');
  L.push('## Recommendation (one rendition)');
  L.push('');
  L.push(`Rule: the smaller rendition whose median SSIM ≥ ${SSIM_OK}.`);
  L.push(rec ? `**${rec}**` : '**none passed: review by eye**');
  L.push('');
  L.push('## Per file');
  L.push('');
  L.push('| drive id | rendition | source MB | source height | minutes | output MB | output height | encode s | SSIM |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of results || []) {
    L.push(`| \`${x.id}\` | ${x.rendition} | ${f(x.src_bytes / 1e6, 0)} | ${x.src_height || 'n/a'} | ${f(x.duration_s / 60, 1)} | ${f(x.out_bytes / 1e6, 1)} | ${x.out_height || 'n/a'} | ${f(x.encode_s, 0)} | ${f(x.ssim, 3)} |`);
  }
  L.push('');
  return { md: L.join('\n'), agg, rec };
}

/** Parse ffmpeg's ssim filter log ("… All:0.981234 (17.2)") → number or NaN. Pure. */
export function parseSsim(text) {
  const m = /All:([0-9.]+)/.exec(String(text || '').split(/\r?\n/).filter((l) => l.includes('SSIM')).pop() || '');
  return m ? Number(m[1]) : NaN;
}

function main() {
  const [, , cmd, a, b, c, d] = process.argv;
  if (cmd === 'pick') {
    const rows = parseCsvObjects(readFileSync(a, 'utf8'));
    const picks = pickMixed(chosenMetas(rows, JSON.parse(readFileSync(b, 'utf8'))), Number(c) || 10);
    writeFileSync(d, picks.map((m) => [m.id, m.size, m.height || 0].join('\t')).join('\n') + '\n');
    console.log(`video-test: picked ${picks.length} files`);
  } else if (cmd === 'ssim') {
    process.stdout.write(String(parseSsim(readFileSync(a, 'utf8'))));
  } else if (cmd === 'report') {
    const results = readFileSync(a, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const { md, rec } = buildReport(results, { crf: process.env.CRF, audio: process.env.AUDIO_BITRATE, ssimSeconds: process.env.SSIM_SECONDS });
    writeFileSync(b, md);
    console.log(`video-test: ${results.length} encodes; recommendation ${rec || 'none'}`);
  } else {
    console.error('Usage: video-test.mjs pick|ssim|report …');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('video-test.mjs')) main();
