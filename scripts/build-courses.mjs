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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── ID helpers ───────────────────────────────────────────────────────────────

export function courseId(index0) {
  return `c${String(index0 + 1).padStart(3, '0')}`;
}
export function lessonId(index0, lessonIndex0) {
  return `${courseId(index0)}-l${String(lessonIndex0 + 1).padStart(3, '0')}`;
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
 * Build a lesson's media array from its source fields and the set of
 * drive_file_ids that have an APPROVED (non-DRAFT) R2 entry.
 * An approved Drive recording becomes an `r2` entry pointing at the R2 key.
 */
export function lessonMedia(lesson, r2ByDriveId) {
  const out = [];
  for (const src of [lesson.audioEmbedSrc, lesson.videoPreviewSrc]) {
    const kind = classifyMedia(src);
    if (!kind) continue;
    if (kind === 'drive' && r2ByDriveId) {
      const driveId = extractDriveId(src);
      const r2 = driveId && r2ByDriveId.get(driveId);
      if (r2) {
        out.push({ kind: 'r2', src: r2.key });
        continue;
      }
    }
    out.push({ kind, src });
  }
  return out;
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
    // Only APPROVED entries become r2 media; DRAFT entries are ignored.
    if (e && e.drive_file_id && e.key && !/^DRAFT\b/i.test(e.status || '')) {
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

    if (!teacherSlugs.has(co.teacherSlug)) {
      issues.push({ course_id: id, lesson_num: '', kind: 'unknown_teacher', detail: co.teacherSlug ?? '(none)' });
    }

    const seenNums = new Set();
    const lessons = [];
    const mediaKinds = new Set();

    (co.lessons || []).forEach((l) => {
      if (seenNums.has(l.num)) {
        issues.push({ course_id: id, lesson_num: l.num, kind: 'duplicate_num', detail: `num ${l.num}` });
        return; // do not emit the duplicate
      }
      seenNums.add(l.num);

      let title = l.titleKm ?? '';
      if (title.trim() === '') {
        issues.push({ course_id: id, lesson_num: l.num, kind: 'empty_title', detail: 'kept as "no title"' });
        title = 'no title';
      }

      const media = lessonMedia(l, r2ByDriveId);
      if (media.length === 0) {
        issues.push({ course_id: id, lesson_num: l.num, kind: 'no_media', detail: 'hidden' });
        return; // hidden: not emitted
      }
      for (const m of media) mediaKinds.add(m.kind);

      lessons.push({ num: l.num, title_km: title, topic: l.topic ?? '', media });
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

/** True when an issue is a hard-fail (stops the build). */
export function isHardFail(issue) {
  return issue.kind === 'duplicate_num' || issue.kind === 'unknown_teacher';
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

  const generated = new Date().toISOString();

  // Write per-course files and build the manifest file list.
  const files = {};
  for (const c of courses) {
    const rel = `courses/${c.id}.json`;
    writeJson(join(coursesOut, `${c.id}.json`), c);
    files[c.id] = { file: rel, updated: generated, sha256: sha256File(join(coursesOut, `${c.id}.json`)) };
  }

  writeJson(join(outDir, 'catalog.json'), { generated, ...catalog });
  writeJson(join(outDir, 'teachers.json'), teachersOut);
  writeJson(join(outDir, 'aliases.json'), {}); // empty until permanent ids exist

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
    console.error(`BUILD FAILED — ${hard.length} hard-fail issue(s): duplicate_num / unknown_teacher. See reports/course-issues.csv.`);
    process.exit(1);
  }
  console.log('build OK');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('build-courses.mjs')) main();
