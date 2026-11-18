/**
 * scripts/master/checks.mjs — public/ops/checks.json for the Operations dashboard (written
 * by master-sync, same refresh as public/ops/status.json). Pure; tested with placeholders.
 *
 * One item per (lesson row, media type, reason):
 *   audio  flagged by the pre-approval check (data/queues/approve/precheck.json);
 *   video  flagged by the video pre-check (data/queues/approve-video/precheck.json);
 *   audio  "conversion failed": no manifest entry and listed in data/queues/failed-review.csv
 *          or tried MAX_ATTEMPTS times by course-autorun (data/ops/autorun-state.json).
 * A source shared by several rows is reported on its first row (as the pre-check does).
 * Titles are copied byte for byte. The file carries NO sheet id and NO sheet URL: only the
 * tab gid and the row number, so the dashboard (which knows the sheet) builds its own link.
 * first_flagged_at is kept from the previous checks.json for the same row/media/reason.
 *
 * PART 6 (16 Nov) — every piece of work a person must do:
 *   audio  "no file link": a course lesson row with no Drive FILE link (mp3/mp4/minicourse), or
 *          only a folder link — the team adds the link in the sheet;
 *   audio  "file not shared": the conversion could not read the file (Drive HTTP 403/404: not
 *          shared with the service account, deleted or in the trash) — from failed-review.csv;
 *   video  "file not shared": the lesson's video could not be read (Drive HTTP 403/404) — from
 *          reports/video-inventory-failures.csv (video-inventory.yml), unless converted since;
 *   course "no approved lesson": a course with no approved lesson where nothing is waiting for
 *          the pipeline (every row is blocked by one of the reasons above, a failed conversion or
 *          a pre-check flag) — only then does a person have to act. Reported on the course's
 *          first lesson row (same fields; media_type "audio").
 * After the team fixes one of these in the sheet, check_decision "fixed" queues the row again.
 */
import { sourceIdOf } from './sync.mjs';
import { reasonKind } from '../media/precheck.mjs';
import { videoLessons } from '../media/video-inventory.mjs';
import { mediaUrl } from '../queues/approve-lists.mjs';
import { noFileLink } from './intake.mjs';

/** PART 11: the row is marked `in editing` (only meaningful while it has no file link). Pure. */
export const inEditing = (r) => String((r && r.editing_status) || '').trim() === 'in editing';

/** A conversion-failure reason that means Drive refused the file. Pure. */
export const isNotShared = (reason) => /HTTP 40[34]\b|not readable from Drive|not shared/i.test(String(reason || ''));

export const SCHEMA_VERSION = 1;
/** Every reason checks.json can carry; public/ops/check-reasons.json describes each one. */
export const REASONS = [
  'duration under 5 min', 'duration over 4 h', 'duration differs > 2 % from the Drive source', 'source duration unknown',
  'same audio (sha256) as another lesson', 'silence > 60 s in the first 2 min', 'silence > 60 s in the last 2 min',
  'duration differs > 2 % from the source', 'same video (sha256) as another lesson', 'same source file as another Drive id',
  'conversion failed', 'file not shared', 'no file link', 'no approved lesson', 'media: does not play',
  'editing: lessons waiting to be cut',
];
export const CHECK_DECISIONS = ['', 'fixed', 'approve anyway', 'hold'];

/** m:ss or h:mm:ss (the pre-check's format). */
export function fmt(s) {
  if (!Number.isFinite(s)) return '?';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

/** Video reason text -> category (same idea as precheck reasonKind). */
export function videoReasonKind(r) {
  if (/under 5 min/.test(r)) return 'duration under 5 min';
  if (/over 4 h/.test(r)) return 'duration over 4 h';
  if (/differs more than 2 %/.test(r)) return 'duration differs > 2 % from the source';
  if (/source duration unknown/.test(r)) return 'source duration unknown';
  if (/same video/.test(r)) return 'same video (sha256) as another lesson';
  if (/same source file/.test(r)) return 'same source file as another Drive id';
  return r;
}

/** Measured vs expected, short. Pure. */
export function audioDetail(kind, entry, measured = {}, sameShaLessons = []) {
  const d = Number(entry && entry.duration_s);
  switch (kind) {
    case 'duration under 5 min': return `duration ${fmt(d)} vs at least 5:00`;
    case 'duration over 4 h': return `duration ${fmt(d)} vs at most 4:00:00`;
    case 'duration differs > 2 % from the Drive source': return `duration ${fmt(d)} vs ${fmt(Number(measured.drive_s))}`;
    case 'source duration unknown': return 'Drive source duration could not be read';
    case 'same audio (sha256) as another lesson': return `same file as ${sameShaLessons.join(', ') || 'another lesson'}`;
    case 'silence > 60 s in the first 2 min': return `silence ${Math.round(Number(measured.head_s))} s vs at most 60 s`;
    case 'silence > 60 s in the last 2 min': return `silence ${Math.round(Number(measured.tail_s))} s vs at most 60 s`;
    default: return '';
  }
}

export function videoDetail(kind, entry = {}) {
  const d = Number(entry.duration_s);
  switch (kind) {
    case 'duration under 5 min': return `duration ${fmt(d)} vs at least 5:00`;
    case 'duration over 4 h': return `duration ${fmt(d)} vs at most 4:00:00`;
    case 'duration differs > 2 % from the source': return `duration ${fmt(d)} vs ${fmt(Number(entry.src_duration_s))}`;
    case 'source duration unknown': return 'source duration could not be read';
    default: return '';
  }
}

const itemKey = (i) => `${i.row_key}|${i.media_type}|${i.reason}`;

/**
 * ctx = { lessonRows (objects, sheet order), sheetRows: Map(row_key -> sheet row number) | null,
 *   gid: number|null, courseRows, wanted: Map(row_key -> {lesson_id}), manifest, videoManifest,
 *   precheck, videoPrecheck, failed: Map(drive id -> detail), prev (previous checks.json), now }
 */
export function checksJson(ctx) {
  const { lessonRows = [], sheetRows = null, gid = null, courseRows = [], wanted = new Map(), manifest = [], videoManifest = [], precheck = null, videoPrecheck = null, failed = new Map(), videoFailures = new Map(), playcheck = null, prev = null, now } = ctx;
  const courseTitle = new Map(courseRows.map((c) => [c.course_id, c.course_title_km]));
  const firstSeen = new Map(((prev && prev.items) || []).map((i) => [itemKey(i), i.first_flagged_at]));
  const byAudio = new Map(); // source id -> first row
  for (const r of lessonRows) {
    if (!r.course_id || !r.row_key) continue;
    const id = sourceIdOf(r);
    if (id && !byAudio.has(id)) byAudio.set(id, r);
  }
  const byVideo = new Map();
  const rowByKey = new Map(lessonRows.map((r) => [r.row_key, r]));
  for (const l of videoLessons(lessonRows)) {
    const r = rowByKey.get(l.row_key);
    if (r && r.course_id && !byVideo.has(l.video_id)) byVideo.set(l.video_id, r);
  }
  const audioEntry = new Map(manifest.filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const videoEntry = new Map((videoManifest || []).filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const shaRows = new Map();
  for (const [id, r] of byAudio) {
    const e = audioEntry.get(id);
    if (!e || !e.sha256) continue;
    if (!shaRows.has(e.sha256)) shaRows.set(e.sha256, []);
    shaRows.get(e.sha256).push(wanted.get(r.row_key)?.lesson_id || r.lesson_id || r.row_key);
  }
  const items = [];
  const push = (r, media_type, reason, detail, key) => {
    const it = {
      row_key: r.row_key,
      lesson_id: wanted.get(r.row_key)?.lesson_id ?? r.lesson_id ?? '',
      course_id: r.course_id,
      course_title_km: courseTitle.has(r.course_id) ? courseTitle.get(r.course_id) : r.course_title_km ?? '',
      lesson_title: r.lesson_title ?? '',
      media_type,
      reason,
      detail,
      first_flagged_at: null,
      sheet_row: sheetRows ? sheetRows.get(r.row_key) ?? null : null,
      sheet_gid: gid,
      play_url: key ? mediaUrl(key) : null,
      check_decision: r.check_decision ?? '',
    };
    it.first_flagged_at = firstSeen.get(itemKey(it)) || now;
    items.push(it);
  };
  const measured = (precheck && precheck.measured) || {};
  for (const f of (precheck && precheck.results && precheck.results.flagged) || []) {
    const r = byAudio.get(f.id);
    if (!r) continue;
    const e = audioEntry.get(f.id) || {};
    const kinds = [...new Set((f.reasons || []).map(reasonKind))];
    for (const k of kinds) {
      const others = (shaRows.get(e.sha256) || []).filter((x) => x !== (wanted.get(r.row_key)?.lesson_id || r.lesson_id || r.row_key));
      push(r, 'audio', k, audioDetail(k, e, measured[f.id], others), e.key);
    }
  }
  for (const [id, detail] of failed) {
    if (audioEntry.has(id)) continue; // converted since: not a failed conversion any more
    const r = byAudio.get(id);
    if (r) push(r, 'audio', isNotShared(detail) ? 'file not shared' : 'conversion failed', detail, null);
  }
  for (const [id, v] of videoFailures) {
    if (videoEntry.has(id)) continue;
    const r = byVideo.get(id);
    if (r && /^40[34]$/.test(String(v.http_status))) push(r, 'video', 'file not shared', `Drive HTTP ${v.http_status}: ${v.likely_cause || 'not shared with the service account, deleted or in the trash'}`, null);
  }
  const editing = new Map(); // course_id -> rows in editing without a file link
  for (const r of lessonRows) {
    if (!r.course_id || !r.row_key || !noFileLink(r)) continue;
    if (inEditing(r)) { if (!editing.has(r.course_id)) editing.set(r.course_id, []); editing.get(r.course_id).push(r); continue; }
    push(r, 'audio', 'no file link', /\/folders\//.test(`${r.mp3_link} ${r.mp4_link} ${r.minicourse_link}`) ? 'a folder link, not a file link' : 'no Drive file link in mp3_link, mp4_link or minicourse_link', null);
  }
  // PART 11: one summary item per course for the lessons the editors are still cutting
  for (const [, rows] of editing) push(rows[0], 'audio', 'editing: lessons waiting to be cut', `${rows.length} lesson${rows.length === 1 ? '' : 's'} marked "in editing" with no file link yet`, null);
  // PART 10: live files that do not play (data/ops/playcheck.json, media-playcheck.yml)
  for (const f of (playcheck && playcheck.failures) || []) {
    const r = f.kind === 'video' ? byVideo.get(f.id) : byAudio.get(f.id);
    if (r) push(r, f.kind === 'video' ? 'video' : 'audio', 'media: does not play', `${f.causes.join(', ')}: ${f.detail}`, f.key);
  }
  // courses where nothing can move without a person
  const approved = new Set(manifest.filter((e) => e && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
  const flagged = new Set(((precheck && precheck.results && precheck.results.flagged) || []).map((f) => f.id));
  const byCourse = new Map();
  for (const r of lessonRows) {
    if (!r.course_id || !r.row_key) continue;
    if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, []);
    byCourse.get(r.course_id).push(r);
  }
  for (const [cid, rows] of byCourse) {
    const tally = { 'no file link': 0, 'file not shared': 0, 'conversion failed': 0, flagged: 0 };
    let approvedN = 0;
    let waiting = 0;
    for (const r of rows) {
      const id = noFileLink(r) ? null : sourceIdOf(r);
      if (id && approved.has(id)) { approvedN++; continue; }
      if (!id && inEditing(r)) { waiting++; continue; } // being cut: a person is already on it
      if (!id) tally['no file link']++;
      else if (flagged.has(id)) tally.flagged++;
      else if (!audioEntry.has(id) && failed.has(id)) tally[isNotShared(failed.get(id)) ? 'file not shared' : 'conversion failed']++;
      else waiting++; // not converted yet (autorun will) or converted and waiting for release
    }
    if (approvedN === 0 && waiting === 0) {
      const parts = Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
      push(rows[0], 'audio', 'no approved lesson', `0 of ${rows.length} lessons approved and none waiting: ${parts.join(', ')}`, null);
    }
  }
  for (const f of (videoPrecheck && videoPrecheck.results && videoPrecheck.results.flagged) || []) {
    const r = byVideo.get(f.id);
    if (!r) continue;
    const e = videoEntry.get(f.id) || {};
    for (const k of [...new Set((f.reasons || []).map(videoReasonKind))]) push(r, 'video', k, videoDetail(k, e), e.key || f.key);
  }
  items.sort((a, b) => a.course_id.localeCompare(b.course_id) || a.row_key.localeCompare(b.row_key) || a.media_type.localeCompare(b.media_type) || a.reason.localeCompare(b.reason));
  return { schema_version: SCHEMA_VERSION, generated_at: now, items };
}

/** reports/video-inventory-failures.csv rows -> Map(video drive id -> {http_status, likely_cause}). Pure. */
export function videoFailuresFrom(rows) {
  const m = new Map();
  for (const r of rows || []) if (r.drive_file_id && !m.has(r.drive_file_id)) m.set(r.drive_file_id, { http_status: r.http_status, likely_cause: r.likely_cause });
  return m;
}

/** failed-review.csv (drive_file_id,course_id[,reason]) + autorun attempts -> Map(id -> detail). */
export function failedMap(failedReviewCsv, autorunState, maxAttempts = 2) {
  const m = new Map();
  const lines = String(failedReviewCsv || '').split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() || '').split(',');
  const ri = head.indexOf('reason');
  for (const l of lines) {
    const cells = l.split(',');
    const id = (cells[0] || '').trim();
    if (!id) continue;
    const reason = ri >= 0 ? cells.slice(ri).join(',').replace(/^"|"$/g, '').trim() : '';
    m.set(id, reason || 'conversion failed (reason not recorded)');
  }
  for (const [id, n] of Object.entries((autorunState && autorunState.attempts) || {})) {
    if (n >= maxAttempts && !m.has(id)) m.set(id, `conversion failed ${n} times (course-autorun)`);
  }
  return m;
}
