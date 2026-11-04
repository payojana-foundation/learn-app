/**
 * scripts/media/b3-decide.mjs — Job B v2 · B3 depth decision (pure).
 * Rule change 3 Nov (audio + coordinator): accept = depth ≤ 12 dB. busy is
 * measured and logged only, NEVER used in the decision. Cap: G_cap = G −
 * (depth − 12); capped I = TARGET_I − cut; floor −18 LUFS (below → failed).
 * An exception (data/media-exceptions.json) is processed at its accept_I
 * regardless of depth (TP still enforced downstream) → "exception".
 *
 * TARGET_I is the ONE constant for the course target loudness (default −16);
 * switch it to −18 to retarget a whole course.
 */
export const TARGET_I = -16;
export const TH = { depthMax: 12, iFloor: -18 };

/** The depth rule: pass when depth ≤ 12 dB. (busy is never consulted.) */
export function depthRuleHolds(depth) {
  return depth <= TH.depthMax;
}

/** dB to lower G by so depth lands on the 12 dB boundary. */
export function capReduction(depth) {
  return Math.max(0, depth - TH.depthMax);
}

/**
 * Decision from the UNCAPPED measurement.
 *   input: { depth, busy?, G, I, target?, exception?:{accept_I} }
 *   → { verdict: 'accept'|'cap'|'exception'|'fail', capG?, capI?, reason }
 * `busy` is accepted for logging symmetry but ignored.
 */
export function decide({ depth, G, I, target = TARGET_I, exception }) {
  if (exception && Number.isFinite(exception.accept_I)) {
    if (exception.accept_I < TH.iFloor) return { verdict: 'fail', reason: `exception accept_I ${exception.accept_I} below floor -18` };
    const capG = G + (exception.accept_I - I); // move to the listed target I
    return { verdict: 'exception', capG, reason: `exception at accept_I=${exception.accept_I}` };
  }
  if (depthRuleHolds(depth)) return { verdict: 'accept', reason: `depth ${depth} ≤ ${TH.depthMax}` };
  const cut = capReduction(depth);
  const capG = G - cut;
  const capI = target - cut;
  if (capI < TH.iFloor) return { verdict: 'fail', reason: `cap would need I=${capI.toFixed(1)} < -18 floor (depth=${depth})` };
  return { verdict: 'cap', capG, capI, reason: `depth ${depth} > ${TH.depthMax}; lowering G by ${cut.toFixed(1)} dB (→ I≈${capI.toFixed(1)})` };
}

function main() {
  const raw = process.argv[2];
  const run = (s) => process.stdout.write(JSON.stringify(decide(JSON.parse(s))));
  if (raw) return run(raw);
  let s = '';
  process.stdin.on('data', (d) => (s += d)).on('end', () => run(s));
}
if (process.argv[1] && process.argv[1].endsWith('b3-decide.mjs')) main();
