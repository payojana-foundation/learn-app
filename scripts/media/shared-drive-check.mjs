/**
 * scripts/media/shared-drive-check.mjs — PART 7b (18 Nov): can the pipeline read a lesson file that
 * lives in the Shared Drive "Payojana-Classes"? Read-only (drive.readonly). Used by
 * .github/workflows/shared-drive-check.yml, which then runs transcode-one.sh in DRY_RUN on the file.
 *
 *   1. find the Shared Drive by name (drives.list);
 *   2. list its audio/video files (files.list, corpora=drive, supportsAllDrives,
 *      includeItemsFromAllDrives); prefer one that a lesson row of data/master/lessons.csv links to
 *      (so "file id unchanged" is checked against the link the team has);
 *   3. files.get it with the pipeline's own query (supportsAllDrives) and the duration lookup the
 *      pre-check uses (videoMediaMetadata).
 * Prints JSON { drive_id, file_id, name, in_lessons_csv, get_ok, get_drive_id, md5, duration_s } and
 * writes the file id to $GITHUB_OUTPUT (file_id). No file is changed.
 *
 * Usage: ACCESS_TOKEN=… node scripts/media/shared-drive-check.mjs ["Payojana-Classes"] [file id]
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { parseCsvObjects } from '../master/csv.mjs';
import { driveIds } from '../catalogue/sheets-map.mjs';

const API = 'https://www.googleapis.com/drive/v3';

/** Every Drive file id linked from lessons.csv (mp3/mp4/minicourse). Pure. */
export function lessonFileIds(rows) {
  const s = new Set();
  for (const r of rows || []) for (const id of driveIds(r.mp3_link, r.mp4_link, r.minicourse_link)) s.add(id);
  return s;
}

/** Pick a media file, preferring one a lesson links to. Pure. */
export function pickFile(files, linked) {
  const media = (files || []).filter((f) => /^(audio|video)\//.test(f.mimeType || ''));
  return media.find((f) => linked.has(f.id)) || media[0] || null;
}

async function get(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; } })() };
}

async function main() {
  const token = process.env.ACCESS_TOKEN;
  if (!token) { console.error('ACCESS_TOKEN not set'); process.exit(2); }
  const name = process.argv[2] || 'Payojana-Classes';
  const wanted = process.argv[3] || '';
  const d = await get(`${API}/drives?q=${encodeURIComponent(`name = '${name}'`)}&pageSize=10`, token);
  const drive = (d.json.drives || [])[0];
  if (!drive) { console.log(JSON.stringify({ error: `Shared Drive "${name}" not visible to the service account (HTTP ${d.status})` })); process.exit(3); }
  const linked = lessonFileIds(parseCsvObjects(readFileSync('data/master/lessons.csv', 'utf-8')));
  let file = null;
  if (wanted) file = { id: wanted };
  else {
    let page = '';
    const seen = [];
    for (let i = 0; i < 10 && !file; i++) {
      const q = encodeURIComponent("trashed = false and (mimeType contains 'audio/' or mimeType contains 'video/')");
      const l = await get(`${API}/files?corpora=drive&driveId=${drive.id}&q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${page}` : ''}`, token);
      seen.push(...(l.json.files || []));
      file = (l.json.files || []).find((f) => linked.has(f.id)) || null;
      page = l.json.nextPageToken || '';
      if (!page) break;
    }
    if (!file) file = pickFile(seen, linked);
  }
  if (!file) { console.log(JSON.stringify({ drive_id: drive.id, error: 'no audio or video file in the Shared Drive - ask the coordinator for one file id' })); process.exit(4); }
  const g = await get(`${API}/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,driveId,md5Checksum,size,videoMediaMetadata(durationMillis)&supportsAllDrives=true`, token);
  const out = {
    drive_name: name, drive_id: drive.id, file_id: file.id, name: g.json.name || file.name || '', in_lessons_csv: linked.has(file.id),
    get_ok: g.status === 200, get_status: g.status, get_id_same: g.json.id === file.id, get_drive_id: g.json.driveId || null,
    in_this_drive: g.json.driveId === drive.id, md5: g.json.md5Checksum || null,
    duration_s: g.json.videoMediaMetadata ? Math.round(Number(g.json.videoMediaMetadata.durationMillis) / 1000) : null,
  };
  console.log(JSON.stringify(out, null, 1));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `file_id=${file.id}\n`);
  if (!out.get_ok || !out.get_id_same || !out.in_this_drive) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('shared-drive-check.mjs')) main();
