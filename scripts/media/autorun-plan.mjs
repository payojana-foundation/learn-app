/**
 * scripts/media/autorun-plan.mjs — PART V4: the course autopilot
 * (.github/workflows/course-autorun.yml). Each run picks the NEXT queue with
 * unconverted lessons — audio queues first (data/queues/c###.csv), then video
 * queues (data/queues/video/c###.csv) when VIDEO_ENABLED — and the workflow
 * runs ONE course-audio / course-video job on it (limit 40, dry_run false),
 * then stops. course-audio itself is not changed: autorun only chooses `list`.
 *
 * "Unconverted" = not in the manifest (audio: an md5 B2 key; video: a video key
 * of VIDEO_RENDITION), not in data/queues/failed-review.csv, not a listed
 * duplicate (data/media-duplicates.json), and tried by autorun fewer than
 * MAX_ATTEMPTS times. A queue whose only missing ids are excluded is passed by,
 * so autorun stops by itself when nothing is left.
 *
 * State: data/ops/autorun-state.json { disabled, reason, at, attempts: {id: n} }.
 * GITHUB_TOKEN cannot change a repo variable, so a red run turns autorun off by
 * writing disabled=true here (and, only when the optional secret
 * AUTORUN_ADMIN_TOKEN exists, also sets AUTORUN_ENABLED=false). Dispatch with
 * reset=true clears it. Log: data/ops/autorun.log, one line per batch run.
 *
 * Usage (CI):
 *   node scripts/media/autorun-plan.mjs plan   (env AUTORUN_ENABLED, VIDEO_ENABLED, VIDEO_RENDITION, BUSY, RESET)
 *   node scripts/media/autorun-plan.mjs report (env PLAN_JSON, RESULT, RESET, AT)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQueue, planRun, manifestDriveIds } from './queue-plan.mjs';
import { planVideoRun, videoManifestIds } from './video-plan.mjs';

export const LIMIT = 40;
export const MAX_ATTEMPTS = 2;
export const STATE = 'data/ops/autorun-state.json';
export const LOG = 'data/ops/autorun.log';
export const BUSY_WORKFLOWS = ['course-audio.yml', 'course-audio-batch.yml', 'course-video.yml'];

/** Count runs in progress / queued from GitHub API pages ({workflow_runs:[]}). Pure. */
export function countBusy(pages) {
  let n = 0;
  for (const p of pages || []) n += (p && Array.isArray(p.workflow_runs) ? p.workflow_runs.length : Number(p && p.total_count) || 0);
  return n;
}

/** Ids of a queue that autorun still counts as work. Pure. */
export function leftIds(queueIds, have, exclude, attempts = {}) {
  return (queueIds || []).filter((id) => !have.has(id) && !exclude.has(id) && (attempts[id] || 0) < MAX_ATTEMPTS);
}

/**
 * The decision of one run. Pure.
 * ctx = { enabled, videoEnabled, rendition, busy, reset, state,
 *         audioQueues: [{path, ids}], audioManifest, videoQueues: [{path, ids}], videoManifest, exclude: Set }
 * → { action: 'off'|'disabled'|'busy'|'empty'|'run', kind?, queue?, toProcess?, left?, reason }
 */
export function decide(ctx) {
  const state = ctx.state || {};
  if (ctx.enabled !== true) return { action: 'off', reason: 'AUTORUN_ENABLED is not "true"' };
  if (state.disabled && !ctx.reset) return { action: 'disabled', reason: `turned off after a red run: ${state.reason || 'unknown'} (dispatch with reset=true to clear)` };
  if (ctx.busy > 0) return { action: 'busy', reason: `${ctx.busy} course-audio/course-video run(s) in progress` };
  const attempts = state.attempts || {};
  const exclude = ctx.exclude || new Set();
  const audioHave = manifestDriveIds(ctx.audioManifest);
  for (const q of ctx.audioQueues || []) {
    const left = leftIds(q.ids, audioHave, exclude, attempts);
    if (left.length) {
      const { toProcess } = planRun(q.ids, ctx.audioManifest, LIMIT);
      return { action: 'run', kind: 'audio', queue: q.path, toProcess, left: left.length, reason: 'next audio queue' };
    }
  }
  if (ctx.videoEnabled === true && /^(480p|720p)$/.test(ctx.rendition || '')) {
    const videoHave = videoManifestIds(ctx.videoManifest, ctx.rendition);
    for (const q of ctx.videoQueues || []) {
      const left = leftIds(q.ids, videoHave, exclude, attempts);
      if (left.length) {
        const { toProcess } = planVideoRun(q.ids, ctx.videoManifest, LIMIT, ctx.rendition);
        return { action: 'run', kind: 'video', queue: q.path, toProcess, left: left.length, reason: 'next video queue' };
      }
    }
  }
  return { action: 'empty', reason: 'nothing left to convert' };
}

/**
 * After the run. Pure. plan = decide() output; result = the called job's result
 * ('success'|'failure'|'cancelled'|'skipped'|''); have = ids now converted
 * (latest main); queueIds/exclude to recount what is left.
 * → { state, line|null, red }
 */
export function applyReport(prevState, { plan, result, have, queueIds = [], exclude = new Set(), reset = false, at, planFailed = false }) {
  const state = { attempts: {}, ...(prevState || {}) };
  state.attempts = { ...(state.attempts || {}) };
  let line = null;
  if (reset && state.disabled) {
    state.disabled = false;
    state.reason = '';
    line = `${at} · reset: autorun switched back on`;
  }
  if (planFailed) {
    state.disabled = true; state.reason = 'the plan step failed'; state.at = at;
    return { state, line: `${at} · RED: the plan step failed · autorun turned itself off`, red: true };
  }
  if (!plan || plan.action !== 'run') return { state, line, red: false };
  const tried = plan.toProcess || [];
  const done = tried.filter((id) => have.has(id));
  const failed = tried.filter((id) => !have.has(id));
  for (const id of failed) state.attempts[id] = (state.attempts[id] || 0) + 1;
  const left = leftIds(queueIds, have, exclude, state.attempts).length;
  const base = `${at} · ${plan.kind} ${plan.queue} · done ${done.length} · failed ${failed.length} · left ${left}`;
  if (result === 'failure') {
    state.disabled = true; state.reason = `${plan.kind} run on ${plan.queue} was red`; state.at = at;
    return { state, line: `${base} · RED: autorun turned itself off`, red: true };
  }
  return { state, line: line ? `${line}\n${base}` : base, red: false };
}

/** One-line summary for a run that did not start a batch. Pure. */
export function idleLine(plan, at) {
  return `${at} · ${plan.action}: ${plan.reason}`;
}

// ── IO ───────────────────────────────────────────────────────────────────────

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
const csvIds = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').split(/\r?\n/).slice(1).map((l) => l.split(',')[0].trim()).filter(Boolean) : []);
function queues(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^c\d{3}\.csv$/.test(f)).sort().map((f) => ({ path: `${dir}/${f}`, ids: parseQueue(readFileSync(join(dir, f), 'utf-8')) }));
}
function exclusions() {
  const dups = readJson('data/media-duplicates.json', []);
  return new Set([...csvIds('data/queues/failed-review.csv'), ...(Array.isArray(dups) ? dups : [])]);
}
function out(k, v) { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }
function summary(s) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n'); console.log(s); }

function main() {
  const cmd = process.argv[2];
  const at = process.env.AT || new Date().toISOString().slice(0, 16) + 'Z';
  const reset = process.env.RESET === 'true';
  if (cmd === 'plan') {
    const plan = decide({
      enabled: process.env.AUTORUN_ENABLED === 'true',
      videoEnabled: process.env.VIDEO_ENABLED === 'true',
      rendition: process.env.VIDEO_RENDITION || '',
      busy: Number(process.env.BUSY || 0),
      reset,
      state: readJson(STATE, {}),
      audioQueues: queues('data/queues'),
      audioManifest: readJson('data/media-manifest.json', []),
      videoQueues: queues('data/queues/video'),
      videoManifest: readJson('data/video-manifest.json', []),
      exclude: exclusions(),
    });
    writeFileSync('autorun-plan.json', JSON.stringify(plan));
    out('action', plan.action);
    out('kind', plan.kind || '');
    out('queue', plan.queue || '');
    if (plan.action !== 'run') summary(`course-autorun: ${idleLine(plan, at)}`);
    else summary(`course-autorun: ${at} · ${plan.kind} ${plan.queue} · starting ${plan.toProcess.length} · left ${plan.left}`);
  } else if (cmd === 'report') {
    const plan = process.env.PLAN_JSON ? JSON.parse(process.env.PLAN_JSON) : null;
    const prev = readJson(STATE, {});
    let have = new Set();
    let queueIds = [];
    if (plan && plan.action === 'run') {
      have = plan.kind === 'video' ? videoManifestIds(readJson('data/video-manifest.json', []), process.env.VIDEO_RENDITION) : manifestDriveIds(readJson('data/media-manifest.json', []));
      queueIds = parseQueue(existsSync(plan.queue) ? readFileSync(plan.queue, 'utf-8') : '');
    }
    const r = applyReport(prev, { plan, result: process.env.RESULT || '', have, queueIds, exclude: exclusions(), reset, at, planFailed: process.env.PLAN_RESULT === 'failure' });
    const changed = JSON.stringify(r.state) !== JSON.stringify(prev) || !!r.line;
    if (changed) {
      mkdirSync('data/ops', { recursive: true });
      writeFileSync(STATE, JSON.stringify(r.state, null, 2) + '\n', 'utf-8');
      if (r.line) appendFileSync(LOG, r.line + '\n', 'utf-8');
    }
    if (r.line) summary(`course-autorun: ${r.line}`);
    if (r.red) console.log(`::error title=Autorun turned off::${r.state.reason}. Fix the cause, then run course-autorun with reset=true.`);
    out('changed', changed ? 'true' : 'false');
    out('red', r.red ? 'true' : 'false');
  } else {
    console.error('Usage: autorun-plan.mjs plan|report');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('autorun-plan.mjs')) main();
