/** PART 7c — check_decision at scale: 200 rows filled at once (fake Sheets API with a real grid). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planDecisions, applyDecisions, decisionCells, COLUMN } from '../decisions.mjs';
import { applyDecision } from '../../media/approve-manifest.mjs';
import { readTab, writeRanges } from '../sync.mjs';
import { allLessonColumns } from '../export.mjs';
import { colLetter } from '../seed.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = allLessonColumns(columns).map((c) => c.key);
const ID = (n) => `F${String(n).padStart(27, '0')}`;
const VID = (n) => `V${String(n).padStart(27, '0')}`;
const url = (id) => `https://drive.google.com/file/d/${id}/view`;
const sha = (n) => n.toString(16).padStart(64, '0');
const D = '2026-11-18';

function fakeSheets(values) {
  const grid = { Lessons: values.map((r) => [...r]) };
  const writes = [];
  const fetchFn = async (u, init) => {
    const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEET', ''));
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET') return ok({ values: grid.Lessons });
    for (const d of JSON.parse(init.body).data) {
      writes.push(d.range);
      const m = /^Lessons!([A-Z]+)(\d+):/.exec(d.range);
      const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = grid.Lessons[Number(m[2]) - 1];
      while (row.length <= c) row.push('');
      row[c] = d.values[0][0];
    }
    return ok({});
  };
  return { fetchFn, grid, writes };
}

// 200 rows over 8 courses: 120 approve anyway (converted), 20 approve anyway (not converted),
// 30 fixed (passed the re-check), 10 fixed (still flagged), 20 hold. 40 of the rows have a video.
const rows = [];
const manifest = [];
const videoManifest = [];
const pass = [];
const flagged = [];
for (let n = 0; n < 200; n++) {
  const course = `c9${String(n % 8).padStart(2, '0')}`;
  const kind = n < 120 ? 'aa' : n < 140 ? 'aa-none' : n < 170 ? 'fx-pass' : n < 180 ? 'fx-flag' : 'hold';
  const r = Object.fromEntries(LK.map((k) => [k, '']));
  Object.assign(r, { row_key: `M${String(n + 1).padStart(5, '0')}`, course_id: course, lesson_title: `t${n}`, source_type: 'mp3', source_file: 'F', mp3_link: url(ID(n)), check_decision: kind.startsWith('aa') ? 'approve anyway' : kind.startsWith('fx') ? 'fixed' : 'hold' });
  if (n % 5 === 0 && kind === 'aa') { r.mp4_link = url(VID(n)); videoManifest.push({ kind: 'video', drive_file_id: VID(n), sha256: sha(1000 + n), status: 'DRAFT' }); }
  if (kind !== 'aa-none') manifest.push({ drive_file_id: ID(n), sha256: sha(n + 1), status: 'DRAFT' });
  if (kind === 'fx-pass') pass.push({ id: ID(n), sha256: sha(n + 1) });
  if (kind === 'fx-flag') flagged.push({ id: ID(n), reasons: ['silence 70 s in the last 2 min'] });
  rows.push(r);
}
const values = [LK, ...rows.map((r) => LK.map((k) => r[k]))];

describe('200 rows filled at once', () => {
  it('one approve-media call per course (and media, reviewer); every acted row written back; only check_decision', async () => {
    const api = fakeSheets(values);
    const sheet = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const objs = sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));
    const plan = planDecisions(objs, manifest, videoManifest, {});
    expect(plan.length).toBe(200);
    const calls = [];
    const spy = (m, ids, reviewer, decision, date) => { calls.push({ ids: ids.length, reviewer }); return applyDecision(m, ids, reviewer, decision, date); };
    const t0 = Date.now();
    const r = applyDecisions(plan, { manifest, videoManifest, precheck: { results: { pass, flagged, pending: [] } }, log: {}, date: D, approveFn: spy });
    expect(Date.now() - t0).toBeLessThan(2000);
    // audio: 8 courses × (approve anyway + fixed) = 16 calls at most; video: 8 at most — never 160
    expect(calls.length).toBeLessThanOrEqual(24);
    expect(r.calls.filter((c) => c.media === 'audio' && c.reviewer === 'team: approve anyway').length).toBe(8);
    expect(calls.reduce((s, c) => s + c.ids, 0)).toBe(120 + 30 + 24);
    expect(r.manifest.filter((e) => e.status === 'approved').length).toBe(150);
    expect(r.videoManifest.filter((e) => e.status === 'approved').length).toBe(24);
    const cells = decisionCells(sheet, r.done);
    expect(cells.length).toBe(180); // every row except the 20 holds
    await writeRanges({ sheetId: 'SHEET', token: 't', ranges: cells, fetchFn: api.fetchFn });
    const ci = LK.indexOf(COLUMN);
    expect(new Set(api.writes.map((w) => w.replace(/\d+:.*$/, '')))).toEqual(new Set([`Lessons!${colLetter(ci)}`]));
    const got = api.grid.Lessons.slice(1).map((row) => row[ci]);
    expect(got.filter((v) => v === `done ${D}`).length).toBe(150);
    expect(got.filter((v) => v === 'still failing: audio not converted yet').length).toBe(20);
    expect(got.filter((v) => v === 'still failing: audio still flagged: silence 70 s in the last 2 min').length).toBe(10);
    expect(got.filter((v) => v === 'hold').length).toBe(20);
    // every other cell unchanged
    api.grid.Lessons.forEach((row, i) => LK.forEach((k, j) => { if (j !== ci) expect(row[j] ?? '').toBe(values[i][j] ?? ''); }));

    // re-run: the written-back values are not decisions -> nothing to act on, nothing written
    const sheet2 = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    const objs2 = sheet2.rows.map((x) => Object.fromEntries(sheet2.header.map((k, i) => [k, x[i] ?? ''])));
    const plan2 = planDecisions(objs2, r.manifest, r.videoManifest, r.log);
    expect(plan2.filter((p) => p.decision !== 'hold')).toEqual([]);
    expect(decisionCells(sheet2, applyDecisions(plan2, { manifest: r.manifest, videoManifest: r.videoManifest, log: r.log, date: D }).done)).toEqual([]);

    // the team picks "fixed" again on a still-failing row (same files): acted on again
    objs2[140].check_decision = 'fixed';
    expect(planDecisions(objs2, r.manifest, r.videoManifest, r.log).map((p) => p.row_key)).toEqual([objs2[140].row_key]);
  });
});
