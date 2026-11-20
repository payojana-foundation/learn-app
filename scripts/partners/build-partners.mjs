/**
 * scripts/partners/build-partners.mjs — bulk 10 P2: partner YouTube classes from the partner
 * sheet export (data/partners/*.csv, P1) merged into the build (scripts/build-courses.mjs).
 *
 * Partner classes are their OWN collection, never master courses: ids `yt-pl-<playlist_id>`
 * (class) and `yt-<11-char video id>` (lesson), never c###; served (only when
 * data/partners-switch.json is {"enabled": true}) as catalog.json `partners` / `partner_courses`
 * and public/data/partners/<id>.json. The master-sheet courses and their files are untouched.
 *
 * Release rule (wave 1, coordinator 18–19 Nov): a Playlists row is released only when
 *   decision = Add AND decided_at filled AND kp_embed gives a playlist UUID AND the teacher maps
 *   (Playlists.teacher_slugs, else Partners.teacher_slugs; every slug must be a teacher record).
 * Partial is not used in wave 1 (hidden + reported). The notes column is never read.
 * Lessons = the playlist's Videos rows with playable = yes and status not Skip/Hidden/Moved, in
 * position order; titles byte-for-byte. A class whose normalised title + teacher equals an own
 * course is refused (duplicate guard). A partner lesson whose video is an own lesson's
 * youtube_link is ADOPTED: left out, aliased to the own lesson id.
 * Embed safety: kp_embed is never injected. `kpPlaylistUuid` extracts the UUID with a strict
 * pattern; any other host, any other script, javascript:/data: → no UUID → hidden + reported.
 *
 * Retirement (data/partners/released-ids.json + retired.json, kept by `ids` below, run by
 * partner-export.yml): an id that was ever released and is not released now is retired (with
 * the date); it comes back when released again. Nothing is ever dropped.
 *
 * CLI: node scripts/partners/build-partners.mjs ids   (update the two id files from the CSVs)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../master/csv.mjs';

export const SWITCH = 'data/partners-switch.json';
export const DIR = 'data/partners';
const UUID4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PLAYLIST_URL = new RegExp(`^https://killerplayer\\.com/watch/video/playlist/(${UUID4})$`);
const HELPER_URL = /^https:\/\/killerplayer\.com\/watch\/embed\.js(\?v=[A-Za-z0-9]+)?$/;
const HIDDEN_STATUS = new Set(['skip', 'hidden', 'moved']);

/** The KillerPlayer playlist UUID of a pasted embed, or null (anything unexpected = null). Pure. */
export function kpPlaylistUuid(embed) {
  const s = String(embed ?? '');
  if (!s.trim()) return null;
  if (/javascript:|data:|vbscript:|\son[a-z]+\s*=/i.test(s)) return null;
  // every <script> must be the helper with a src and no inline code
  const scripts = s.match(/<script\b[^>]*>[\s\S]*?(<\/script>|$)/gi) || [];
  for (const sc of scripts) {
    const src = /\bsrc\s*=\s*['"]([^'"]+)['"]/i.exec(sc);
    const body = sc.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
    if (!src || !HELPER_URL.test(src[1]) || body.trim() !== '') return null;
  }
  if (/<(?!\/?(iframe|script)\b)[a-z]/i.test(s)) return null; // no other tags
  const urls = s.match(/(https?:)?\/\/[^\s'"<>]+/gi) || [];
  const uuids = new Set();
  for (const u of urls) {
    const m = PLAYLIST_URL.exec(u);
    if (m) uuids.add(m[1]);
    else if (!HELPER_URL.test(u)) return null;
  }
  return uuids.size === 1 ? [...uuids][0] : null;
}

/** The 11-char YouTube video id of a link, or null. Pure. */
export function youtubeId(link) {
  const s = String(link ?? '').trim();
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(s);
  return m ? m[1] : null;
}

/** Comparison form for the duplicate guard only (never displayed). Pure. */
export const normTitle = (s) => String(s ?? '').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const splitSlugs = (s) => String(s ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const posNum = (p) => (Number.isFinite(Number(p)) && String(p).trim() !== '' ? Number(p) : Infinity);

/**
 * -> { partners, courses, files, hidden, report }
 *   partners  [{ slug, name_km, name_en, teacher_slugs, course_ids }]  (only with ≥1 released class)
 *   courses   catalog entries  [{ id, kind:'partner', partner_slug, title, teacher_slugs, lesson_count, teaching_points }]
 *   files     course files     [{ id, kind:'partner', partner_slug, title, teacher_slugs, playlist_uuid, lessons:[{id, num, title, duration_s}] }]
 *   hidden    [{ id, partner_slug, reason, detail }]
 *   adopted   { 'yt-<id>': '<own lesson id>' }
 */
export function buildPartners({ partners = [], playlists = [], videos = [], terms = [], teacherSlugs = new Set(), ownCourses = [], ownYoutube = new Map() }) {
  const partnerBy = new Map(partners.filter((p) => p.partner_slug).map((p) => [p.partner_slug, p]));
  const videosBy = new Map();
  for (const v of videos) {
    if (!v.playlist_id) continue;
    if (!videosBy.has(v.playlist_id)) videosBy.set(v.playlist_id, []);
    videosBy.get(v.playlist_id).push(v);
  }
  const ownKeys = new Set();
  for (const c of ownCourses) for (const t of [c.title_km, c.title_en, ...(c.title_aliases || [])]) if (t) ownKeys.add(`${normTitle(t)}\t${c.teacher_slug}`);
  const termIndex = termsIndex(terms);
  const hidden = [];
  const courses = [];
  const files = [];
  const adopted = {};
  const unknownTerms = [];
  const seen = new Set();
  for (const pl of playlists) {
    const pid = String(pl.playlist_id ?? '');
    if (!/^[A-Za-z0-9_-]+$/.test(pid)) { hidden.push({ id: pid || '(none)', partner_slug: pl.partner_slug, reason: 'bad playlist_id', detail: '' }); continue; }
    const id = `yt-pl-${pid}`;
    if (seen.has(id)) { hidden.push({ id, partner_slug: pl.partner_slug, reason: 'duplicate playlist row', detail: '' }); continue; }
    seen.add(id);
    const hide = (reason, detail = '') => hidden.push({ id, partner_slug: pl.partner_slug, reason, detail });
    const decision = String(pl.decision ?? '').trim();
    if (/^partial$/i.test(decision)) { hide('Partial (not used in wave 1)'); continue; }
    if (decision !== 'Add') { hide(decision ? `decision ${decision}` : 'no decision'); continue; }
    if (!String(pl.decided_at ?? '').trim()) { hide('no decided_at'); continue; }
    const uuid = kpPlaylistUuid(pl.kp_embed);
    if (!uuid) { hide('bad kp_embed', String(pl.kp_embed ?? '').trim() ? 'no strict KillerPlayer playlist URL, or another host/script' : 'empty'); continue; }
    const partner = partnerBy.get(pl.partner_slug);
    if (!partner) { hide('unknown partner', pl.partner_slug || '(none)'); continue; }
    const slugs = splitSlugs(pl.teacher_slugs).length ? splitSlugs(pl.teacher_slugs) : splitSlugs(partner.teacher_slugs);
    if (!slugs.length || slugs.some((s) => !teacherSlugs.has(s))) { hide('unmapped teacher', slugs.join(' ') || '(none)'); continue; }
    const title = String(pl.display_title ?? '') !== '' ? pl.display_title : pl.playlist_title ?? '';
    if (slugs.some((s) => ownKeys.has(`${normTitle(title)}\t${s}`))) { hide('duplicate of an own course', ''); continue; }
    const lessons = [];
    const lessonIds = new Set();
    for (const v of (videosBy.get(pid) || []).slice().sort((a, b) => posNum(a.position) - posNum(b.position))) {
      if (String(v.playable ?? '').trim().toLowerCase() !== 'yes') continue;
      if (HIDDEN_STATUS.has(String(v.status ?? '').trim().toLowerCase())) continue;
      if (!/^[A-Za-z0-9_-]{11}$/.test(v.video_id || '')) continue;
      const lid = `yt-${v.video_id}`;
      if (lessonIds.has(lid)) continue;
      if (ownYoutube.has(v.video_id)) { adopted[lid] = ownYoutube.get(v.video_id); continue; }
      lessonIds.add(lid);
      lessons.push({ id: lid, num: posNum(v.position) === Infinity ? lessons.length + 1 : posNum(v.position), title: v.title ?? '', duration_s: Number(v.duration_s) || 0 });
    }
    if (!lessons.length) { hide('no playable videos'); continue; }
    const tp = [];
    for (const raw of String(pl.teaching_points ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
      const tid = termIndex.get(raw);
      if (tid) { if (!tp.includes(tid)) tp.push(tid); } else unknownTerms.push({ id, term: raw });
    }
    const entry = { id, kind: 'partner', partner_slug: pl.partner_slug, title, teacher_slugs: slugs, lesson_count: lessons.length, teaching_points: tp };
    courses.push(entry);
    files.push({ id, kind: 'partner', partner_slug: pl.partner_slug, title, teacher_slugs: slugs, playlist_uuid: uuid, teaching_points: tp, lessons });
  }
  const outPartners = [];
  for (const p of partners) {
    const ids = courses.filter((c) => c.partner_slug === p.partner_slug).map((c) => c.id);
    if (!ids.length) continue;
    outPartners.push({ slug: p.partner_slug, name_km: p.name_km ?? '', name_en: p.name_en ?? '', teacher_slugs: [...new Set(courses.filter((c) => c.partner_slug === p.partner_slug).flatMap((c) => c.teacher_slugs))], course_ids: ids });
  }
  const usedTerms = new Set(courses.flatMap((c) => c.teaching_points));
  const outTerms = terms.filter((t) => usedTerms.has(t.term_id)).map((t) => ({ term_id: t.term_id, term_km: t.term_km ?? '', term_pali: t.term_pali ?? '', term_en: t.term_en ?? '', other_spellings: String(t.other_spellings ?? '').split(';').map((x) => x.trim()).filter(Boolean) }));
  return { partners: outPartners, courses, files, hidden, adopted, terms: outTerms, unknownTerms };
}

/** Terms → Map(text → term_id): term_km first, then other_spellings (`;`). Pure. */
export function termsIndex(terms) {
  const m = new Map();
  for (const t of terms || []) if (t.term_id && t.term_km && !m.has(t.term_km)) m.set(t.term_km, t.term_id);
  for (const t of terms || []) for (const o of String(t.other_spellings ?? '').split(';').map((x) => x.trim()).filter(Boolean)) if (t.term_id && !m.has(o)) m.set(o, t.term_id);
  return m;
}

/**
 * Retirement. Pure. ever = {courses:[], lessons:[]} (ever released), retired = {courses:{id:{since}}, lessons:{id:{since, course_id, alias?}}}.
 * -> { ever, retired }  (a released id leaves `retired`; a gone one enters it; nothing is dropped)
 */
export function retirePlan(ever, retired, files, adopted, date) {
  const E = { courses: [...((ever && ever.courses) || [])], lessons: [...((ever && ever.lessons) || [])] };
  const R = { courses: { ...((retired && retired.courses) || {}) }, lessons: { ...((retired && retired.lessons) || {}) } };
  const nowC = new Set(files.map((f) => f.id));
  const nowL = new Map(files.flatMap((f) => f.lessons.map((l) => [l.id, f.id])));
  for (const id of nowC) { if (!E.courses.includes(id)) E.courses.push(id); delete R.courses[id]; }
  for (const [id] of nowL) { if (!E.lessons.includes(id)) E.lessons.push(id); delete R.lessons[id]; }
  for (const id of E.courses) if (!nowC.has(id) && !R.courses[id]) R.courses[id] = { since: date };
  for (const id of E.lessons) {
    if (nowL.has(id)) continue;
    if (!R.lessons[id]) R.lessons[id] = { since: date };
    if (adopted && adopted[id]) R.lessons[id] = { ...R.lessons[id], alias: adopted[id] };
  }
  E.courses.sort();
  E.lessons.sort();
  return { ever: E, retired: R };
}

/** The four CSVs (missing folder = null). */
export function readPartnerCsvs(root) {
  const d = join(root, DIR);
  if (!existsSync(join(d, 'playlists.csv'))) return null;
  const r = (f) => (existsSync(join(d, f)) ? parseCsvObjects(readFileSync(join(d, f), 'utf-8')) : []);
  return { partners: r('partners.csv'), playlists: r('playlists.csv'), videos: r('videos.csv'), terms: r('terms.csv') };
}

/** data/partners-switch.json → boolean (missing = off; bad shape throws). */
export function partnersEnabled(root) {
  const p = join(root, SWITCH);
  if (!existsSync(p)) return false;
  const v = JSON.parse(readFileSync(p, 'utf-8'));
  if (!v || typeof v.enabled !== 'boolean') throw new Error(`${SWITCH} must be {"enabled": true|false}`);
  return v.enabled;
}

/** Own lessons' YouTube ids → own lesson id (only lessons that are shown). Pure. */
export function ownYoutubeMap(lessonRows, ownCourseFiles) {
  const shown = new Set(ownCourseFiles.flatMap((c) => c.lessons.map((l) => l.id)));
  const m = new Map();
  for (const r of lessonRows || []) {
    const y = youtubeId(r.youtube_link);
    if (y && r.lesson_id && shown.has(r.lesson_id) && !m.has(y)) m.set(y, r.lesson_id);
  }
  return m;
}

/** Report lines (counts per partner, hidden by reason). Pure. */
export function partnersReport(res, enabled) {
  const per = {};
  for (const c of res.courses) per[c.partner_slug] = (per[c.partner_slug] || 0) + 1;
  const reasons = {};
  for (const h of res.hidden) reasons[h.reason] = (reasons[h.reason] || 0) + 1;
  return [
    '# Partner classes (bulk 10 P2)', '',
    `- served: ${enabled ? 'yes (data/partners-switch.json enabled)' : 'no (data/partners-switch.json off: nothing served)'}`,
    `- released classes: ${res.courses.length} ${JSON.stringify(per)}; lessons ${res.files.reduce((n, f) => n + f.lessons.length, 0)}`,
    `- hidden: ${res.hidden.length} ${JSON.stringify(reasons)}`,
    `- adopted lessons (own lesson has the video): ${Object.keys(res.adopted).length}`,
    `- unknown teaching points: ${res.unknownTerms.length}`, '',
  ].join('\n');
}

function main() {
  const cmd = process.argv[2];
  const root = process.cwd();
  if (cmd !== 'ids') { console.error('Usage: build-partners.mjs ids'); process.exit(1); }
  const csv = readPartnerCsvs(root);
  if (!csv) { console.log('no data/partners export yet'); return; }
  const teachers = JSON.parse(readFileSync(join(root, 'data', 'source', 'teachers-2026-11-02', 'teachers-2026-11-02.json'), 'utf-8'));
  const coursesDir = join(root, 'public', 'data', 'courses');
  const catalog = JSON.parse(readFileSync(join(root, 'public', 'data', 'catalog.json'), 'utf-8'));
  const ownFiles = catalog.courses.map((c) => JSON.parse(readFileSync(join(coursesDir, `${c.id}.json`), 'utf-8')));
  const lessonRows = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'lessons.csv'), 'utf-8'));
  const res = buildPartners({ ...csv, teacherSlugs: new Set(teachers.map((t) => t.slug)), ownCourses: catalog.courses, ownYoutube: ownYoutubeMap(lessonRows, ownFiles) });
  const everP = join(root, DIR, 'released-ids.json');
  const retP = join(root, DIR, 'retired.json');
  const ever = existsSync(everP) ? JSON.parse(readFileSync(everP, 'utf-8')) : null;
  const retired = existsSync(retP) ? JSON.parse(readFileSync(retP, 'utf-8')) : null;
  const next = retirePlan(ever, retired, res.files, res.adopted, new Date().toISOString().slice(0, 10));
  const w = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf-8');
  w(everP, { _doc: 'Bulk 10 P2: every partner class / lesson id ever released (scripts/partners/build-partners.mjs ids). Never shrinks.', ...next.ever });
  w(retP, { _doc: 'Bulk 10 P2: partner ids released before and not now (since = date); alias = the own lesson that adopted the video. Saved progress is never dropped.', ...next.retired });
  console.log(`partner ids: ever ${next.ever.courses.length} classes / ${next.ever.lessons.length} lessons; retired ${Object.keys(next.retired.courses).length} / ${Object.keys(next.retired.lessons).length}`);
}

if (process.argv[1] && process.argv[1].endsWith('build-partners.mjs')) main();
