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
import { parseTab, sheetToGrid, parseInventoryNames, outer, norm } from './sheets-map.mjs';

export const HIDDEN_TABS = ['7-មលិន្ទប្បញ្ហា'];
const PILOT_FILE = '1B7NgdftwwJeMZEtKm4cpz-3_Lp8RCtv7';

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

/** Decision 3: the course title is the section row ABOVE the first lesson row.
 * Return { title, missing }. `text` is the tab grid, `firstRow` is 1-based. */
export function courseTitle(text, firstRow, tabName) {
  for (let r = firstRow - 2; r >= 0; r--) {
    const cells = (text[r] || []).map((c) => outer(c)).filter(Boolean);
    // A section row is a single non-empty cell that is not a header label.
    if (cells.length === 1 && !/ចំណងជើង|ឈ្មោះគ្រូ|លេខកូដ|MP3|MP4|Acast|drive|យូធូប/i.test(cells[0])) {
      return { title: cells[0], missing: false };
    }
  }
  return { title: tabName, missing: true };
}

const approvedIds = (manifest) => new Set((manifest || []).filter((e) => e && e.drive_file_id && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
const manifestIds = (manifest) => new Set((manifest || []).filter((e) => e && e.drive_file_id).map((e) => e.drive_file_id));

/**
 * Pure core. Given parsed files + registries, produce the per-course plan.
 *   files        = [{ file_id, file_name, tabs: [{ name, text, links }] }]
 *   teacherFiles = { file_id: slug }
 *   courseIds    = { "<file_id>\t<tab>": "c###" }  (mutated copy returned)
 * Returns { courses[], hidden[], unmappedFiles[], registry, nextFree }.
 */
export function planCatalogue(files, { teacherFiles = {}, courseIds = {}, approved = new Set(), inManifest = new Set(), pilotIds = [] } = {}) {
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

  const courses = [];
  const hidden = []; // { course_id, teacher, title, lesson_id|null, num, reason }
  const unmappedFiles = [];
  const pilotSet = new Set(pilotIds);

  for (const f of files) {
    const slug = teacherFiles[f.file_id] || null;
    const isPilotFile = f.file_id === PILOT_FILE;
    if (!slug) unmappedFiles.push({ file_id: f.file_id, file_name: f.file_name });

    for (const t of f.tabs) {
      const key = `${f.file_id}\t${t.name}`;
      const tabHidden = HIDDEN_TABS.includes(t.name);
      const parsed = parseTab(t);
      // A tab yields a course only if it has lessons and is not a hidden tab.
      if (parsed.status !== 'ok' || tabHidden) {
        if (parsed.status === 'ok' || tabHidden) {
          // A real but hidden tab (either 7-មលិន្ទ or a skipped-with-lessons tab).
        }
        if (tabHidden || parsed.lessons.length) {
          const cid = registry[key] || null;
          hidden.push({ course_id: cid, teacher: slug, title: t.name, lesson_id: null, num: '', reason: tabHidden ? `hidden tab (${t.name})` : `skipped tab: ${parsed.reason}` });
        }
        continue;
      }
      // Assign / reuse the course id (decision 2).
      const cid = registry[key] || nextFreeId();
      registry[key] = cid;

      const first = parsed.lessons[0];
      const { title, missing } = courseTitle(t.text, first.row, t.name);
      const isPilotCourse = isPilotFile && norm(t.name).includes('វេស្សន្តរជាត');

      const seenSrc = new Set();
      const visible = [];   // shown in the app now (an approved manifest entry)
      const queueable = []; // has a usable source, de-duped, teacher mapped — may
                            // or may not be approved yet (the queue needs these)
      for (const l of parsed.lessons) {
        const { id: sourceId, from } = pickSource(l, { pilot: isPilotCourse });
        const lid = lessonIdOf(l, sourceId);
        const base = { course_id: cid, teacher: slug, title, num: l.number, lesson_code: outer(l.lesson_code), lesson_id: lid, source_id: sourceId, source_from: from };
        if (!slug) { hidden.push({ ...base, reason: 'teacher file not mapped' }); continue; }
        if (!sourceId) { hidden.push({ ...base, reason: 'no source (no cut MP3 / MP4 / MiniCourse id)' }); continue; }
        if (seenSrc.has(sourceId)) { hidden.push({ ...base, reason: `duplicate source id ${sourceId} (first kept)` }); continue; }
        seenSrc.add(sourceId);
        queueable.push(base);
        // Decision 6: a lesson with no approved manifest entry stays hidden as
        // now. It is still QUEUEABLE (so it can be transcoded + approved).
        if (approved.has(sourceId)) visible.push({ ...base, playable: true });
        else hidden.push({ ...base, reason: 'no approved manifest entry yet (hidden until approved)' });
      }
      courses.push({
        course_id: cid, file_id: f.file_id, file_name: f.file_name, tab: t.name, teacher: slug,
        title, title_missing: missing, pilot: isPilotCourse,
        lessons: parsed.lessons.length, visible, queueable, hidden_count: parsed.lessons.length - visible.length,
      });
    }
  }
  return { courses, hidden, unmappedFiles, registry, nextFree: probe };
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

async function main() {
  const root = process.cwd();
  const dir = arg('dir', join(root, 'data', 'source', 'sheets'));
  if (!existsSync(dir)) { console.error(`sheets dir not found: ${dir}`); process.exit(1); }
  let XLSX;
  try { const m = await import('xlsx'); XLSX = m.default ?? m; }
  catch { console.error('The `xlsx` reader is not installed. Run:  npm install --no-save xlsx@0.18.5'); process.exit(1); }

  const names = existsSync(join(dir, 'INVENTORY.md')) ? parseInventoryNames(readFileSync(join(dir, 'INVENTORY.md'), 'utf-8')) : new Map();
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    if (extname(f).toLowerCase() !== '.xlsx') continue;
    const id = basename(f, extname(f));
    const wb = XLSX.readFile(join(dir, f));
    files.push({ file_id: id, file_name: names.get(id) ?? '', tabs: wb.SheetNames.map((n) => ({ name: n, ...sheetToGrid(XLSX, wb.Sheets[n]) })) });
  }

  const teacherFiles = (readJson(join(root, 'data', 'teacher-files.json'), { files: {} })).files || {};
  const courseIds = (readJson(join(root, 'data', 'course-ids.json'), { courses: {} })).courses || {};
  const manifest = readJson(join(root, 'data', 'media-manifest.json'), []);
  const pilotIds = existsSync(join(root, 'data', 'audio-queue.pilot.csv'))
    ? readFileSync(join(root, 'data', 'audio-queue.pilot.csv'), 'utf-8').split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter((l) => l && l !== 'drive_file_id')
    : [];

  const plan = planCatalogue(files, { teacherFiles, courseIds, approved: approvedIds(manifest), inManifest: manifestIds(manifest), pilotIds });

  // Decision 1: pilot aliases — provisional c080-l0NN → AJAD lesson id.
  const pilot = plan.courses.find((c) => c.pilot);
  const aliases = readJson(join(root, 'data', 'id-aliases.json'), {});
  Object.assign(aliases, pilotAliases(pilot));

  // --report-only (data-check, decision 9): write ONLY HIDDEN.md so the job
  // never dirties the committed registries/queues/public-data it is diffing.
  const reportOnly = process.argv.includes('--report-only');

  const inMan = manifestIds(manifest);
  let totalQueued = 0;
  if (!reportOnly) {
    // Decision 2: persist any newly-assigned course ids (never renumber).
    writeFileSync(join(root, 'data', 'course-ids.json'), JSON.stringify({ _doc: (readJson(join(root, 'data', 'course-ids.json'), {})._doc) || '', courses: plan.registry }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(root, 'data', 'id-aliases.json'), JSON.stringify(aliases, null, 2) + '\n', 'utf-8');

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
  } else {
    for (const c of plan.courses) totalQueued += queueFor(c, inMan).length;
  }

  // Decision 9: HIDDEN.md.
  const byReason = {};
  for (const h of plan.hidden) byReason[h.reason] = (byReason[h.reason] || 0) + 1;
  const H = ['# Hidden lessons (per course, with reason)', '', 'Generated by scripts/catalogue/catalogue-build.mjs. These rows are NOT shown in the app.', ''];
  H.push('## By reason');
  H.push('');
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) H.push(`- ${reason}: ${n}`);
  if (plan.unmappedFiles.length) {
    H.push('', '## Unmapped teacher files (add to data/teacher-files.json — do not guess)', '');
    for (const u of plan.unmappedFiles) H.push(`- \`${u.file_id}\`  ${String(u.file_name).replace(/\|/g, '\\|')}`);
  }
  H.push('', '## Hidden lessons', '', '| course id | teacher | title | num | lesson id | reason |', '| --- | --- | --- | --- | --- | --- |');
  for (const h of plan.hidden) H.push(`| ${h.course_id || '—'} | ${h.teacher || '(unmapped)'} | ${String(h.title).replace(/\|/g, '\\|')} | ${h.num || ''} | ${h.lesson_id || '—'} | ${String(h.reason).replace(/\|/g, '\\|')} |`);
  writeFileSync(join(dir, 'HIDDEN.md'), H.join('\n') + '\n', 'utf-8');

  // "eligible" = a lesson with a usable source + a mapped teacher (queueable);
  // "visible now" = those with an approved manifest entry (0 until media lands).
  const eligible = plan.courses.reduce((n, c) => n + (c.queueable || []).length, 0);
  const visibleNow = plan.courses.reduce((n, c) => n + c.visible.length, 0);
  console.log(`courses ${plan.courses.length} · lessons eligible ${eligible} · visible now ${visibleNow} · hidden ${plan.hidden.length} · queued ${totalQueued}`);
  console.log(`pilot ${pilot ? (pilot.queueable || []).length + ' lessons, aliases c080-l001→' + ((pilot.queueable || [])[0]?.lesson_id) + ' … ' + ((pilot.queueable || []).slice(-1)[0]?.lesson_id) : 'NOT FOUND'}`);
  for (const [reason, n] of Object.entries(byReason)) console.log(`  hidden: ${reason} = ${n}`);
}

if (process.argv[1] && process.argv[1].endsWith('catalogue-build.mjs')) main();
