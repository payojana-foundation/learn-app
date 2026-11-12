# Kiro bulk 09 — learn-app · app reads the master sheet; approved lessons only · 11 Nov 2026

Plan: claude/master-sheet-plan.md (P2). Master sheet 12MOXAOHwwtKa6DFVwbfRMj8UtaKmN1758boN1EUKNZs, seeded 11 Nov (bulk 08, 4852 Lessons rows, 86 Courses).
Coordinator decisions: per-lesson release (a course shows as soon as one lesson is approved; only approved lessons show) · courses still being taught show an "ongoing" label · no Acast/YouTube/Drive embeds in Learn (3 Nov) · Learn shows only what the coordinator approved.

Rules: git pull first; main only; one commit per part; tests must pass; push with retry; report reports/kiro-bulk-09-report.md (untracked). Touch only files each part names. Do NOT change course-audio, approve-media, media workflows, the manifest, catalogue-build or scripts/master/seed.mjs. Never retype Khmer: byte-for-byte. Never invent ids, titles, statuses. Test as much as you can. Windows: one e2e suite at a time; stop port 4321 servers before/after.

## P0 — Review + report (no code). STOP after.
- Conflicts with this spec, .kiro/steering/protected.md P-lines, or earlier decisions (list each with file:line).
- Today's app data: how build-courses builds public/data (source, ids, media kinds, teachers, topics, durations). What the app reads besides course/lesson data.
- ID migration: the app's current course/lesson ids (website data) vs master ids (course_id c### from the registry, lesson_id). Is the same c### the same course in both? For each old lesson id: can it be mapped to a master lesson_id (e.g. by Drive file id)? Counts: mapped / unmapped. Saved learner progress that would be lost.
- Which app features use embeds today and what changes when they go.
- Proposed P-line changes (text), not applied.

## P1 — Master export (workflow master-export.yml)
- workflow_dispatch + daily schedule (pick an off-peak minute). Scope spreadsheets.readonly. Reads tabs Lessons and Courses of the master sheet; writes data/master/lessons.csv and data/master/courses.csv (byte-exact, header from columns.json); commits only when content changed; push with retry.
- Fails loudly if a header differs from columns.json.

## P2 — build-courses reads the master export
- Source = data/master/*.csv + data/media-manifest.json + existing teachers file. Website JSON no longer used for courses/lessons (keep the file; do not delete).
- Lesson visible = approved R2 audio in the manifest (same rule as learn_live). Course visible = at least one visible lesson. Lesson order = lesson_no (Khmer digits sort as numbers).
- Titles from master: course_title_km, lesson_title, byte-for-byte; course_title_en empty → existing Khmer-title rule.
- Teacher from the master teacher column mapped to teacher slugs; "pending" → course hidden + reported.
- "ongoing" label when Courses.course_status = ongoing. Strings: km «កំពុងបង្រៀន» (DRAFT – needs reviewer approval), en "Ongoing". In strings.ts.
- No embed media kinds in output; player only plays r2.
- Old ids: write data/id-aliases.json for every old lesson id P0 could map; unmapped old progress is dropped once, cleanly (never pointed at a different lesson).
- Report hidden courses/lessons with reasons (reports/course-issues.csv).

## P3 — Tests + P-lines
- Contract tests: only approved lessons appear; course with 1 approved lesson appears with only that lesson; ongoing label shown only for ongoing; no acast/youtube/drive kinds anywhere in public/data; aliases resolve; Khmer byte-equality vs master export.
- e2e: home lists the approved course(s) only; lesson plays from R2; no iframe on any lesson page.
- Update protected.md P-lines exactly as approved after P0.

## Done when
Tests + e2e green; after deploy, learn.84000.digital shows only approved lessons (today: 1 course, 10 lessons); deploy-check passes.

## Decisions 11 Nov

Coordinator answers to the P0 report (reports/kiro-bulk-09-report.md). They override the spec text above where they differ.

- **Q1 clean cut (a).** One IndexedDB version bump drops all data keyed by old ids; the c080 lessons are kept through an explicit lesson-level map. Minimal changes in src/db and src/app.ts are allowed. (P-20 = clean cut.) data/id-aliases.json is therefore NOT filled with the 3408 mapped lessons.
- **Q2 yes.** master-export.yml also runs build-courses and commits data/master + public/data together. Triggers: workflow_dispatch, daily 03:17 UTC, workflow_run of approve-media. Concurrency group data-rebuild-main.
- **Q3 yes.** Media = the Drive id of the `source_type` link; if two rows share a source, the first row wins.
- **Q4.** A leaf only when every lesson of the course is shown and done AND course_status is not ongoing.
- **Q5.** Topic chips are hidden when no course has topics; `?topic=` is ignored. No topics column now.
- **Q6 yes.** May also touch public/_headers, src/ui/views.ts, src/data/catalog.ts, src/strings.ts, src/db/*, src/app.ts, data/guide-lines.json and the 4 e2e files (route-mocked catalogs).
- **Q7.** Teacher pages with no shown course are hidden.
- **Q8 yes, but HOLD.** Push P1. Build P2 + P3 and run all tests, but do NOT push P2/P3 until the coordinator writes "go live". Report when ready.
- **Gap 6.** Re-key `course_signs` with the old->new course map; unmapped -> drop + report.
- **Gap 7.** Lesson order tie or non-number -> sheet row.
- **Gap 8.** The build fails if a lesson id with approved media disappears or changes, unless it is aliased.
- **Gap 10.** The report lists the 22 old English course titles with their new course_id (the team pastes them into course_title_en later).
- **Gap 11.** The Khmer string for the ongoing label is copied from the spec byte for byte.
- **Gap 12.** As proposed; schedule 03:17 UTC.
- **Gap 4.** The old `buildCourses` stays untouched; add `buildFromMaster`.
- **change protected:** P-07, P-14, P-19, P-20, P-23, P-27 as proposed in the P0 report (P-20 = clean cut per Q1). Note P-10 / P-25 / P-22: course ids now mean master ids (course_signs re-keyed). Add P-29.
