/**
 * scripts/catalogue/catalogue-build.mjs — Job catalogue build (decisions 1–9,
 * coordinator 4 Nov). PREP/REPORT: it reads the teacher sheets and the three
 * registries and writes id-aliases, batch queues, an index and a hidden-lessons
 * report. It does NOT touch public/data or build-courses — the live app build is
 * unchanged. Khmer is copied byte-for-byte; codes/titles/slugs are never invented.
 *
 * Inputs:
 *   data/source/sheets/*.xlsx        the course tabs (one course = one tab)
 *   data/source/sheets/INVENTORY.md  file_id → display name
 *   data/teacher-files.json          file_id → teacher slug (decision 4)
 *   data/course-ids.json             "<file_id>\t<tab>" → c### (decision 2)
 *   data/media-manifest.json         approved/DRAFT entries (hide + queue gating)
 *   data/audio-queue.pilot.csv       the pilot's 15 MiniCourse ids (decision 5)
 * Outputs:
 *   data/id-aliases.json             provisional id → new id (decision 1)
 *   data/course-ids.json             updated with any newly-assigned c### (dec 2)
 *   data/queues/<c###>.csv           per-course batch queue (decision 7)
 *   data/queues/INDEX.md             course id · teacher · title · lessons · queued
 *   data/source/sheets/HIDDEN.md     hidden lessons per course + reason (decision 9)
 *
 * Decisions:
 *  1. lesson id = the audio lesson code (lesson_code) when present, else
 *     provisional `d-<source drive id>`. Pilot c080 → AJAD00YYX0101–0115 aliases.
 *  2. course id from the registry (reuse / next free c###; never renumber).
 *  3. course title = the section row above the first lesson, byte-for-byte; else
 *     the tab name, flagged "title missing".
 *  4. teacher from data/teacher-files.json; unmapped file → listed, hidden.
 *  5. source per lesson: cut MP3 → cut MP4 → MiniCourse; never the uncut original.
 *     Pilot keeps its MiniCourse ids (same audio already in the manifest).
 *  6. hidden: no source; duplicate source id (keep first row); tab
 *     7-មលិន្ទប្បញ្ហា; skipped tabs; a lesson with no approved manifest entry.
 *  7. per-course queues exclude hidden rows and ids already in the manifest.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTab, sheetToGrid, parseInventoryNames, outer, norm } from './sheets-map.mjs';
import { loadAliases, canonicalFileId, canonicalTab } from './file-aliases.mjs';

export const HIDDEN_TABS = ['7-មលិន្ទប្បញ្ហា'];
// Decision 6 (4 Nov, team-confirmed NOT courses): keyed by "<file_id>\t<tab>".
// These are already skipped by parseTab (no header row); listing them here makes
// the HIDDEN.md reason explicit ("confirmed not a course") instead of generic.
export const SKIP_TABS = new Set([
  '1PK2kBcIqMN46a9OyvFX5CxWYxzA78URtBjGyua2Q-S4\t2-បរិច្ឆេទទី២ (ឆ្នាំ ២០២២)',
  '1PK2kBcIqMN46a9OyvFX5CxWYxzA78URtBjGyua2Q-S4\tPramaha Vinh Sovoeurng',
  '1x8gSAqqV_Yr4gjwlEBVpx7k8TnLb2w03\tពុទ្ធប្រវត្តិ',
  '1uSuNVNJr-JylT1GqDY5GNRGF_Z_GhSjB1Ozlgv_WZMs\tContent',
]);
const PILOT_FILE = '1B7NgdftwwJeMZEtKm4cpz-3_Lp8RCtv7';
// Decision 5 (fix): files that are NOT teacher course sheets — excluded from
// teacher mapping and from HIDDEN.md's unmapped list.
export const NON_COURSE_FILES = new Set([
  '18Bzta6div7LcLV276uGTnkyAl889VPbk', // លេខ Season … ក្នុង Acast.xlsx
  '1KjWMiLWRJM2wqleHzNAH23sdYRRvUVX3', // E-Book.xlsx
]);

/** Khmer/ASCII digit string → integer sort value (-1 when not a clean number). */
export function khmerToInt(s) {
  const t = String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/[.)]+$/, '');
  if (!/^[0-9\u17E0-\u17E9]+$/.test(t)) return -1;
  let n = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0);
    const d = c >= 0x17e0 && c <= 0x17e9 ? c - 0x17e0 : c - 48;
    n = n * 10 + d;
  }
  return n;
}

/** The course-code PREFIX of a lesson code: the leading letters + the course
 * block, i.e. everything before the trailing lesson pair. ASUT017YY0003 → ASUT017YY. */
export function codePrefix(code) {
  const c = outer(code);
  // strip a trailing 2–4 digit lesson suffix if present
  const m = /^([A-Za-z].*?)(\d{2,4})$/.exec(c);
  return m ? m[1] : c;
}

/** Decision 2 (fix): a row is a SECTION row (not a lesson) when its number is
 * 0/០ or empty, OR its code equals the course prefix with no lesson suffix. */
export function isSectionRow(lesson) {
  const n = khmerToInt(lesson.number);
  if (n <= 0) return true; // 0, ០, or non-numeric/empty
  const code = outer(lesson.lesson_code);
  if (code && code === codePrefix(code)) return true; // e.g. ASUT017YY with no -NN
  return false;
}

/** Decision 5: pick ONE Drive id per lesson — cut MP3, then MP4, then MiniCourse
 * (never the uncut original). The pilot course keeps its MiniCourse id. */
export function pickSource(lesson, { pilot = false } = {}) {
  if (pilot) return { id: lesson.minicourse[0] || null, from: 'minicourse' };
  if (lesson.mp3[0]) return { id: lesson.mp3[0], from: 'mp3' };
  if (lesson.mp4[0]) return { id: lesson.mp4[0], from: 'mp4' };
  if (lesson.minicourse[0]) return { id: lesson.minicourse[0], from: 'minicourse' };
  return { id: null, from: null };
}

/** Decision 1: lesson id = the audio code when present, else `d-<drive id>`. */
export function lessonIdOf(lesson, sourceId) {
  const code = outer(lesson.lesson_code);
  if (code) return code;
  return sourceId ? `d-${sourceId}` : null;
}

/** Decision 1/3 (fix): the course title is the TITLE-column (ចំណងជើង មេរៀន) cell
 * of the section row just above the first lesson, byte-for-byte — NEVER the code
 * cell. `cols` is parseTab's column map; `headerRow`/`firstRow` are 1-based.
 * Empty → the tab name, flagged missing. */
export function courseTitle(text, cols, headerRow, firstRow, tabName) {
  for (let r = firstRow - 2; r >= headerRow; r--) {
    const row = text[r] || [];
    const titleCell = cols.title >= 0 ? outer(row[cols.title]) : '';
    const numCell = khmerToInt(cols.number >= 0 ? row[cols.number] : '');
    // the section row sits above the first lesson and has no lesson number
    if (numCell <= 0 && titleCell) return { title: titleCell, missing: false };
  }
  return { title: tabName, missing: true };
}

const approvedIds = (manifest) => new Set((manifest || []).filter((e) => e && e.drive_file_id && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
const manifestIds = (manifest) => new Set((manifest || []).filter((e) => e && e.drive_file_id).map((e) => e.drive_file_id));

/** Decision 6: match a sheet file to an EXISTING teacher by name, exact after a
 * ZWSP/whitespace trim — the full teacher name_km or name_en must appear in the
 * sheet's display name (minus .xlsx). Returns { slug, matchedOn } or null.
 * Never invents a slug; a partial/ambiguous name does NOT match. */
export function matchTeacher(fileName, teachers) {
  const hay = norm(String(fileName || '').replace(/\.xlsx$/i, ''));
  if (!hay) return null;
  const hits = [];
  for (const t of teachers) {
    for (const [field, val] of [['name_km', t.name_km], ['name_en', t.name_en]]) {
      const n = norm(val);
      if (n && hay.includes(n)) hits.push({ slug: t.slug, matchedOn: `${field}:${val}` });
    }
  }
  // Only a single, unambiguous teacher match is accepted.
  const slugs = new Set(hits.map((h) => h.slug));
  return slugs.size === 1 ? hits[0] : null;
}

/** Teacher for one sheet file AFTER aliases: the teacher-files.json entry for the
 * canonical (old) file id, else an unambiguous name match. { slug|null, match|null }. */
export function resolveTeacher(f, { teacherFiles = {}, teachers = [], aliases = null } = {}) {
  const fid = canonicalFileId(f.file_id, aliases);
  if (teacherFiles[fid]) return { slug: teacherFiles[fid], match: null };
  const m = matchTeacher(f.file_name, teachers);
  return m ? { slug: m.slug, match: m } : { slug: null, match: null };
}

/** Part B: sheet files that are course sheets but have no teacher after aliases.
 * [{ file_id, canonical_id, file_name }] — the catalogue job must fail on any. */
export function unmappedTeacherFiles(files, { teacherFiles = {}, teachers = [], aliases = null } = {}) {
  const out = [];
  for (const f of files) {
    const fid = canonicalFileId(f.file_id, aliases);
    if (NON_COURSE_FILES.has(fid)) continue;
    if (!resolveTeacher(f, { teacherFiles, teachers, aliases }).slug) out.push({ file_id: f.file_id, canonical_id: fid, file_name: f.file_name });
  }
  return out;
}

/** Part B: the lessons that are playable now (approved media), id → where. This is
 * the "catalogue" snapshot the id guard compares against. */
export function lessonIdSnapshot(plan) {
  const lessons = {};
  for (const c of plan.courses) for (const l of c.visible) lessons[l.lesson_id] = { course_id: c.course_id, source_id: l.source_id };
  return lessons;
}

/** Part B id guard: every lesson id that had approved media in the LAST committed
 * snapshot must still exist with the same source and course, unless the id is a
 * key in data/id-aliases.json. Returns [{ id, problem, was, now }]; [] = ok.
 * No baseline (first run) = nothing to compare. */
export function guardLessonIds(baseline, current, idAliases = {}) {
  const out = [];
  for (const [id, was] of Object.entries(baseline || {})) {
    if (Object.prototype.hasOwnProperty.call(idAliases || {}, id)) continue;
    const now = current[id];
    if (!now) out.push({ id, problem: 'disappeared', was, now: null });
    else if (now.source_id !== was.source_id || now.course_id !== was.course_id) out.push({ id, problem: 'changed', was, now });
  }
  return out;
}

/**
 * Pure core. Given parsed files + registries, produce the per-course plan.
 *   files        = [{ file_id, file_name, tabs: [{ name, text, links }] }]
 *   teacherFiles = { file_id: slug }
 *   courseIds    = { "<file_id>\t<tab>": "c###" }  (mutated copy returned)
 * Returns { courses[], hidden[], unmappedFiles[], registry, nextFree }.
 */
export function planCatalogue(files, { teacherFiles = {}, teachers = [], courseIds = {}, approved = new Set(), inManifest = new Set(), aliases = null } = {}) {
  const registry = { ...courseIds };
  const used = new Set(Object.values(registry));
  let probe = 1;
  const nextFreeId = () => {
    for (;;) {
      const c = `c${String(probe).padStart(3, '0')}`;
      probe += 1;
      if (!used.has(c)) { used.add(c); return c; }
    }
  };

  const hidden = []; // { course_id, teacher, title, lesson_id|null, num, reason }
  const unmappedFiles = [];
  const matchedFiles = {}; // file_id → { slug, matchedOn } (decision 6)

  // ── Phase 1: parse every course tab into candidate lessons. ─────────────────
  const courses = [];
  for (const f of files) {
    // Part A: resolve the file id (new → old) BEFORE any registry lookup.
    const fid = canonicalFileId(f.file_id, aliases);
    if (NON_COURSE_FILES.has(fid)) continue; // decision 5: skip non-courses
    const isPilotFile = fid === PILOT_FILE;
    // decision 6: teacher = the registry entry if present, else a name match.
    const { slug, match } = resolveTeacher(f, { teacherFiles, teachers, aliases });
    if (match) matchedFiles[fid] = match;
    if (!slug) unmappedFiles.push({ file_id: f.file_id, canonical_id: fid, file_name: f.file_name });

    for (const t of f.tabs) {
      // Part A: then the tab name (new → old), still before any lookup.
      const tabName = canonicalTab(f.file_id, t.name, aliases);
      const key = `${fid}\t${tabName}`;
      const tabHidden = HIDDEN_TABS.includes(tabName);
      const teamSkipped = SKIP_TABS.has(key);
      const parsed = parseTab(t);
      if (parsed.status !== 'ok' || tabHidden || teamSkipped) {
        if (teamSkipped) {
          hidden.push({ course_id: registry[key] || null, teacher: slug, title: t.name, lesson_id: null, num: '', reason: 'confirmed not a course (team 4 Nov)' });
        } else if (tabHidden || parsed.lessons.length) {
          hidden.push({ course_id: registry[key] || null, teacher: slug, title: t.name, lesson_id: null, num: '', reason: tabHidden ? `hidden tab (${t.name})` : `skipped tab: ${parsed.reason}` });
        }
        continue;
      }
      const cid = registry[key] || nextFreeId();
      registry[key] = cid;
      const isPilotCourse = isPilotFile && norm(tabName).includes('វេស្សន្តរជាត');
      // decision 2 (fix): a leading section row carries the course title; real
      // lessons are the rows that are NOT section rows.
      const firstLesson = parsed.lessons.find((l) => !isSectionRow(l)) || parsed.lessons[0];
      const { title, missing } = courseTitle(t.text, parsed.cols, parsed.headerRow, firstLesson.row, t.name);

      const cand = [];
      for (const l of parsed.lessons) {
        if (isSectionRow(l)) { // decision 2: not a lesson
          if (outer(l.lesson_code) || l.mp3[0] || l.mp4[0] || l.minicourse[0]) {
            hidden.push({ course_id: cid, teacher: slug, title, num: l.number, lesson_id: null, reason: `section row (num ${l.number || '∅'}${outer(l.lesson_code) ? ', code ' + outer(l.lesson_code) : ''})` });
          }
          continue;
        }
        const { id: sourceId, from } = pickSource(l, { pilot: isPilotCourse });
        cand.push({ course_id: cid, teacher: slug, title, num: l.number, num_sort: khmerToInt(l.number), lesson_code: outer(l.lesson_code), lesson_id: lessonIdOf(l, sourceId), source_id: sourceId, source_from: from });
      }
      courses.push({ course_id: cid, file_id: f.file_id, file_name: f.file_name, tab: t.name, teacher: slug, title, title_missing: missing, pilot: isPilotCourse, candidates: cand });
    }
  }

  // ── Phase 2: GLOBAL duplicate checks BEFORE the teacher check (decision 3).
  // Keep the first row of each duplicate code / source id (across ALL courses);
  // hide the later rows with a reason. Order = course order, then sheet row.
  const all = courses.flatMap((c) => c.candidates);
  const seenCode = new Set();
  const seenSrc = new Set();
  for (const c of courses) {
    const visible = [];
    const queueable = [];
    for (const l of c.candidates) {
      if (!l.source_id) { hidden.push({ ...l, reason: 'no source (no cut MP3 / MP4 / MiniCourse id)' }); continue; }
      if (l.lesson_code && seenCode.has(l.lesson_code)) { hidden.push({ ...l, reason: `duplicate lesson code ${l.lesson_code} (first kept)` }); continue; }
      if (seenSrc.has(l.source_id)) { hidden.push({ ...l, reason: `duplicate source id ${l.source_id} (first kept, may be another course)` }); continue; }
      if (l.lesson_code) seenCode.add(l.lesson_code);
      seenSrc.add(l.source_id);
      // teacher check AFTER the dup checks (decision 3)
      if (!l.teacher) { hidden.push({ ...l, reason: 'teacher file not mapped' }); continue; }
      queueable.push(l);
      if (approved.has(l.source_id)) visible.push({ ...l, playable: true });
      else hidden.push({ ...l, reason: 'no approved manifest entry yet (hidden until approved)' });
    }
    c.visible = visible;
    c.queueable = queueable;
    c.lessons = c.candidates.length;
    c.hidden_count = c.candidates.length - visible.length;
    delete c.candidates;
  }

  // Build-fail guard (decision 3): no two VISIBLE lessons may share a lesson id.
  const idSeen = new Map();
  const idCollisions = [];
  for (const c of courses) for (const l of c.visible) {
    if (idSeen.has(l.lesson_id)) idCollisions.push({ id: l.lesson_id, a: idSeen.get(l.lesson_id), b: `${c.course_id} row ${l.num}` });
    else idSeen.set(l.lesson_id, `${c.course_id} row ${l.num}`);
  }

  return { courses, hidden, unmappedFiles, matchedFiles, registry, nextFree: probe, idCollisions, total: all.length };
}

/** Decision 1: alias map for the pilot — provisional c080-l0NN → the new lesson
 * id (the AJAD audio code), in lesson order. Course id c080 itself is unchanged.
 * Pure + exported so a fixture test can assert the pilot carry-over. */
export function pilotAliases(pilotCourse) {
  const map = {};
  if (!pilotCourse) return map;
  // ALL pilot lessons in order (approval-independent), so every tester's c080
  // progress carries over, not just the already-uploaded ones.
  (pilotCourse.queueable || []).forEach((l, i) => {
    map[`c080-l${String(i + 1).padStart(3, '0')}`] = l.lesson_id;
  });
  return map;
}

/** Decision 7: queue rows = queueable lessons (sourced, de-duped, teacher
 * mapped — hidden rows already excluded), in order, not already in the manifest. */
export function queueFor(course, inManifest) {
  return (course.queueable || []).filter((l) => l.source_id && !inManifest.has(l.source_id)).map((l) => l.source_id);
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
const csvCols = 'drive_file_id';

/** The lesson-id snapshot from the last COMMIT (git show HEAD:…), else the file on
 * disk, else null (first run: nothing to compare). */
function committedSnapshot(root, rel) {
  let text = null;
  try { text = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* not committed yet */ }
  if (text == null && existsSync(join(root, rel))) text = readFileSync(join(root, rel), 'utf-8');
  if (text == null) return null;
  try { return JSON.parse(text).lessons || null; } catch { return null; }
}

async function main() {
  const root = process.cwd();
  const dir = arg('dir', join(root, 'data', 'source', 'sheets'));
  if (!existsSync(dir)) { console.error(`sheets dir not found: ${dir}`); process.exit(1); }
  let XLSX;
  try { const m = await import('xlsx'); XLSX = m.default ?? m; }
  catch { console.error('The `xlsx` reader is not installed. Run:  npm install --no-save xlsx@0.18.5'); process.exit(1); }

  const names = existsSync(join(dir, 'INVENTORY.md')) ? parseInventoryNames(readFileSync(join(dir, 'INVENTORY.md'), 'utf-8')) : new Map();
  const fileAliases = loadAliases(root);
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    if (extname(f).toLowerCase() !== '.xlsx') continue;
    const id = basename(f, extname(f));
    const wb = XLSX.readFile(join(dir, f));
    // Part A: INVENTORY name fallback — the new id first, else the old (aliased) id.
    files.push({ file_id: id, file_name: names.get(id) ?? names.get(canonicalFileId(id, fileAliases)) ?? '', tabs: wb.SheetNames.map((n) => ({ name: n, ...sheetToGrid(XLSX, wb.Sheets[n]) })) });
  }

  const tfJson = readJson(join(root, 'data', 'teacher-files.json'), { files: {} });
  const teacherFiles = tfJson.files || {};
  const courseIds = (readJson(join(root, 'data', 'course-ids.json'), { courses: {} })).courses || {};
  const manifest = readJson(join(root, 'data', 'media-manifest.json'), []);
  const teachers = readJson(join(root, 'data', 'source', 'teachers-2026-11-02', 'teachers-2026-11-02.json'), []);

  const plan = planCatalogue(files, { teacherFiles, teachers, courseIds, approved: approvedIds(manifest), inManifest: manifestIds(manifest), aliases: fileAliases });

  // Decision 3: a duplicate VISIBLE lesson id is a build failure.
  if (plan.idCollisions.length) {
    for (const c of plan.idCollisions) console.error(`::error::duplicate visible lesson id ${c.id}: ${c.a} vs ${c.b}`);
    console.error(`BUILD FAILED — ${plan.idCollisions.length} duplicate visible lesson id(s).`);
    process.exit(1);
  }

  // Decision 1: pilot aliases — provisional c080-l0NN → AJAD lesson id.
  const pilot = plan.courses.find((c) => c.pilot);
  const aliases = readJson(join(root, 'data', 'id-aliases.json'), {});
  Object.assign(aliases, pilotAliases(pilot));

  // --report-only (data-check, decision 9): write ONLY HIDDEN.md so the job
  // never dirties the committed registries/queues/public-data it is diffing.
  const reportOnly = process.argv.includes('--report-only');

  // Part B: fail loud. (1) a course sheet with no teacher after aliases;
  // (2) an id with approved media that changed/disappeared since the last
  // committed snapshot (unless listed in data/id-aliases.json). Only THIS job
  // fails (exit 1 at the end) — the deploy build never runs this script.
  const teacherErrors = unmappedTeacherFiles(files, { teacherFiles, teachers, aliases: fileAliases });
  const snapshot = lessonIdSnapshot(plan);
  const snapRel = 'data/source/sheets/lesson-ids.json';
  const idProblems = guardLessonIds(committedSnapshot(root, snapRel), snapshot, aliases);

  const inMan = manifestIds(manifest);
  let totalQueued = 0;
  if (!reportOnly) {
    // Decision 2: persist any newly-assigned course ids (never renumber).
    writeFileSync(join(root, 'data', 'course-ids.json'), JSON.stringify({ _doc: (readJson(join(root, 'data', 'course-ids.json'), {})._doc) || '', courses: plan.registry }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(root, 'data', 'id-aliases.json'), JSON.stringify(aliases, null, 2) + '\n', 'utf-8');
    // Decision 6: persist name-matched teacher files (merged; never overwrite a
    // hand-set slug). A slug is only ever an existing teacher's.
    const mergedFiles = { ...teacherFiles }; // keyed by the OLD (canonical) file id
    for (const [fid, m] of Object.entries(plan.matchedFiles)) if (!mergedFiles[fid]) mergedFiles[fid] = m.slug;
    writeFileSync(join(root, 'data', 'teacher-files.json'), JSON.stringify({ _doc: tfJson._doc || '', files: mergedFiles }, null, 2) + '\n', 'utf-8');

    // Decision 7: queues + INDEX.
    const qdir = join(root, 'data', 'queues');
    mkdirSync(qdir, { recursive: true });
    const index = ['# Batch queues (per course)', '', '| course id | teacher | title | lessons | queued |', '| --- | --- | --- | --- | --- |'];
    for (const c of plan.courses.sort((a, b) => a.course_id.localeCompare(b.course_id))) {
      const q = queueFor(c, inMan);
      totalQueued += q.length;
      writeFileSync(join(qdir, `${c.course_id}.csv`), [csvCols, ...q].join('\n') + '\n', 'utf-8');
      const title = c.title_missing ? `${c.title} (title missing)` : c.title;
      index.push(`| ${c.course_id} | ${c.teacher || '(unmapped)'} | ${String(title).replace(/\|/g, '\\|')} | ${c.lessons} | ${q.length} |`);
    }
    writeFileSync(join(qdir, 'INDEX.md'), index.join('\n') + '\n', 'utf-8');
    // Part B: refresh the lesson-id snapshot ONLY when the guard passed, so a
    // failing run never overwrites the baseline it failed against.
    if (idProblems.length === 0) {
      writeFileSync(join(root, snapRel), JSON.stringify({ _doc: 'Lessons with approved media (lesson id -> course id + source id). Written by catalogue-build.mjs; the id guard compares against the last COMMITTED copy. Do not edit by hand.', lessons: snapshot }, null, 2) + '\n', 'utf-8');
    }
  } else {
    for (const c of plan.courses) totalQueued += queueFor(c, inMan).length;
  }

  // Decision 9: HIDDEN.md.
  const byReason = {};
  for (const h of plan.hidden) byReason[h.reason] = (byReason[h.reason] || 0) + 1;
  const H = ['# Hidden lessons (per course, with reason)', '', 'Generated by scripts/catalogue/catalogue-build.mjs. These rows are NOT shown in the app.', ''];
  if (teacherErrors.length || idProblems.length) {
    H.push('## ERRORS (the catalogue job fails)', '');
    for (const e of teacherErrors) H.push(`- ERROR no teacher for sheet file «${String(e.file_name || '(no name)').replace(/\|/g, '\\|')}» id \`${e.file_id}\` — add to data/source/file-aliases.json (new id → old id) or to data/teacher-files.json`);
    for (const p of idProblems) H.push(`- ERROR lesson id \`${p.id}\` had approved media (course ${p.was.course_id}, source \`${p.was.source_id}\`) and ${p.problem === 'disappeared' ? 'would DISAPPEAR' : `would CHANGE (now course ${p.now.course_id}, source \`${p.now.source_id}\`)`} — fix the sheet or add the old id to data/id-aliases.json`);
    H.push('');
  }
  H.push('## By reason');
  H.push('');
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) H.push(`- ${reason}: ${n}`);
  const matchedEntries = Object.entries(plan.matchedFiles);
  if (matchedEntries.length) {
    H.push('', '## Teacher files matched by name (decision 6)', '');
    for (const [fid, m] of matchedEntries) H.push(`- \`${fid}\` → ${m.slug}  (${String(m.matchedOn).replace(/\|/g, '\\|')})`);
  }
  if (plan.unmappedFiles.length) {
    H.push('', '## Unmatched teacher files (add to data/teacher-files.json — never guess a slug)', '',
      'The sheet name did not contain an existing teacher name exactly. Names found on disk:', '');
    for (const u of plan.unmappedFiles) H.push(`- \`${u.file_id}\`  «${String(u.file_name).replace(/\|/g, '\\|')}»`);
  }
  H.push('', '## Hidden lessons', '', '| course id | teacher | title | num | lesson id | reason |', '| --- | --- | --- | --- | --- | --- |');
  for (const h of plan.hidden) H.push(`| ${h.course_id || '—'} | ${h.teacher || '(unmapped)'} | ${String(h.title).replace(/\|/g, '\\|')} | ${h.num || ''} | ${h.lesson_id || '—'} | ${String(h.reason).replace(/\|/g, '\\|')} |`);
  writeFileSync(join(dir, 'HIDDEN.md'), H.join('\n') + '\n', 'utf-8');

  // "eligible" = a lesson with a usable source + a mapped teacher (queueable);
  // "visible now" = those with an approved manifest entry (0 until media lands).
  const eligible = plan.courses.reduce((n, c) => n + (c.queueable || []).length, 0);
  const visibleNow = plan.courses.reduce((n, c) => n + c.visible.length, 0);
  console.log(`courses ${plan.courses.length} · lessons eligible ${eligible} · visible now ${visibleNow} · hidden ${plan.hidden.length} · queued ${totalQueued}`);
  console.log(`teacher files matched ${Object.keys(plan.matchedFiles).length} · unmatched ${plan.unmappedFiles.length}`);
  console.log(`pilot ${pilot ? (pilot.queueable || []).length + ' lessons, aliases c080-l001→' + ((pilot.queueable || [])[0]?.lesson_id) + ' … ' + ((pilot.queueable || []).slice(-1)[0]?.lesson_id) : 'NOT FOUND'}`);
  for (const [reason, n] of Object.entries(byReason)) console.log(`  hidden: ${reason} = ${n}`);

  if (teacherErrors.length || idProblems.length) {
    for (const e of teacherErrors) console.error(`::error::no teacher for sheet file ${e.file_id} (${e.file_name || 'no name'}) — add to data/source/file-aliases.json`);
    for (const p of idProblems) console.error(`::error::lesson id ${p.id} with approved media ${p.problem} (course ${p.was.course_id}, source ${p.was.source_id})`);
    console.error(`CATALOGUE FAILED — ${teacherErrors.length} file(s) without a teacher, ${idProblems.length} approved lesson id(s) changed/disappeared.`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('catalogue-build.mjs')) main();
