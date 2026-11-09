# Bulk 07 — Finish the companion and parked items

Read docs/kiro-bulk-05.md, docs/kiro-bulk-06.md and .kiro/steering/* first.

## Rules

- Work on main. Commit + push each part only when tests pass. No branches, no PRs, never force-push. If a push is rejected (course-audio bot): pull, rebuild, rerun tests, push.
- Touch ONLY what this file asks.
- Do NOT stop between parts. If a part conflicts with a protected line or the spec, SKIP that part (no code for it), quote the conflict in the report, and continue with the next part.
- Never type or change scripture, course titles, lesson titles or teacher names (data as stored).
- Never invent Khmer text. Use only Khmer given here or already in strings.ts.
- Test as much as you can. Report: append to reports/kiro-bulk-07-report.md, one section per part, then phone steps at the end.

## P1 — Approve the Khmer and use ថ្នាក់ (one commit)

The coordinator approved the companion Khmer.

1. In strings.ts, interface labels where km "វគ្គ" means "course/class" become "ថ្នាក់" (e.g. the label on course cards). List every string you change (key, old, new). Do NOT touch strings where វគ្គ means something else, and never touch course titles from data. If វគ្គ on the cards comes from data, not strings.ts, change nothing and report it.

2. data/guide-lines.json: set approved=true on home.start_here, course.finished, my.branch.empty. Text unchanged. Run the build and commit the regenerated public/data files.

3. strings.ts: remove the [VERIFY] mark from my.branch.label and my.branch.device_note only. Text unchanged.

4. Tests: update only tests that assert the old approved=false state or the changed labels; list each one. Run npm test, npm run e2e, npm run release-check (report its output).

Commit: "bulk-07 P1: approve companion km, ថ្នាក់".

## P2 — Data rebuild job (one commit)

Goal: a person edits data/*.json on GitHub's website; within minutes public/data is rebuilt and committed; Cloudflare deploys; no workflow stays red for that flow.

- New workflow on push to main, paths data/**: checkout with full history (the stamp uses git log), npm ci, npm run build-courses; if public/data changed, commit "data: rebuild after <short sha>" and push with the repo's existing push-with-retry script.
- concurrency group so two runs never overlap; no loop (its own push must not retrigger it); never force-push.
- Make data-check not go red for this flow (e.g. run it after the rebuild, or have it check the rebuilt tree). Explain your choice in the report.
- Do not change the course-audio workflow.
- Test with act or a dry-run script if possible; otherwise explain exactly what you could not test. Write click-by-click steps for the coordinator: how to edit data/paths.json on GitHub, what success looks like (Actions green, new "data: rebuild" commit, deploy).

Commit: "bulk-07 P2: data rebuild workflow".

## P3 — DB upgrade safety (one commit)

- Add a versionchange handler: when a newer tab needs to upgrade the DB, the old tab closes its connection and shows the EXISTING "update available" prompt. If no existing string fits, skip this part and report (no new Khmer).
- If the open is blocked, retry when unblocked; never delete or clear stores.
- Unit test with two connections.

Commit: "bulk-07 P3: db versionchange handling".

## P4 — Layout fixes on /my and the tab bar (one commit)

At 320 and 360 px, km and en, light and dark:

1. /my tabs: all four tab labels fully visible (today the 4th is cut: "កំណ…"). Use spacing, font size or wrapping; no label text change, no horizontal page scroll.
2. Bottom tab bar: "ការសិក្សារបស់ខ្ញុំ" on one line if it fits at 360 px; at 320 px two lines are OK but all four items keep the same height and stay tappable (44 px min).

No string changes. Add e2e checks for both.

Commit: "bulk-07 P4: /my tabs and tab bar fit".

## End

Update docs/STATUS.md. Report: commit hashes, tests, skipped parts with reasons, and phone steps for the coordinator after deploy.
