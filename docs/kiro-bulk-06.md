# Bulk 06 — Buds on the branch, Start here leaf marks, "no guilt" rule

Builds on bulk-05 (docs/kiro-bulk-05.md). Read it and .kiro/steering/* first.

## Rules for this task

- Work on main. Commit + push only when tests pass.
- No branches, no pull requests. Never force-push. If a push is rejected (the course-audio bot pushes to main): pull, rebuild, rerun tests, push.
- Touch ONLY what this file asks. Do not change any existing flow, screen, string, route, store or test unless a part below names it.
- Protected lines: if any part needs a change to an existing P-line, quote the line and your proposed text in the report and STOP before coding it.
- No new IndexedDB store, no DB version bump.
- Nothing leaves the device. No notifications.
- Test as much as you can (unit + e2e). Report what you could not test.
- Report: append to reports/kiro-bulk-06-report.md.
- Before coding: check this file against the spec, protected.md and the current code. If you find a conflict, STOP and report it. If none, say so in the report and continue.

## What we are building

1. Bud: a class the learner has started but not finished shows a small outlined bud on the branch. When the class is finished, the bud is replaced by a leaf (existing leaves logic).
2. Start here leaf marks: in the Start here row only, a finished class card shows a small leaf.
3. A written "no guilt" rule in protected.md.

Not in scope: anything else on /my, cards elsewhere, numbers, counts, animation.

## P1 — Buds and marks (one commit)

1. Started = the course is in the catalogue, has NO leaf, and its progress record has at least one lesson with done === true. Opening a lesson without completing it does not count. Derive it from the progress store at render time; no new tracking. If the learner un-marks every lesson, the bud goes away (allowed). Leaves are never removed (P-23 unchanged).

2. Branch order: all leaves first (by leaf `at`), then buds (by progress updatedAt, oldest first). Same slots 1..12 per branch; 13+ items start the next branch, as now. When a bud's class is finished, it leaves the bud list and its leaf is added after the other leaves (positions may shift by one; that is accepted).

3. Bud shape: add to public/brand/companion/branch-draft.svg a second def, id "bb":

   ```
   <path id="bb" d="M0 0C-3.5-3-4-8 0-12C4-8 3.5-3 0 0Z" fill="none" stroke="#F26000" stroke-width="1.6"/>
   ```

   A slot shows a leaf with href "#bl" and a bud with href "#bb". Keep the leaf def unchanged. The brand team will keep both ids when they replace the file; note this in data-contract or the SVG comment.

4. Panel at 0 leaves and 0 buds: unchanged (bare branch + guide line my.branch.empty). With buds but 0 leaves: no guide line (the bud speaks for itself). No new strings.

5. Start here leaf mark: on Start here row cards only, when that class has a leaf, show the leaf sign (16 px, aria-hidden) beside the title. No text, no number. Other card rows unchanged. The row is still hidden while paths.json is empty or unapproved.

6. Unit tests: started rule (done vs opened only, course not in catalogue, course with leaf), ordering leaves-then-buds, bud removed after un-marking all lessons, leaf never removed, 13+ items across branches.

7. e2e at 320 and 360 px, light and dark, km and en:
   - fresh /my: bare branch, no buds
   - open a lesson without finishing: no bud
   - mark one lesson done: one bud
   - finish that class: bud gone, one leaf
   - 3 leaves + 2 buds: order leaves then buds
   - Start here fixture (approved, 2 classes, one finished): leaf mark on the finished card only; no mark on cards outside the row
   - buds/leaves survive reload and offline reload
   - no horizontal scroll; no digits in the panel

Commit: "bulk-06 P1: buds and Start here marks".

Push. STOP. Write the phone steps for the coordinator at the end of the report.

## P2 — Protect (one commit, after "go P2")

Add to .kiro/steering/protected.md:

- P-26 No guilt: the app sends no notifications or reminders; shows no streaks, day counts, points, ranks or leaderboards; never uses wording about missing, losing, failing or sadness; nothing on the branch is removed or fades because of time.
- P-27 Buds: a bud = class started (>=1 lesson done) and not finished; derived from progress; leaves first, then buds.
- P-28 Start here leaf mark: Start here row only, leaf sign only, no text or numbers.

Add contract tests for P-26..P-28 where testable (e.g. no digits in the branch panel; no Notification API use in src/). Update docs/STATUS.md and finish the report.

Commit: "bulk-06 P2: protect buds and no-guilt".
