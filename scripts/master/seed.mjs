/**
 * scripts/master/seed.mjs — seed the master content sheet (bulk 08, PART 2).
 *
 * One row per numbered lesson row of the teacher sheets (data/source/sheets/*.xlsx),
 * INCLUDING rows Learn hides today. Section rows, unnumbered rows, 0_ tabs and
 * tabs without a header are out (listed in reports/master-seed-excluded.csv).
 *
 * course_id / lesson_id / visibility / hide reason come from catalogue-build's
 * planCatalogue (same functions, no copy of the logic). Everything else is read
 * from the sheet cells. Khmer is copied byte-for-byte; nothing is invented.
 *
 *   dry   (default) writes reports/master-seed-preview.csv (Lessons),
 *         reports/master-seed-legacy.csv (Legacy) and reports/master-seed-excluded.csv.
 *         No network.
 *   write fills tabs Lessons, Legacy and Lists of the given Google Sheet through the
 *         Sheets API, adds dropdowns, protected ranges (SYSTEM columns + lesson_code,
 *         editor: the service account only) and freezes the header row. REFUSES if
 *         Lessons already has data rows (protects team edits).
 *
 * Usage:
 *   node scripts/master/seed.mjs [--mode dry|write] [--sheet-id <id>]
 *        [--dir data/source/sheets] [--out reports]
 *   write needs env ACCESS_TOKEN (scope spreadsheets) and SA_EMAIL.
 *
 * Format of the CSV files and the sheet: docs/master-sheet.md.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { parseTab, sheetToGrid, parseInventoryNames, driveIds, hasFolderLink, norm, outer } from '../catalogue/sheets-map.mjs';
import {
  planCatalogue, pickSource, lessonIdOf, courseTitle, isSectionRow, resolveTeacher, pendingSet,
  HIDDEN_TABS, SKIP_TABS, NON_COURSE_FILES,
} from '../catalogue/catalogue-build.mjs';
import { loadAliases, canonicalFileId, canonicalTab } from '../catalogue/file-aliases.mjs';
import { toCsv } from './csv.mjs';

// Labels named by the coordinator (10 Nov, C8). Copied from the decision text.
export const DETAILS_LABEL = 'គោលធម៌';
export const YOUTUBE_EXTRA_LABEL = 'តំណក្នុង YoutTube';

const DONE = /^done$/i;
const YES = /^yes$/i;
const READY_RE = /^(ready|realy)\s*\?*$/i;
const EMBED_LABEL_RE = /embed link/i;
const MINI_RE = /^minicourse$/i; // the plain MiniCourse / minicourse status columns
const urlish = (t) => /https?:\/\//i.test(t) || t.length > 90;

// ── columns.json ──────────────────────────────────────────────────────────────

export function loadColumns(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, 'data', 'master', 'columns.json'), 'utf-8'));
}

// ── column detection (labels for the columns the catalogue reader does not know) ──

/** Per column: the nearest non-URL label at/above the header row. `norm` is for
 * matching; `raw` is the cell text exactly as stored (used in Legacy). */
export function columnLabels(text, hr) {
  const maxc = Math.max(0, ...text.map((r) => (r || []).length));
  const norms = [];
  const raws = [];
  for (let c = 0; c < maxc; c++) {
    let n = '';
    let raw = '';
    for (let r = hr; r >= 0; r--) {
      const cell = (text[r] || [])[c];
      const q = norm(cell);
      if (q && !urlish(q)) { n = q; raw = String(cell); break; }
    }
    norms.push(n);
    raws.push(raw);
  }
  return { norms, raws };
}

/** column index → role. The reader's columns first (parseTab cols), then the
 * extra labels. A column keeps its first role; a second column with the same
 * role stays unclaimed (→ Legacy). */
export function assignColumns(text, hr, cols, { miniStatus = false } = {}) {
  const { norms, raws } = columnLabels(text, hr);
  const role = new Map();
  const claim = (i, name) => { if (i >= 0 && !role.has(i)) role.set(i, name); };
  claim(cols.number, 'number');
  claim(cols.teacher, 'teacher');
  claim(cols.title, 'title');
  claim(cols.lessonCode, 'code');
  claim(cols.videoCode, 'video_code');
  for (const k of ['mp3', 'mp4', 'original', 'minicourse', 'youtube']) claim(cols.link[k], k);
  const byLabel = (name, test) => {
    const i = norms.findIndex((l, idx) => l && !role.has(idx) && test(l));
    if (i >= 0) role.set(i, name);
  };
  byLabel('details', (l) => l === norm(DETAILS_LABEL));
  byLabel('youtube_extra', (l) => l === norm(YOUTUBE_EXTRA_LABEL));
  byLabel('acast', (l) => /^acast$/i.test(l));
  byLabel('soundwise', (l) => /^soundwise$/i.test(l));
  byLabel('ready', (l) => READY_RE.test(l));
  if (miniStatus) byLabel('minicourse_status', (l) => MINI_RE.test(l));
  // Every embed-labelled column (the Acast label and the other embed label): the CELL decides
  // (acastEmbedUrl); a cell that is not an Acast URL stays in Legacy.
  norms.forEach((l, i) => { if (l && !role.has(i) && EMBED_LABEL_RE.test(l)) role.set(i, 'embed'); });
  return { norms, raws, role };
}

const cellText = (t, r, c) => (c >= 0 ? String((t.text[r] || [])[c] ?? '') : '');
const cellLink = (t, r, c) => (c >= 0 ? String(((t.links || [])[r] || [])[c] ?? '') : '');

/** A link cell as the sheet should show it: the cell text when it holds a link /
 * id / file name, else the hyperlink target when there is one. */
export function rawLink(text, link) {
  const raw = outer(text);
  if (driveIds(raw).length || hasFolderLink(raw) || /https?:\/\//i.test(raw)) return raw;
  return link ? String(link) : raw;
}

/** True when the URL host of `text` contains "acast" (embed.acast.com, play.acast.com …). */
export function acastEmbedUrl(text) {
  const m = /https?:\/\/([^\/\s?#"'<>]+)/i.exec(String(text ?? ''));
  return !!m && m[1].toLowerCase().includes('acast');
}

/** An Acast episode id: exactly 24 hex digits (any case). */
export const ACAST_EPISODE_ID_RE = /^[0-9a-f]{24}$/i;
export const acastEpisodeId = (text) => ACAST_EPISODE_ID_RE.test(outer(text));

/** acast_embed and acast_episode_id for one row, from the embed-labelled cells (both
 * labels). The first cell whose URL host contains "acast" is acast_embed; the first
 * cell that is a bare 24-hex id is acast_episode_id (stored trimmed). Both columns are
 * marked used; every other embed cell stays for Legacy. A URL is never built from an id. */
function acastEmbed(t, r0, role, used) {
  let embed = '';
  let episodeId = '';
  for (const [c, r] of role) {
    if (r !== 'embed') continue;
    const v = rawLink(cellText(t, r0, c), cellLink(t, r0, c));
    if (v === '') continue;
    if (!embed && acastEmbedUrl(v)) { embed = v; used.add(c); } else if (!episodeId && acastEpisodeId(v)) { episodeId = outer(v); used.add(c); }
  }
  return { embed, episodeId };
}

/** Evidence for the MiniCourse decision (C8): done/empty only → a status column,
 * anything else → Legacy. */
export function minicourseDecision(valueCounts) {
  const other = Object.entries(valueCounts).filter(([v]) => v !== '' && !DONE.test(v));
  return { decision: other.length === 0 ? 'status' : 'legacy', other: other.map(([v, n]) => ({ value: v, rows: n })) };
}

/** Prepass (C8): values of every MiniCourse-labelled column over the rows that go in the
 * sheet (numbered, non-section). done/empty only → status column; else → Legacy. */
export function scanMiniCourse(files, aliases = null) {
  const counts = {};
  for (const f of files) {
    if (NON_COURSE_FILES.has(canonicalFileId(f.file_id, aliases))) continue;
    for (const t of f.tabs) {
      const tabName = canonicalTab(f.file_id, t.name, aliases);
      const parsed = parseTab(t);
      if (parsed.status !== 'ok' || SKIP_TABS.has(`${canonicalFileId(f.file_id, aliases)}\t${tabName}`)) continue;
      const { norms, role } = assignColumns(t.text, parsed.headerRow - 1, parsed.cols);
      const cs = norms.map((l, i) => (MINI_RE.test(l) && !role.has(i) ? i : -1)).filter((i) => i >= 0);
      for (const l of parsed.lessons) {
        if (isSectionRow(l)) continue;
        for (const c of cs) { const v = outer(cellText(t, l.row - 1, c)); counts[v] = (counts[v] || 0) + 1; }
      }
    }
  }
  return counts;
}

// ── the rows ──────────────────────────────────────────────────────────────────

const approvedSet = (manifest) =>
  new Set((manifest || []).filter((e) => e && e.drive_file_id && /^approved\b/i.test(e.status || '')).map((e) => e.drive_file_id));
const manifestSet = (manifest) => new Set((manifest || []).filter((e) => e && e.drive_file_id).map((e) => e.drive_file_id));

/**
 * files = [{ file_id, file_name, tabs: [{ name, text, links }] }] (as catalogue-build).
 * ctx   = { teacherFiles, pending, teachers, courseIds, manifest, failedReview(Set), aliases }
 * → { rows[], legacy[], excluded[], stats, plan }
 */
export function buildMaster(files, ctx = {}) {
  const { teacherFiles = {}, pending = [], teachers = [], courseIds = {}, manifest = [], failedReview = new Set(), aliases = null } = ctx;
  const approved = approvedSet(manifest);
  const inManifest = manifestSet(manifest);
  const plan = planCatalogue(files, { teacherFiles, teachers, courseIds, approved, inManifest, aliases, pending });
  const mc = scanMiniCourse(files, aliases);
  const mcDecision = minicourseDecision(mc);
  const miniStatus = mcDecision.decision === 'status';

  // catalogue entry per (course id, sheet row): visible, or hidden with its reason
  const entry = new Map();
  for (const c of plan.courses) for (const l of c.visible) entry.set(`${c.course_id}|${l.row}`, { e: l, visible: true, reason: '' });
  for (const h of plan.hidden) if (h.course_id && h.row != null) entry.set(`${h.course_id}|${h.row}`, { e: h, visible: false, reason: h.reason });

  const pendingIds = pendingSet(pending);
  const teacherName = (slug) => (teachers.find((t) => t.slug === slug) || {}).name_km ?? '';
  const rows = [];
  const legacy = [];
  const excluded = [];
  let n = 0;

  for (const f of files) {
    const fid = canonicalFileId(f.file_id, aliases);
    if (NON_COURSE_FILES.has(fid)) continue;
    const { slug } = resolveTeacher(f, { teacherFiles, teachers, aliases });
    const isPending = !slug && pendingIds.has(fid);
    const teacher = slug ? teacherName(slug) : isPending ? 'pending' : '';

    for (const t of f.tabs) {
      const tabName = canonicalTab(f.file_id, t.name, aliases);
      const key = `${fid}\t${tabName}`;
      const parsed = parseTab(t);
      if (parsed.status !== 'ok' || SKIP_TABS.has(key)) continue;
      const hiddenTab = HIDDEN_TABS.includes(tabName);
      const courseId = plan.registry[key] || '';
      const { norms, raws, role } = assignColumns(t.text, parsed.headerRow - 1, parsed.cols, { miniStatus });
      const idx = (name) => { for (const [i, r] of role) if (r === name) return i; return -1; };
      const firstLesson = parsed.lessons.find((l) => !isSectionRow(l)) || parsed.lessons[0];
      const hiddenTabTitle = hiddenTab ? courseTitle(t.text, parsed.cols, parsed.headerRow, firstLesson.row, t.name).title : '';

      for (const row of parsed.unnumbered) {
        excluded.push({ file_id: f.file_id, tab: t.name, row, kind: 'unnumbered row', text: outer(cellText(t, row - 1, parsed.cols.title)) || outer(cellText(t, row - 1, parsed.cols.lessonCode)) });
      }

      for (const l of parsed.lessons) {
        const r0 = l.row - 1;
        if (isSectionRow(l)) {
          excluded.push({ file_id: f.file_id, tab: t.name, row: l.row, kind: 'section row', text: outer(l.title) || outer(l.lesson_code) });
          continue;
        }
        const found = entry.get(`${courseId}|${l.row}`);
        let sourceId;
        let sourceFrom;
        let lessonId;
        if (found) {
          sourceId = found.e.source_id;
          sourceFrom = found.e.source_from;
          lessonId = found.e.lesson_id;
        } else { // the hidden tab never reaches the catalogue: same functions, one row
          const ps = pickSource(l);
          sourceId = ps.id;
          sourceFrom = ps.from;
          lessonId = lessonIdOf(l, sourceId);
        }
        const used = new Set();
        const L = (name) => {
          const c = idx(name);
          if (c < 0) return '';
          const v = rawLink(cellText(t, r0, c), cellLink(t, r0, c));
          if (v !== '') used.add(c);
          return v;
        };
        const youtube = L('youtube') || L('youtube_extra');
        const acastCell = idx('acast') >= 0 ? cellText(t, r0, idx('acast')) : '';
        const { embed, episodeId } = acastEmbed(t, r0, role, used);
        const swCell = idx('soundwise') >= 0 ? cellText(t, r0, idx('soundwise')) : '';
        const readyCell = idx('ready') >= 0 ? cellText(t, r0, idx('ready')) : '';
        const miniCell = idx('minicourse_status') >= 0 ? cellText(t, r0, idx('minicourse_status')) : '';
        const stray = []; // [column index] values that do not fit their status column
        const acastDone = DONE.test(outer(acastCell));
        if (outer(acastCell) !== '' && !acastDone) stray.push(idx('acast'));
        if (outer(swCell) !== '' && !DONE.test(outer(swCell))) stray.push(idx('soundwise'));
        if (outer(readyCell) !== '' && !YES.test(outer(readyCell))) stray.push(idx('ready'));

        const issues = [];
        if (found && !found.visible) issues.push(found.reason);
        if (hiddenTab) issues.push('hidden tab');
        if (!outer(l.title)) issues.push('no title');
        if (!lessonId) issues.push('no source, no code');
        if (acastDone && !embed && !episodeId) issues.push('acast embed missing');

        const rowKey = `M${String(++n).padStart(5, '0')}`;
        const src = sourceId ? sourceFrom || '' : '';
        rows.push({
          row_key: rowKey,
          lesson_id: lessonId || '',
          course_id: courseId,
          teacher,
          course_title_km: found ? found.e.title : hiddenTabTitle,
          course_title_en: '',
          lesson_no: outer(l.number),
          lesson_title: outer(l.title),
          lesson_code: outer(l.lesson_code),
          video_code: outer(l.video_code),
          mp3_link: L('mp3'),
          mp4_link: L('mp4'),
          minicourse_link: L('minicourse'),
          youtube_link: youtube,
          original_video_link: L('original'),
          details: idx('details') >= 0 ? cellText(t, r0, idx('details')) : '',
          source_type: src,
          audio_status: sourceId && approved.has(sourceId) ? 'approved'
            : sourceId && failedReview.has(sourceId) ? 'needs review'
              : sourceId && inManifest.has(sourceId) ? 'converted' : 'not started',
          learn_live: found && found.visible ? 'yes' : 'no',
          acast_status: acastDone || embed ? 'posted' : 'to do',
          acast_embed: embed,
          acast_episode_id: episodeId,
          soundwise_status: DONE.test(outer(swCell)) ? 'posted' : 'to do',
          minicourse_status: miniStatus ? (DONE.test(outer(miniCell)) ? 'posted' : 'to do') : '',
          issues: issues.join('; '),
          ready: YES.test(outer(readyCell)) ? 'yes' : '',
          notes: '',
          source_file: f.file_id,
          source_tab: t.name,
          source_row: String(l.row),
        });

        // Legacy: every other labelled column that holds data, byte-exact.
        const strayCols = new Set(stray);
        for (let c = 0; c < norms.length; c++) {
          if (!norms[c]) continue;
          const r = role.get(c);
          const consumed = r && !((r === 'youtube_extra' || r === 'embed') && !used.has(c)) && !strayCols.has(c);
          if (consumed) continue;
          const text = cellText(t, r0, c);
          const value = outer(text) !== '' ? text : cellLink(t, r0, c);
          if (outer(value) === '') continue;
          legacy.push({ row_key: rowKey, source_file: f.file_id, source_tab: t.name, source_row: String(l.row), label: raws[c], value });
        }
      }
    }
  }

  const newIds = Object.keys(plan.registry).filter((k) => !(k in courseIds));
  return {
    rows, legacy, excluded, plan,
    stats: { rows: rows.length, legacy: legacy.length, excluded: excluded.length, newCourseIds: newIds, minicourse: { values: mc, ...mcDecision } },
  };
}

// ── CSV output (dry run) ─────────────────────────────────────────────────────

export const EXCLUDED_HEADER = ['file_id', 'tab', 'row', 'kind', 'text'];

export function masterCsv(columns, rows) {
  return toCsv(columns.columns.map((c) => c.key), rows);
}
export function legacyCsv(columns, legacy) {
  return toCsv(columns.legacy.columns, legacy);
}
export function excludedCsv(excluded) {
  return toCsv(EXCLUDED_HEADER, excluded);
}
export function coursesCsv(columns, courses) {
  return toCsv(columns.courses.columns.map((c) => c.key), courses);
}

/** Courses tab (bulk 08 Part 6): one row per distinct non-empty course_id of the Lessons
 * rows, in order of first appearance. course_title_km and teacher are copied from the
 * first Lessons row of the course; lesson_count = Lessons rows with that course_id;
 * course_status is empty at seed (the team fills it). Hidden-tab rows have no course_id
 * and are not in this tab. */
export function buildCourses(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.course_id) continue;
    if (!by.has(r.course_id)) by.set(r.course_id, { course_id: r.course_id, course_title_km: r.course_title_km, teacher: r.teacher, lesson_count: 0, course_status: '' });
    by.get(r.course_id).lesson_count += 1;
  }
  return [...by.values()].map((c) => ({ ...c, lesson_count: String(c.lesson_count) }));
}

// ── Lists tab (dropdown values) ──────────────────────────────────────────────

export function listsTable(columns) {
  const dd = [...columns.columns, ...(columns.courses ? columns.courses.columns : [])].filter((c) => Array.isArray(c.dropdown));
  const height = Math.max(0, ...dd.map((c) => c.dropdown.length));
  const grid = [dd.map((c) => c.key)];
  for (let i = 0; i < height; i++) grid.push(dd.map((c) => c.dropdown[i] ?? ''));
  return grid;
}

// ── Google Sheets (write mode) ───────────────────────────────────────────────

export class RefuseError extends Error {}

/** A write failed part way: which tab, and the last row that was written (0 = none). */
export class SheetWriteError extends Error {
  constructor(tab, lastRow, cause) {
    super(`write failed in tab ${tab}: last row written ${lastRow}: ${cause && cause.message ? cause.message : cause}`);
    this.tab = tab;
    this.lastRow = lastRow;
    this.cause = cause;
  }
}

export const SPARE_ROWS = 100;
export const SPARE_COLUMNS = 5;
export const WRITE_CHUNK = 1000;

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
export const colLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Contiguous [start, end) runs of column indexes that are protected. */
export function protectedRuns(columns) {
  const runs = [];
  columns.columns.forEach((c, i) => {
    if (!c.protected) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else runs.push([i, i + 1]);
  });
  return runs;
}

/**
 * Fill Lessons, Legacy and Lists. `fetchFn` is injected (tests pass a fake).
 * Order: refuse-check first; data goes in Legacy/Lists, then formatting, then the
 * Lessons rows LAST — a failure half way leaves Lessons without data rows, so a
 * re-run is allowed (protected ranges of an earlier attempt are removed first).
 */
export async function writeToSheet({ sheetId, token, saEmail, columns, rows, legacy, courses = [], fetchFn = fetch, log = () => {} }) {
  if (!sheetId) throw new Error('sheet id missing');
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('sheet id has characters a Google sheet id never has');
  if (!token) throw new Error('ACCESS_TOKEN missing');
  if (!saEmail) throw new Error('SA_EMAIL missing (editor of the protected ranges)');
  const api = async (method, path, body) => {
    const res = await fetchFn(`${SHEETS_BASE}/${sheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheets API ${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  const meta = async () => (await api('GET', '?fields=sheets(properties(sheetId,title),protectedRanges(protectedRangeId))')).sheets || [];
  const byTitle = (sheets, title) => sheets.find((s) => s.properties.title === title);
  const enc = encodeURIComponent;

  let sheets = await meta();
  const lessons0 = byTitle(sheets, 'Lessons');
  if (lessons0) {
    const cur = await api('GET', `/values/${enc(`Lessons!A2:${colLetter(columns.columns.length - 1)}`)}`);
    const hasData = (cur.values || []).some((r) => r.some((c) => String(c).trim() !== ''));
    if (hasData) throw new RefuseError('Lessons already has data rows - refusing to overwrite team edits');
  }

  const missing = ['Lessons', 'Legacy', 'Lists', 'Courses'].filter((t) => !byTitle(sheets, t));
  if (missing.length) {
    await api('POST', ':batchUpdate', { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });
    sheets = await meta();
  }
  const id = (title) => byTitle(sheets, title).properties.sheetId;
  const lessonsId = id('Lessons');
  const coursesId = id('Courses');

  // Resize the tab's grid first (a new tab is 1000 rows x 26-30 columns): header + all rows +
  // spare rows, all columns + spare columns. Then clear and write in chunks. Any error stops
  // the write and names the tab and the last row that was written.
  const put = async (title, grid, { rowsTotal = grid.length } = {}) => {
    let last = 0;
    try {
      const cols = Math.max(1, ...grid.map((r) => r.length));
      await api('POST', ':batchUpdate', {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: id(title), gridProperties: { rowCount: Math.max(rowsTotal, grid.length) + SPARE_ROWS, columnCount: cols + SPARE_COLUMNS } },
            fields: 'gridProperties.rowCount,gridProperties.columnCount',
          },
        }],
      });
      await api('POST', `/values/${enc(`${title}!A:ZZ`)}:clear`, {});
      for (let i = 0; i < grid.length; i += WRITE_CHUNK) {
        const chunk = grid.slice(i, i + WRITE_CHUNK);
        await api('PUT', `/values/${enc(`${title}!A${i + 1}`)}?valueInputOption=RAW`, { range: `${title}!A${i + 1}`, majorDimension: 'ROWS', values: chunk });
        last = i + chunk.length;
      }
    } catch (e) {
      throw new SheetWriteError(title, last, e);
    }
  };
  const keys = columns.columns.map((c) => c.key);
  await put('Legacy', [columns.legacy.columns, ...legacy.map((r) => columns.legacy.columns.map((k) => r[k] ?? ''))]);
  await put('Lists', listsTable(columns));
  const courseKeys = columns.courses.columns.map((c) => c.key);
  await put('Courses', [courseKeys, ...courses.map((r) => courseKeys.map((k) => r[k] ?? ''))]);
  await put('Lessons', [keys], { rowsTotal: rows.length + 1 }); // header only for now, grid sized for all rows
  log('tabs written: Legacy, Lists, Courses, Lessons header');

  // freeze + dropdowns + protected ranges (service account only), for Lessons and Courses
  const requests = [];
  const formatTab = (title, tabSheetId, defs) => {
    const tabKeys = defs.columns.map((c) => c.key);
    for (const p of (byTitle(sheets, title).protectedRanges || [])) requests.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } });
    requests.push({ updateSheetProperties: { properties: { sheetId: tabSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    defs.columns.forEach((c, i) => {
      if (!Array.isArray(c.dropdown)) return;
      requests.push({
        setDataValidation: {
          range: { sheetId: tabSheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          rule: { condition: { type: 'ONE_OF_LIST', values: c.dropdown.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true },
        },
      });
    });
    for (const [a, b] of protectedRuns(defs)) {
      requests.push({
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: tabSheetId, startColumnIndex: a, endColumnIndex: b },
            description: `master sheet ${title}: ${tabKeys.slice(a, b).join(', ')} (service account only)`,
            warningOnly: false,
            editors: { users: [saEmail] },
          },
        },
      });
    }
  };
  formatTab('Lessons', lessonsId, columns);
  formatTab('Courses', coursesId, columns.courses);
  await api('POST', ':batchUpdate', { requests });
  log('formatting done: freeze, dropdowns, protected ranges (Lessons, Courses)');

  await put('Lessons', [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ''))]);
  log(`Lessons rows written: ${rows.length}`);
  return { rows: rows.length, legacy: legacy.length, courses: courses.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);

export function loadContext(root = process.cwd()) {
  const tf = readJson(join(root, 'data', 'teacher-files.json'), { files: {} });
  const fr = join(root, 'data', 'queues', 'failed-review.csv');
  const failedReview = new Set(existsSync(fr)
    ? readFileSync(fr, 'utf-8').split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter((v) => v && v !== 'drive_file_id')
    : []);
  return {
    teacherFiles: tf.files || {},
    pending: Array.isArray(tf.pending) ? tf.pending : [],
    teachers: readJson(join(root, 'data', 'source', 'teachers-2026-11-02', 'teachers-2026-11-02.json'), []),
    courseIds: (readJson(join(root, 'data', 'course-ids.json'), { courses: {} }).courses) || {},
    manifest: readJson(join(root, 'data', 'media-manifest.json'), []),
    failedReview,
    aliases: loadAliases(root),
  };
}

/** Read every .xlsx in `dir` into catalogue-style file objects. */
export async function loadFiles(dir, aliases) {
  let XLSX;
  try { const m = await import('xlsx'); XLSX = m.default ?? m; }
  catch { throw new Error('The `xlsx` reader is not installed. Run:  npm install --no-save xlsx@0.18.5'); }
  const invPath = join(dir, 'INVENTORY.md');
  const names = existsSync(invPath) ? parseInventoryNames(readFileSync(invPath, 'utf-8')) : new Map();
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    if (extname(f).toLowerCase() !== '.xlsx') continue;
    const id = basename(f, extname(f));
    const wb = XLSX.readFile(join(dir, f));
    files.push({
      file_id: id,
      file_name: names.get(id) ?? names.get(canonicalFileId(id, aliases)) ?? '',
      tabs: wb.SheetNames.map((n) => ({ name: n, ...sheetToGrid(XLSX, wb.Sheets[n]) })),
    });
  }
  return files;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const root = process.cwd();
  const mode = arg('mode', 'dry');
  const dir = arg('dir', join(root, 'data', 'source', 'sheets'));
  const out = arg('out', join(root, 'reports'));
  if (!['dry', 'write'].includes(mode)) { console.error(`--mode must be dry or write (got ${mode})`); process.exit(2); }
  if (!existsSync(dir)) { console.error(`sheets dir not found: ${dir}`); process.exit(1); }

  const columns = loadColumns(root);
  const ctx = loadContext(root);
  const files = await loadFiles(dir, ctx.aliases);
  const { rows, legacy, excluded, stats } = buildMaster(files, ctx);
  const courses = buildCourses(rows);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'master-seed-courses.csv'), coursesCsv(columns, courses), 'utf-8');
  writeFileSync(join(out, 'master-seed-preview.csv'), masterCsv(columns, rows), 'utf-8');
  writeFileSync(join(out, 'master-seed-legacy.csv'), legacyCsv(columns, legacy), 'utf-8');
  writeFileSync(join(out, 'master-seed-excluded.csv'), excludedCsv(excluded), 'utf-8');
  console.log(`rows ${stats.rows} · legacy ${stats.legacy} · courses ${courses.length} · excluded ${stats.excluded} · new course ids ${stats.newCourseIds.length}`);
  console.log(`minicourse decision: ${stats.minicourse.decision} · other values: ${JSON.stringify(stats.minicourse.other)}`);
  console.log(`wrote ${join(out, 'master-seed-preview.csv')}, master-seed-legacy.csv, master-seed-excluded.csv`);
  if (stats.newCourseIds.length) { console.error('::error::a dry run must not create course ids: ' + stats.newCourseIds.join(', ')); process.exit(1); }
  if (mode === 'dry') return;

  try {
    const r = await writeToSheet({
      sheetId: arg('sheet-id', ''), token: process.env.ACCESS_TOKEN, saEmail: process.env.SA_EMAIL,
      columns, rows, legacy, courses, log: (m) => console.log(`[sheet] ${m}`),
    });
    console.log(`write done: ${r.rows} Lessons rows, ${r.legacy} Legacy rows, ${r.courses} Courses rows`);
  } catch (e) {
    if (e instanceof RefuseError) { console.error(`::error::${e.message}`); process.exit(3); }
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) main();
