/**
 * scripts/media/playcheck.mjs — PART 10 (17 Nov): does every live media file play?
 * Run by .github/workflows/media-playcheck.yml (manual + weekly), sharded.
 *
 * For every APPROVED entry of data/media-manifest.json (audio) and data/video-manifest.json (video):
 *   http          GET (HEAD) of https://media.84000.digital/<key> answers 200;
 *   content-type  audio/mpeg (audio) or video/mp4 (video);
 *   size          Content-Length equals the manifest bytes;
 *   decode        ffmpeg decodes the whole file without an error;
 *   duration      ffprobe duration within 2 % of the manifest duration_s;
 *   not faststart (video) the moov box comes after mdat (the player must download it all first);
 *   poster        (video) the WebP poster answers 200 image/webp (poster_key null = missing).
 * Read-only: GET/HEAD only. Results: data/ops/playcheck.json; master-sync turns every failure into a
 * checks.json item "media: does not play".
 *
 * CLI: list <shards>                  → playcheck-list.json  (all entries, with shard numbers)
 *      check <shard> [concurrency]    → playcheck-<shard>.json
 *      merge <file...>                → data/ops/playcheck.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { mediaUrl } from '../queues/approve-lists.mjs';

export const DRIFT = 0.02;
export const CAUSES = ['http', 'content-type', 'size', 'decode', 'duration', 'not faststart', 'poster'];
const isApproved = (e) => /^approved\b/i.test((e && e.status) || '');

/** Approved entries to check, audio then video. Pure. */
export function entries(audioManifest, videoManifest) {
  const a = (audioManifest || []).filter((e) => e && e.key && isApproved(e)).map((e) => ({ kind: 'audio', id: e.drive_file_id, key: e.key, bytes: Number(e.bytes) || 0, duration_s: Number(e.duration_s) || 0 }));
  const v = (videoManifest || []).filter((e) => e && e.kind === 'video' && e.key && isApproved(e)).map((e) => ({ kind: 'video', id: e.drive_file_id, key: e.key, bytes: Number(e.bytes) || 0, duration_s: Number(e.duration_s) || 0, poster_key: e.poster_key || null }));
  return [...a, ...v];
}

/** Round-robin shards (video spread over all shards). Pure. */
export function shard(list, n) {
  return list.map((e, i) => ({ ...e, shard: i % n }));
}

/**
 * MP4 top-level box order from (offset, size, type) reads. readBox(offset) → {size, type} | null.
 * → 'faststart' (moov before mdat) | 'not faststart' | 'unknown'. Async, injectable.
 */
export async function boxOrder(readBox, maxBoxes = 12) {
  let off = 0;
  for (let i = 0; i < maxBoxes; i++) {
    const b = await readBox(off);
    if (!b || !(b.size >= 8)) return 'unknown';
    if (b.type === 'moov') return 'faststart';
    if (b.type === 'mdat') return 'not faststart';
    off += b.size;
  }
  return 'unknown';
}

/** Box header from 16 bytes (handles the 64-bit size). Pure. */
export function parseBoxHeader(buf) {
  if (!buf || buf.length < 8) return null;
  let size = buf.readUInt32BE(0);
  const type = buf.toString('latin1', 4, 8);
  if (size === 1 && buf.length >= 16) size = Number(buf.readBigUInt64BE(8));
  return { size, type };
}

/** Judge one entry from its measurements. Pure. → { ok, causes: [cause], detail } */
export function judge(e, m) {
  const causes = [];
  const why = [];
  if (m.status !== 200) { causes.push('http'); why.push(`HTTP ${m.status}`); }
  else if (m.downloadError) { causes.push('http'); why.push(`download failed after retries: ${String(m.downloadError).slice(0, 120)}`); }
  else {
    const want = e.kind === 'video' ? 'video/mp4' : 'audio/mpeg';
    if (!String(m.type || '').toLowerCase().startsWith(want)) { causes.push('content-type'); why.push(`content-type ${m.type || 'none'} (want ${want})`); }
    if (e.bytes && Number(m.length) !== e.bytes) { causes.push('size'); why.push(`size ${m.length} vs ${e.bytes} bytes`); }
    if (m.decodeErrors) { causes.push('decode'); why.push(`decode: ${String(m.decodeErrors).split('\n')[0].slice(0, 120)}`); }
    if (!(m.duration > 0) || (e.duration_s && Math.abs(m.duration - e.duration_s) / e.duration_s > DRIFT)) { causes.push('duration'); why.push(`duration ${m.duration ? Math.round(m.duration) : '?'} s vs ${e.duration_s} s`); }
    if (e.kind === 'video') {
      if (m.order !== 'faststart') { causes.push('not faststart'); why.push(`moov box: ${m.order}`); }
      if (!e.poster_key) { causes.push('poster'); why.push('no poster'); }
      else if (m.posterStatus !== 200 || !/^image\/webp/.test(String(m.posterType || ''))) { causes.push('poster'); why.push(`poster HTTP ${m.posterStatus} ${m.posterType || ''}`.trim()); }
    }
  }
  return { ok: causes.length === 0, causes, detail: why.join('; ') };
}

/** Summary over all results. Pure. */
export function summarize(results, generated) {
  const failed = results.filter((r) => !r.ok);
  const byCause = {};
  for (const r of failed) for (const c of r.causes) byCause[c] = (byCause[c] || 0) + 1;
  const byKind = {};
  for (const r of results) {
    byKind[r.kind] = byKind[r.kind] || { checked: 0, passed: 0, failed: 0 };
    byKind[r.kind].checked++;
    byKind[r.kind][r.ok ? 'passed' : 'failed']++;
  }
  return {
    schema_version: 1, generated, checked: results.length, passed: results.length - failed.length, failed: failed.length,
    by_kind: byKind, by_cause: byCause,
    failures: failed.map((r) => ({ id: r.id, kind: r.kind, key: r.key, causes: r.causes, detail: r.detail })),
  };
}

// ── measurements (CI) ────────────────────────────────────────────────────────
const run = (cmd, args, timeoutMs) => new Promise((res) => execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => res({ err, stdout: String(stdout), stderr: String(stderr) })));

async function head(url) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return { status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length') };
    } catch { await new Promise((z) => setTimeout(z, 2000)); }
  }
  return { status: 0 };
}

/**
 * Measure one file. The file is DOWNLOADED first (curl, 5 retries; a dropped HTTPS stream is a
 * network fault, not a decode error), then size, full decode, duration and box order are read from
 * the local copy, which is deleted afterwards.
 */
async function measure(e) {
  const url = mediaUrl(e.key);
  const m = await head(url);
  if (m.status !== 200) return m;
  const tmp = join(tmpdir(), `pc-${process.pid}-${Math.random().toString(36).slice(2)}${e.kind === 'video' ? '.mp4' : '.mp3'}`);
  try {
    const dl = await run('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '3', '-o', tmp, url], 3600 * 1000);
    if (dl.err || !existsSync(tmp)) { m.downloadError = (dl.stderr || String(dl.err && dl.err.message) || 'no file').trim(); return m; }
    m.length = String(statSync(tmp).size);
    const dec = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '0', '-i', tmp, '-map', '0', '-f', 'null', '-'], 3 * 3600 * 1000);
    m.decodeErrors = (dec.stderr.trim() || (dec.err ? String(dec.err.message || dec.err) : '')).slice(0, 2000);
    const p = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], 120000);
    m.duration = Number(String(p.stdout).trim());
    if (e.kind === 'video') {
      const fd = openSync(tmp, 'r');
      try {
        m.order = await boxOrder(async (off) => {
          const buf = Buffer.alloc(16);
          const n = readSync(fd, buf, 0, 16, off);
          return n >= 8 ? parseBoxHeader(buf.subarray(0, n)) : null;
        });
      } finally { closeSync(fd); }
      if (e.poster_key) {
        const ph = await head(mediaUrl(e.poster_key));
        m.posterStatus = ph.status;
        m.posterType = ph.type;
      }
    }
    return m;
  } finally {
    rmSync(tmp, { force: true });
  }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

async function main() {
  const [, , cmd, a, b, ...rest] = process.argv;
  const json = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);
  if (cmd === 'list') {
    const n = Math.max(1, Number(a) || 20);
    const list = shard(entries(json('data/media-manifest.json', []), json('data/video-manifest.json', [])), n);
    writeFileSync('playcheck-list.json', JSON.stringify(list));
    console.log(`playcheck: ${list.length} approved files (${list.filter((e) => e.kind === 'audio').length} audio, ${list.filter((e) => e.kind === 'video').length} video) in ${n} shards`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `shards=${JSON.stringify(Array.from({ length: n }, (_, i) => i))}\n`);
  } else if (cmd === 'check') {
    const s = Number(a);
    const mine = json('playcheck-list.json', []).filter((e) => e.shard === s);
    const out = [];
    let done = 0;
    await pool(mine, Number(b) || 4, async (e) => {
      const m = await measure(e);
      out.push({ id: e.id, kind: e.kind, key: e.key, ...judge(e, m) });
      if (++done % 25 === 0) console.log(`shard ${s}: ${done}/${mine.length}`);
    });
    writeFileSync(`playcheck-${s}.json`, JSON.stringify(out));
    console.log(`shard ${s}: checked ${out.length}, failed ${out.filter((r) => !r.ok).length}`);
  } else if (cmd === 'merge') {
    const all = [a, b, ...rest].filter(Boolean).flatMap((p) => json(p, []));
    const sum = summarize(all, new Date().toISOString());
    mkdirSync('data/ops', { recursive: true });
    writeFileSync('data/ops/playcheck.json', JSON.stringify(sum, null, 2) + '\n');
    const line = `media-playcheck: checked ${sum.checked}, passed ${sum.passed}, failed ${sum.failed} ${JSON.stringify(sum.by_cause)} ${JSON.stringify(sum.by_kind)}`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
  } else {
    console.error('Usage: playcheck.mjs list <shards> | check <shard> [concurrency] | merge <files...>');
    process.exit(2);
  }
}

if (process.argv[1] && process.argv[1].endsWith('playcheck.mjs')) main();
