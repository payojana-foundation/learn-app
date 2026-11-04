/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 "G loop" (pure state machine).
 * Approved 3 Nov 2026 (coordinator; audio agreed): G is tuned on the LIMITED
 * signal, because the limiter costs 1.2–1.8 LU.
 *
 *  1. pass-1 on the mono signal → I1, TP1.  G = target − I1.
 *  2. Loop, max 3. Each loop is a null pass of the FULL chain incl. alimiter
 *     (no mp3) → I_lim.
 *       |target − I_lim| ≤ 0.2 → stop.
 *       else G += (target − I_lim).
 *     After every candidate G:  depth = TP1 + G − 20·log10(0.708).
 *       depth > 12 → CAP: G = 12 + 20·log10(0.708) − TP1, ONE more null pass →
 *       I_cap (measured). I_cap ≥ −18 → result "cap", else "failed" (exception
 *       route). Stop.
 *     After 3 loops: |target − I_lim| ≤ 0.5 → ok (G corrected by the last
 *     difference), else failed.
 *  3. Encode once; the caller accepts on the mp3 (see expectI).
 *
 * An exception (data/media-exceptions.json) runs the same loop at its accept_I
 * (≥ −18) and ignores depth → result "exception". busy is logged only.
 *
 * Pure: the caller does the ffmpeg null passes and feeds I_lim to `step`.
 *   CLI:  node b3-decide.mjs init '<json>'          → state JSON
 *         <state JSON on stdin> | node b3-decide.mjs step <I_lim> → new state
 */
export const TARGET_I = -16;
export const LIMIT = 0.708;
export const CEIL_DB = 20 * Math.log10(LIMIT);
export const TH = { depthMax: 12, iFloor: -18, aim: 0.2, accept: 0.5, maxLoops: 3 };

/** depth = TP1 + G − 20·log10(0.708)  [dB] */
export function depthOf(TP1, G) {
  return TP1 + G - CEIL_DB;
}

/** G that lands depth exactly on the 12 dB boundary. */
export function capGain(TP1) {
  return TH.depthMax + CEIL_DB - TP1;
}

function finish(s, result, iFinal, reason) {
  const depth = Number.isFinite(s.TP1) && Number.isFinite(s.G) ? depthOf(s.TP1, s.G) : null;
  let expectI = null;
  if (result === 'ok' || result === 'exception') expectI = s.target;
  else if (result === 'cap') expectI = iFinal;
  return { ...s, done: true, result, I_final: iFinal, depth, expectI, reason };
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
    I_final: null, depth: null, expectI: null, reason: '',
  };
  if (!Number.isFinite(i1) || !Number.isFinite(tp1)) return finish({ ...s, G: NaN }, 'failed', null, 'pass-1 measurement missing');
  if (exc !== null && exc < TH.iFloor) return finish(s, 'failed', null, `exception accept_I ${exc} below floor -18`);
  return s;
}

/** Feed the measured I_lim for the CURRENT state.G; returns the next state. */
export function step(state, I_lim) {
  if (state.done) return state;
  const s = { ...state, history: [...state.history] };
  const m = Number(I_lim);
  if (!Number.isFinite(m)) return finish(s, 'failed', null, 'null pass returned no loudness');

  if (s.phase === 'cap') {
    s.history.push({ phase: 'cap', G: s.G, I: m });
    if (m >= TH.iFloor) return finish(s, 'cap', m, `capped at depth 12: G=${s.G.toFixed(2)}, I_cap=${m.toFixed(2)}`);
    return finish(s, 'failed', m, `I_cap ${m.toFixed(2)} < -18 floor (exception route)`);
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
    settled = s.loop >= TH.maxLoops; // loop 3, within 0.5 → ok with the corrected G
  }

  const depth = depthOf(s.TP1, s.G);
  if (!s.exception && depth > TH.depthMax) {
    s.G = capGain(s.TP1);
    s.phase = 'cap';
    s.reason = `depth ${depth.toFixed(2)} > 12 → CAP, G=${s.G.toFixed(2)}; measuring I_cap`;
    return s;
  }
  if (settled) return finish(s, s.exception ? 'exception' : 'ok', m, `loop ${s.loop}: |target − I_lim| = ${Math.abs(d).toFixed(2)}`);
  return s;
}

function main() {
  const [, , mode, arg] = process.argv;
  if (mode === 'init') {
    process.stdout.write(JSON.stringify(initState(JSON.parse(arg))));
    return;
  }
  if (mode === 'step') {
    let raw = '';
    process.stdin.on('data', (d) => (raw += d)).on('end', () => {
      process.stdout.write(JSON.stringify(step(JSON.parse(raw), arg)));
    });
    return;
  }
  console.error('usage: b3-decide.mjs init <json> | step <I_lim> (state on stdin)');
  process.exit(2);
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
