/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 loop (pure state machine).
 * FINAL AUDIO STANDARD — CHANGE 4 Nov 2026 "B3 loop and ceiling" (coordinator;
 * audio agreed). The loop now measures the ACTUAL encoded mp3 each round and
 * tunes a VARIABLE limiter ceiling; it replaces the 3/4 Nov null-pass G loop and
 * the "one G-lowering re-encode" TP rule.
 *
 * Chain (unchanged): mono → volume G → aresample 44100 → alimiter(attack 5,
 * release 50) → libmp3lame 64k CBR. Only the limit and G move.
 *
 *  - Start: limit = 0.60. Starting G from the null pass, capped at
 *    G_max = 12 + 20·log10(limit) − TP1.  (G_max moves when the limit changes.)
 *  - Loop, max 5 encodes total. Each round the caller encodes the mp3, decodes it
 *    and measures ebur128 peak=true → I_mp3, TP_mp3, then calls step(). In order:
 *      a. TP_mp3 > −1.5 → limit ×= 0.9 (min 0.50); G unchanged but re-capped to
 *         the new G_max. Still over at limit 0.50 → failed, stop.
 *      b. else |−18 − I_mp3| > 0.2 → G += (−18 − I_mp3), capped at G_max.
 *      c. else stop (converged).
 *    No adjustment after the 5th encode; the result is judged on the last mp3.
 *  - Result on the LAST mp3:
 *      ok     = I within −18 ±0.5 AND TP ≤ −1.5
 *      cap    = −19.0 ≤ I < −18.5 AND TP ≤ −1.5
 *      failed = I < −19.0, OR TP > −1.5 at the end (duration is checked in shell)
 *  Exception (data/media-exceptions.json) unchanged: run at accept_I, ignore the
 *  I band width the same way (accept_I ±0.5) → "exception". Target default −18.
 *
 * Pure: the caller does the ffmpeg encode+measure and feeds {I,TP} to `step`.
 *   CLI:  node b3-decide.mjs init '<json>'                       → state JSON
 *         <state on stdin> | node b3-decide.mjs step <I> <TP>    → new state
 *         node b3-decide.mjs classify <I> <TP> [target] [accept] → {result,reason}
 */
export const TARGET_I = -18;
export const START_LIMIT = 0.6;
export const MIN_LIMIT = 0.5;
export const TH = {
  depthMax: 12, // G_max = depthMax + 20·log10(limit) − TP1
  tpMax: -1.5,
  aim: 0.2, // stop when |target − I| ≤ aim
  okBand: 0.5, // ok: |I − target| ≤ 0.5
  capFloor: 1.0, // cap: target − 1.0 ≤ I < target − 0.5
  maxEncodes: 5,
  limitStep: 0.9,
};
const EPS = 1e-9;
const ceilDb = (limit) => 20 * Math.log10(limit);

/** G_max for a given limiter ceiling and the source true peak (pass-1). */
export function gMax(limit, TP1) {
  return TH.depthMax + ceilDb(limit) - TP1;
}

/** ok / cap / failed from the finished-mp3 I and TP, relative to the target. */
export function classify(I, TP, target = TARGET_I) {
  const i = Number(I);
  const tp = Number(TP);
  if (!Number.isFinite(i) || !Number.isFinite(tp)) return 'failed';
  if (tp > TH.tpMax + EPS) return 'failed';
  if (Math.abs(i - target) <= TH.okBand + EPS) return 'ok';
  if (i < target - TH.okBand && i >= target - TH.capFloor - EPS) return 'cap';
  return 'failed';
}

function finish(s, reason) {
  const result = s.exception
    ? (Math.abs(Number(s.I_mp3) - s.target) <= TH.okBand + EPS && Number(s.TP_mp3) <= TH.tpMax + EPS ? 'exception' : 'failed')
    : classify(s.I_mp3, s.TP_mp3, s.target);
  const depth = Number.isFinite(s.TP_mp3) ? Number(s.TP_mp3) - ceilDb(s.limit) : null;
  return { ...s, done: true, result, depth, reason };
}

/** Build the start state from the pass-1 null measurement (I1, TP1). */
export function initState({ target = TARGET_I, I1, TP1, exception = null }) {
  const i1 = Number(I1);
  const tp1 = Number(TP1);
  const exc = exception && Number.isFinite(Number(exception.accept_I)) ? Number(exception.accept_I) : null;
  const tgt = exc !== null ? exc : Number(target);
  const limit = START_LIMIT;
  const s = {
    target: tgt, I1: i1, TP1: tp1, limit, exception: exc !== null,
    G: null, encodes: 0, history: [], done: false, result: null,
    I_mp3: null, TP_mp3: null, depth: null, reason: '',
  };
  if (!Number.isFinite(i1) || !Number.isFinite(tp1)) {
    return { ...finish({ ...s, I_mp3: NaN, TP_mp3: NaN }, 'pass-1 measurement missing'), G: null };
  }
  // Starting G from the null pass (target − I1), capped at G_max.
  s.G = Math.min(tgt - i1, gMax(limit, tp1));
  return s;
}

/** Feed the measured mp3 {I,TP} for the CURRENT (G, limit); returns next state. */
export function step(state, I_mp3, TP_mp3) {
  if (state.done) return state;
  const s = { ...state, history: [...state.history] };
  const i = Number(I_mp3);
  const tp = Number(TP_mp3);
  s.encodes += 1;
  s.I_mp3 = i;
  s.TP_mp3 = tp;
  s.history.push({ encode: s.encodes, G: round(s.G), limit: round(s.limit), I_mp3: i, TP_mp3: tp });
  if (!Number.isFinite(i) || !Number.isFinite(tp)) return finish(s, 'mp3 measurement missing');

  // No adjustment after the 5th encode — judge the last mp3.
  if (s.encodes >= TH.maxEncodes) return finish(s, `reached ${TH.maxEncodes} encodes`);

  // a. true peak too hot → tighten the limiter (G unchanged, re-cap to new G_max).
  if (tp > TH.tpMax + EPS) {
    if (s.limit <= MIN_LIMIT + EPS) return finish(s, `TP ${tp.toFixed(2)} > -1.5 at limit ${MIN_LIMIT} — failed`);
    s.limit = Math.max(MIN_LIMIT, round(s.limit * TH.limitStep));
    s.G = Math.min(s.G, gMax(s.limit, s.TP1));
    s.reason = `TP ${tp.toFixed(2)} > -1.5 → limit=${s.limit}, G re-capped to ${round(s.G)}`;
    return s;
  }
  // b. loudness off → move G toward the target, capped at G_max.
  if (Math.abs(s.target - i) > TH.aim + EPS) {
    s.G = Math.min(s.G + (s.target - i), gMax(s.limit, s.TP1));
    s.reason = `|${s.target} − I ${i.toFixed(2)}| > 0.2 → G=${round(s.G)} (limit ${s.limit})`;
    return s;
  }
  // c. converged.
  return finish(s, `converged: I ${i.toFixed(2)}, TP ${tp.toFixed(2)}`);
}

function round(x) {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x;
}

function main() {
  const [, , mode, a, b, c, e] = process.argv;
  if (mode === 'init') return void process.stdout.write(JSON.stringify(initState(JSON.parse(a))));
  if (mode === 'step') {
    let raw = '';
    process.stdin.on('data', (d) => (raw += d)).on('end', () => process.stdout.write(JSON.stringify(step(JSON.parse(raw), a, b))));
    return;
  }
  if (mode === 'classify') {
    const target = c !== undefined && c !== '' ? Number(c) : TARGET_I;
    const exc = e !== undefined && e !== '' ? Number(e) : null;
    const result = exc !== null
      ? (Math.abs(Number(a) - exc) <= TH.okBand + EPS && Number(b) <= TH.tpMax + EPS ? 'exception' : 'failed')
      : classify(a, b, target);
    return void process.stdout.write(JSON.stringify({ result, reason: `I ${a}, TP ${b} → ${result}` }));
  }
  console.error('usage: b3-decide.mjs init <json> | step <I> <TP> (state on stdin) | classify <I> <TP> [target] [accept_I]');
  process.exit(2);
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
