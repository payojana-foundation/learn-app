/**
 * scripts/build-courses.mjs — build the served course data (P3).
 *
 * Reads the frozen sources:
 *   data/source/website-courses-2026-09-28.json
 *   data/source/teachers-2026-10-25/teachers-2026-10-25.json  (+ teacher-photos/)
 *   data/media-manifest.json  (optional; from the media pipeline, P2)
 * and writes:
 *   public/data/catalog.json
 *   public/data/courses/<id>.json   (one per course)
 *   public/data/teachers.json
 *   public/data/aliases.json        (empty until permanent ids exist)
 *   public/data/manifest.json       (SHA-256 of every served file)
 * plus reports/course-issues.csv (untracked).
 *
 * Titles and names are copied byte-for-byte; the build never retypes, trims,
 * normalises, or translates them. IDs are provisional (`c###`, `c###-l###`),
 * flagged `provisional: true`, and carry an aliases hook for the permanent ids.
 *
 * Exit 0 when all hard checks pass; exit 1 on any hard-fail check.
 *
 * The transform functions are exported so contract tests can exercise them with
 * a small fixture (never the real titles).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  'data/source/website-courses-2026-09-28.json',
  'data/source/teachers-2026-10-25/teachers-2026-10-25.json',
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
export function lessonMedia(lesson, r2ByDriveId, courseIsR2) {
  const out = [];
  for (const src of [lesson.audioEmbedSrc, lesson.videoPreviewSrc]) {
    const kind = classifyMedia(src);
    if (!kind) continue;
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
export function courseAllDriveApproved(course, r2ByDriveId) {
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
export function buildCourses(sourceCourses, teachers, mediaManifest) {
  const teacherSlugs = new Set(teachers.map((t) => t.slug));
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

  sourceCourses.forEach((co, i) => {
    const id = courseId(i);
    const titleKm = co.titleKm ?? '';
    const titleEn = englishTitle(titleKm, co.titleEn);

    // Course-level all-or-nothing r2 (Q4): only when EVERY Drive-backed lesson
    // in this course has an approved (non-DRAFT) manifest entry.
    const courseIsR2 = courseAllDriveApproved(co, r2ByDriveId);

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

      const media = lessonMedia(l, r2ByDriveId, courseIsR2);
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
  return issue.kind === 'unknown_teacher';
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
  const teacherDir = join(srcDir, 'teachers-2026-10-25');
  const outDir = join(root, 'public', 'data');
  const coursesOut = join(outDir, 'courses');
  const photosOut = join(outDir, 'teacher-photos');
  const reportsDir = join(root, 'reports');

  const sourceCourses = JSON.parse(readFileSync(join(srcDir, 'website-courses-2026-09-28.json'), 'utf-8')).c;
  const teachers = JSON.parse(readFileSync(join(teacherDir, 'teachers-2026-10-25.json'), 'utf-8'));
  const mediaManifestPath = join(root, 'data', 'media-manifest.json');
  const mediaManifest = existsSync(mediaManifestPath)
    ? JSON.parse(readFileSync(mediaManifestPath, 'utf-8'))
    : [];

  // Provisional→permanent id alias SOURCE map (Q5). Merged (copied) verbatim into
  // the served public/data/aliases.json; empty {} until permanent ids arrive.
  const aliasSrcPath = join(root, 'data', 'id-aliases.json');
  const aliasMap = existsSync(aliasSrcPath) ? JSON.parse(readFileSync(aliasSrcPath, 'utf-8')) : {};

  const { catalog, courses, issues } = buildCourses(sourceCourses, teachers, mediaManifest);

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

  writeJson(join(outDir, 'catalog.json'), { generated, ...catalog });
  writeJson(join(outDir, 'teachers.json'), teachersOut);
  writeJson(join(outDir, 'aliases.json'), aliasMap); // merged from data/id-aliases.json (empty until permanent ids)

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

  // Summary.
  const hard = issues.filter(isHardFail);
  const counts = issues.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {});
  console.log(`courses: ${courses.length}, lessons emitted: ${courses.reduce((n, c) => n + c.lessons.length, 0)}`);
  console.log('issues:', JSON.stringify(counts));
  console.log(`reports/course-issues.csv written (${issues.length} rows)`);

  if (hard.length > 0) {
    console.error(`BUILD FAILED — ${hard.length} hard-fail issue(s): unknown_teacher. See reports/course-issues.csv.`);
    process.exit(1);
  }
  console.log('build OK');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('build-courses.mjs')) main();
