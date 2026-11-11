# Kiro bulk 08 — learn-app · master content sheet (seed + parity, no switch) · 10 Nov 2026

Plan: claude/master-sheet-plan.md. Coordinator answers 10 Nov: 1a teacher dropdown = Khmer display names mapped to teacher ids · 2a keep YouTube + original-video columns · 3a Soundwise = status only · 4a one "details" column · 5a lesson_code protected (coordinator only).

Rules: git pull first; main only; one commit per part; tests must pass; push with retry; report file reports/kiro-bulk-08-report.md (untracked). Touch nothing outside the files named here. Do NOT change course-audio, approve-media, media workflows, build-courses, the app, or catalogue-build behaviour. Never retype Khmer: copy byte-for-byte. Never invent codes, names, statuses. Test as much as you can.

## PART 0 — Review + report (no code)
- Read this spec; list conflicts with the repo or earlier decisions. STOP if any.
- From data/source/sheets (latest export), report:
  a) every header label that is NOT mapped below, with tab count and filled-cell count;
  b) distinct values (with counts) of the Soundwise, Acast and "Ready ?" columns;
  c) row counts: titled rows, rows Learn shows today, rows hidden today (by reason).
- STOP after the report. Coordinator answers the mapping of a) and b).

## PART 1 — Schema file (single source for seed, reader, dashboard)
- data/master/columns.json + docs/master-sheet.md: column order, owner (TEAM|SYSTEM), dropdown values, source mapping.
- Columns: lesson_id(S) · course_id(S) · teacher(T, dropdown km names) · course_title_km(T) · course_title_en(T) · lesson_no(T) · lesson_title(T) · lesson_code(T, protected) · mp3_link(T) · mp4_link(T) · minicourse_link(T) · youtube_link(T) · original_video_link(T) · details(T) · source_type(S) · audio_status(S: not started|converted|too quiet|failed|approved) · learn_live(S: yes|no) · acast_status(T: to do|posted|not needed) · acast_embed(S) · soundwise_status(T: to do|posted|not needed) · issues(S) · ready(T: yes|empty) · notes(T) · source_file(S) · source_tab(S) · source_row(S).
- lesson_id and course_id exactly as catalogue-build computes them today (same function, no copy of logic).

## PART 2 — Seed (workflow_dispatch master-seed.yml)
- Inputs: sheet_id, mode = dry | write. Scope adds https://www.googleapis.com/auth/spreadsheets.
- dry: writes reports/master-seed-preview.csv only.
- write: fills tabs Lessons and Lists in the given sheet. Refuses if Lessons already has data rows (protects team edits).
- One row per titled lesson row in the teacher files, INCLUDING rows Learn hides today (issues = the hide reason). Section rows and 0_ tabs excluded.
- audio_status from data/media-manifest.json (+ failed-review list if present); learn_live = approved and shown in the catalogue.
- acast_embed + acast_status = posted when the sheet has an Acast embed/id; otherwise to do. Soundwise and details mapping: only as answered after PART 0.
- Dropdown validation on all dropdown columns; protected ranges on all SYSTEM columns and on lesson_code (editors: coordinator only). Freeze header row.
- Tests: fixture teacher files → expected rows; byte-identical Khmer; refuse-on-existing-data.

## PART 3 — Parity report (report only, no switch)
- scripts/master/parity.mjs: build the catalogue from the master sheet export and from the teacher files; diff course ids, lesson ids, titles, media ids, visibility.
- Output reports/master-parity.md. Goal: 0 differences. No change to what Learn reads.

## STOP gate
After PART 3: coordinator spot-checks 20 rows in the sheet + parity = 0. The reader switch, freeze and sync Action come in bulk 09.
