/**
 * scripts/build-courses.mjs — build the served course data (P3).
 *
 * Reads (bulk 09: the app is built from the MASTER SHEET export):
 *   data/master/lessons.csv + data/master/courses.csv  (export of the master sheet)
 *   data/source/teachers-2026-11-02/teachers-2026-11-02.json  (+ teacher-photos/)
 *   data/media-manifest.json  (approved entries decide which lessons are shown)
 * The old website source (data/source/website-courses-2026-09-28.json) is no longer
 * read; the old `buildCourses` below is kept untouched (used by contract tests).
 * and writes:
 *   public/data/catalog.json
 *   public/data/courses/<id>.json   (one per course)
 *   public/data/teachers.json
 *   public/data/aliases.json        (empty until permanent ids exist)
 *   public/data/manifest.json       (SHA-256 of every served file)
 * plus reports/course-issues.csv (untracked).
 *
 * Titles and names are copied byte-for-byte; the build never retypes, trims,
 * normalises, or translates them. Ids come from the master sheet (course `c###`
 * from the registry, lesson id = the master lesson_id).
 *
 * Exit 0 when all hard checks pass; exit 1 on any hard-fail check.
 *
 * The transform functions are exported so contract tests can exercise them with
 * a small fixture (never the real titles).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathsShapeErrors, guideLinesShapeErrors, companionIssues, issuesCsv } from './companion-check.mjs';
import { driveIds } from './catalogue/sheets-map.mjs';
import { parseCsvObjects } from './master/csv.mjs';

/**
 * Reproducible build stamp (R3, bulk-03). The served data must rebuild to the
 * SAME bytes from the same sources, so `data-check.yml` can fail when the
 * committed public/data/ drifts from a fresh build. A wall-clock `new Date()`
 * would change every build and make that check meaningless, so `generated`
 * (and each manifest entry's `updated`) is derived deterministically. The data
 * is a pure function of its sources, so its stamp is the sources' last change:
 *   1. `SOURCE_DATE_EPOCH` (seconds) if set — the reproducible-builds standard.
 *   2. else the git commit date (ISO) of the LAST commit that touched any
 *      source input (website courses, teachers, media manifest, id aliases) —
 *      stable until a source actually changes, which is exactly when the served
 *      data should change.
 *   3. else the current time — local dev with no git; not reproducible, but the
 *      app never depends on the value (the loader keys on per-file sha256).
 * The value is an ISO-8601 string, unchanged in shape from before.
 */
const SOURCE_INPUTS = [
  'data/master/lessons.csv',
  'data/master/courses.csv',
  'data/source/teachers-2026-11-02/teachers-2026-11-02.json',
  'data/media-manifest.json',
  'data/id-aliases.json',
];

function buildStamp(root) {
  const epoch = process.env.SOURCE_DATE_EPOCH?.trim();
  if (epoch && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  try {
    const iso = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', ...SOURCE_INPUTS],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    if (iso) return new Date(iso).toISOString();
  } catch {
    /* no git available */
  }
  return new Date().toISOString();
}

// ── ID helpers ───────────────────────────────────────────────────────────────

export function courseId(index0) {
  return `c${String(index0 + 1).padStart(3, '0')}`;
}
export function lessonId(index0, lessonIndex0) {
  return `${courseId(index0)}-l${String(lessonIndex0 + 1).padStart(3, '0')}`;
}

/**
 * Provisional lesson id with a duplicate-num suffix. The id is numbered by the
 * FIRST source position that carries the num, so the first occurrence keeps the
 * plain id and later duplicates get a letter suffix (occ 2 → "b", 3 → "c").
 * This keeps the displayed num byte-for-byte while giving every lesson a unique,
 * stable provisional id used in the URL (/courses/<course-id>/<lesson-id>).
 */
export function lessonIdSuffixed(index0, lessonIndex0, occurrence) {
  const base = lessonId(index0, lessonIndex0);
  if (occurrence <= 1) return base;
  // occ 2 → 'b', 3 → 'c', … (97 = 'a'); occ 1 would be 'a' but is left bare.
  return `${base}${String.fromCharCode(96 + occurrence)}`;
}

// ── Media classification ─────────────────────────────────────────────────────

/** Classify a single source URL into a media kind, or null if empty/unknown. */
export function classifyMedia(src) {
  if (!src || typeof src !== 'string' || src.trim() === '') return null;
  let host = '';
  try {
    host = new URL(src).host;
  } catch {
    return null;
  }
  if (host.endsWith('acast.com')) return 'acast';
  if (host.endsWith('youtube.com') || host.endsWith('youtu.be')) return 'youtube';
  if (host.endsWith('drive.google.com')) return 'drive';
  return null;
}

/**
 * Build a lesson's media array from its source fields.
 *
 * `r2ByDriveId` maps a Drive file id → its APPROVED (non-DRAFT) manifest entry.
 * `courseIsR2` is the COURSE-LEVEL decision (Q4, bulk-02): a course switches to
 * r2 ONLY when EVERY Drive-backed lesson in it has an approved manifest entry —
 * there are no mixed courses. When `courseIsR2` is true, a Drive source becomes
 * an `r2` entry carrying the bare R2 `key` as `src` (the player prepends
 * MEDIA_BASE_URL + URL-encodes it, per P-12 — the key is NOT a full URL here)
 * and the real `duration_s` from the manifest. When it is false, Drive sources
 * stay `drive` even if some lessons happen to be on R2.
 */
export function lessonMedia(lesson, r2ByDriveId, courseIsR2, overrideDriveId) {
  const out = [];
  // When an override links this lesson to a canonical drive_file_id (Job B v2
  // prep), an approved r2 entry replaces the FIRST audio/video source — so a
  // lesson whose source is acast/youtube/drive still switches to the r2 player.
  let overrideUsed = false;
  for (const src of [lesson.audioEmbedSrc, lesson.videoPreviewSrc]) {
    const kind = classifyMedia(src);
    if (!kind) continue;
    if (courseIsR2 && r2ByDriveId && overrideDriveId && !overrideUsed) {
      const r2 = r2ByDriveId.get(overrideDriveId);
      if (r2) {
        out.push({ kind: 'r2', src: r2.key, duration_s: Number(r2.duration_s) || 0 });
        overrideUsed = true;
        continue;
      }
    }
    if (kind === 'drive' && courseIsR2 && r2ByDriveId) {
      const driveId = extractDriveId(src);
      const r2 = driveId && r2ByDriveId.get(driveId);
      if (r2) {
        // src = the bare R2 key (P-12: the player builds the URL, not the data).
        out.push({ kind: 'r2', src: r2.key, duration_s: Number(r2.duration_s) || 0 });
        continue;
      }
    }
    out.push({ kind, src });
  }
  return out;
}

/**
 * Course-level all-or-nothing r2 decision (Q4). A course is r2 ONLY when it has
 * at least one Drive-backed audio lesson AND every Drive source in the course
 * has an approved (non-DRAFT) manifest entry. A course with no Drive sources is
 * never "r2" (nothing to switch). Counts only approved entries.
 */
export function courseAllDriveApproved(course, r2ByDriveId, overridesForCourse) {
  // Override-linked course (Job B v2): the course is r2 only when EVERY listed
  // lesson num has an approved manifest entry for its canonical drive_file_id.
  if (overridesForCourse) {
    const ids = Object.values(overridesForCourse);
    if (ids.length === 0) return false;
    return ids.every((id) => r2ByDriveId.has(id));
  }
  const driveIds = [];
  for (const l of course.lessons || []) {
    for (const src of [l.audioEmbedSrc, l.videoPreviewSrc]) {
      if (classifyMedia(src) === 'drive') {
        const id = extractDriveId(src);
        if (id) driveIds.push(id);
      }
    }
  }
  if (driveIds.length === 0) return false; // no Drive audio → not an r2 course
  return driveIds.every((id) => r2ByDriveId.has(id));
}

/** Pull the Drive file id out of a Drive preview URL, or null. */
export function extractDriveId(src) {
  const m = /\/file\/d\/([^/]+)/.exec(src) || /[?&]id=([^&]+)/.exec(src);
  return m ? m[1] : null;
}

// ── Title / teacher rules ────────────────────────────────────────────────────

/** English title is null when the source put the Khmer title in the English field. */
export function englishTitle(titleKm, titleEn) {
  if (!titleEn || titleEn === titleKm) return null;
  return titleEn;
}

function startsWithYes(v) {
  return typeof v === 'string' && v.trim().toLowerCase().startsWith('yes');
}

/** Apply the teacher display rules (byte-for-byte names; gated en/bio/photo). */
export function teacherRecord(t) {
  return {
    slug: t.slug,
    name_km: t.name_km,
    name_en: startsWithYes(t.show_english_name) ? t.name_en : null,
    bio_km: startsWithYes(t.bio_approved_by_teacher) ? t.bio_km : null,
    bio_en: startsWithYes(t.bio_approved_by_teacher) ? t.bio_en : null,
    topics: Array.isArray(t.topics) ? t.topics : typeof t.topics === 'string' ? t.topics.split(/\s*,\s*/).filter(Boolean) : [],
    photo: t.photo_file || null,
  };
}

// ── Core transform (pure; used by the build and by contract tests) ───────────

/**
 * Transform the raw sources into { catalog, courses, issues, teacherSlugs }.
 * `issues` is a list of { course_id, lesson_num, kind, detail } rows.
 * Hard-fail issues have kind 'duplicate_num' or 'unknown_teacher'.
 */
export function buildCourses(sourceCourses, teachers, mediaManifest, sharedSources = [], mediaOverrides = null) {
  const teacherSlugs = new Set(teachers.map((t) => t.slug));

  // Job B v2 prep: title_km → { "<num>": drive_file_id } so a lesson can link to
  // its canonical manifest entry even when its source URL is acast/youtube.
  const overridesByTitle = new Map();
  for (const c of (mediaOverrides && mediaOverrides.courses) || []) {
    if (c && c.title_km && c.lessons) overridesByTitle.set(c.title_km, c.lessons);
  }

  // B5 (Job B v2): a lesson must resolve to exactly one key. If a single
  // drive_file_id maps to two different keys in the manifest, that is a build
  // FAILURE (ambiguous). Two DIFFERENT drive_file_ids sharing one source_md5
  // (= same key = one upload) is a WARNING + CSV, silenced when the pair's key
  // is listed in data/media-shared-sources.json. The lesson↔manifest link is
  // drive_file_id.
  const keysByDriveId = new Map(); // drive_file_id → Set(keys)
  const driveIdsByMd5 = new Map(); // source_md5 → Set(drive_file_id)
  for (const e of mediaManifest || []) {
    if (!e || !e.drive_file_id || !e.key) continue;
    if (!keysByDriveId.has(e.drive_file_id)) keysByDriveId.set(e.drive_file_id, new Set());
    keysByDriveId.get(e.drive_file_id).add(e.key);
    if (e.source_md5) {
      if (!driveIdsByMd5.has(e.source_md5)) driveIdsByMd5.set(e.source_md5, new Set());
      driveIdsByMd5.get(e.source_md5).add(e.drive_file_id);
    }
  }
  const sharedSilenced = new Set(sharedSources || []);
  const buildBlockers = [];
  for (const [did, keys] of keysByDriveId) {
    if (keys.size > 1) {
      buildBlockers.push(`drive_file_id ${did} resolves to ${keys.size} keys: ${[...keys].join(', ')}`);
    }
  }

  const r2ByDriveId = new Map();
  for (const e of mediaManifest || []) {
    // Only an explicitly APPROVED entry becomes r2 media (P-19). A DRAFT entry
    // never counts, and — since R4 (bulk-03) added a reviewer `rejected`
    // decision — a REJECTED entry is kept in the manifest for the audit trail
    // but must NEVER play, so the test is "status is approved", not merely
    // "not DRAFT". DRAFT still never counts and approved still counts, so the
    // P-19 contract test is unchanged.
    if (e && e.drive_file_id && e.key && /^approved\b/i.test(e.status || '')) {
      r2ByDriveId.set(e.drive_file_id, e);
    }
  }

  const issues = [];
  const catalogCourses = [];
  const courseFiles = [];

  // B5: one lesson → two keys is a hard fail (ambiguous media).
  for (const b of buildBlockers) {
    issues.push({ course_id: '', lesson_num: '', kind: 'lesson_two_keys', detail: b });
  }
  // B5: two drive ids sharing one source_md5 (same key, one upload) → WARNING
  // + CSV, silenced when that key is listed in media-shared-sources.json.
  for (const [md5, dids] of driveIdsByMd5) {
    if (dids.size < 2) continue;
    const key = `audio/${md5.toLowerCase().slice(0, 16)}-a64.mp3`;
    if (sharedSilenced.has(key)) continue;
    issues.push({
      course_id: '',
      lesson_num: '',
      kind: 'shared_source',
      detail: `source_md5 ${md5} shared by ${dids.size} drive ids (${[...dids].join(', ')}) → one key ${key}`,
    });
  }

  sourceCourses.forEach((co, i) => {
    const id = courseId(i);
    const titleKm = co.titleKm ?? '';
    const titleEn = englishTitle(titleKm, co.titleEn);

    // Course-level all-or-nothing r2 (Q4): only when EVERY Drive-backed lesson
    // in this course has an approved (non-DRAFT) manifest entry.
    const courseOverrides = overridesByTitle.get(titleKm) || null;
    const courseIsR2 = courseAllDriveApproved(co, r2ByDriveId, courseOverrides);

    if (!teacherSlugs.has(co.teacherSlug)) {
      issues.push({ course_id: id, lesson_num: '', kind: 'unknown_teacher', detail: co.teacherSlug ?? '(none)' });
    }

    // Track each num's occurrences so a provisional-id suffix (b, c, …) can
    // disambiguate duplicates WITHOUT editing the displayed num. The id BASE is
    // taken from the num's FIRST source position, so the first occurrence keeps
    // the plain id (c007-l013) and later duplicates reuse that base with a
    // letter suffix (c007-l013b). Coordinator decision 26 Oct 2026 (answer "b").
    const numOccurrence = new Map(); // num → count seen so far
    const numFirstIndex = new Map(); // num → first source index (0-based)
    const numTotal = new Map(); // num → total occurrences in this course
    (co.lessons || []).forEach((l, li) => {
      numTotal.set(l.num, (numTotal.get(l.num) || 0) + 1);
      if (!numFirstIndex.has(l.num)) numFirstIndex.set(l.num, li);
    });

    const lessons = [];
    const mediaKinds = new Set();

    (co.lessons || []).forEach((l) => {
      const occ = (numOccurrence.get(l.num) || 0) + 1;
      numOccurrence.set(l.num, occ);

      // Id base = the num's first position; suffix for occ >= 2.
      const id_lesson = lessonIdSuffixed(i, numFirstIndex.get(l.num), occ);

      if (numTotal.get(l.num) > 1) {
        // Duplicate num is a WARNING, not a build failure. Record every case
        // with both lesson titles so a human can confirm later. The duplicate
        // is KEPT (no data loss).
        const siblings = (co.lessons || []).filter((x) => x.num === l.num).map((x) => x.titleKm ?? '');
        issues.push({
          course_id: id,
          lesson_num: l.num,
          kind: 'duplicate-num',
          detail: `course "${titleKm}" num ${l.num} occ ${occ}/${numTotal.get(l.num)} → id ${id_lesson}; titles: ${siblings.map((s) => `«${s}»`).join(' | ')}`,
        });
      }

      let title = l.titleKm ?? '';
      if (title.trim() === '') {
        issues.push({ course_id: id, lesson_num: l.num, kind: 'empty_title', detail: 'kept as "no title"' });
        title = 'no title';
      }

      const overrideDriveId = courseOverrides ? courseOverrides[String(l.num)] : undefined;
      const media = lessonMedia(l, r2ByDriveId, courseIsR2, overrideDriveId);
      if (media.length === 0) {
        issues.push({ course_id: id, lesson_num: l.num, kind: 'no_media', detail: 'hidden' });
        return; // hidden: not emitted (but the duplicate warning above still stands)
      }
      for (const m of media) mediaKinds.add(m.kind);

      lessons.push({ id: id_lesson, num: l.num, title_km: title, topic: l.topic ?? '', media });
    });

    const courseFile = {
      id,
      provisional: true,
      title_km: titleKm,
      title_en: titleEn,
      teacher: co.teacher ?? '',
      teacher_slug: co.teacherSlug ?? '',
      topics: Array.isArray(co.topics) ? co.topics : [],
      lessons,
    };
    courseFiles.push(courseFile);

    catalogCourses.push({
      id,
      provisional: true,
      title_km: titleKm,
      title_en: titleEn,
      teacher: co.teacher ?? '',
      teacher_slug: co.teacherSlug ?? '',
      topics: courseFile.topics,
      lesson_count: lessons.length,
      media_kinds: [...mediaKinds].sort(),
    });
  });

  return {
    catalog: { provisional: true, courses: catalogCourses },
    courses: courseFiles,
    issues,
    teacherSlugs,
  };
}

/**
 * True when an issue is a hard-fail (stops the build). `unknown_teacher` is the
 * only hard fail: it means a course points at a teacher slug not in the teacher
 * file, which cannot be rendered. `duplicate-num`, `empty_title`, and `no_media`
 * are WARNINGS — handled (kept/renamed/hidden) and reported, never fatal.
 * (Coordinator 26 Oct 2026: duplicate num is a warning, not a build failure.)
 */
export function isHardFail(issue) {
  return issue.kind === 'unknown_teacher' || issue.kind === 'lesson_two_keys';
}

// ── bulk 09: build from the master sheet export ─────────────────────────────

/** source_type (master column) -> the link column that holds the Drive id of the source. */
const SOURCE_COL = { mp3: 'mp3_link', mp4: 'mp4_link', minicourse: 'minicourse_link' };

/** Khmer or ASCII digits -> integer; -1 when the text is not a plain number. */
export function khmerNumber(text) {
  const t = String(text ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!/^[0-9\u17E0-\u17E9]+$/.test(t)) return -1;
  let n = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0);
    n = n * 10 + (c >= 0x17e0 && c <= 0x17e9 ? c - 0x17e0 : c - 48);
  }
  return n;
}

/**
 * Which master rows are shown. A row is shown when the Drive id of its `source_type`
 * link has an APPROVED (non-DRAFT) entry in the media manifest. If two rows share one
 * source id the FIRST row (sheet order) wins. Rows without a course id (hidden tab)
 * are never shown and do not claim a source. Returns Map(row -> manifest entry) and
 * the reason for every other row with a course id.
 */
export function shownRows(lessonRows, mediaManifest) {
  const approved = new Map();
  for (const e of mediaManifest || []) {
    if (e && e.drive_file_id && e.key && /^approved\b/i.test(e.status || '')) approved.set(e.drive_file_id, e);
  }
  const shown = new Map();
  const hidden = new Map(); // row -> reason
  const claimed = new Set();
  for (const r of lessonRows) {
    if (!r.course_id) continue;
    const col = SOURCE_COL[r.source_type];
    const id = col ? driveIds(r[col])[0] : null;
    if (!id) { hidden.set(r, 'no source'); continue; }
    if (claimed.has(id)) { hidden.set(r, 'duplicate source (an earlier row has it)'); continue; }
    claimed.add(id);
    const entry = approved.get(id);
    if (entry) shown.set(r, entry);
    else hidden.set(r, 'no approved media yet');
  }
  return { shown, hidden };
}

/**
 * Master export -> { catalog, courses, issues }. Pure; used by the build and by the
 * contract tests (with a small fixture, never the real titles).
 *   lessonRows / courseRows  parsed data/master/lessons.csv / courses.csv (objects)
 *   teachers                 the teacher records (name_km -> slug)
 *   mediaManifest            data/media-manifest.json
 * Visible lesson = approved R2 audio (shownRows). Visible course = at least one
 * visible lesson and a mapped teacher. Lesson order = lesson_no as a number (Khmer
 * digits count), ties and non-numbers by sheet row. Titles are copied byte for byte.
 */
export function buildFromMaster(lessonRows, courseRows, teachers, mediaManifest) {
  const issues = [];
  const slugByName = new Map();
  const dupNames = new Set();
  for (const t of teachers) {
    if (slugByName.has(t.name_km)) dupNames.add(t.name_km);
    slugByName.set(t.name_km, t.slug);
  }
  const courseRowById = new Map((courseRows || []).map((c) => [c.course_id, c]));
  const { shown, hidden } = shownRows(lessonRows, mediaManifest);

  const byCourse = new Map(); // course_id -> rows in sheet order
  for (const r of lessonRows) {
    if (!r.course_id) continue;
    if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, []);
    byCourse.get(r.course_id).push(r);
  }
  const ids = [...new Set([...byCourse.keys(), ...courseRowById.keys()])].sort();

  const catalogCourses = [];
  const courseFiles = [];
  for (const cid of ids) {
    const rows = byCourse.get(cid) || [];
    const cr = courseRowById.get(cid) || {};
    const showRows = rows.filter((r) => shown.has(r));
    for (const r of rows) {
      if (!shown.has(r)) issues.push({ course_id: cid, lesson_num: r.lesson_no, kind: 'lesson_hidden', detail: hidden.get(r) || 'no source' });
    }
    if (showRows.length === 0) {
      issues.push({ course_id: cid, lesson_num: '', kind: 'course_hidden', detail: 'no approved lesson' });
      continue;
    }
    const teacherName = cr.teacher || rows[0].teacher || '';
    if (teacherName === 'pending') {
      issues.push({ course_id: cid, lesson_num: '', kind: 'course_hidden', detail: 'teacher pending (course has approved lessons)' });
      continue;
    }
    const slug = dupNames.has(teacherName) ? undefined : slugByName.get(teacherName);
    if (!slug) {
      // An approved lesson whose teacher cannot be mapped: stop the build (loud), as before.
      issues.push({ course_id: cid, lesson_num: '', kind: 'unknown_teacher', detail: teacherName || '(none)' });
      continue;
    }
    const titleKm = cr.course_title_km !== undefined && cr.course_title_km !== '' ? cr.course_title_km : rows[0].course_title_km ?? '';
    if (titleKm === '') issues.push({ course_id: cid, lesson_num: '', kind: 'empty_course_title', detail: 'shown with an empty title' });

    // Order: lesson_no as a number; ties and non-numbers by sheet row (stable sort).
    const order = showRows
      .map((r, i) => ({ r, i, n: khmerNumber(r.lesson_no) }))
      .sort((a, b) => (a.n < 0 ? Infinity : a.n) - (b.n < 0 ? Infinity : b.n) || a.i - b.i);
    const seenNums = new Map();
    const seenIds = new Set();
    const lessons = [];
    order.forEach(({ r, n }, pos) => {
      if (seenIds.has(r.lesson_id)) {
        issues.push({ course_id: cid, lesson_num: r.lesson_no, kind: 'duplicate_lesson_id', detail: r.lesson_id });
        return;
      }
      seenIds.add(r.lesson_id);
      const entry = shown.get(r);
      let num = n;
      if (n < 0) {
        num = pos + 1;
        issues.push({ course_id: cid, lesson_num: r.lesson_no, kind: 'lesson_no_not_number', detail: `shown as number ${num}` });
      }
      if (seenNums.has(num)) issues.push({ course_id: cid, lesson_num: r.lesson_no, kind: 'duplicate-num', detail: `id ${r.lesson_id} and ${seenNums.get(num)}` });
      else seenNums.set(num, r.lesson_id);
      if (r.lesson_title === '') issues.push({ course_id: cid, lesson_num: r.lesson_no, kind: 'empty_title', detail: 'shown with an empty title' });
      lessons.push({
        id: r.lesson_id,
        num,
        title_km: r.lesson_title,
        topic: '',
        media: [{ kind: 'r2', src: entry.key, duration_s: Number(entry.duration_s) || 0 }],
      });
    });

    const ongoing = cr.course_status === 'ongoing';
    const allShown = showRows.length === rows.length;
    courseFiles.push({
      id: cid, provisional: false, title_km: titleKm, title_en: null,
      teacher: teacherName, teacher_slug: slug, topics: [], ongoing, all_shown: allShown, lessons,
    });
    catalogCourses.push({
      id: cid, provisional: false, title_km: titleKm, title_en: null,
      teacher: teacherName, teacher_slug: slug, topics: [],
      lesson_count: lessons.length, media_kinds: ['r2'], ongoing, all_shown: allShown,
    });
  }
  return { catalog: { provisional: false, courses: catalogCourses }, courses: courseFiles, issues };
}

/**
 * Id guard (bulk 09 gap 8): a lesson id that had approved (r2) media in the previous
 * served data must still exist in the new data, unless it is a KEY of
 * data/id-aliases.json. Returns the lesson ids that disappeared; the build fails on any.
 */
export function approvedIdGuard(prevCourses, newCourses, aliasMap) {
  const now = new Set((newCourses || []).flatMap((c) => c.lessons.map((l) => l.id)));
  const lost = [];
  for (const c of prevCourses || []) {
    for (const l of c.lessons || []) {
      const had = (l.media || []).some((m) => m.kind === 'r2');
      if (had && !now.has(l.id) && !Object.prototype.hasOwnProperty.call(aliasMap || {}, l.id)) lost.push({ course_id: c.id, lesson_id: l.id });
    }
  }
  return lost;
}

// ── File runner ──────────────────────────────────────────────────────────────

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const srcDir = join(root, 'data', 'source');
  const teacherDir = join(srcDir, 'teachers-2026-11-02');
  const outDir = join(root, 'public', 'data');
  const coursesOut = join(outDir, 'courses');
  const photosOut = join(outDir, 'teacher-photos');
  const reportsDir = join(root, 'reports');

  const teachers = JSON.parse(readFileSync(join(teacherDir, 'teachers-2026-11-02.json'), 'utf-8'));
  const mediaManifestPath = join(root, 'data', 'media-manifest.json');
  const mediaManifest = existsSync(mediaManifestPath)
    ? JSON.parse(readFileSync(mediaManifestPath, 'utf-8'))
    : [];
  // bulk 09: the master sheet export (written by master-export.yml).
  const lessonsCsv = join(root, 'data', 'master', 'lessons.csv');
  const coursesCsv = join(root, 'data', 'master', 'courses.csv');
  if (!existsSync(lessonsCsv) || !existsSync(coursesCsv)) {
    console.error('BUILD FAILED — data/master/lessons.csv and courses.csv are missing (run master-export).');
    process.exit(1);
  }
  const lessonRows = parseCsvObjects(readFileSync(lessonsCsv, 'utf-8'));
  const courseRows = parseCsvObjects(readFileSync(coursesCsv, 'utf-8'));

  // Provisional→permanent id alias SOURCE map (Q5). Merged (copied) verbatim into
  // the served public/data/aliases.json; empty {} until permanent ids arrive.
  const aliasSrcPath = join(root, 'data', 'id-aliases.json');
  const aliasMap = existsSync(aliasSrcPath) ? JSON.parse(readFileSync(aliasSrcPath, 'utf-8')) : {};

  const { catalog, courses, issues } = buildFromMaster(lessonRows, courseRows, teachers, mediaManifest);

  // Id guard (gap 8): nothing is written if a lesson id with approved media would vanish.
  const prevCourses = existsSync(coursesOut)
    ? readdirSync(coursesOut).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(coursesOut, f), 'utf-8')))
    : [];
  const lostIds = approvedIdGuard(prevCourses, courses, aliasMap);
  if (lostIds.length) {
    for (const x of lostIds) console.error(`::error::lesson id ${x.lesson_id} (course ${x.course_id}) had approved media and is gone; add it to data/id-aliases.json if intended`);
    console.error(`BUILD FAILED — ${lostIds.length} lesson id(s) with approved media disappeared.`);
    process.exit(1);
  }

  // Study companion (bulk-05): data/paths.json + data/guide-lines.json are
  // edited by people and copied VERBATIM to public/data/. A bad shape stops the
  // build (before anything is written), so a bad file never gets a hash.
  const pathsSrc = join(root, 'data', 'paths.json');
  const guideSrc = join(root, 'data', 'guide-lines.json');
  const pathsJson = JSON.parse(readFileSync(pathsSrc, 'utf-8'));
  const guideJson = JSON.parse(readFileSync(guideSrc, 'utf-8'));
  const shapeErrs = [...pathsShapeErrors(pathsJson), ...guideLinesShapeErrors(guideJson)];
  if (shapeErrs.length) {
    console.error('BUILD FAILED — companion data has a bad shape:\n  ' + shapeErrs.join('\n  '));
    process.exit(1);
  }

  // Output directories.
  mkdirSync(coursesOut, { recursive: true });
  mkdirSync(photosOut, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });

  // teachers.json (display rules applied).
  const teachersOut = { teachers: teachers.map(teacherRecord) };

  // Copy teacher photos as-is.
  const photoSrcDir = join(teacherDir, 'teacher-photos');
  if (existsSync(photoSrcDir)) {
    for (const f of readdirSync(photoSrcDir)) copyFileSync(join(photoSrcDir, f), join(photosOut, f));
  }

  const generated = buildStamp(root);

  // Write per-course files and build the manifest file list.
  const files = {};
  for (const c of courses) {
    const rel = `courses/${c.id}.json`;
    writeJson(join(coursesOut, `${c.id}.json`), c);
    files[c.id] = { file: rel, updated: generated, sha256: sha256File(join(coursesOut, `${c.id}.json`)) };
  }

  // Stale course files (courses that are no longer shown) are removed, so the folder
  // always holds exactly the courses in the manifest.
  const keep = new Set(courses.map((c) => `${c.id}.json`));
  for (const f of readdirSync(coursesOut)) if (f.endsWith('.json') && !keep.has(f)) unlinkSync(join(coursesOut, f));

  writeJson(join(outDir, 'catalog.json'), { generated, ...catalog });
  writeJson(join(outDir, 'teachers.json'), teachersOut);
  writeJson(join(outDir, 'aliases.json'), aliasMap); // merged from data/id-aliases.json (empty until permanent ids)

  copyFileSync(pathsSrc, join(outDir, 'paths.json'));
  copyFileSync(guideSrc, join(outDir, 'guide-lines.json'));
  files.paths = { file: 'paths.json', updated: generated, sha256: sha256File(join(outDir, 'paths.json')) };
  files['guide-lines'] = { file: 'guide-lines.json', updated: generated, sha256: sha256File(join(outDir, 'guide-lines.json')) };

  files.catalog = { file: 'catalog.json', updated: generated, sha256: sha256File(join(outDir, 'catalog.json')) };
  files.teachers = { file: 'teachers.json', updated: generated, sha256: sha256File(join(outDir, 'teachers.json')) };
  files.aliases = { file: 'aliases.json', updated: generated, sha256: sha256File(join(outDir, 'aliases.json')) };

  writeJson(join(outDir, 'manifest.json'), { generated, files });

  // Issues CSV (untracked).
  const header = 'course_id,lesson_num,kind,detail';
  const rows = issues.map(
    (i) => `${i.course_id},${i.lesson_num},${i.kind},"${String(i.detail).replace(/"/g, '""')}"`
  );
  writeFileSync(join(reportsDir, 'course-issues.csv'), [header, ...rows].join('\n') + '\n', 'utf-8');

  // Companion issues (untracked): unknown course ids in paths / course_signs.
  const catalogIds = new Set(catalog.courses.map((c) => c.id));
  const compRows = companionIssues(pathsJson, guideJson, catalogIds, aliasMap);
  writeFileSync(join(reportsDir, 'paths-issues.csv'), issuesCsv(compRows), 'utf-8');
  console.log(`reports/paths-issues.csv written (${compRows.length} rows)`);

  // Summary.
  const hard = issues.filter(isHardFail);
  const counts = issues.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {});
  console.log(`courses: ${courses.length}, lessons emitted: ${courses.reduce((n, c) => n + c.lessons.length, 0)}`);
  console.log('issues:', JSON.stringify(counts));
  console.log(`reports/course-issues.csv written (${issues.length} rows)`);

  if (hard.length > 0) {
    console.error(`BUILD FAILED — ${hard.length} hard-fail issue(s): unknown_teacher (an approved lesson whose teacher is not in the teacher file). See reports/course-issues.csv.`);
    process.exit(1);
  }
  console.log('build OK');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('build-courses.mjs')) main();
