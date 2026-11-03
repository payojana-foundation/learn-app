/**
 * scripts/media/approve-manifest.mjs — apply a reviewer DECISION to entries in
 * data/media-manifest.json (R4, bulk-03), driven by the approve-media.yml
 * workflow so the team never hand-edits the JSON.
 *
 * For each Drive file id given:
 *   - if it is in the manifest: set `status`, `reviewer`, `reviewed_at`.
 *   - if it is NOT in the manifest: record it as not-found; the job still
 *     succeeds for the rest (no throw, no partial-write surprise).
 *
 * Decisions:
 *   "approved"  → status `APPROVED_STATUS`. build-courses counts ONLY an
 *                 approved status toward the course-level all-or-nothing r2
 *                 switch (P-19), so this is what makes a lesson playable.
 *   "rejected"  → status `REJECTED_STATUS`. A rejected entry is KEPT for the
 *                 audit trail but is NEVER played (build-courses does not count
 *                 it). A later corrected file is uploaded under a NEW key
 *                 (`-v2`) by the pipeline, never by overwriting this one.
 *
 * The functions are pure and exported so the unit test exercises them with a
 * fixture manifest (never real titles/keys).
 *
 * Usage:
 *   node scripts/media/approve-manifest.mjs <manifest.json> <decision> <reviewer> <id[,id...]>
 * where decision ∈ {approved, rejected}.
 * Exit 0 on a clean apply (even if some ids were not found); 1 on bad input.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const APPROVED_STATUS = 'approved';
export const REJECTED_STATUS = 'rejected';
export const DECISIONS = ['approved', 'rejected'];

/** Map a decision word to the status string stored in the manifest. */
export function statusForDecision(decision) {
  if (decision === 'approved') return APPROVED_STATUS;
  if (decision === 'rejected') return REJECTED_STATUS;
  return null;
}

/** Parse a comma/space/newline-separated id list into a clean, de-duped array. */
export function parseIds(raw) {
  return [...new Set(String(raw || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Apply a decision to the manifest. Pure: returns
 *   { manifest, applied: string[], notFound: string[] }
 * `manifest` is a new array (input is not mutated). `reviewedAt` is a caller-
 * supplied UTC date string (so the result is testable/reproducible).
 */
export function applyDecision(manifest, ids, reviewer, decision, reviewedAt) {
  const status = statusForDecision(decision);
  if (!status) throw new Error(`unknown decision "${decision}" (use: ${DECISIONS.join(' | ')})`);
  if (!reviewer || typeof reviewer !== 'string') throw new Error('reviewer name is required');

  const list = Array.isArray(manifest) ? manifest : [];
  const want = new Set(ids);
  const present = new Set(list.filter((e) => want.has(e.drive_file_id)).map((e) => e.drive_file_id));

  const applied = ids.filter((id) => present.has(id));
  const notFound = ids.filter((id) => !present.has(id));

  const next = list.map((e) =>
    want.has(e.drive_file_id)
      ? { ...e, status, reviewer, reviewed_at: reviewedAt }
      : e
  );

  return { manifest: next, applied, notFound };
}

/**
 * "course" mode (Job B v2): approve ONLY the entries whose loudness.result is
 * "ok" among the given drive_file_ids (a course's lessons), and bucket the rest
 * for the coordinator. Pure: returns
 *   { manifest, approved, skipped: { cap, exception, failed, other, notFound } }
 * Never approves a cap/exception/failed entry — those need a human decision.
 */
export function approveCourse(manifest, driveIds, reviewer, reviewedAt) {
  if (!reviewer || typeof reviewer !== 'string') throw new Error('reviewer name is required');
  const list = Array.isArray(manifest) ? manifest : [];
  const want = new Set(driveIds);
  const byId = new Map(list.filter((e) => want.has(e.drive_file_id)).map((e) => [e.drive_file_id, e]));
  const resultOf = (e) => (e && e.loudness && e.loudness.result) || 'other';

  const approved = [];
  const skipped = { cap: [], exception: [], failed: [], other: [], notFound: [] };
  for (const id of driveIds) {
    const e = byId.get(id);
    if (!e) { skipped.notFound.push(id); continue; }
    const r = resultOf(e);
    if (r === 'ok') approved.push(id);
    else if (skipped[r]) skipped[r].push(id);
    else skipped.other.push(id);
  }
  const approve = new Set(approved);
  const next = list.map((e) =>
    approve.has(e.drive_file_id)
      ? { ...e, status: APPROVED_STATUS, reviewer, reviewed_at: reviewedAt }
      : e
  );
  return { manifest: next, approved, skipped };
}

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function main() {
  const [, , manifestPath, decision, reviewer, idsRaw] = process.argv;
  if (!manifestPath || !decision || !reviewer || !idsRaw) {
    console.error(
      'Usage: node scripts/media/approve-manifest.mjs <manifest.json> <decision> <reviewer> <id[,id...]>\n' +
        `  decision ∈ {${DECISIONS.join(', ')}, course}\n` +
        '  course: ids = the course\'s lesson drive_file_ids; only result=ok entries are approved.'
    );
    process.exit(1);
  }
  // "course" mode: approve ONLY result=ok entries among the given ids; list the
  // rest (cap/exception/failed) for the coordinator.
  if (decision === 'course') {
    const ids = parseIds(idsRaw);
    if (ids.length === 0) { console.error('no drive_file_ids given'); process.exit(1); }
    if (!existsSync(manifestPath)) { console.log(`manifest ${manifestPath} does not exist — nothing to approve.`); process.exit(0); }
    const current = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const { manifest, approved, skipped } = approveCourse(current, ids, reviewer, utcDate());
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    console.log(`course approve by ${reviewer}`);
    console.log(`approved ok (${approved.length}): ${approved.join(', ') || '(none)'}`);
    console.log(`needs coordinator — cap: ${skipped.cap.join(', ') || '(none)'}`);
    console.log(`needs coordinator — exception: ${skipped.exception.join(', ') || '(none)'}`);
    console.log(`needs coordinator — failed: ${skipped.failed.join(', ') || '(none)'}`);
    if (skipped.other.length) console.log(`other/no-result: ${skipped.other.join(', ')}`);
    if (skipped.notFound.length) console.log(`not found: ${skipped.notFound.join(', ')}`);
    console.log(`APPLIED_COUNT=${approved.length}`);
    process.exit(0);
  }
  if (!DECISIONS.includes(decision)) {
    console.error(`unknown decision "${decision}" (use: ${DECISIONS.join(' | ')} | course)`);
    process.exit(1);
  }
  const ids = parseIds(idsRaw);
  if (ids.length === 0) {
    console.error('no drive_file_ids given');
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    // No manifest yet: nothing to approve. Report every id as not found; the
    // job still succeeds (exit 0) so a dispatch before any audio is uploaded
    // does not fail.
    console.log(`manifest ${manifestPath} does not exist — nothing to apply.`);
    console.log(`not found: ${ids.join(', ')}`);
    process.exit(0);
  }

  const current = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const { manifest, applied, notFound } = applyDecision(current, ids, reviewer, decision, utcDate());
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.log(`decision: ${decision} by ${reviewer}`);
  console.log(`applied (${applied.length}): ${applied.join(', ') || '(none)'}`);
  if (notFound.length) console.log(`not found (${notFound.length}): ${notFound.join(', ')}`);
  // Emit a count for the workflow commit message.
  console.log(`APPLIED_COUNT=${applied.length}`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('approve-manifest.mjs')) main();
