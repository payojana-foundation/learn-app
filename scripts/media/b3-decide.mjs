/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 depth/busy decision (pure),
 * coordinator standard (3 Nov, FROZEN). No acompressor, no rescue/forcing loop.
 *
 * Thresholds (frozen for the pilot): depth ≤ 6 dB, OR depth ≤ 12 dB with
 * busy < 0.5 %. Cap: if the rule fails, lower G by (depth − 6) when the 6 dB
 * rule is the one in play, else by (depth − 12); re-measure. Floor I = -18 LUFS;
 * below → failed. An exception (data/media-exceptions.json) is processed at its
 * accept_I regardless of depth/busy (TP still enforced downstream) → "exception".
 */
export const TH = { depthOk: 6, depthMax: 12, busyMax: 0.5, iFloor: -18 };

/** The depth/busy rule: pass when depth ≤ 6, or depth ≤ 12 with busy < 0.5%. */
export function depthRuleHolds(depth, busy) {
  if (depth <= TH.depthOk) return true;
  return depth <= TH.depthMax && busy < TH.busyMax;
}

/** dB to lower G by so depth lands on the rule boundary it just missed. */
export function capReduction(depth, busy) {
  if (depthRuleHolds(depth, busy)) return 0;
  // If busy is clean enough to use the 12 dB rule, aim for 12; else aim for 6.
  const target = busy < TH.busyMax ? TH.depthMax : TH.depthOk;
  return Math.max(0, depth - target);
}

/**
 * First-pass decision from the UNCAPPED measurement.
 *   input: { depth, busy, G, I, exception?:{accept_I} }
 *   → { verdict: 'accept'|'cap'|'exception'|'fail', capG?, reason }
 * 'accept' uploads at G (result ok). 'cap' re-encodes at capG (result cap) if
 * the capped I stays ≥ -18, else 'fail'. 'exception' uses the listed accept_I.
 */
export function decide({ depth, busy, G, I, exception }) {
  if (exception && Number.isFinite(exception.accept_I)) {
    if (exception.accept_I < TH.iFloor) return { verdict: 'fail', reason: `exception accept_I ${exception.accept_I} below floor -18` };
    const capG = G + (exception.accept_I - I); // move to the listed target I
    return { verdict: 'exception', capG, reason: `exception at accept_I=${exception.accept_I}` };
  }
  if (depthRuleHolds(depth, busy)) return { verdict: 'accept', reason: `depth ${depth} within rule (busy ${busy})` };
  const cut = capReduction(depth, busy);
  const capG = G - cut;
  const capI = I - cut; // lowering G by `cut` dB lowers integrated loudness by `cut`
  if (capI < TH.iFloor) return { verdict: 'fail', reason: `cap would need I=${capI.toFixed(1)} < -18 floor (depth=${depth}, busy=${busy})` };
  return { verdict: 'cap', capG, reason: `depth ${depth} > rule; lowering G by ${cut.toFixed(1)} dB (→ I≈${capI.toFixed(1)})` };
}

function main() {
  const raw = process.argv[2];
  const run = (s) => process.stdout.write(JSON.stringify(decide(JSON.parse(s))));
  if (raw) return run(raw);
  let s = '';
  process.stdin.on('data', (d) => (s += d)).on('end', () => run(s));
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
