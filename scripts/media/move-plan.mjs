/**
 * scripts/media/move-plan.mjs — media move plan (bulk-04 S2).
 *
 * OFFLINE and read-only: reads ONLY the committed source catalogue
 * (data/source/website-courses-2026-09-28.json) and emits a plan of what media
 * each lesson has and, for Drive-backed audio/video, the R2 key it WOULD get if
 * transcoded. It makes NO network call to Drive, R2, Acast, or YouTube and does
 * not touch public/data/.
 *
 * Why the SOURCE file, not the served course files: the served
 * public/data/courses/<id>.json collapses a Drive source to `{kind:"drive"}`
 * and loses whether it was the audio or the video field. The move plan needs
 * that distinction (drive-audio vs drive-video), so it reads the raw source
 * where `audioEmbedSrc` and `videoPreviewSrc` are separate.
 *
 * Outputs (all in reports/, which is gitignored — working notes):
 *   reports/media-move-plan.csv   one row per lesson that has media
 *   reports/media-move-plan.md    summary by teacher and by kind, + totals
 * and the pilot queue (tracked data input, committed only on say-so):
 *   data/audio-queue.pilot.csv    the pilot course's Drive ids in lesson order
 *
 * Row columns (CSV + the md detail):
 *   course_id, lesson_id, teacher, kind, drive_file_id, planned_key, status
 *   - kind:        drive-audio | drive-video | acast | youtube
 *   - drive_file_id: the Drive id, else empty
 *   - planned_key: audio/<drive_file_id>-a64.mp3 for ANY Drive file, else empty
 *                  (this is the REAL pipeline key, scripts/media/transcode-one.sh)
 *   - status:      ready        = a Drive id is known (can be transcoded)
 *                  needs-original = Acast/YouTube only (original lives elsewhere)
 *
 * IDs match scripts/build-courses.mjs: course c### by source order,
 * lesson c###-l### by the num's first source position, with a letter suffix for
 * a duplicate num. A lesson with media on BOTH fields yields two rows (audio and
 * video), both under the same lesson id.
 *
 * The pure functions are exported for unit tests (fixtures, never real titles).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  courseId,
  lessonIdSuffixed,
  classifyMedia,
  extractDriveId,
} from '../build-courses.mjs';

/** The pilot course is matched by teacher slug + exact stored title. */
export const PILOT_TEACHER_SLUG = 'yon-yi';
export const PILOT_TITLE = 'ថ្នាក់កុមារ វេស្សន្តរជាតក';

/** R2 key a Drive file would get — the real pipeline convention. */
export function plannedKey(driveFileId) {
  return driveFileId ? `audio/${driveFileId}-a64.mp3` : '';
}

/**
 * Build the plan rows from the raw source courses array.
 * Returns { rows, pilot } where
 *   rows  = [{ course_id, lesson_id, teacher, kind, drive_file_id, planned_key, status }]
 *   pilot = { found, course_id, title, driveIds[], noDriveLessons[] } | null
 */
export function buildPlan(sourceCourses) {
  const rows = [];
  let pilot = null;

  (Array.isArray(sourceCourses) ? sourceCourses : []).forEach((co, i) => {
    const cId = courseId(i);
    const teacher = co.teacherSlug ?? '';

    // Lesson-id numbering identical to the build: id base = num's first source
    // position; duplicate num gets a letter suffix (occ 2 → b, …).
    const numFirstIndex = new Map();
    (co.lessons || []).forEach((l, li) => {
      if (!numFirstIndex.has(l.num)) numFirstIndex.set(l.num, li);
    });
    const numOccurrence = new Map();

    const isPilot = co.teacherSlug === PILOT_TEACHER_SLUG && co.titleKm === PILOT_TITLE;
    const pilotDriveIds = [];
    const pilotNoDrive = [];

    (co.lessons || []).forEach((l) => {
      const occ = (numOccurrence.get(l.num) || 0) + 1;
      numOccurrence.set(l.num, occ);
      const lId = lessonIdSuffixed(i, numFirstIndex.get(l.num), occ);

      // audioEmbedSrc → audio-ish; videoPreviewSrc → video-ish.
      const fields = [
        { src: l.audioEmbedSrc, slot: 'audio' },
        { src: l.videoPreviewSrc, slot: 'video' },
      ];

      let lessonDriveId = null;
      for (const { src, slot } of fields) {
        const base = classifyMedia(src);
        if (!base) continue;
        let kind = base;
        if (base === 'drive') kind = slot === 'audio' ? 'drive-audio' : 'drive-video';
        const driveFileId = base === 'drive' ? extractDriveId(src) || '' : '';
        if (driveFileId && !lessonDriveId) lessonDriveId = driveFileId;
        rows.push({
          course_id: cId,
          lesson_id: lId,
          teacher,
          kind,
          drive_file_id: driveFileId,
          planned_key: plannedKey(driveFileId),
          status: driveFileId ? 'ready' : 'needs-original',
        });
      }

      if (isPilot) {
        if (lessonDriveId) pilotDriveIds.push(lessonDriveId);
        else pilotNoDrive.push(lId);
      }
    });

    if (isPilot) {
      pilot = {
        found: true,
        course_id: cId,
        title: co.titleKm,
        driveIds: pilotDriveIds,
        noDriveLessons: pilotNoDrive,
        lessonCount: (co.lessons || []).length,
      };
    }
  });

  return { rows, pilot };
}

/** Count rows by kind. */
export function countByKind(rows) {
  const m = { 'drive-audio': 0, 'drive-video': 0, acast: 0, youtube: 0 };
  for (const r of rows) m[r.kind] = (m[r.kind] || 0) + 1;
  return m;
}

/** Count rows by teacher → { teacher: {drive-audio, drive-video, acast, youtube, total} }. */
export function countByTeacher(rows) {
  const out = {};
  for (const r of rows) {
    const t = (out[r.teacher] ||= { 'drive-audio': 0, 'drive-video': 0, acast: 0, youtube: 0, total: 0 });
    t[r.kind] = (t[r.kind] || 0) + 1;
    t.total += 1;
  }
  return out;
}

/** Unique Drive ids across all rows. */
export function uniqueDriveIds(rows) {
  const s = new Set();
  for (const r of rows) if (r.drive_file_id) s.add(r.drive_file_id);
  return s;
}

/** CSV text for the per-lesson rows. */
export function toCsv(rows) {
  const header = 'course_id,lesson_id,teacher,kind,drive_file_id,planned_key,status';
  const body = rows.map(
    (r) =>
      [r.course_id, r.lesson_id, r.teacher, r.kind, r.drive_file_id, r.planned_key, r.status].join(',')
  );
  return [header, ...body].join('\n') + '\n';
}

/** Pilot queue CSV: header + one Drive id per line, lesson order. */
export function pilotQueueCsv(pilot) {
  const ids = pilot && pilot.found ? pilot.driveIds : [];
  return ['drive_file_id', ...ids].join('\n') + '\n';
}

// Expected totals asserted by the task (bulk-04 S2); the script reports its own
// counts and any difference, it does NOT edit data to match.
const EXPECTED = {
  acast: 2188,
  youtube: 1521,
  'drive-audio': 887,
  'drive-video': 465,
  uniqueDrive: 1352,
};

export function toMarkdown(rows, pilot) {
  const byKind = countByKind(rows);
  const byTeacher = countByTeacher(rows);
  const uniqueDrive = uniqueDriveIds(rows).size;

  const L = [];
  L.push('# Media move plan (bulk-04 S2)');
  L.push('');
  L.push('Offline plan built from `data/source/website-courses-2026-09-28.json` only.');
  L.push('No network call to Drive/R2/Acast/YouTube. One row per lesson-field with media.');
  L.push('');
  L.push('## Totals by kind (script counts vs task-expected)');
  L.push('');
  L.push('| kind | count | expected | diff |');
  L.push('| --- | ---: | ---: | ---: |');
  for (const k of ['acast', 'youtube', 'drive-audio', 'drive-video']) {
    const c = byKind[k] || 0;
    const e = EXPECTED[k];
    L.push(`| ${k} | ${c} | ${e} | ${c - e >= 0 ? '+' : ''}${c - e} |`);
  }
  L.push(`| **unique Drive ids** | ${uniqueDrive} | ${EXPECTED.uniqueDrive} | ${uniqueDrive - EXPECTED.uniqueDrive >= 0 ? '+' : ''}${uniqueDrive - EXPECTED.uniqueDrive} |`);
  L.push('');
  const totalRows = rows.length;
  L.push(`Total media rows: ${totalRows}.`);
  L.push('');
  L.push('Sizes: unknown — from media-inventory run.');
  L.push('');
  L.push('## By teacher');
  L.push('');
  L.push('| teacher | drive-audio | drive-video | acast | youtube | total |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const t of Object.keys(byTeacher).sort()) {
    const r = byTeacher[t];
    L.push(`| ${t} | ${r['drive-audio']} | ${r['drive-video']} | ${r.acast} | ${r.youtube} | ${r.total} |`);
  }
  L.push('');
  L.push('## Pilot course (teacher yon-yi)');
  L.push('');
  if (pilot && pilot.found) {
    L.push(`- course_id: \`${pilot.course_id}\` · lessons: ${pilot.lessonCount}`);
    L.push(`- Drive ids found (lesson order): ${pilot.driveIds.length}`);
    L.push(`- lessons with NO Drive id (original comes from the teacher's Drive folder later): ${pilot.noDriveLessons.length}`);
    if (pilot.noDriveLessons.length) {
      L.push('');
      L.push('  ' + pilot.noDriveLessons.map((x) => `\`${x}\``).join(', '));
    }
    L.push('');
    L.push('Pilot Drive ids written to `data/audio-queue.pilot.csv` in lesson order.');
  } else {
    L.push('- NOT FOUND — no course matched teacher yon-yi + the pilot title.');
  }
  L.push('');
  return L.join('\n') + '\n';
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');
  const srcPath = join(root, 'data', 'source', 'website-courses-2026-09-28.json');
  const reportsDir = join(root, 'reports');

  if (!existsSync(srcPath)) {
    console.error(`move-plan: source not found: ${srcPath}`);
    process.exit(1);
  }
  const sourceCourses = JSON.parse(readFileSync(srcPath, 'utf-8')).c;
  const { rows, pilot } = buildPlan(sourceCourses);

  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'media-move-plan.csv'), toCsv(rows), 'utf-8');
  writeFileSync(join(reportsDir, 'media-move-plan.md'), toMarkdown(rows, pilot), 'utf-8');
  writeFileSync(join(root, 'data', 'audio-queue.pilot.csv'), pilotQueueCsv(pilot), 'utf-8');

  const byKind = countByKind(rows);
  console.log('move-plan rows:', rows.length);
  console.log('by kind:', JSON.stringify(byKind));
  console.log('unique Drive ids:', uniqueDriveIds(rows).size);
  console.log('expected:', JSON.stringify(EXPECTED));
  if (pilot && pilot.found) {
    console.log(`pilot ${pilot.course_id}: ${pilot.driveIds.length} drive ids, ${pilot.noDriveLessons.length} no-drive of ${pilot.lessonCount} lessons`);
  } else {
    console.log('pilot: NOT FOUND');
  }
  console.log('wrote reports/media-move-plan.{csv,md} + data/audio-queue.pilot.csv');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('move-plan.mjs')) main();
