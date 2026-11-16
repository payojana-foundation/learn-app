/**
 * scripts/media/loudness-rerun.mjs — PART 5 (16 Nov): the one-time re-run of conversion
 * failures with the fixed pipeline.
 *
 *   plan      every queued id with NO manifest entry that is in data/queues/failed-review.csv
 *             or was given up by course-autorun (data/ops/autorun-state.json attempts) →
 *             data/queues/rerun/loudness-1.csv … loudness-<PARTS>.csv (run in parallel, one course-audio each);
 *             their autorun try counters are reset once (deleted).
 *   group     after the runs: reads the course-audio run logs (paths in argv) and rewrites
 *             data/queues/failed-review.csv: one row per id STILL without a manifest entry,
 *             with its exact reason, grouped (sorted) by reason; ids now converted are removed;
 *             ids that failed again get autorun tries = 2 (the re-run was their retry).
 *
 * Usage: node scripts/media/loudness-rerun.mjs plan
 *        node scripts/media/loudness-rerun.mjs group <run.log> [run.log ...]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseQueue } from './queue-plan.mjs';

const json = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
const FR = 'data/queues/failed-review.csv';
const ST = 'data/ops/autorun-state.json';
export const PARTS = 6;
const partFiles = () => (existsSync('data/queues/rerun') ? readdirSync('data/queues/rerun').filter((f) => /^loudness-\d+\.csv$/.test(f)).sort().map((f) => join('data/queues/rerun', f)) : []);

/** Round-robin split into n parts (each a mix of courses). Pure. */
export function splitParts(ids, n = PARTS) {
  const out = Array.from({ length: Math.min(n, ids.length) }, () => []);
  ids.forEach((id, i) => out[i % out.length].push(id));
  return out;
}

/** failed-review.csv rows: [{id, course, reason}]. Pure. */
export function readFailed(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  lines.shift();
  return lines.map((l) => {
    const c = l.split(',');
    return { id: c[0].trim(), course: (c[1] || '').trim(), reason: c.slice(2).join(',').trim() };
  });
}

/** Ids to re-run. Pure. */
export function rerunIds(failed, attempts, manifestIds) {
  return [...new Set([...failed.map((f) => f.id), ...Object.keys(attempts || {})])].filter((id) => id && !manifestIds.has(id));
}

/**
 * The exact failure reason of each id from course-audio logs ("[id] FAILED stage=…: …"), as a
 * stable category + the measured numbers. Later logs win. Pure.
 */
export function reasonsFromLogs(texts) {
  const m = new Map();
  for (const t of texts) {
    for (const line of String(t).split(/\r?\n/)) {
      const x = /\[([A-Za-z0-9_-]{25,})\] FAILED stage=([a-z-]+): (.*)$/.exec(line);
      if (!x) continue;
      const [, id, stage, rest] = x;
      const tp = /tp-result final measure I (\S+) TP (\S+)/.exec(rest);
      let reason;
      if (stage === 'accept') {
        const q = /I (-?[\d.]+) too quiet/.exec(rest);
        const lim = /limiter depth ([\d.]+) dB > (\d+)/.exec(rest);
        const hot = /TP (-?[\d.]+) (?:over|>) -1\.5/.exec(rest);
        if (lim) reason = `too quiet: needs limiter depth ${lim[1]} dB (> ${lim[2]} dB cap of the true-peak path)`;
        else if (q) reason = `too quiet: I ${q[1]} LUFS after the true-peak path (< -18.5)`;
        else if (hot) reason = `true peak too hot: TP ${hot[1]} dBTP (> -1.5)`;
        else reason = `loudness: ${rest.replace(/ — 5 loudest peaks.*$/, '').slice(0, 160)}`;
      } else if (stage === 'download' || stage === 'drive-meta') reason = `file not readable from Drive (${stage}): ${rest.slice(0, 120)}`;
      else if (stage === 'ffprobe') reason = 'no audio stream in the file';
      else reason = `${stage}: ${rest.slice(0, 160)}`;
      if (tp) reason = `final measure outside the standard: I ${tp[1]}, TP ${tp[2]}`;
      m.set(id, reason);
    }
    for (const x of String(t).matchAll(/\[([A-Za-z0-9_-]{25,})\] duration (\d+)s vs source (\d+)s/g)) m.set(x[1], `duration ${x[2]} s vs source ${x[3]} s (> ±1 s)`);
  }
  return m;
}

/** The new failed-review.csv text. Pure. */
export function groupedCsv(failed, courseOf, reasons, manifestIds, rerun) {
  const out = new Map();
  for (const f of failed) if (!manifestIds.has(f.id)) out.set(f.id, { ...f });
  for (const id of rerun) {
    if (manifestIds.has(id)) continue;
    const prev = out.get(id) || { id, course: courseOf.get(id) || '', reason: '' };
    out.set(id, { ...prev, course: prev.course || courseOf.get(id) || '', reason: reasons.get(id) || prev.reason || 'failed again with the fixed pipeline (reason not in the log)' });
  }
  const rows = [...out.values()].sort((a, b) => a.reason.localeCompare(b.reason) || a.course.localeCompare(b.course) || a.id.localeCompare(b.id));
  return ['drive_file_id,course_id,reason', ...rows.map((r) => `${r.id},${r.course},${r.reason.replace(/,/g, ';')}`)].join('\n') + '\n';
}

function courseIndex() {
  const m = new Map();
  for (const f of readdirSync('data/queues').filter((x) => /^c\d{3}\.csv$/.test(x))) for (const id of parseQueue(readFileSync(join('data/queues', f), 'utf-8'))) m.set(id, f.slice(0, 4));
  return m;
}

function main() {
  const [, , cmd, ...logs] = process.argv;
  const manifestIds = new Set(json('data/media-manifest.json', []).map((e) => e && e.drive_file_id));
  const failed = readFailed(existsSync(FR) ? readFileSync(FR, 'utf-8') : '');
  const st = json(ST, {});
  if (cmd === 'plan') {
    const ids = rerunIds(failed, st.attempts, manifestIds);
    mkdirSync('data/queues/rerun', { recursive: true });
    const parts = splitParts(ids);
    parts.forEach((p, i) => writeFileSync(`data/queues/rerun/loudness-${i + 1}.csv`, ['drive_file_id', ...p].join('\n') + '\n'));
    st.attempts = Object.fromEntries(Object.entries(st.attempts || {}).filter(([id]) => !ids.includes(id)));
    writeFileSync(ST, JSON.stringify(st, null, 2) + '\n');
    console.log(`re-run: ${ids.length} ids in ${parts.length} queues (${parts.map((p) => p.length).join(' + ')}); autorun tries reset for them`);
  } else if (cmd === 'group') {
    const ids = partFiles().flatMap((p) => parseQueue(readFileSync(p, 'utf-8')));
    const reasons = reasonsFromLogs(logs.map((p) => readFileSync(p, 'utf-8')));
    writeFileSync(FR, groupedCsv(failed, courseIndex(), reasons, manifestIds, ids));
    const still = ids.filter((id) => !manifestIds.has(id));
    st.attempts = { ...(st.attempts || {}) };
    for (const id of still) st.attempts[id] = Math.max(2, st.attempts[id] || 0);
    writeFileSync(ST, JSON.stringify(st, null, 2) + '\n');
    const by = {};
    for (const id of still) { const k = (reasons.get(id) || 'reason not in the log').replace(/-?\d+(\.\d+)?/g, '#'); by[k] = (by[k] || 0) + 1; }
    console.log(JSON.stringify({ rerun: ids.length, passed: ids.length - still.length, still: still.length, byReason: by }, null, 1));
  } else {
    console.error('Usage: loudness-rerun.mjs plan | group <log>...');
    process.exit(2);
  }
}

if (process.argv[1] && process.argv[1].endsWith('loudness-rerun.mjs')) main();
