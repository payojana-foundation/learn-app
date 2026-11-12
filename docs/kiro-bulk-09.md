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
