/**
 * scripts/master/decisions.mjs — PART 2 (16 Nov): act on the TEAM column `check_decision`
 * of the Lessons tab (.github/workflows/check-decisions.yml, hourly after approve-check).
 *
 *   approve anyway -> approve the lesson's converted audio, and its converted video if any
 *                     (applyDecision, as approve-media per-ids; reviewer "team: approve anyway").
 *   fixed          -> forget its pre-check measurements, measure again (the workflow runs
 *                     precheck.mjs between `prepare` and `apply`), release if it passes (audio,
 *                     and video when the video passes too). Never converted -> its
 *                     course-autorun tries are reset so autorun converts it again.
 *   hold           -> nothing.
 * Acted on once per (decision, converted audio sha256, converted video sha256); logged in
 * data/ops/check-decisions.json and in the row's issues ("DECISION: ..."). Writes only the
 * issues cells of rows it acted on, plus (once) the check_decision header and its dropdown.
 *
 * CLI (env ACCESS_TOKEN, --sheet-id):
 *   prepare      -> decisions-plan.json; clears precheck measurements of `fixed` audio
 *   apply        -> manifests, data/ops/check-decisions.json, autorun-state, decisions-cells.json
 *   write-issues -> writes decisions-cells.json to the sheet (after the commit landed)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTab, writeRanges, sourceIdOf } from './sync.mjs';
import { colLetter } from './seed.mjs';
import { videoLessons } from '../media/video-inventory.mjs';
import { applyDecision } from '../media/approve-manifest.mjs';

export const COLUMN = 'check_decision';
export const DECISIONS = ['fixed', 'approve anyway', 'hold'];
export const REVIEWER = 'team: approve anyway';
export const REVIEWER_FIXED = 'team: fixed (passed the re-check)';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');
const isRejected = (e) => /^rejected\b/i.test((e && e.status) || '');

/** The DECISION text that goes in issues. Pure. */
export const decisionText = (d) => (d && d.decision ? `DECISION: ${d.decision} (${d.at}): ${d.result}` : '');

/** Current issues with the old DECISION part replaced. Pure. */
export function withDecision(issues, d) {
  const parts = String(issues || '').split('; ').filter((p) => p && !p.startsWith('DECISION: '));
  const t = decisionText(d);
  if (t) parts.push(t);
  return parts.join('; ');
}

/**
 * Which rows to act on. Pure.
 * rows: [{row_key, check_decision, ...link columns}] ; log: {row_key: {decision, audio_sha, video_sha}}
 * -> [{row_key, decision, audio_id, video_id, audio_sha, video_sha}]
 */
export function planDecisions(rows, manifest, videoManifest, log = {}) {
  const audio = new Map((manifest || []).filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const video = new Map((videoManifest || []).filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const videoOf = new Map(videoLessons(rows).map((l) => [l.row_key, l.video_id]));
  const out = [];
  for (const r of rows) {
    if (!r.row_key) continue;
    const decision = String(r[COLUMN] || '').trim();
    const prev = log[r.row_key];
    if (!decision && !(prev && prev.decision)) continue;
    if (decision && !DECISIONS.includes(decision)) continue; // not a dropdown value: ignored
    const audio_id = sourceIdOf(r);
    const video_id = videoOf.get(r.row_key) || null;
    const audio_sha = (audio_id && audio.get(audio_id)?.sha256) || '';
    const video_sha = (video_id && video.get(video_id)?.sha256) || '';
    if (prev && prev.decision === decision && prev.audio_sha === audio_sha && prev.video_sha === video_sha) continue;
    out.push({ row_key: r.row_key, decision, audio_id, video_id, audio_sha, video_sha });
  }
  return out;
}

/** Audio ids whose pre-check measurements must be forgotten (decision fixed, converted). Pure. */
export function recheckIds(plan, manifest) {
  const have = new Set((manifest || []).map((e) => e && e.drive_file_id));
  return [...new Set(plan.filter((p) => p.decision === 'fixed' && p.audio_id && have.has(p.audio_id)).map((p) => p.audio_id))];
}

const passed = (precheck, id) => ((precheck && precheck.results && precheck.results.pass) || []).some((p) => p.id === id);
const flagsOf = (precheck, id) => (((precheck && precheck.results && precheck.results.flagged) || []).find((f) => f.id === id) || {}).reasons || [];

/**
 * Apply the plan. Pure (dates passed in).
 * -> { manifest, videoManifest, autorun, log, done: [{row_key, decision, result}] }
 */
export function applyDecisions(plan, { manifest, videoManifest, precheck, videoPrecheck, autorun = {}, log = {}, date }) {
  let am = manifest;
  let vm = videoManifest || [];
  const ar = { ...autorun, attempts: { ...((autorun && autorun.attempts) || {}) } };
  const nextLog = { ...log };
  const done = [];
  const audioE = () => new Map(am.filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const videoE = () => new Map(vm.filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  for (const p of plan) {
    const a = p.audio_id && audioE().get(p.audio_id);
    const v = p.video_id && videoE().get(p.video_id);
    const res = [];
    if (p.decision === '') {
      res.push('decision cleared');
    } else if (p.decision === 'hold') {
      res.push('held');
    } else if (p.decision === 'approve anyway') {
      if (!a) res.push('audio not converted yet');
      else if (isApproved(a)) res.push('audio already approved');
      else if (isRejected(a)) res.push('audio was rejected: decide in approve-media');
      else { am = applyDecision(am, [p.audio_id], REVIEWER, 'approved', date).manifest; res.push('audio approved'); }
      if (v) {
        if (isApproved(v)) res.push('video already approved');
        else if (isRejected(v)) res.push('video was rejected: decide in approve-media');
        else { vm = applyDecision(vm, [p.video_id], REVIEWER, 'approved', date).manifest; res.push('video approved'); }
      }
    } else if (p.decision === 'fixed') {
      if (!a) {
        if (p.audio_id && ar.attempts[p.audio_id]) delete ar.attempts[p.audio_id];
        res.push('not converted yet: conversion queued again');
      } else if (isApproved(a)) res.push('audio already approved');
      else if (passed(precheck, p.audio_id)) { am = applyDecision(am, [p.audio_id], REVIEWER_FIXED, 'approved', date).manifest; res.push('audio passed the re-check and is approved'); }
      else res.push(`audio still flagged: ${flagsOf(precheck, p.audio_id).join(', ') || 'not checked yet'}`);
      if (v) {
        const audioOk = isApproved(audioE().get(p.audio_id));
        if (isApproved(v)) res.push('video already approved');
        else if (audioOk && passed(videoPrecheck, p.video_id)) { vm = applyDecision(vm, [p.video_id], REVIEWER_FIXED, 'approved', date).manifest; res.push('video approved'); }
        else if (!audioOk) res.push('video waits for the audio');
        else res.push(`video still flagged: ${flagsOf(videoPrecheck, p.video_id).join(', ') || 'not checked yet'}`);
      }
    }
    const entry = { decision: p.decision, at: date, result: res.join(', '), audio_sha: p.audio_sha, video_sha: p.video_sha };
    nextLog[p.row_key] = entry;
    done.push({ row_key: p.row_key, ...entry });
  }
  return { manifest: am, videoManifest: vm, autorun: ar, log: nextLog, done };
}

/** issues cells for the rows acted on: [{range, values}] (only the issues column). Pure. */
export function issueCells(sheet, done, log) {
  const ki = sheet.header.indexOf('row_key');
  const ii = sheet.header.indexOf('issues');
  if (ki < 0 || ii < 0) return [];
  const rowOf = new Map(sheet.rows.map((r, i) => [r[ki], i]));
  const out = [];
  for (const d of done) {
    const i = rowOf.get(d.row_key);
    if (i === undefined) continue;
    const want = withDecision(sheet.rows[i][ii], log[d.row_key]);
    if (want !== String(sheet.rows[i][ii] ?? '')) out.push({ range: `Lessons!${colLetter(ii)}${i + 2}:${colLetter(ii)}${i + 2}`, values: [[want]] });
  }
  return out;
}

const api = async (fetchFn, sheetId, token, method, path, body) => {
  const res = await fetchFn(`${SHEETS_BASE}/${sheetId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets API ${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

/**
 * Add the check_decision column at the END of the Lessons tab once: header cell + dropdown
 * (ONE_OF_LIST, strict, empty allowed). Only when the header is exactly the columns before it.
 * Returns 'present' | 'added'. Throws when the header is anything else.
 */
export async function ensureColumn({ sheetId, token, keys, fetchFn = fetch }) {
  const sheet = await readTab({ sheetId, token, tab: 'Lessons', fetchFn });
  const i = keys.indexOf(COLUMN);
  if (sheet.header[i] === COLUMN) return 'present';
  if (sheet.header.length !== i || sheet.header.some((h, j) => h !== keys[j])) throw new Error('Lessons header is not the columns before check_decision: not adding it');
  const meta = await api(fetchFn, sheetId, token, 'GET', '?fields=sheets(properties(sheetId,title,gridProperties))');
  const tab = (meta.sheets || []).find((s) => s.properties.title === 'Lessons');
  if (!tab) throw new Error('no Lessons tab');
  const gid = tab.properties.sheetId;
  const grid = tab.properties.gridProperties || {};
  const requests = [];
  if ((grid.columnCount || 0) <= i) requests.push({ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: i + 1 - (grid.columnCount || 0) } });
  requests.push({
    setDataValidation: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: grid.rowCount || 1000, startColumnIndex: i, endColumnIndex: i + 1 },
      rule: { condition: { type: 'ONE_OF_LIST', values: DECISIONS.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true },
    },
  });
  await api(fetchFn, sheetId, token, 'POST', ':batchUpdate', { requests });
  await api(fetchFn, sheetId, token, 'PUT', `/values/${encodeURIComponent(`Lessons!${colLetter(i)}1`)}?valueInputOption=RAW`, { range: `Lessons!${colLetter(i)}1`, values: [[COLUMN]] });
  return 'added';
}

const objects = (sheet) => sheet.rows.map((r) => Object.fromEntries(sheet.header.map((k, i) => [k, r[i] ?? ''])));
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf-8');
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const cmd = process.argv[2];
  const sheetId = arg('sheet-id', '');
  const token = process.env.ACCESS_TOKEN || '';
  if (!token || !/^[A-Za-z0-9_-]+$/.test(sheetId)) { console.error('needs --sheet-id and ACCESS_TOKEN'); process.exit(2); }
  const root = process.cwd();
  const P = {
    am: join(root, 'data', 'media-manifest.json'), vm: join(root, 'data', 'video-manifest.json'),
    pc: join(root, 'data', 'queues', 'approve', 'precheck.json'), vpc: join(root, 'data', 'queues', 'approve-video', 'precheck.json'),
    ar: join(root, 'data', 'ops', 'autorun-state.json'), log: join(root, 'data', 'ops', 'check-decisions.json'),
  };
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (cmd === 'prepare') {
    const columns = readJson(join(root, 'data', 'master', 'columns.json'), {});
    const col = await ensureColumn({ sheetId, token, keys: columns.columns.map((c) => c.key) });
    console.log(`check_decision column: ${col}`);
    const sheet = await readTab({ sheetId, token, tab: 'Lessons' });
    const plan = planDecisions(objects(sheet), readJson(P.am, []), readJson(P.vm, []), readJson(P.log, {}));
    const re = recheckIds(plan, readJson(P.am, []));
    if (re.length) {
      const pc = readJson(P.pc, {});
      for (const id of re) if (pc.measured) delete pc.measured[id];
      writeJson(P.pc, pc);
    }
    writeJson('decisions-plan.json', { plan, sheet });
    console.log(`decisions: ${plan.length} to act on (${plan.map((p) => p.decision || 'cleared').join(', ') || 'none'}); re-check ${re.length}`);
    out('acts', plan.length);
    out('recheck', re.length);
  } else if (cmd === 'apply') {
    const { plan, sheet } = readJson('decisions-plan.json', { plan: [], sheet: { header: [], rows: [] } });
    const r = applyDecisions(plan, {
      manifest: readJson(P.am, []), videoManifest: readJson(P.vm, []), precheck: readJson(P.pc, null), videoPrecheck: readJson(P.vpc, null),
      autorun: readJson(P.ar, {}), log: readJson(P.log, {}), date: new Date().toISOString().slice(0, 10),
    });
    mkdirSync(join(root, 'data', 'ops'), { recursive: true });
    writeJson(P.am, r.manifest);
    if (existsSync(P.vm) || r.videoManifest.length) writeJson(P.vm, r.videoManifest);
    if (existsSync(P.ar)) writeJson(P.ar, r.autorun);
    writeJson(P.log, r.log);
    writeJson('decisions-cells.json', issueCells(sheet, r.done, r.log));
    const approved = r.done.filter((d) => /\b(audio|video) (passed the re-check and is )?approved\b/.test(d.result)).length;
    const line = `${new Date().toISOString().slice(0, 16)}Z · check-decisions · ${r.done.length} acted: ${r.done.map((d) => `${d.row_key} ${d.decision || 'cleared'} -> ${d.result}`).join(' | ') || 'none'}`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
    out('approved', approved);
  } else if (cmd === 'write-issues') {
    const ranges = readJson('decisions-cells.json', []);
    const n = ranges.length ? await writeRanges({ sheetId, token, ranges }) : 0;
    console.log(`issues cells written: ${n}`);
  } else {
    console.error('Usage: decisions.mjs prepare|apply|write-issues --sheet-id <id>');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('decisions.mjs')) main().catch((e) => { console.error(`::error title=check-decisions::${e.message}`); process.exit(1); });
