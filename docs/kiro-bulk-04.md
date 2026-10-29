# Kiro bulk task 04 — learn-app · use remaining credit while setup is pending · 28 Oct 2026

Same rules as bulk-01..03 (git pull first; main only; one commit per part; tests before
push; safety check; STOP gates; report first for data; never retype Khmer/Pāḷi). First
review this file against protected.md and the contract tests and list conflicts.
Report: `reports/kiro-bulk-04-report.md`. No network calls to Drive/R2 in any part.

## S1 — Forbidden-strings guard (CI + npm run check)
`scripts/check-forbidden.mjs` fails if tracked files (excluding `docs/archive/**`,
`reports/**`, `node_modules/**`, `data/source/**`) contain: `beref.org`,
`sansombucks.workers.dev`, `study-84000`, `study.84000.digital`, `r2.dev`.
(The email sansombucks@gmail.com in git metadata is allowed — only file contents are
checked; the bare word `sansombucks` inside the kiro-bulk-*.md task files is allowed.)
Wire into `npm run check` and lint-workflows. Fix any hit outside the exclusions and list
each in the report. Apply the same script + wiring to `app-template` (separate commit there).
Note: the foundation email/domain is now payojana.org; beref.org must not appear anywhere.

## S2 — Media move plan (offline, from committed data only)
`scripts/media/move-plan.mjs` → `reports/media-move-plan.csv` and
`reports/media-move-plan.md`. One row per lesson with media: course_id, lesson_id, teacher,
kind (drive-audio | drive-video | acast | youtube), drive_file_id (if any), planned key
(`audio/<drive_file_id>-a64.mp3` for any Drive file; empty when there is no Drive id), status
(`ready` = Drive id known; `needs-original` = Acast/YouTube only). Summary by teacher and
kind with counts. Expected totals from the data: Acast 2,188 · YouTube 1,521 · Drive audio
887 · Drive video 465 (1,352 unique Drive ids) — report the script's own counts and any
difference. Sizes: write "unknown — from media-inventory run". Also emit
`data/audio-queue.pilot.csv` with the Drive ids of the pilot course (teacher yon-yi, title
"ថ្នាក់កុមារ វេស្សន្តរជាតក", 15 lessons — find it by teacher + title, copy the title
byte-for-byte from the data) in lesson order. Most of its lessons are YouTube/Acast in the
data, so expect few Drive ids: list every lesson that has none (their originals come from
the teacher's Drive folder later).
Unit tests with a fixture.

## S3 — Real audio e2e (what P5 could not cover)
Generate a short silent/tone WAV or MP3 fixture in the test (no ffmpeg dependency if not
installed; a JS-generated WAV is fine), serve it locally as an r2 lesson, and test in
Chromium: play advances position, ±15 s, speed change, resume after reload, 90% → completed,
autoplay-next, sleep timer pauses (shorten via a test hook, not by changing real values),
mini player keeps playing across screens, navigator.mediaSession metadata + action handlers
set. 360 px light only is enough.

## S4 — Accessibility pass
Add axe-core (exact-pinned devDependency) to e2e: Home, course, lesson, search, My Learning,
More, teacher at 360 px light + dark; fail on serious/critical. Fix findings in the UI
without changing protected behaviour (P-lines); if a fix would change one, STOP and list it.
Keyboard: tab order reaches play/pause, ±15 s, speed, notes; visible focus everywhere.

## S5 — Offline behaviour
e2e: after one online visit, go offline (context.setOffline), reload: shell + fonts render,
visited course data loads from cache, unvisited course shows the existing offline message
(no crash, no blank screen), My Learning works. Report what is cached and its size.

Done when: npm run check + e2e green; report lists every fix.
