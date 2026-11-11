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

## Decisions 10 Nov

Coordinator answers to the PART 0 report (conflict numbers as in reports/kiro-bulk-08-report.md section e). They override the spec text above where they differ. Conflict 12 (the claude/ plan files are not in the repo) is fixed by recording the answers here.

- **C1/C2 row_key.** New SYSTEM column `row_key` (M00001…), assigned once at seed, never changes; it is the row's identity. `lesson_id` = SYSTEM, recomputed on every seed/sync (not frozen). No source + no code -> `lesson_id` empty, issue "no source, no code".
- **C3 learn_live** = approved AND catalogue-visible (10 today). Do not touch build-courses; the app switch is bulk 09.
- **C4 teacher** = SYSTEM from teacher-files.json until bulk 09; shown as the Khmer display name; pending files -> "pending".
- **C5 audio_status:** not started | converted | needs review (id in failed-review.csv) | approved. "too quiet" and "failed" are dropped.
- **C6 acast / soundwise:** done -> posted, empty -> to do; "not needed" is team-only. Acast posted + no embed -> issue "acast embed missing". Embed present but acast empty -> posted. Soundwise value "កាត់ស្អាត" -> to do + Legacy.
- **C7 ready:** yes/Yes and the "Realy ?"/"Realy" columns -> yes; empty -> empty. Not used for visibility or parity.
- **C8 columns.** details <- គោលធម៌. youtube_link also <- "តំណក្នុង YoutTube". New TEAM column `video_code` <- the video_code labels. course_title_en = empty (no source). MiniCourse/minicourse: if the values are only done/empty -> new TEAM column `minicourse_status` (to do|posted|not needed); otherwise -> Legacy (report which). Every other labelled column with data -> new tab "Legacy": row_key, source_file, source_tab, source_row, label, value, byte-exact.
- **C9 files:** `scripts/master/seed.mjs` and `scripts/master/__tests__/`.
- **C10 Google:** the Sheets API is enabled; the sheet is shared with the service account as Editor. sheet_id = 12MOXAOHwwtKa6DFVwbfRMj8UtaKmN1758boN1EUKNZs. The spreadsheets scope is added only in master-seed.yml. Protected-range editors: the service account only. Parity reads the dry-run CSV (format in docs/master-sheet.md). Kiro builds and tests dry mode; the coordinator runs write mode.
- **C11 rows:** in = titled numbered rows (4752; hidden-tab rows with issue "hidden tab") + numbered untitled rows (100, issue "no title"). Out = section rows and the 54 unnumbered rows; they are listed in the report.
- **C13** OK; no new course ids in dry mode.
