/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 "G loop" (pure state machine).
 * FINAL AUDIO STANDARD (4 Nov 2026, coordinator; audio agreed). Replaces the
 * 3 Nov −16 target and the 3 Nov loop/cap numbers.
 *
 *  1. TARGET_I = −18 for all courses (one constant).
 *  2. pass-1 on the mono signal → I1, TP1.  G = target − I1.
 *     Loop, max 5: a null pass of the FULL chain incl. alimiter (no mp3) → I_lim.
 *       |target − I_lim| ≤ 0.2 → stop. Else G += (target − I_lim).
 *     depth = TP1 + G − 20·log10(0.708), checked every loop. After 5 loops:
 *     |target − I_lim| ≤ 0.5 → ok, else failed. busy is logged only.
 *  3. depth > 12 → set G so depth = 12 (G = 12 + 20·log10(0.708) − TP1), one more
 *     null pass → I:  −18 ±0.5 → ok;  −19.0 ≤ I < −18.5 → cap;
 *     I < −19.0 → failed (exception route).
 *  4. Finished mp3 (see mp3Verdict / tpFixGain): TP > −1.5 → lower G by
 *     (TP + 1.5) dB, re-encode ONCE, re-check TP AND the same I bands; TP still
 *     over → failed. Duration = source ±1 s (shell).
 *
 * An exception (data/media-exceptions.json) runs the same loop at its accept_I
 * and ignores depth → "exception". Bands are relative to the target (the ab-test
 * runs the same rule at −16 and −18).
 *
 * Pure: the caller does the ffmpeg null passes and feeds I_lim to `step`.
 *   CLI:  node b3-decide.mjs init '<json>'                    → state JSON
 *         <state JSON on stdin> | node b3-decide.mjs step <I_lim> → new state
 *         node b3-decide.mjs verdict <I> <TP> [target] [accept_I] → {result,reason}
 *         node b3-decide.mjs tpfix <G> <TP>                    → new G
 */
export const TARGET_I = -18;
export const LIMIT = 0.708;
export const CEIL_DB = 20 * Math.log10(LIMIT);
export const TH = {
  depthMax: 12,
  aim: 0.2, // loop stops when |target − I_lim| ≤ aim
  accept: 0.5, // ok band half-width
  capFloor: 1.0, // cap band: target − 1.0 ≤ I < target − 0.5 (−19.0 … −18.5 at −18)
  maxLoops: 5,
  tpMax: -1.5,
};
const EPS = 1e-9;

/** depth = TP1 + G − 20·log10(0.708)  [dB] */
export function depthOf(TP1, G) {
  return TP1 + G - CEIL_DB;
}

/** G that lands depth exactly on the 12 dB boundary. */
export function capGain(TP1) {
  return TH.depthMax + CEIL_DB - TP1;
}

/** ok: |I − target| ≤ 0.5;  cap: target−1.0 ≤ I < target−0.5;  else failed. */
export function classifyI(I, target = TARGET_I) {
  const v = Number(I);
  if (!Number.isFinite(v)) return 'failed';
  if (Math.abs(v - target) <= TH.accept + EPS) return 'ok';
  if (v < target - TH.accept && v >= target - TH.capFloor - EPS) return 'cap';
  return 'failed';
}

/** New G after a finished mp3 whose TP is over −1.5: lower by (TP + 1.5) dB. */
export function tpFixGain(G, TP) {
  return Number(G) - (Number(TP) - TH.tpMax);
}

/**
 * Verdict on the FINISHED mp3: TP ≤ −1.5 AND the I bands.
 *   exception: |I − accept_I| ≤ 0.5 → "exception".
 */
export function mp3Verdict({ I, TP, target = TARGET_I, exception = null }) {
  const tp = Number(TP);
  if (!Number.isFinite(tp)) return { result: 'failed', reason: 'mp3 true peak not measured' };
  if (tp > TH.tpMax + EPS) return { result: 'failed', reason: `mp3 TP ${tp.toFixed(2)} > -1.5 dBTP` };
  const acc = exception && Number.isFinite(Number(exception.accept_I)) ? Number(exception.accept_I) : null;
  if (acc !== null) {
    return Math.abs(Number(I) - acc) <= TH.accept + EPS
      ? { result: 'exception', reason: `I ${Number(I).toFixed(2)} within accept_I ${acc} ±0.5` }
      : { result: 'failed', reason: `I ${Number(I).toFixed(2)} outside accept_I ${acc} ±0.5` };
  }
  const result = classifyI(I, target);
  return { result, reason: `mp3 I ${Number(I).toFixed(2)} → ${result} (target ${target})` };
}

function finish(s, result, iFinal, reason) {
  const depth = Number.isFinite(s.TP1) && Number.isFinite(s.G) ? depthOf(s.TP1, s.G) : null;
  return { ...s, done: true, result, I_final: iFinal, depth, reason };
}

/** Build the start state from the pass-1 measurement. */
export function initState({ target = TARGET_I, I1, TP1, LRA1 = null, exception = null }) {
  const i1 = Number(I1);
  const tp1 = Number(TP1);
  const exc = exception && Number.isFinite(Number(exception.accept_I)) ? Number(exception.accept_I) : null;
  const tgt = exc !== null ? exc : Number(target);
  const lra = LRA1 === null || LRA1 === undefined || LRA1 === '' ? NaN : Number(LRA1);
  const s = {
    target: tgt, I1: i1, TP1: tp1, LRA1: Number.isFinite(lra) ? lra : null, G: tgt - i1, loop: 0, phase: 'loop',
    exception: exc !== null, history: [], done: false, result: null,
    I_final: null, depth: null, reason: '',
  };
  if (!Number.isFinite(i1) || !Number.isFinite(tp1)) return finish({ ...s, G: NaN }, 'failed', null, 'pass-1 measurement missing');
  if (exc !== null && exc < Number(target) - TH.capFloor - EPS) {
    return finish(s, 'failed', null, `exception accept_I ${exc} below the ${(Number(target) - TH.capFloor).toFixed(1)} floor`);
  }
  return s;
}

/** Feed the measured I for the CURRENT state.G (I_lim, or I in the cap phase). */
export function step(state, I_lim) {
  if (state.done) return state;
  const s = { ...state, history: [...state.history] };
  const m = Number(I_lim);
  if (!Number.isFinite(m)) return finish(s, 'failed', null, 'null pass returned no loudness');

  if (s.phase === 'cap') {
    s.history.push({ phase: 'cap', G: s.G, I: m });
    const r = classifyI(m, s.target);
    const why = r === 'failed' ? ' (exception route)' : '';
    return finish(s, r, m, `depth capped at 12: G=${s.G.toFixed(2)}, I=${m.toFixed(2)} → ${r}${why}`);
  }

  s.loop += 1;
  s.history.push({ phase: 'loop', loop: s.loop, G: s.G, I_lim: m });
  const d = s.target - m;
  let settled = Math.abs(d) <= TH.aim;
  if (!settled) {
    if (s.loop >= TH.maxLoops && Math.abs(d) > TH.accept) {
      return finish(s, 'failed', m, `after ${s.loop} loops |target − I_lim| = ${Math.abs(d).toFixed(2)} > 0.5`);
    }
    s.G += d;
    settled = s.loop >= TH.maxLoops; // last loop, within 0.5 → ok with the corrected G
  }

  const depth = depthOf(s.TP1, s.G);
  if (!s.exception && depth > TH.depthMax + EPS) {
    s.G = capGain(s.TP1);
    s.phase = 'cap';
    s.reason = `depth ${depth.toFixed(2)} > 12 → G=${s.G.toFixed(2)} (depth 12); measuring I`;
    return s;
  }
  if (settled) return finish(s, s.exception ? 'exception' : 'ok', m, `loop ${s.loop}: |target − I_lim| = ${Math.abs(d).toFixed(2)}`);
  return s;
}

function main() {
  const [, , mode, a, b, c, e] = process.argv;
  if (mode === 'init') {
    process.stdout.write(JSON.stringify(initState(JSON.parse(a))));
    return;
  }
  if (mode === 'step') {
    let raw = '';
    process.stdin.on('data', (d) => (raw += d)).on('end', () => {
      process.stdout.write(JSON.stringify(step(JSON.parse(raw), a)));
    });
    return;
  }
  if (mode === 'verdict') {
    const exception = e !== undefined && e !== '' ? { accept_I: Number(e) } : null;
    process.stdout.write(JSON.stringify(mp3Verdict({ I: Number(a), TP: Number(b), target: c !== undefined && c !== '' ? Number(c) : TARGET_I, exception })));
    return;
  }
  if (mode === 'tpfix') {
    process.stdout.write(String(tpFixGain(a, b)));
    return;
  }
  console.error('usage: b3-decide.mjs init <json> | step <I_lim> (state on stdin) | verdict <I> <TP> [target] [accept_I] | tpfix <G> <TP>');
  process.exit(2);
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
