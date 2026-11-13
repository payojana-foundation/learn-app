/**
 * scripts/media/video-inventory.mjs — PART V1: READ-ONLY video inventory.
 *
 * For every lesson row in data/master/lessons.csv: does it have a cut MP4
 * (`mp4_link`) and/or a MiniCourse video (`minicourse_link`)? For each Drive
 * file id found, the workflow (video-inventory.yml) asks Drive for metadata
 * only (size, mimeType, md5Checksum, videoMediaMetadata width/height/
 * durationMillis). Nothing is downloaded, moved, renamed or deleted.
 *
 * Video source of a lesson (`video_id`): the first Drive id in `mp4_link`, else
 * the first in `minicourse_link`. This rule is a working choice (unknown which
 * cut the coordinator prefers); both ids are listed in the CSV.
 *
 * Usage:
 *   node scripts/media/video-inventory.mjs ids <lessons.csv> <out ids.txt>
 *   node scripts/media/video-inventory.mjs fetch <ids.txt> <out meta.json>   (needs ACCESS_TOKEN)
 *   node scripts/media/video-inventory.mjs report <lessons.csv> <meta.json> <out.md> <out.csv>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects, toCsv } from '../master/csv.mjs';
import { driveIds } from '../catalogue/sheets-map.mjs';

/** One record per lesson row that has any video link. Pure. */
export function videoLessons(rows) {
  const out = [];
  for (const r of rows || []) {
    const mp4_ids = driveIds(r.mp4_link);
    const minicourse_ids = driveIds(r.minicourse_link);
    if (!mp4_ids.length && !minicourse_ids.length) continue;
    out.push({
      row_key: r.row_key,
      lesson_id: r.lesson_id,
      course_id: r.course_id,
      lesson_no: r.lesson_no,
      mp4_ids,
      minicourse_ids,
      video_id: mp4_ids[0] || minicourse_ids[0],
      video_from: mp4_ids[0] ? 'mp4' : 'minicourse',
    });
  }
  return out;
}

/** Unique Drive ids of every video link (both columns), in first-seen order. Pure. */
export function uniqueVideoIds(lessons) {
  const s = new Set();
  for (const l of lessons) for (const id of [...l.mp4_ids, ...l.minicourse_ids]) s.add(id);
  return [...s];
}

/** Normalise one Drive files.get response (or an error) to a meta record. Pure. */
export function toMeta(id, json, error) {
  if (error || !json) return { id, ok: false, error: String(error || 'no response') };
  const v = json.videoMediaMetadata || {};
  return {
    id,
    ok: true,
    name: json.name ?? '',
    mimeType: json.mimeType ?? '',
    size: Number(json.size) || 0,
    md5Checksum: json.md5Checksum ?? '',
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    duration_s: v.durationMillis ? Math.round(Number(v.durationMillis) / 1000) : 0,
  };
}

/** Fetch metadata for ids with a bounded pool. fetchImpl is injectable for tests. */
export async function fetchMeta(ids, token, { fetchImpl = fetch, concurrency = 8 } = {}) {
  const fields = 'id,name,mimeType,size,md5Checksum,videoMediaMetadata';
  const out = new Array(ids.length);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const i = next++;
      const id = ids[i];
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${fields}&supportsAllDrives=true`;
      try {
        const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) out[i] = toMeta(id, null, `HTTP ${res.status}`);
        else out[i] = toMeta(id, await res.json(), null);
      } catch (e) {
        out[i] = toMeta(id, null, e?.message || e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/** Height bucket label for a resolution histogram. Pure. */
export function heightBucket(h) {
  if (!h) return 'unknown';
  if (h >= 1080) return '≥1080p';
  if (h >= 720) return '720–1079p';
  if (h >= 480) return '480–719p';
  return '<480p';
}

const GB = 1024 ** 3;

/**
 * Totals over lessons + meta. Size/duration count each lesson's chosen
 * `video_id` once per unique file (a file shared by two lessons is counted
 * once in GB/hours). Pure.
 */
export function summarize(lessons, metaList) {
  const meta = new Map((metaList || []).map((m) => [m.id, m]));
  const byCourse = new Map();
  const seen = new Set();
  const res = {};
  let bytes = 0, secs = 0, missing = 0;
  for (const l of lessons) {
    const c = byCourse.get(l.course_id) || { course_id: l.course_id, lessons: 0, files: 0, bytes: 0, secs: 0, missing: 0 };
    c.lessons++;
    const m = meta.get(l.video_id);
    if (!m || !m.ok) { c.missing++; missing++; byCourse.set(l.course_id, c); continue; }
    if (!seen.has(l.video_id)) {
      seen.add(l.video_id);
      c.files++; c.bytes += m.size; c.secs += m.duration_s;
      bytes += m.size; secs += m.duration_s;
      const b = heightBucket(m.height);
      res[b] = (res[b] || 0) + 1;
    }
    byCourse.set(l.course_id, c);
  }
  return {
    lessons: lessons.length,
    mp4Lessons: lessons.filter((l) => l.mp4_ids.length).length,
    minicourseLessons: lessons.filter((l) => l.minicourse_ids.length).length,
    files: seen.size,
    bytes, gb: bytes / GB, hours: secs / 3600, missing,
    resolutions: res,
    courses: [...byCourse.values()].sort((a, b) => String(a.course_id).localeCompare(String(b.course_id))),
  };
}

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** Markdown report. Pure. */
export function buildReportMd(s) {
  const L = [];
  L.push('# Video inventory (PART V1)');
  L.push('');
  L.push('READ-ONLY. Drive metadata only (no download, no move, no delete). Source:');
  L.push('`data/master/lessons.csv` columns `mp4_link` and `minicourse_link`.');
  L.push('A lesson\'s video = first id in `mp4_link`, else first in `minicourse_link`.');
  L.push('GB and hours count each unique chosen file once.');
  L.push('');
  L.push(`- Lessons with video: **${s.lessons}** (cut MP4: ${s.mp4Lessons}, MiniCourse: ${s.minicourseLessons})`);
  L.push(`- Unique chosen files with metadata: **${s.files}**`);
  L.push(`- Total size: **${f1(s.gb)} GB**`);
  L.push(`- Total duration: **${f1(s.hours)} h**`);
  L.push(`- Lessons whose file metadata could not be read: **${s.missing}**`);
  L.push('');
  L.push('## Resolution (by file height)');
  L.push('');
  L.push('| height | files |');
  L.push('|---|---:|');
  for (const k of ['≥1080p', '720–1079p', '480–719p', '<480p', 'unknown']) if (s.resolutions[k]) L.push(`| ${k} | ${s.resolutions[k]} |`);
  L.push('');
  L.push('## By course');
  L.push('');
  L.push('| course | lessons | files | GB | hours | no metadata |');
  L.push('|---|---:|---:|---:|---:|---:|');
  for (const c of s.courses) L.push(`| ${c.course_id} | ${c.lessons} | ${c.files} | ${f1(c.bytes / GB)} | ${f1(c.secs / 3600)} | ${c.missing} |`);
  L.push('');
  return L.join('\n');
}

export const CSV_COLUMNS = ['row_key', 'lesson_id', 'course_id', 'lesson_no', 'video_from', 'video_id', 'mp4_ids', 'minicourse_ids', 'ok', 'error', 'size', 'duration_s', 'width', 'height', 'mimeType'];

/** Per-lesson CSV rows. Pure. */
export function buildCsvRows(lessons, metaList) {
  const meta = new Map((metaList || []).map((m) => [m.id, m]));
  return lessons.map((l) => {
    const m = meta.get(l.video_id) || { ok: false, error: 'not fetched' };
    return {
      ...l,
      mp4_ids: l.mp4_ids.join(' '),
      minicourse_ids: l.minicourse_ids.join(' '),
      ok: m.ok ? 'yes' : 'no',
      error: m.error || '',
      size: m.size ?? '', duration_s: m.duration_s ?? '', width: m.width ?? '', height: m.height ?? '', mimeType: m.mimeType ?? '',
    };
  });
}

async function main() {
  const [, , cmd, a, b, c, d] = process.argv;
  if (cmd === 'ids') {
    const ids = uniqueVideoIds(videoLessons(parseCsvObjects(readFileSync(a, 'utf8'))));
    writeFileSync(b, ids.join('\n') + '\n');
    console.log(`video-inventory: ${ids.length} unique video ids`);
  } else if (cmd === 'fetch') {
    const token = process.env.ACCESS_TOKEN;
    if (!token) { console.error('ACCESS_TOKEN is not set'); process.exit(1); }
    const ids = readFileSync(a, 'utf8').split(/\r?\n/).filter(Boolean);
    const meta = await fetchMeta(ids, token);
    writeFileSync(b, JSON.stringify(meta, null, 2));
    console.log(`video-inventory: fetched ${meta.length}, failed ${meta.filter((m) => !m.ok).length}`);
  } else if (cmd === 'report') {
    const lessons = videoLessons(parseCsvObjects(readFileSync(a, 'utf8')));
    const meta = JSON.parse(readFileSync(b, 'utf8'));
    const s = summarize(lessons, meta);
    writeFileSync(c, buildReportMd(s));
    writeFileSync(d, toCsv(CSV_COLUMNS, buildCsvRows(lessons, meta)));
    console.log(`video-inventory: ${s.lessons} lessons, ${s.files} files, ${f1(s.gb)} GB, ${f1(s.hours)} h`);
  } else {
    console.error('Usage: video-inventory.mjs ids|fetch|report …');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('video-inventory.mjs')) main();
