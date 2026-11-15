/**
 * scripts/ops/release-report.mjs — per-course release report (coordinator
 * decision 15 Nov: every converted lesson that passes the pre-check is
 * released). Read-only over the repo: audio queues data/queues/c###.csv,
 * data/media-manifest.json, data/queues/approve/precheck.json,
 * data/queues/failed-review.csv, data/ops/autorun-state.json.
 *
 * Per queued id: approved | flagged (pre-check reason) | failed (no manifest
 * entry; in failed-review.csv or failed under autorun) | waiting (not converted).
 * Usage: node scripts/ops/release-report.mjs <out.md> <date> [run ids text]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { parseQueue } from '../media/queue-plan.mjs';

const json = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);

/** Pure. → { rows: [{course, approved, flagged, failed, waiting, held:[{id, reason}]}], totals } */
export function releaseRows(queues, manifest, precheck, failedReview, attempts) {
  const byId = new Map(manifest.filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const flagged = new Map(((precheck && precheck.results && precheck.results.flagged) || []).map((f) => [f.id, f.reasons.join('; ')]));
  const rows = [];
  const totals = { approved: 0, flagged: 0, failed: 0, waiting: 0, other: 0 };
  for (const q of queues) {
    const r = { course: q.course, approved: 0, flagged: 0, failed: 0, waiting: 0, other: 0, held: [] };
    for (const id of q.ids) {
      const e = byId.get(id);
      if (e && /^approved\b/i.test(e.status || '')) r.approved++;
      else if (e && flagged.has(id)) { r.flagged++; r.held.push({ id, reason: `flagged: ${flagged.get(id)}` }); }
      else if (e) { r.other++; r.held.push({ id, reason: `converted, status ${e.status || 'none'}, not in the pass list` }); }
      else if (failedReview.has(id)) { r.failed++; r.held.push({ id, reason: 'conversion failed (failed-review.csv)' }); }
      else if ((attempts[id] || 0) > 0) { r.failed++; r.held.push({ id, reason: `conversion failed under autorun (${attempts[id]} tries; audio standard)` }); }
      else r.waiting++;
    }
    for (const k of Object.keys(totals)) totals[k] += r[k];
    if (q.ids.length) rows.push(r);
  }
  return { rows, totals };
}

function main() {
  const [, , out, date, runs = ''] = process.argv;
  const queues = readdirSync('data/queues').filter((f) => /^c\d{3}\.csv$/.test(f)).sort()
    .map((f) => ({ course: f.slice(0, 4), ids: parseQueue(readFileSync(`data/queues/${f}`, 'utf-8')) }));
  const fr = existsSync('data/queues/failed-review.csv') ? readFileSync('data/queues/failed-review.csv', 'utf-8').split(/\r?\n/).slice(1).map((l) => l.split(',')[0].trim()).filter(Boolean) : [];
  const { rows, totals } = releaseRows(queues, json('data/media-manifest.json', []), json('data/queues/approve/precheck.json', {}), new Set(fr), (json('data/ops/autorun-state.json', {}).attempts) || {});
  const L = [`# Release ${date}`, '', 'Coordinator decision 15 Nov: every converted lesson that passes the pre-check is released; flagged and failed lessons stay held.', ''];
  if (runs) L.push(runs, '');
  L.push(`Totals over the audio queues: **approved ${totals.approved}**, held flagged ${totals.flagged}, held failed ${totals.failed}, other held ${totals.other}, waiting (not converted) ${totals.waiting}.`, '');
  L.push('| course | approved | flagged | failed | other held | waiting |', '|---|---:|---:|---:|---:|---:|');
  for (const r of rows) L.push(`| ${r.course} | ${r.approved} | ${r.flagged} | ${r.failed} | ${r.other} | ${r.waiting} |`);
  L.push('', '## Held lessons and reasons', '', '| course | drive id | reason |', '|---|---|---|');
  for (const r of rows) for (const h of r.held) L.push(`| ${r.course} | ${h.id} | ${h.reason.replace(/\|/g, '\\|')} |`);
  writeFileSync(out, L.join('\n') + '\n', 'utf-8');
  console.log(JSON.stringify(totals));
}

if (process.argv[1] && process.argv[1].endsWith('release-report.mjs')) main();
