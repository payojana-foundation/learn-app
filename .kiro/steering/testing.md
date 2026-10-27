---
inclusion: always
---

# Testing rules (every session)

These apply to every change, even when the prompt does not ask for tests.

1. **A bug fix gets a NEW test.** The test must FAIL before the fix and PASS
   after it. Show both runs (red then green) in the report.

2. **Every UI change is checked across the matrix.** 360px AND 320px, light AND
   dark, both languages (km, en). Report the result as a table. No horizontal
   scroll; focus visible.

3. **Both suites before every commit.** Run `npm test` and `npm run e2e`; both
   must pass. Report the full summary (which scripts ran and their result).

4. **Never edit, skip, or weaken an existing test to make it pass.** The
   protected.md contract-test rules apply: a failing contract test means a
   protected behaviour drifted — change nothing and report which P-line broke.

5. **If something cannot be tested automatically, say so** and list it as a
   phone check for the user (what to open, what to look for).

6. **Tests use placeholder text, never typed Khmer/Pāḷi titles or names.** Refer
   to a course by its id and a lesson by its number, or use placeholder strings.
   Never retype or reformat data titles in tests or fixtures.

7. **Vitest pool is pinned.** `vite.config.ts` sets `pool: 'forks'` with
   `maxWorkers: 2`. The old default on Windows spawned one worker per test file
   and intermittently SKIPPED whole files in a spawn race. Do not remove this
   pin. `isolate` stays ON so each file gets fresh module state (the
   fake-indexeddb shim is module-global per worker).

8. **Type-check gates the unit suite.** `npm test` runs `tsc --noEmit` first
   (the `pretest` script), so a type error fails the suite before Vitest runs.
   `npm run check` runs the type-check and the unit suite together. Report the
   tsc result alongside the test result.

9. **Every report states the test FILE count and the test count.** Record the
   `Test Files N passed (N)` and `Tests N passed (N)` lines from `npm test`, and
   the e2e script count + their PASS/FAIL, so a silently skipped file is visible
   (a drop in the file count is the tell).

10. **E2e uses mobile emulation at 360 px** (and 320 px for the quality pass,
    P5), light and dark. Mock media in e2e — never fetch real R2/embeds.
