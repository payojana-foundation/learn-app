# Kiro bulk task 02 — learn-app · data and media at scale · 26 Oct 2026

Start only after bulk-01 is finished and its report is written. Same rules as bulk-01
(main only, one commit per part, push after tests pass, report first for data, STOP gates,
no secrets in files/logs, never retype Khmer/Pāḷi titles, test as much as possible).
Report: `reports/kiro-bulk-02-report.md` (untracked).

## Q1 — Teacher-sheet inventory (structure discovery, no assumptions)
Workflow `sheets-inventory.yml` (workflow_dispatch; same WIF auth as P2, scope
drive.readonly). Input var `TEACHER_SHEETS_FOLDER` = 1GT0HCp6iQgJmu92dPnLPK4gJvNG7Wv-Y
("Spreadsheet"; subfolder វត្តធម្មចក្រពុទ្ធារាម holds six). List every file recursively;
Google Sheets are exported with the Drive API as .xlsx, .xlsx files downloaded as-is.
Output, committed by the workflow to `data/source/sheets/`:
- the raw exports (never edited), named `<drive_file_id>.xlsx`
- `reports/sheets-inventory.md`: per file — name, id, tabs, header row of each tab, row
  count, columns that look like IDs/codes (report only, do not decide), sample of 3 rows.
Do NOT build courses from them yet. The architect writes the mapping after reading this report.

## Q2 — Media inventory
Workflow `media-inventory.yml`. Input file `data/media-folders.csv`
(`teacher_slug,drive_folder_id`), filled by the coordinator; empty file → job ends with
"nothing to do". Per folder, recursively: file id, name, mimeType, size, md5Checksum,
createdTime, and `ffprobe` (over HTTP with the Authorization header, reading only the
header bytes) for duration, has_video, has_audio, codec. Output
`reports/media-inventory.csv` + `reports/media-gaps.md` (no audio track, name says .mp3
but has video, duplicates by md5, zero-size). Read-only: never move, rename or delete.

## Q3 — Course-audio in batches
Extend `course-audio.yml`: input `list` = path to a CSV of drive_file_ids (default
`data/audio-queue.csv`), `limit` (default 5), `max_minutes` (stop cleanly before the
GitHub job time limit and leave the rest for the next run). Skip ids already in
`data/media-manifest.json`. One manifest line per file, committed at the end of the run
(and on cancellation, what finished so far). Concurrency 2 by default. Log a summary
table: done / skipped / failed with reason.

## Q4 — Manifest → app
`build-courses.mjs`: a lesson whose media source (Drive file id from the website data's
Drive link, or later from the sheets) appears in the manifest gets `media.kind = "r2"`,
`src = VITE_MEDIA_BASE_URL + "/" + key`, `duration_s`. A course switches to r2 only when
ALL its audio lessons are in the manifest (no mixed courses). Contract test for this rule.
Player shows real duration from the data.

## Q5 — Provisional → permanent IDs (hook only)
`data/id-aliases.json` (`{"c012":"<permanent>"…}`, empty now). On app start, user data in
IndexedDB keyed by an alias is moved to the permanent key once, inside one transaction,
idempotent. Old URLs `/courses/<provisional>` redirect in-app to the permanent one.
Unit tests with a fixture alias map. No real permanent IDs are invented.

Done when: all workflows pass actionlint, unit tests pass, `npm run check` passes,
STATUS.md updated.
