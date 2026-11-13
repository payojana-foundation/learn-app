/**
 * scripts/queues/approve-lists.mjs — the approval lists the coordinator works from.
 *
 * Writes (nothing else, no manifest, no R2, no Drive):
 *   data/queues/approve/<course>.txt   one per course that has converted lessons which
 *                                      are not approved yet (status DRAFT in the manifest).
 *                                      The LAST line is the comma-separated drive ids:
 *                                      paste it into the approve-media input
 *                                      "Comma-separated Drive file ids to decide on".
 *   data/queues/approve/INDEX.md       one row per such course, largest first: course id,
 *                                      title (copied), count, ONE sample play link (tappable
 *                                      markdown link) and a link to its list.
 *
 * Play links = MEDIA_BASE_URL (src/config.ts default, docs/DEPLOY.md) + "/" + the manifest key.
 * Titles are copied byte for byte from the sheet; nothing is retyped.
 *
 * Usage: node scripts/queues/approve-lists.mjs [--today 2026-11-13]
 */
import fs from 'node:fs';
import { parseTab } from '../catalogue/sheets-map.mjs';
import { planCatalogue } from '../catalogue/catalogue-build.mjs';
import { loadContext, loadFiles } from '../master/seed.mjs';

export const MEDIA_BASE = 'https://media.84000.digital';

export const mediaUrl = (key, base = MEDIA_BASE) => `${base}/${String(key).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;

/** The last non-empty line of a list file = the comma-separated ids. */
export function idsLine(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.length ? lines[lines.length - 1] : '';
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * entries = [{ cid, title, items: [{ num, lesson_id, drive_file_id, minutes, I, result, url, title }], ... }]
 * Returns the INDEX.md text. Sorted by count (largest first), then by course id.
 * The sample link is the FIRST item (lowest lesson order given by the caller).
 */
export function renderIndex(entries, today) {
  const rows = [...entries].sort((a, b) => b.items.length - a.items.length || a.cid.localeCompare(b.cid));
  const total = rows.reduce((n, e) => n + e.items.length, 0);
  const L = [];
  L.push('# Approval index', '');
  L.push(`Generated ${today} by scripts/queues/approve-lists.mjs. One row per course that has converted lessons which are not approved yet (status DRAFT in data/media-manifest.json), largest first. ${rows.length} courses, ${total} lessons.`, '');
  L.push('How to approve a course on your phone:', '');
  L.push('1. Tap the sample link to hear one lesson; open the list (second link) to see all of them.');
  L.push('2. Copy the LAST line of the list (comma-separated ids).');
  L.push('3. GitHub → Actions → approve-media → Run workflow: decision `approved`, paste the ids into "Comma-separated Drive file ids to decide on", add your name, Run.', '');
  L.push('| course | title | lessons to approve | sample (tap to play) | list |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const e of rows) {
    const s = e.items[0];
    L.push(`| ${e.cid} | ${esc(e.title)} | ${e.items.length} | [▶ lesson ${esc(s.num)}](${s.url}) | [${e.cid}.txt](${e.cid}.txt) |`);
  }
  return L.join('\n') + '\n';
}

/** One list file. The last line is the ids (approve-media input). */
export function renderList(e, today) {
  const T = [];
  T.push(`# ${e.cid} approve list, ${today}`);
  T.push(`# teacher: ${e.teacher}`, `# course: ${e.title}`);
  T.push(`# queued ${e.queued} · converted ${e.converted} · approved ${e.approved} · failed ${e.failed} · not started ${e.notStarted}`);
  T.push(`# play links = ${MEDIA_BASE} + "/" + the manifest key (src/config.ts, docs/DEPLOY.md VITE_MEDIA_BASE_URL)`);
  T.push('# columns (tab separated): lesson no · lesson id · drive_file_id · status · minutes · integrated loudness (I) · result · play link · title');
  for (const l of e.items) T.push([l.num, l.lesson_id, l.drive_file_id, 'DRAFT', l.minutes, l.I, l.result, l.url, l.title].join('\t'));
  T.push('', '# approve-media drive_file_ids (converted, not approved yet), comma separated:', e.items.map((l) => l.drive_file_id).join(','));
  return T.join('\n') + '\n';
}

async function main() {
  const i = process.argv.indexOf('--today');
  const today = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
  const ctx = loadContext();
  const manifest = ctx.manifest;
  const byId = new Map(manifest.map((e) => [e.drive_file_id, e]));
  const frCsv = fs.readFileSync('data/queues/failed-review.csv', 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','));
  const frIds = new Set(frCsv.map((x) => x[0]));
  const approved = new Set(manifest.filter((e) => /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
  const files = await loadFiles('data/source/sheets', ctx.aliases);
  const plan = planCatalogue(files, { teacherFiles: ctx.teacherFiles, teachers: ctx.teachers, courseIds: ctx.courseIds, approved, inManifest: new Set(byId.keys()), aliases: ctx.aliases, pending: ctx.pending });
  const gridOf = new Map(files.flatMap((f) => f.tabs.map((t) => [`${f.file_id}\t${t.name}`, t])));
  const teacherName = (slug) => (ctx.teachers.find((t) => t.slug === slug) || {}).name_km || '';
  const readIds = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(',')[0].trim()).filter(Boolean);

  // Remove only the files this script owns (c###.txt, INDEX.md); FLAGGED.md and
  // precheck.json belong to scripts/media/precheck.mjs and are kept.
  fs.mkdirSync('data/queues/approve', { recursive: true });
  for (const f of fs.readdirSync('data/queues/approve')) {
    if (/^c\d+\.txt$/.test(f) || f === 'INDEX.md') fs.rmSync(`data/queues/approve/${f}`);
  }
  const entries = [];
  for (const c of plan.courses) {
    const qf = `data/queues/${c.course_id}.csv`;
    if (!fs.existsSync(qf)) continue;
    const ids = readIds(qf);
    const parsed = parseTab(gridOf.get(`${c.file_id}\t${c.tab}`));
    const titleAt = new Map(parsed.lessons.map((l) => [l.row, l.title]));
    const items = c.queueable
      .filter((l) => ids.includes(l.source_id) && byId.has(l.source_id) && !approved.has(l.source_id))
      .map((l) => {
        const e = byId.get(l.source_id);
        return {
          num: l.num, lesson_id: l.lesson_id, drive_file_id: l.source_id,
          minutes: e.duration_s != null ? (e.duration_s / 60).toFixed(1) : '',
          I: e.loudness && e.loudness.out ? e.loudness.out.I : '', result: e.loudness ? e.loudness.result : '',
          url: mediaUrl(e.key), title: titleAt.get(l.row) ?? '',
        };
      });
    if (items.length === 0) continue;
    entries.push({
      cid: c.course_id, title: c.title, teacher: teacherName(c.teacher), items,
      queued: ids.length, converted: ids.filter((x) => byId.has(x)).length, approved: ids.filter((x) => approved.has(x)).length,
      failed: ids.filter((x) => !byId.has(x) && frIds.has(x)).length, notStarted: ids.filter((x) => !byId.has(x) && !frIds.has(x)).length,
    });
  }
  for (const e of entries) fs.writeFileSync(`data/queues/approve/${e.cid}.txt`, renderList(e, today), 'utf8');
  fs.writeFileSync('data/queues/approve/INDEX.md', renderIndex(entries, today), 'utf8');
  console.log(`approve lists: ${entries.length} courses, ${entries.reduce((n, e) => n + e.items.length, 0)} lessons; INDEX.md written`);
}

if (process.argv[1] && process.argv[1].endsWith('approve-lists.mjs')) main();
