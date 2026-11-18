/**
 * scripts/media/tp-decide.mjs — PART 5 (16 Nov) loudness fix for peaky, quiet recordings.
 * Pure decisions; the ffmpeg work is b3_tploop in scripts/media/b3-loop.sh.
 *
 * WHY: the B3 loop (b3-decide.mjs, unchanged) caps the gain at
 *   G_max = depthMax(12) + 20·log10(limit) − TP1
 * i.e. at most 12 dB of limiter gain reduction on the loudest peak. A recording with quiet
 * speech and a few loud clicks (TP1 near 0 dBFS) needs more gain than that, so G is "pinned at
 * G_max" and the mp3 stays too quiet (I −19..−20) while its true peak is still well under
 * −1.5 dBTP. The cap, not the ceiling, stops it.
 *
 * FIX (only after B3 failed "too quiet" with G pinned; the standard is the same):
 *   [pan] → volume Gp → aresample 176400 (4× = true-peak) → alimiter at CEIL dBFS
 *   (attack 1 ms, release 50, level disabled) → aresample 44100   = the limited signal
 *   → loudnorm two-pass (pass 1 measures, pass 2 applies, linear, I −18, TP LN_TP)
 *   → libmp3lame 64k → MEASURED (ebur128 true peak). Accept only I −18 ±0.5 AND TP ≤ −1.5.
 * Gp starts at target − I1 and is corrected from loudnorm's pass-1 input_i so the limited
 * signal already sits at loudnorm's target lnI (loudnorm then stays linear: no compression).
 * The mp3 is measured: a TP over −1.5 lowers the ceiling by 1 dB (to MIN_CEIL_DB); an I off
 * the target (the 64 kbps encode can lose a few tenths) moves lnI by the error and re-aims Gp —
 * after loudnorm, Gp alone cannot move the output loudness. A safety cap on the limiter
 * depth (TP1 + Gp − ceiling) of MAX_DEPTH dB stops pathological files (reported, never uploaded).
 * At most MAX_ENCODES mp3 encodes and MAX_RENDERS limiter renders per encode.
 */

import { readFileSync } from 'node:fs';

export const TARGET_I = -18;
export const OK_BAND = 0.5;
export const TP_MAX = -1.5;
export const LN_TP = -2.0; // loudnorm's true-peak target (margin for the mp3 encode)
export const START_CEIL_DB = -3.0;
// PART 8 (16 Nov): the 64 kbps mp3 encode adds up to ~5 dB of peak above the limiter ceiling on
// noisy / dense peaks (measured: c012 lesson, 4–5 dB). A TP over the standard lowers the ceiling by
// the MEASURED excess (TP − SAFE_TP, at least CEIL_STEP_DB), down to MIN_CEIL_DB.
export const MIN_CEIL_DB = -10.0;
export const SAFE_TP = -2.0;
export const CEIL_STEP_DB = 1.0;
export const MAX_DEPTH = 20;
/** data/audio/limit-exceptions.json may raise the cap for listed ids, never above this. */
export const MAX_DEPTH_EXCEPTION = 21;
/** PART 11c (18 Nov): a single listed id (per_id) may go to at most this. */
export const MAX_DEPTH_PER_ID = 21.5;
export const MAX_ENCODES = 5;
export const MAX_RENDERS = 5;
export const PRE_GAIN_STEP = 1.25; // limiting eats some loudness: step a little past the gap
export const PRE_AIM = 0.3; // |target − input_i| ≤ this → encode
// A passing mp3 outside this centre is kept as the fallback and the loop tries once more toward
// the middle (up to CENTER_ENCODES encodes); the best passing mp3 is the one uploaded.
export const CENTER_I = 0.25;
export const CENTER_TP = -1.7;
export const CENTER_ENCODES = 3;
const r2 = (x) => Math.round(x * 100) / 100;

export const depthOf = (s) => r2(Number(s.TP1) + Number(s.Gp) - Number(s.ceilDb));
const capOf = (s) => (Number.isFinite(Number(s.maxDepth)) ? Number(s.maxDepth) : MAX_DEPTH);

/**
 * The limiter-depth cap for one Drive id. exceptions = data/audio/limit-exceptions.json
 * { cap_db, ids: [...] } (ids only). Default MAX_DEPTH; a listed id gets cap_db, which must be a
 * number in (MAX_DEPTH, MAX_DEPTH_EXCEPTION] — anything else is an error (never silently wider).
 */
export function capFor(id, exceptions) {
  const per = exceptions && exceptions.per_id && Object.prototype.hasOwnProperty.call(exceptions.per_id, id) ? Number(exceptions.per_id[id]) : null;
  if (per !== null) {
    if (!Number.isFinite(per) || per <= MAX_DEPTH || per > MAX_DEPTH_PER_ID) throw new Error(`limit-exceptions.json per_id ${id} must be > ${MAX_DEPTH} and <= ${MAX_DEPTH_PER_ID} (got ${exceptions.per_id[id]})`);
    return per;
  }
  if (!exceptions || !Array.isArray(exceptions.ids) || !exceptions.ids.includes(id)) return MAX_DEPTH;
  const c = Number(exceptions.cap_db);
  if (!Number.isFinite(c) || c <= MAX_DEPTH || c > MAX_DEPTH_EXCEPTION) throw new Error(`limit-exceptions.json cap_db must be > ${MAX_DEPTH} and <= ${MAX_DEPTH_EXCEPTION} (got ${exceptions.cap_db})`);
  return c;
}

/** True when a B3 final state is the loudness-only failure this fix is for. Pure. */
export function isQuietCapped(b3) {
  return !!b3 && b3.result === 'failed' && /G pinned at/.test(b3.reason || '') && /too quiet/.test(b3.reason || '');
}

/** PART 8: a B3 failure on true peak (TP over −1.5 even at the lowest B3 ceiling). Pure. */
export function isTruePeakFailure(b3) {
  if (!b3 || b3.result !== 'failed') return false;
  const r = `${b3.reason || ''} ${b3.wrong_side || ''}`;
  return /TP -?[\d.]+ > -1\.5/.test(r) && !/too loud/.test(r);
}

/** Every B3 loudness failure this path is for (too quiet with G capped, or true peak). Pure. */
export const takesTpPath = (b3) => isQuietCapped(b3) || isTruePeakFailure(b3);

function finish(s, result, reason) {
  return { ...s, done: true, result, reason, depth: depthOf(s) };
}

/** Finish on the best passing mp3 so far (only called when one exists). */
function useBest(s, why = '') {
  const b = s.best;
  const f = finish({ ...s, I_mp3: b.I_mp3, TP_mp3: b.TP_mp3, norm: b.norm, best_encode: b.encode, Gp: b.Gp, ceilDb: b.ceilDb, lnI: b.lnI }, 'ok', `ok: I ${b.I_mp3}, TP ${b.TP_mp3} (encode ${b.encode}${why})`);
  return { ...f, depth: b.depth }; // the settings of the file that is uploaded
}
const overDepth = (s, why) => (s.best ? useBest(s, ', the best passing one (no deeper limiting)') : finish(s, 'failed', `${why}limiter depth ${depthOf(s)} dB > ${capOf(s)}`));

/** Start state from pass-1 of the source (I1, TP1). Pure. */
export function init({ I1, TP1, target = TARGET_I, maxDepth = MAX_DEPTH }) {
  const s = {
    method: 'tp-limit+loudnorm', target: Number(target), I1: Number(I1), TP1: Number(TP1),
    Gp: r2(Number(target) - Number(I1)), lnI: Number(target), ceilDb: START_CEIL_DB, phase: 'pre', renders: 0, encodes: 0,
    done: false, result: null, reason: '', I_mp3: null, TP_mp3: null, norm: null, history: [],
    maxDepth: Number(maxDepth),
  };
  if (!(s.maxDepth > 0) || s.maxDepth > MAX_DEPTH_PER_ID) return finish(s, 'failed', `limiter depth cap ${maxDepth} is not allowed (max ${MAX_DEPTH_PER_ID})`);
  if (!Number.isFinite(s.I1) || !Number.isFinite(s.TP1)) return finish(s, 'failed', 'source not measurable');
  if (depthOf(s) > capOf(s)) return finish(s, 'failed', `limiter depth ${depthOf(s)} dB > ${capOf(s)}`);
  return s;
}

/** Feed loudnorm pass-1 input_i of the limited signal. Pure. */
export function onPre(state, inputI) {
  const s = { ...state, renders: state.renders + 1 };
  const i = Number(inputI);
  if (!Number.isFinite(i)) return finish(s, 'failed', 'limited signal not measurable');
  const off = s.lnI - i;
  // loudness per dB of gain falls as the limiter works harder: use the measured slope of the
  // last two renders (secant), else a first step a little past the gap.
  const p = state.prevPre;
  let slope = off > 0 ? 1 / PRE_GAIN_STEP : 1;
  if (p && Math.abs(s.Gp - p.Gp) > 0.05) slope = Math.min(1, Math.max(0.3, (i - p.I) / (s.Gp - p.Gp)));
  s.prevPre = { Gp: s.Gp, I: i };
  if (Math.abs(off) > PRE_AIM && s.renders < MAX_RENDERS) {
    s.Gp = r2(s.Gp + off / slope);
    if (depthOf(s) > capOf(s)) return overDepth(s, '');
    s.reason = `limited I ${i} → Gp ${s.Gp}`;
    return s;
  }
  s.phase = 'encode';
  s.reason = `limited I ${i} (Gp ${s.Gp}, ceiling ${s.ceilDb}) → loudnorm pass 2 at I ${s.lnI}`;
  return s;
}

/** Classify a measured mp3. Pure. */
export function classify(I, TP, target = TARGET_I) {
  const i = Number(I);
  const tp = Number(TP);
  if (!Number.isFinite(i) || !Number.isFinite(tp)) return { ok: false, reason: 'mp3 not measurable' };
  const parts = [];
  if (i < target - OK_BAND) parts.push(`I ${i} too quiet (< ${target - OK_BAND})`);
  if (i > target + OK_BAND) parts.push(`I ${i} too loud (> ${target + OK_BAND})`);
  if (tp > TP_MAX) parts.push(`TP ${tp} over ${TP_MAX}`);
  return { ok: parts.length === 0, reason: parts.join(', ') || `ok: I ${i}, TP ${tp}` };
}

/** Feed the measured mp3 {I, TP} and loudnorm's normalization type. Pure. */
export function onMp3(state, I, TP, norm = null) {
  const s = { ...state, encodes: state.encodes + 1, I_mp3: Number(I), TP_mp3: Number(TP), norm };
  s.history = [...state.history, { encode: s.encodes, Gp: s.Gp, lnI: s.lnI, ceilDb: s.ceilDb, I_mp3: s.I_mp3, TP_mp3: s.TP_mp3, norm }];
  const c = classify(I, TP, s.target);
  const centred = c.ok && Math.abs(Number(I) - s.target) <= CENTER_I && Number(TP) <= CENTER_TP;
  if (c.ok) {
    const off = Math.abs(Number(I) - s.target);
    if (!s.best || off < s.best.off) s.best = { encode: s.encodes, I_mp3: s.I_mp3, TP_mp3: s.TP_mp3, norm, off, Gp: s.Gp, ceilDb: s.ceilDb, lnI: s.lnI, depth: depthOf(s) };
  }
  if (centred) return useBest(s);
  if (c.ok && s.encodes >= CENTER_ENCODES) return useBest(s, ', the best passing one');
  if (s.encodes >= MAX_ENCODES) return s.best ? useBest(s, ', the best passing one') : finish(s, 'failed', `${c.reason} after ${s.encodes} encodes`);
  s.phase = 'pre';
  s.renders = 0;
  s.prevPre = null;
  if (c.ok) {
    // passes but not centred: aim for the middle once more (both corrections, half a step on TP)
    const d = s.target - Number(I);
    if (Math.abs(d) > CENTER_I) { s.lnI = r2(s.lnI + d); s.Gp = r2(s.Gp + d); }
    if (Number(TP) > CENTER_TP && s.ceilDb - 0.5 >= MIN_CEIL_DB - 1e-9) s.ceilDb = r2(s.ceilDb - 0.5);
    if (depthOf(s) > capOf(s)) return overDepth(s, '');
    s.reason = `${c.reason}, not centred → loudnorm I ${s.lnI}, ceiling ${s.ceilDb}`;
    return s;
  }
  if (Number(TP) > TP_MAX) {
    if (s.ceilDb <= MIN_CEIL_DB + 1e-9) return finish(s, 'failed', `${c.reason} at ceiling ${s.ceilDb} dB`);
    const step = Math.max(CEIL_STEP_DB, Math.round((Number(TP) - SAFE_TP) * 10) / 10);
    s.ceilDb = Math.max(MIN_CEIL_DB, r2(s.ceilDb - step));
    if (depthOf(s) > capOf(s)) return s.best ? useBest(', the best passing one') : finish(s, 'failed', `; limiter depth ${depthOf(s)} dB > ${capOf(s)}`);
    s.reason = `${c.reason} → ceiling ${s.ceilDb} dB`;
  } else {
    const d = s.target - Number(I);
    s.lnI = r2(s.lnI + d);
    s.Gp = r2(s.Gp + d);
    if (depthOf(s) > capOf(s)) return finish(s, 'failed', `${c.reason}; limiter depth ${depthOf(s)} dB > ${capOf(s)}`);
    s.reason = `${c.reason} → loudnorm I ${s.lnI}, Gp ${s.Gp}`;
  }
  return s;
}

/** loudnorm print_format=json block from ffmpeg stderr → object | null. Pure. */
export function parseLoudnorm(stderr) {
  const t = String(stderr || '');
  const i = t.lastIndexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try {
    return JSON.parse(t.slice(i, j + 1));
  } catch {
    return null;
  }
}

// CLI for the shell loop: init '<json>' | step-pre <input_i> | step-mp3 <I> <TP> [norm]
// | is-quiet-capped (b3 state on stdin) | loudnorm-field <field> (stderr text on stdin)
function main() {
  const [, , cmd, a, b, c] = process.argv;
  const read = () => new Promise((res) => { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => res(s)); });
  if (cmd === 'init') return process.stdout.write(JSON.stringify(init(JSON.parse(a))));
  if (cmd === 'cap-for') {
    // cap-for <limit-exceptions.json> <drive id> → the cap in dB (exit 2 on a bad file)
    let ex = null;
    try { ex = JSON.parse(readFileSync(a, 'utf-8')); } catch { ex = null; }
    try { return process.stdout.write(String(capFor(b, ex))); } catch (e) { console.error(e.message); process.exit(2); }
  }
  return read().then((txt) => {
    if (cmd === 'step-pre') process.stdout.write(JSON.stringify(onPre(JSON.parse(txt), a)));
    else if (cmd === 'step-mp3') process.stdout.write(JSON.stringify(onMp3(JSON.parse(txt), a, b, c || null)));
    else if (cmd === 'is-quiet-capped') process.exit(isQuietCapped(JSON.parse(txt)) ? 0 : 1);
    else if (cmd === 'takes-tp-path') process.exit(takesTpPath(JSON.parse(txt)) ? 0 : 1);
    else if (cmd === 'loudnorm-field') {
      const j = parseLoudnorm(txt);
      process.stdout.write(j && j[a] !== undefined ? String(j[a]) : '');
    } else {
      console.error('Usage: tp-decide.mjs init|step-pre|step-mp3|is-quiet-capped|loudnorm-field');
      process.exit(2);
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith('tp-decide.mjs')) main();
