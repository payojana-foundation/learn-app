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
 */
import { sourceIdOf } from './sync.mjs';
import { reasonKind } from '../media/precheck.mjs';
import { videoLessons } from '../media/video-inventory.mjs';
import { mediaUrl } from '../queues/approve-lists.mjs';

export const SCHEMA_VERSION = 1;
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
  const { lessonRows = [], sheetRows = null, gid = null, courseRows = [], wanted = new Map(), manifest = [], videoManifest = [], precheck = null, videoPrecheck = null, failed = new Map(), prev = null, now } = ctx;
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
    if (r) push(r, 'audio', 'conversion failed', detail, null);
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
