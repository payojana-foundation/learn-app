/**
 * scripts/media/precheck.mjs — automatic pre-approval check of every converted lesson that
 * is not approved yet (run by .github/workflows/approve-check.yml). READ-ONLY on R2 and
 * Drive: it only reads (HTTP Range on the R2 file, Drive metadata / header bytes). It
 * changes no audio, no key and no manifest entry.
 *
 * A lesson is FLAGGED when any of:
 *   duration     duration_s < 5 min or > 4 h (manifest);
 *   source       the converted duration differs > 2 % from the Drive source duration
 *                (Drive videoMediaMetadata, else ffprobe of the source header over HTTP);
 *                an unreadable source duration is a flag too ("source duration unknown");
 *   duplicate    its audio sha256 equals another manifest entry's sha256;
 *   silence      a silence > 60 s in the first or last 2 minutes (ffmpeg silencedetect,
 *                noise -50 dB, reading only those two parts of the R2 file).
 * A lesson PASSES when every check has run and none flagged. Otherwise it is PENDING.
 *
 * Lessons = the master export (data/master/lessons.csv): rows with a course id whose source
 * (the Drive id of the source_type link, as in master-sync) has a manifest entry that is not
 * approved. A source shared by two rows counts once (the first row).
 *
 * State (measurements, so a later run continues where the last one stopped):
 *   data/queues/approve/precheck.json  { version, measured: {id: {...}}, results: {...} }
 * Report:
 *   data/queues/approve/FLAGGED.md     one row per flagged lesson + passing / pending counts
 *
 * Usage: node scripts/media/precheck.mjs [--drive] [--silence] [--budget-min 55]
 *          [--concurrency 8] [--today YYYY-MM-DD]
 *   --drive    needs env ACCESS_TOKEN (drive.readonly) and ffprobe
 *   --silence  needs ffmpeg and network access to the media host
 * Without --drive / --silence only the manifest checks run (the rest stays pending).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { parseCsvObjects } from '../master/csv.mjs';
import { sourceIdOf } from '../master/sync.mjs';
import { mediaUrl } from '../queues/approve-lists.mjs';

export const MIN_S = 5 * 60;
export const MAX_S = 4 * 3600;
export const DRIFT = 0.02;
export const EDGE_S = 120;
export const SILENCE_S = 60;
export const NOISE_DB = -50;
const STATE = 'data/queues/approve/precheck.json';
const REPORT = 'data/queues/approve/FLAGGED.md';

// ── pure ─────────────────────────────────────────────────────────────────────

const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');

/** Converted, unapproved lessons from the master rows. One per source id (first row wins). */
export function candidates(lessonRows, courseRows, manifest) {
  const byId = new Map(manifest.filter((e) => e && e.drive_file_id).map((e) => [e.drive_file_id, e]));
  const courseTitle = new Map(courseRows.map((c) => [c.course_id, c.course_title_km]));
  const seen = new Set();
  const out = [];
  for (const r of lessonRows) {
    if (!r.course_id) continue;
    const id = sourceIdOf(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const e = byId.get(id);
    if (!e || isApproved(e)) continue;
    out.push({
      id, course_id: r.course_id, course_title: courseTitle.get(r.course_id) ?? r.course_title_km ?? '',
      lesson_id: r.lesson_id, lesson_no: r.lesson_no, title: r.lesson_title, key: e.key, url: mediaUrl(e.key),
      duration_s: Number(e.duration_s), sha256: e.sha256 || '',
    });
  }
  return out;
}

/** sha256 -> number of manifest entries with it. */
export function shaCounts(manifest) {
  const m = new Map();
  for (const e of manifest) if (e && e.sha256) m.set(e.sha256, (m.get(e.sha256) || 0) + 1);
  return m;
}

/**
 * Silence spans from ffmpeg silencedetect stderr over a segment of `segS` seconds.
 * A silence still open at the end of the segment lasts until the segment end.
 */
export function parseSilence(stderr, segS) {
  const spans = [];
  let open = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    let m = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (m) { open = Math.max(0, Number(m[1])); continue; }
    m = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (m) { spans.push(Number(m[2])); open = null; }
  }
  if (open !== null) spans.push(Math.max(0, segS - open));
  return spans.length ? Math.max(...spans) : 0;
}

/**
 * The flags of one lesson from its measurements. Returns { flags: [reason], pending: [check] }.
 * measured = { drive_s: number|null|undefined, drive_error?: string, head_s?: number, tail_s?: number }
 */
export function evaluate(c, measured = {}, shaCount = new Map()) {
  const flags = [];
  const pending = [];
  const d = c.duration_s;
  if (!(d >= MIN_S)) flags.push(`duration ${fmt(d)} is under 5 min`);
  if (d > MAX_S) flags.push(`duration ${fmt(d)} is over 4 h`);
  if (c.sha256 && (shaCount.get(c.sha256) || 0) > 1) flags.push('same audio (sha256) as another lesson');
  if (measured.drive_s === undefined) pending.push('source');
  else if (measured.drive_s === null || !(measured.drive_s > 0)) flags.push('source duration unknown');
  else if (Math.abs(d - measured.drive_s) / measured.drive_s > DRIFT) flags.push(`duration ${fmt(d)} differs ${pct(d, measured.drive_s)} from the Drive source (${fmt(measured.drive_s)})`);
  if (measured.head_s === undefined || measured.tail_s === undefined) pending.push('silence');
  else {
    if (measured.head_s > SILENCE_S) flags.push(`silence ${Math.round(measured.head_s)} s in the first 2 min`);
    if (measured.tail_s > SILENCE_S) flags.push(`silence ${Math.round(measured.tail_s)} s in the last 2 min`);
  }
  return { flags, pending };
}

const fmt = (s) => {
  if (!Number.isFinite(s)) return '?';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const pct = (a, b) => `${((100 * Math.abs(a - b)) / b).toFixed(1)} %`;

/** Results: { pass: [{id, sha256}], flagged: [{id, reasons}], pending: [id] } */
export function results(cands, measuredById, shaCount) {
  const pass = [];
  const flagged = [];
  const pending = [];
  for (const c of cands) {
    const { flags, pending: p } = evaluate(c, measuredById[c.id], shaCount);
    if (flags.length) flagged.push({ id: c.id, course_id: c.course_id, reasons: flags });
    else if (p.length) pending.push({ id: c.id, course_id: c.course_id, checks: p });
    else pass.push({ id: c.id, course_id: c.course_id, sha256: c.sha256 });
  }
  return { pass, flagged, pending };
}

/** The reason category (for counts and the master-sheet issues text). */
export function reasonKind(r) {
  if (/under 5 min/.test(r)) return 'duration under 5 min';
  if (/over 4 h/.test(r)) return 'duration over 4 h';
  if (/from the Drive source/.test(r)) return 'duration differs > 2 % from the Drive source';
  if (/source duration unknown/.test(r)) return 'source duration unknown';
  if (/same audio/.test(r)) return 'same audio (sha256) as another lesson';
  if (/first 2 min/.test(r)) return 'silence > 60 s in the first 2 min';
  if (/last 2 min/.test(r)) return 'silence > 60 s in the last 2 min';
  return r;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderFlagged(cands, res, today, note = '') {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const L = [];
  L.push('# Pre-approval check', '');
  L.push(`Generated ${today} by scripts/media/precheck.mjs (workflow approve-check). ${cands.length} converted lessons not approved yet: **${res.pass.length} pass**, **${res.flagged.length} flagged**, **${res.pending.length} not checked yet**.${note ? ' ' + note : ''}`, '');
  L.push('A lesson is flagged when its duration is under 5 min or over 4 h, differs more than 2 % from the Drive source, has the same audio as another lesson, or has more than 60 s of silence in its first or last 2 minutes. Flagged lessons are never approved by approve-media "all-passing"; listen and decide per id.', '');
  const reasonCount = {};
  for (const f of res.flagged) for (const r of f.reasons) { const k = reasonKind(r); reasonCount[k] = (reasonCount[k] || 0) + 1; }
  L.push('## Flagged by reason', '', '| reason | lessons |', '| --- | --- |', ...Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${esc(k)} | ${n} |`), '');
  L.push('## Flagged lessons', '', '| course | lesson | title | reason | play |', '| --- | --- | --- | --- | --- |');
  const sorted = [...res.flagged].sort((a, b) => a.course_id.localeCompare(b.course_id) || String(byId.get(a.id).lesson_no).localeCompare(String(byId.get(b.id).lesson_no), undefined, { numeric: true }));
  for (const f of sorted) {
    const c = byId.get(f.id);
    L.push(`| ${c.course_id} | ${esc(c.lesson_no)} | ${esc(c.title)} | ${esc(f.reasons.join('; '))} | [▶ play](${c.url}) |`);
  }
  if (!sorted.length) L.push('| — | — | — | none | — |');
  const per = new Map();
  for (const c of cands) if (!per.has(c.course_id)) per.set(c.course_id, { title: c.course_title, pass: 0, flagged: 0, pending: 0 });
  for (const p of res.pass) per.get(p.course_id).pass++;
  for (const f of res.flagged) per.get(f.course_id).flagged++;
  for (const p of res.pending) per.get(p.course_id).pending++;
  L.push('', '## Per course', '', '| course | title | pass | flagged | not checked yet |', '| --- | --- | --- | --- | --- |');
  for (const [cid, v] of [...per].sort((a, b) => a[0].localeCompare(b[0]))) L.push(`| ${cid} | ${esc(v.title)} | ${v.pass} | ${v.flagged} | ${v.pending} |`);
  return L.join('\n') + '\n';
}

// ── measurements (CI) ────────────────────────────────────────────────────────

const run = (cmd, args, timeoutMs = 120000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) }));
  });

async function driveDuration(id, token) {
  const meta = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=mimeType,videoMediaMetadata(durationMillis)&supportsAllDrives=true`;
  try {
    const r = await fetch(meta, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const j = await r.json();
      const ms = Number(j.videoMediaMetadata && j.videoMediaMetadata.durationMillis);
      if (ms > 0) return { drive_s: ms / 1000, via: 'drive metadata' };
    }
  } catch { /* fall through to ffprobe */ }
  const dl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const p = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '-headers', `Authorization: Bearer ${token}\r\n`, dl]);
  const s = Number(String(p.stdout).trim());
  return s > 0 ? { drive_s: s, via: 'ffprobe header' } : { drive_s: null, drive_error: (p.stderr || 'no duration').slice(0, 200) };
}

async function silenceAt(url, edge, durationS) {
  const seg = Math.min(EDGE_S, Math.max(1, durationS || EDGE_S));
  const pos = edge === 'head' ? ['-ss', '0'] : ['-sseof', `-${seg}`];
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', ...pos, '-t', String(seg), '-i', url, '-af', `silencedetect=noise=${NOISE_DB}dB:d=${SILENCE_S}`, '-f', 'null', '-']);
  if (r.err && !/silence|Output|size=/.test(r.stderr)) return null;
  return parseSilence(r.stderr, seg);
}

async function pool(items, n, fn, deadline) {
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const it = items[i++];
      await fn(it);
      done++;
    }
  });
  await Promise.all(workers);
  return done;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const root = process.cwd();
  const today = arg('today', new Date().toISOString().slice(0, 10));
  const budgetMin = Number(arg('budget-min', '55'));
  const conc = Math.max(1, Number(arg('concurrency', '8')));
  const doDrive = process.argv.includes('--drive');
  const doSilence = process.argv.includes('--silence');
  const token = process.env.ACCESS_TOKEN || '';
  if (doDrive && !token) { console.error('--drive needs ACCESS_TOKEN'); process.exit(2); }

  const manifest = JSON.parse(readFileSync(join(root, 'data', 'media-manifest.json'), 'utf-8'));
  const lessons = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'lessons.csv'), 'utf-8'));
  const courses = parseCsvObjects(readFileSync(join(root, 'data', 'master', 'courses.csv'), 'utf-8'));
  const cands = candidates(lessons, courses, manifest);
  const statePath = join(root, STATE);
  const prev = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf-8')) : {};
  const measured = prev.measured || {};
  // A re-converted file (new sha256) is measured again.
  for (const c of cands) if (measured[c.id] && measured[c.id].sha256 !== c.sha256) delete measured[c.id];

  const deadline = Date.now() + budgetMin * 60000;
  const save = () => {
    const shaCount = shaCounts(manifest);
    const res = results(cands, measured, shaCount);
    const keep = Object.fromEntries(cands.filter((c) => measured[c.id]).map((c) => [c.id, measured[c.id]]));
    mkdirSync(join(root, 'data', 'queues', 'approve'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ version: 1, generated: today, rules: { min_s: MIN_S, max_s: MAX_S, drift: DRIFT, edge_s: EDGE_S, silence_s: SILENCE_S, noise_db: NOISE_DB }, measured: keep, results: res }, null, 2) + '\n', 'utf-8');
    return res;
  };

  let didDrive = 0;
  let didSilence = 0;
  if (doDrive) {
    const todo = cands.filter((c) => !measured[c.id] || measured[c.id].drive_s === undefined);
    didDrive = await pool(todo, conc, async (c) => {
      const r = await driveDuration(c.id, token);
      measured[c.id] = { ...(measured[c.id] || {}), sha256: c.sha256, ...r };
    }, deadline);
    save();
  }
  if (doSilence) {
    const todo = cands.filter((c) => !measured[c.id] || measured[c.id].head_s === undefined || measured[c.id].tail_s === undefined);
    let n = 0;
    didSilence = await pool(todo, conc, async (c) => {
      const head = await silenceAt(c.url, 'head', c.duration_s);
      const tail = await silenceAt(c.url, 'tail', c.duration_s);
      const m = { ...(measured[c.id] || {}), sha256: c.sha256 };
      if (head !== null) m.head_s = head;
      if (tail !== null) m.tail_s = tail;
      measured[c.id] = m;
      if (++n % 100 === 0) save();
    }, deadline);
  }
  const res = save();
  const pendingSilence = res.pending.filter((p) => p.checks.includes('silence')).length;
  const pendingSource = res.pending.filter((p) => p.checks.includes('source')).length;
  const note = pendingSilence || pendingSource
    ? `Still to check: silence ${pendingSilence}, Drive source duration ${pendingSource} (approve-check continues in batches).`
    : '';
  writeFileSync(join(root, REPORT), renderFlagged(cands, res, today, note), 'utf-8');
  console.log(`candidates ${cands.length} · pass ${res.pass.length} · flagged ${res.flagged.length} · pending ${res.pending.length} (silence ${pendingSilence}, source ${pendingSource}) · measured this run: drive ${didDrive}, silence ${didSilence}`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `pending=${res.pending.length}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('precheck.mjs')) main();
