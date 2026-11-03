/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 accept/cap/stop decision (pure).
 *
 * Inputs (one JSON object on argv[2] or stdin):
 *   { I, TP, depth, busy, G, loops }
 * Thresholds (B3, A/B starting values): I = -16 ±0.5, TP ≤ -1.5 dBTP,
 * depth ≤ 6 dB OR (depth ≤ 12 dB AND busy < 0.5 %). Cap: lower G toward the
 * loudest result that still holds the rule, down to I = -18. Stop at -18 or
 * after 3 loops.
 *
 * Output (JSON): { verdict: 'accept'|'adjust'|'cap'|'fail', nextG?, reason }
 *   accept — meets loudness + depth rule → upload, result "ok"
 *   cap    — depth rule only holds below target but I ≥ -18 and TP ok → upload, "cap"
 *   adjust — try again with nextG (another loop)
 *   fail   — even -18 breaks the rule, or loudness unreachable in 3 loops
 */
export const TH = { iLo: -16.5, iHi: -15.5, tp: -1.5, depthOk: 6, depthMax: 12, busyMax: 0.5, iFloor: -18 };

export function depthRuleHolds(depth, busy) {
  if (!(depth <= TH.depthMax)) return false;
  return depth <= TH.depthOk || busy < TH.busyMax;
}

export function decide({ I, TP, depth, busy, G, loops }) {
  const tpOk = TP <= TH.tp;
  const loudOk = I >= TH.iLo && I <= TH.iHi;
  const dRule = depthRuleHolds(depth, busy);

  if (loudOk && tpOk && dRule) return { verdict: 'accept', reason: 'I/TP/depth all within rule' };

  // Loudness in band + TP ok, but depth rule fails → cap: lower G (quieter)
  // toward -18. Accept the loudest that holds; stop (fail) at the -18 floor.
  if (tpOk && !dRule) {
    if (I <= TH.iFloor) return { verdict: 'fail', reason: `depth rule fails even at I=${I} (≤ -18) — source may need a manual fix` };
    if (loops >= 3) return { verdict: 'cap', reason: `depth rule not met by loop 3; accepting loudest safe result at I=${I}` };
    // step G down by ~1 dB (bounded so I does not overshoot -18)
    const nextG = G - Math.min(1, Math.max(0, I - TH.iFloor));
    return { verdict: 'adjust', nextG, reason: `depth too high (depth=${depth}, busy=${busy}); lowering G toward -18` };
  }

  // TP too hot or loudness out of band: another loop if we have one left.
  if (loops >= 3) return { verdict: 'fail', reason: `loudness/TP not reached in 3 loops (I=${I}, TP=${TP})` };
  let nextG = G;
  if (!tpOk) nextG = G - 1; // pull back gain; limiter catches the rest
  else if (I < TH.iLo) nextG = G + (-16 - I);
  else if (I > TH.iHi) nextG = G - (I + 16);
  return { verdict: 'adjust', nextG, reason: `retune (I=${I}, TP=${TP})` };
}

function main() {
  const raw = process.argv[2];
  const run = (s) => process.stdout.write(JSON.stringify(decide(JSON.parse(s))));
  if (raw) return run(raw);
  let s = '';
  process.stdin.on('data', (d) => (s += d)).on('end', () => run(s));
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
