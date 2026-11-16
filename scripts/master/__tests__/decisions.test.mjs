/** PART 2 — check_decision (placeholders only). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planDecisions, recheckIds, applyDecisions, issueCells, withDecision, ensureColumn, DECISIONS, COLUMN } from '../decisions.mjs';
import { computeSystem, presentKeys, checkHeader, HeaderMismatchError } from '../sync.mjs';
import { rowsFromValues, plan as exportPlan } from '../export.mjs';
import { colLetter } from '../seed.mjs';

const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = columns.columns.map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (o) => ({ ...Object.fromEntries(LK.map((k) => [k, ''])), course_id: 'c900', lesson_title: 't', source_type: 'mp3', ...o });
const sha = (c) => c.repeat(64);
const rows = [
  row({ row_key: 'M1', mp3_link: url('A1'), mp4_link: url('V1'), check_decision: 'approve anyway' }),
  row({ row_key: 'M2', mp3_link: url('A2'), check_decision: 'fixed' }),
  row({ row_key: 'M3', mp3_link: url('A3'), check_decision: 'hold' }),
  row({ row_key: 'M4', mp3_link: url('A4'), check_decision: 'fixed' }), // never converted
  row({ row_key: 'M5', mp3_link: url('A5'), check_decision: '' }),
  row({ row_key: 'M6', mp3_link: url('A6'), check_decision: 'maybe' }), // not a dropdown value
];
const manifest = [
  { drive_file_id: DID('A1'), sha256: sha('a'), status: 'DRAFT' },
  { drive_file_id: DID('A2'), sha256: sha('b'), status: 'DRAFT' },
  { drive_file_id: DID('A3'), sha256: sha('c'), status: 'DRAFT' },
  { drive_file_id: DID('A5'), sha256: sha('e'), status: 'DRAFT' },
];
const videoManifest = [{ kind: 'video', drive_file_id: DID('V1'), sha256: sha('f'), status: 'DRAFT' }];

describe('the column', () => {
  it('is a TEAM column at the end with exactly the dropdown fixed | approve anyway | hold (empty = none)', () => {
    const c = columns.columns[columns.columns.length - 1];
    expect(c).toMatchObject({ key: COLUMN, owner: 'TEAM', protected: false, added_after_seed: true });
    expect(c.dropdown).toEqual(['fixed', 'approve anyway', 'hold']);
    expect(DECISIONS).toEqual(c.dropdown);
  });
  it('a sheet without the column is still read (as empty) by the sync and the export; anything else fails', () => {
    const old = LK.slice(0, -1);
    expect(presentKeys(old, LK, [COLUMN])).toEqual(old);
    expect(() => checkHeader('Lessons', old, LK, [COLUMN])).not.toThrow();
    expect(() => checkHeader('Lessons', old, LK)).toThrow(HeaderMismatchError);
    expect(() => checkHeader('Lessons', LK.slice(1), LK, [COLUMN])).toThrow(HeaderMismatchError);
    const L = exportPlan(columns)[0];
    const out = rowsFromValues('Lessons', [old, ['M1', 'X']], L.keys, L.optional);
    expect(out[0]).toMatchObject({ row_key: 'M1', lesson_id: 'X', check_decision: '' });
  });
});

describe('plan', () => {
  const p = planDecisions(rows, manifest, videoManifest, {});
  it('acts on the dropdown values only, with the audio and video ids of the row', () => {
    expect(p.map((x) => [x.row_key, x.decision])).toEqual([['M1', 'approve anyway'], ['M2', 'fixed'], ['M3', 'hold'], ['M4', 'fixed']]);
    expect(p[0]).toMatchObject({ audio_id: DID('A1'), video_id: DID('V1'), audio_sha: sha('a'), video_sha: sha('f') });
  });
  it('only "fixed" + converted audio is re-checked', () => {
    expect(recheckIds(p, manifest)).toEqual([DID('A2')]);
  });
  it('acted on once: same decision and same files = nothing to do; a new file = act again', () => {
    const log = Object.fromEntries(p.map((x) => [x.row_key, { decision: x.decision, audio_sha: x.audio_sha, video_sha: x.video_sha }]));
    expect(planDecisions(rows, manifest, videoManifest, log)).toEqual([]);
    const m2 = manifest.map((e) => (e.drive_file_id === DID('A2') ? { ...e, sha256: sha('z') } : e));
    expect(planDecisions(rows, m2, videoManifest, log).map((x) => x.row_key)).toEqual(['M2']);
  });
  it('a cleared decision is logged once', () => {
    const log = { M5: { decision: 'hold', audio_sha: sha('e'), video_sha: '' } };
    expect(planDecisions(rows, manifest, videoManifest, log).find((x) => x.row_key === 'M5')).toMatchObject({ decision: '' });
  });
});

describe('apply', () => {
  const plan = planDecisions(rows, manifest, videoManifest, {});
  const precheck = { results: { pass: [{ id: DID('A2'), sha256: sha('b') }], flagged: [], pending: [] } };
  const r = applyDecisions(plan, { manifest, videoManifest, precheck, videoPrecheck: null, autorun: { attempts: { [DID('A4')]: 2 } }, log: {}, date: '2026-01-01' });
  const st = (m, id) => m.find((e) => e.drive_file_id === DID(id)).status;
  it('approve anyway: audio and video approved, reviewer recorded', () => {
    expect(st(r.manifest, 'A1')).toBe('approved');
    expect(st(r.videoManifest, 'V1')).toBe('approved');
    expect(r.manifest.find((e) => e.drive_file_id === DID('A1')).reviewer).toBe('team: approve anyway');
    expect(r.log.M1.result).toBe('audio approved, video approved');
  });
  it('fixed: released when the re-check passes; never converted -> autorun tries reset', () => {
    expect(st(r.manifest, 'A2')).toBe('approved');
    expect(r.log.M2.result).toBe('audio passed the re-check and is approved');
    expect(r.autorun.attempts[DID('A4')]).toBeUndefined();
    expect(r.log.M4.result).toBe('not converted yet: conversion queued again');
  });
  it('fixed but still flagged: not approved, the flags are logged', () => {
    const p2 = planDecisions([rows[1]], manifest, [], {});
    const o = applyDecisions(p2, { manifest, videoManifest: [], precheck: { results: { pass: [], flagged: [{ id: DID('A2'), reasons: ['silence 90 s in the last 2 min'] }] } }, log: {}, date: 'D' });
    expect(st(o.manifest, 'A2')).toBe('DRAFT');
    expect(o.log.M2.result).toBe('audio still flagged: silence 90 s in the last 2 min');
  });
  it('hold: nothing changes', () => {
    expect(st(r.manifest, 'A3')).toBe('DRAFT');
    expect(r.log.M3.result).toBe('held');
  });
  it('the decision goes in issues (replacing an older DECISION), via the sync too', () => {
    expect(withDecision('no approved media yet; DECISION: hold (x): held', r.log.M1)).toBe('no approved media yet; DECISION: approve anyway (2026-01-01): audio approved, video approved');
    const w = computeSystem([rows[2]], [], { manifest, decisions: r.log });
    expect(w.lessons.get('M3').issues).toContain('DECISION: hold (2026-01-01): held');
  });
});

describe('sheet writes (fake Sheets API)', () => {
  function fake(header, dataRows) {
    const calls = [];
    const grid = { rows: 1000, cols: header.length + 5 };
    const fetchFn = async (u, init) => {
      const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEET', ''));
      calls.push({ method: init.method, path: p, body: init.body ? JSON.parse(init.body) : null });
      const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
      if (init.method === 'GET' && p.startsWith('?fields=')) return ok({ sheets: [{ properties: { sheetId: 7, title: 'Lessons', gridProperties: { rowCount: grid.rows, columnCount: grid.cols } } }] });
      if (init.method === 'GET') return ok({ values: [header, ...dataRows] });
      return ok({});
    };
    return { fetchFn, calls };
  }
  it('adds the header cell + dropdown once, at the end; present = no write', async () => {
    const f = fake(LK.slice(0, -1), []);
    expect(await ensureColumn({ sheetId: 'SHEET', token: 't', keys: LK, fetchFn: f.fetchFn })).toBe('added');
    const writes = f.calls.filter((c) => c.method !== 'GET');
    const letter = colLetter(LK.length - 1);
    expect(writes.map((w) => w.path)).toEqual([':batchUpdate', `/values/Lessons!${letter}1?valueInputOption=RAW`]);
    const rule = writes[0].body.requests[0].setDataValidation;
    expect(rule.range).toMatchObject({ sheetId: 7, startRowIndex: 1, startColumnIndex: LK.length - 1, endColumnIndex: LK.length });
    expect(rule.rule.condition.values.map((v) => v.userEnteredValue)).toEqual(['fixed', 'approve anyway', 'hold']);
    const g = fake(LK, []);
    expect(await ensureColumn({ sheetId: 'SHEET', token: 't', keys: LK, fetchFn: g.fetchFn })).toBe('present');
    expect(g.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('refuses to add the column to a header it does not recognise', async () => {
    const f = fake(['row_key', 'something'], []);
    await expect(ensureColumn({ sheetId: 'SHEET', token: 't', keys: LK, fetchFn: f.fetchFn })).rejects.toThrow(/not adding it/);
  });
  it('writes only the issues cells of the rows acted on (never a TEAM column)', () => {
    const sheet = { header: LK, rows: rows.map((o) => LK.map((k) => o[k])) };
    const plan = planDecisions(rows, manifest, videoManifest, {});
    const r = applyDecisions(plan, { manifest, videoManifest, precheck: null, log: {}, date: 'D' });
    const cells = issueCells(sheet, r.done, r.log);
    const L = colLetter(LK.indexOf('issues'));
    expect(cells.length).toBe(4);
    expect(cells.every((c) => new RegExp(`^Lessons!${L}\\d+:${L}\\d+$`).test(c.range))).toBe(true);
    expect(cells[0]).toEqual({ range: `Lessons!${L}2:${L}2`, values: [['DECISION: approve anyway (D): audio approved, video approved']] });
  });
});

describe('workflow', () => {
  const y = readFileSync('.github/workflows/check-decisions.yml', 'utf-8');
  it('hourly after approve-check, sheet + drive read-only scopes, re-check only when needed', () => {
    expect(y).toContain('workflows: [approve-check]');
    expect(y).toContain('https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.readonly');
    expect(y).toMatch(/if: \$\{\{ steps\.prep\.outputs\.recheck != '0' \}\}\n\s+env:[\s\S]*?precheck\.mjs --drive --silence/);
  });
  it('rebase-proof push, issues written only after the push, master-export after an approval', () => {
    expect(y).toContain('for attempt in 1 2 3 4 5 6 7 8; do');
    expect(y).toMatch(/if: \$\{\{ steps\.push\.outputs\.pushed == 'true' \}\}[\s\S]*?decisions\.mjs write-issues/);
    expect(y).toContain('gh workflow run master-export.yml --ref main');
  });
});
