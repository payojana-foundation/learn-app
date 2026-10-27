/**
 * scripts/media/media-inventory.mjs — build the media inventory + gaps report
 * (Q2, media-inventory.yml). READ-ONLY discovery: it never moves, renames, or
 * deletes anything on Drive or R2.
 *
 * The workflow lists each Drive folder in data/media-folders.csv recursively,
 * collects per-file Drive metadata (id, name, mimeType, size, md5Checksum,
 * createdTime) and runs `ffprobe` over HTTP reading only the header bytes
 * (duration, has_video, has_audio, codec). It hands this script one JSON array
 * of entries; the script writes:
 *   - reports/media-inventory.csv  (one row per file)
 *   - reports/media-gaps.md        (problems: no audio track, name says .mp3 but
 *                                   has video, duplicates by md5, zero-size)
 *
 * The CSV columns and the gap rules live here (pure) so they are unit-tested
 * with a fixture; the workflow only gathers the raw inputs.
 *
 * Input entry shape (per file):
 *   { teacher_slug, folder_id, id, name, mimeType, size, md5Checksum,
 *     createdTime, duration_s, has_video, has_audio, codec }
 *
 * Usage:
 *   node scripts/media/media-inventory.mjs <entries.json> <outCsv> <outGapsMd>
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** Parse data/media-folders.csv (teacher_slug,drive_folder_id) → [{teacher_slug, drive_folder_id}]. */
export function parseFoldersCsv(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^teacher_slug\s*,\s*drive_folder_id$/i.test(line)) continue; // header
    const [teacher_slug, drive_folder_id] = line.split(',').map((s) => (s ?? '').trim());
    if (!teacher_slug || !drive_folder_id) continue;
    rows.push({ teacher_slug, drive_folder_id });
  }
  return rows;
}

export const INVENTORY_COLUMNS = [
  'teacher_slug',
  'folder_id',
  'id',
  'name',
  'mimeType',
  'size',
  'md5Checksum',
  'createdTime',
  'duration_s',
  'has_video',
  'has_audio',
  'codec',
];

/** Quote a CSV field (RFC4180): wrap in quotes and double embedded quotes. */
export function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the inventory CSV text from entries. Pure. */
export function buildInventoryCsv(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const header = INVENTORY_COLUMNS.join(',');
  const rows = list.map((e) => INVENTORY_COLUMNS.map((c) => csvField(e[c])).join(','));
  return [header, ...rows].join('\n') + '\n';
}

/** True when the Drive name ends in .mp3 (case-insensitive). */
export function nameSaysMp3(name) {
  return /\.mp3$/i.test(String(name || ''));
}

/**
 * Compute the gap lists from the entries. Pure.
 * Returns { noAudio[], mp3WithVideo[], duplicates: [{md5, files[]}], zeroSize[] }.
 */
export function computeGaps(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const noAudio = list.filter((e) => e.has_audio === false);
  const mp3WithVideo = list.filter((e) => nameSaysMp3(e.name) && e.has_video === true);
  const zeroSize = list.filter((e) => Number(e.size) === 0);

  const byMd5 = new Map();
  for (const e of list) {
    const md5 = e.md5Checksum;
    if (!md5) continue; // no checksum → can't judge duplicate
    if (!byMd5.has(md5)) byMd5.set(md5, []);
    byMd5.get(md5).push(e);
  }
  const duplicates = [];
  for (const [md5, files] of byMd5) {
    if (files.length > 1) duplicates.push({ md5, files });
  }
  return { noAudio, mp3WithVideo, duplicates, zeroSize };
}

/** Build the gaps markdown from the gap lists. Pure. */
export function buildGapsMd(entries) {
  const g = computeGaps(entries);
  const total = Array.isArray(entries) ? entries.length : 0;
  const L = [];
  L.push('# Media inventory — gaps (Q2)');
  L.push('');
  L.push('READ-ONLY discovery. Nothing was moved, renamed, or deleted. Each list below is a');
  L.push('problem for a human to check against the raw files; this report decides nothing.');
  L.push('');
  L.push(`Files inspected: **${total}**.`);
  L.push('');

  const section = (title, rows, render) => {
    L.push(`## ${title} (${rows.length})`);
    if (!rows.length) {
      L.push('');
      L.push('- none');
      L.push('');
      return;
    }
    L.push('');
    for (const r of rows) L.push(`- ${render(r)}`);
    L.push('');
  };

  const fileLabel = (e) => `\`${e.id}\` ${mdInline(e.name)} (${e.teacher_slug || '?'})`;
  section('No audio track', g.noAudio, fileLabel);
  section('Name says .mp3 but has video', g.mp3WithVideo, fileLabel);
  section('Zero-size files', g.zeroSize, fileLabel);

  L.push(`## Duplicates by md5 (${g.duplicates.length})`);
  if (!g.duplicates.length) {
    L.push('');
    L.push('- none');
    L.push('');
  } else {
    L.push('');
    for (const d of g.duplicates) {
      L.push(`- md5 \`${d.md5}\`:`);
      for (const e of d.files) L.push(`  - ${fileLabel(e)}`);
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

/** Flatten a value for inline markdown (strip newlines; leave text verbatim otherwise). */
function mdInline(v) {
  return String(v ?? '').replace(/\r?\n/g, ' ');
}

function main() {
  const [, , entriesPath, outCsv, outGaps] = process.argv;
  if (!entriesPath || !outCsv || !outGaps) {
    console.error('Usage: node scripts/media/media-inventory.mjs <entries.json> <outCsv> <outGapsMd>');
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(entriesPath, 'utf-8'));
  writeFileSync(outCsv, buildInventoryCsv(entries), 'utf-8');
  writeFileSync(outGaps, buildGapsMd(entries), 'utf-8');
  const g = computeGaps(entries);
  console.log(
    `inventory: ${entries.length} files; gaps — noAudio ${g.noAudio.length}, mp3+video ${g.mp3WithVideo.length}, dup-md5 ${g.duplicates.length}, zero-size ${g.zeroSize.length}`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('media-inventory.mjs')) main();
