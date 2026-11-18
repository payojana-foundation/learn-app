/**
 * scripts/master/write-switch.mjs — PART 12 (18 Nov): checks around switching master-sync to write.
 * Run by .github/workflows/master-write-switch.yml (manual, one step per run). Prints one JSON
 * result line per step; exit 1 = the check failed (stop).
 *
 *   backup <sheet> <drive name>      files.copy of the master sheet into the Shared Drive
 *                                    (supportsAllDrives), named "MASTER backup YYYY-MM-DD"
 *   preview <preview.csv>            the dry-run preview: TEAM-column changes (must be 0), per column
 *   protections <sheet>              every SYSTEM column of Lessons/Courses inside a protected range
 *   verify <sheet> <backup id>       TEAM columns of Lessons/Courses byte-identical to the backup
 *   restore <sheet> <backup id>      write the SYSTEM columns of the backup back (step 6 only)
 * Env ACCESS_TOKEN. The backup id is printed for the step summary only; nothing is committed.
 */
import { readFileSync } from 'node:fs';
import { readTab, writeRanges } from './sync.mjs';
import { parseCsvObjects } from './csv.mjs';
import { allLessonColumns, allCourseColumns } from './export.mjs';
import { colLetter } from './seed.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LCOL = allLessonColumns(columns);
const CCOL = allCourseColumns(columns);
const TEAM = { Lessons: new Set(LCOL.filter((c) => c.owner === 'TEAM').map((c) => c.key)), Courses: new Set(CCOL.filter((c) => c.owner === 'TEAM').map((c) => c.key)) };
const SYSTEM = { Lessons: LCOL.filter((c) => c.owner === 'SYSTEM').map((c) => c.key), Courses: CCOL.filter((c) => c.owner === 'SYSTEM').map((c) => c.key) };

/** Preview rows -> { total, team, byColumn }. Pure. */
export function previewCheck(rows) {
  const byColumn = {};
  let team = 0;
  for (const r of rows) {
    const col = r.column === '(new row)' ? 'new Courses row' : r.column;
    byColumn[col] = (byColumn[col] || 0) + 1;
    if (TEAM[r.tab] && TEAM[r.tab].has(r.column)) team++;
  }
  return { total: rows.length, team, byColumn };
}

/** Column ranges of a tab covered by protected ranges -> SYSTEM keys NOT covered. Pure. */
export function unprotected(header, systemKeys, ranges) {
  return systemKeys.filter((k) => {
    const i = header.indexOf(k);
    if (i < 0) return false;
    return !ranges.some((r) => (r.startColumnIndex ?? 0) <= i && i < (r.endColumnIndex ?? Infinity) && (r.startRowIndex ?? 0) <= 1);
  });
}

/** TEAM cells that differ between two reads of a tab, matched by key column. Pure. */
export function teamDiff(a, b, keyCol, teamKeys) {
  const idx = (t) => new Map(t.rows.map((r) => [r[t.header.indexOf(keyCol)], r]));
  const A = idx(a);
  const B = idx(b);
  const diffs = [];
  for (const [k, ra] of A) {
    if (!k) continue;
    const rb = B.get(k);
    if (!rb) { diffs.push({ key: k, column: '(row missing)' }); continue; }
    for (const c of teamKeys) {
      const ia = a.header.indexOf(c);
      const ib = b.header.indexOf(c);
      if (ia < 0 && ib < 0) continue;
      const va = ia < 0 ? '' : String(ra[ia] ?? '');
      const vb = ib < 0 ? '' : String(rb[ib] ?? '');
      if (va !== vb) diffs.push({ key: k, column: c });
    }
  }
  if (B.size !== A.size) diffs.push({ key: '(row count)', column: `${A.size} vs ${B.size}` });
  return diffs;
}

const api = async (method, url, token, body) => {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j;
  try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, json: j };
};

async function main() {
  const [, , cmd, a, b] = process.argv;
  const token = process.env.ACCESS_TOKEN || '';
  const out = (o, ok) => { console.log(JSON.stringify(o)); process.exit(ok ? 0 : 1); };
  if (cmd === 'preview') {
    const r = previewCheck(parseCsvObjects(readFileSync(a, 'utf-8')));
    return out({ step: 'preview', ...r }, r.team === 0);
  }
  if (!token) out({ error: 'ACCESS_TOKEN not set' }, false);
  if (cmd === 'backup') {
    const d = await api('GET', `https://www.googleapis.com/drive/v3/drives?q=${encodeURIComponent(`name = '${b}'`)}`, token);
    const drive = (d.json.drives || [])[0];
    if (!drive) return out({ step: 'backup', ok: false, error: `Shared Drive "${b}" not visible (HTTP ${d.status})` }, false);
    const name = `MASTER backup ${new Date().toISOString().slice(0, 10)}`;
    const c = await api('POST', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(a)}/copy?supportsAllDrives=true&fields=id,name,driveId`, token, { name, parents: [drive.id] });
    if (c.status !== 200) return out({ step: 'backup', ok: false, status: c.status, error: (c.json.error && c.json.error.message) || c.json.raw || 'copy failed' }, false);
    return out({ step: 'backup', ok: true, backup_id: c.json.id, name: c.json.name, in_drive: c.json.driveId === drive.id }, c.json.driveId === drive.id);
  }
  if (cmd === 'protections') {
    const m = await api('GET', `https://sheets.googleapis.com/v4/spreadsheets/${a}?fields=sheets(properties(title),protectedRanges(range,warningOnly))`, token);
    const res = {};
    let ok = true;
    for (const tab of ['Lessons', 'Courses']) {
      const s = (m.json.sheets || []).find((x) => x.properties.title === tab);
      const ranges = ((s && s.protectedRanges) || []).filter((p) => !p.warningOnly).map((p) => p.range);
      const sheet = await readTab({ sheetId: a, token, tab });
      const missing = unprotected(sheet.header, SYSTEM[tab], ranges);
      res[tab] = { protected_ranges: ranges.length, system_columns: SYSTEM[tab].length, unprotected: missing };
      if (missing.length) ok = false;
    }
    return out({ step: 'protections', ok, ...res }, ok);
  }
  if (cmd === 'verify' || cmd === 'restore') {
    const cur = { Lessons: await readTab({ sheetId: a, token, tab: 'Lessons' }), Courses: await readTab({ sheetId: a, token, tab: 'Courses' }) };
    const bak = { Lessons: await readTab({ sheetId: b, token, tab: 'Lessons' }), Courses: await readTab({ sheetId: b, token, tab: 'Courses' }) };
    if (cmd === 'verify') {
      const dl = teamDiff(bak.Lessons, cur.Lessons, 'row_key', LCOL.filter((c) => c.owner === 'TEAM').map((c) => c.key));
      const dc = teamDiff(bak.Courses, cur.Courses, 'course_id', CCOL.filter((c) => c.owner === 'TEAM').map((c) => c.key));
      return out({ step: 'verify', ok: !dl.length && !dc.length, lessons_team_diffs: dl.length, courses_team_diffs: dc.length, sample: [...dl, ...dc].slice(0, 10) }, !dl.length && !dc.length);
    }
    // restore: SYSTEM columns of the backup, by row position (the sync never moves rows)
    const ranges = [];
    for (const tab of ['Lessons', 'Courses']) {
      for (const k of SYSTEM[tab]) {
        const ib = bak[tab].header.indexOf(k);
        const ic = cur[tab].header.indexOf(k);
        if (ib < 0 || ic < 0) continue;
        const L = colLetter(ic);
        const vals = bak[tab].rows.map((r) => [String(r[ib] ?? '')]);
        if (vals.length) ranges.push({ range: `${tab}!${L}2:${L}${vals.length + 1}`, values: vals });
      }
    }
    const n = await writeRanges({ sheetId: a, token, ranges });
    return out({ step: 'restore', ok: true, ranges: n }, true);
  }
  out({ error: 'Usage: write-switch.mjs backup|preview|protections|verify|restore …' }, false);
}

if (process.argv[1] && process.argv[1].endsWith('write-switch.mjs')) main();
