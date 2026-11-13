# Master content sheet (bulk 08)

One Google Sheet that lists every lesson row of the teacher sheets, so the team edits one place. Decisions: `docs/kiro-bulk-08.md`. Schema (single source for the seed, the reader and the dashboard): `data/master/columns.json`. Bulk 08 only SEEDS the sheet and REPORTS parity; the app and `build-courses` keep reading what they read today (the switch is bulk 09).

## Tabs

- **Lessons**: one row per numbered lesson row, the columns below, in this order. Header row frozen.
- **Legacy**: every other labelled column that holds data: `row_key, source_file, source_tab, source_row, label, value`. Label and value are copied byte-for-byte.
- **Courses** (Part 6): one row per course, the columns in the "Courses tab" section below. Header row frozen.
- **Lists**: the dropdown values (one column per dropdown column of Lessons and Courses, header = column key).

## Columns

Owner TEAM = the team edits it. SYSTEM = written by the seed/sync; a protected range whose only editor is the service account. `lesson_code` is TEAM-owned but protected the same way (only the coordinator's account changes codes).

| # | column | owner | protected | dropdown | source |
| --- | --- | --- | --- | --- | --- |
| 1 | `row_key` | SYSTEM | yes |  | Assigned once at seed (M00001...), never changes; the row's identity. Order: file name, tab order, sheet row. |
| 2 | `lesson_id` | SYSTEM | yes |  | catalogue-build lessonIdOf via planCatalogue (code, else d-<source drive id>); recomputed on every seed/sync. Empty when no source and no code. |
| 3 | `course_id` | SYSTEM | yes |  | data/course-ids.json registry via planCatalogue (file id + tab). No new ids in a dry run. |
| 4 | `teacher` | SYSTEM | yes |  | data/teacher-files.json (file -> slug) shown as the teacher's Khmer display name (name_km); pending files show: pending. |
| 5 | `course_title_km` | TEAM | no |  | catalogue-build courseTitle (section row above the first lesson, else the tab name). |
| 6 | `course_title_en` | TEAM | no |  | No source in the sheets; empty. |
| 7 | `lesson_no` | TEAM | no |  | Number column, trimmed like the reader. |
| 8 | `lesson_title` | TEAM | no |  | Title column, trimmed like the reader. |
| 9 | `lesson_code` | TEAM | yes |  | Lesson-code column (both spellings). Protected: only the coordinator's account changes it. |
| 10 | `video_code` | TEAM | no |  | The code column whose label contains 'video'. |
| 11 | `mp3_link` | TEAM | no |  | Cut MP3 link column (cell text, or the hyperlink target when the text holds no link). |
| 12 | `mp4_link` | TEAM | no |  | Cut MP4 link column. |
| 13 | `minicourse_link` | TEAM | no |  | 'Video for MiniCourse' column. |
| 14 | `youtube_link` | TEAM | no |  | YouTube column, else the column labelled តំណក្នុង YoutTube. |
| 15 | `original_video_link` | TEAM | no |  | Original-video link column. |
| 16 | `details` | TEAM | no |  | Column labelled គោលធម៌. |
| 17 | `source_type` | SYSTEM | yes |  | Which link the catalogue picked: mp3 \| mp4 \| minicourse (planCatalogue source_from); empty when none. |
| 18 | `audio_status` | SYSTEM | yes | not started / converted / needs review / approved | data/media-manifest.json by source drive id: approved; id in data/queues/failed-review.csv = needs review; any other manifest entry = converted; else not started. |
| 19 | `learn_live` | SYSTEM | yes | yes / no | yes = approved AND visible in the catalogue (planCatalogue visible). Not what the app shows today (app switch: bulk 09). |
| 20 | `acast_status` | TEAM | no | to do / posted / not needed | Acast column: done -> posted, empty -> to do; an Acast embed link present -> posted. 'not needed' is team-only (never seeded). |
| 21 | `acast_embed` | SYSTEM | yes |  | The first cell, under ANY embed-labelled column ('Embed link from Acast' and the other 'embed link' label), whose URL host contains acast. Other cells stay in Legacy. |
| 22 | `acast_episode_id` | SYSTEM | yes |  | The first cell under any embed-labelled column whose trimmed value is exactly 24 hex digits (case-insensitive). No URL is ever built from it. |
| 23 | `soundwise_status` | TEAM | no | to do / posted / not needed | Soundwise column: done -> posted, empty -> to do; any other value -> to do and the value goes to Legacy. |
| 24 | `minicourse_status` | TEAM | no | to do / posted / not needed | Column labelled MiniCourse / minicourse (only when every value is done or empty, else those columns go to Legacy): done -> posted, empty -> to do. 'not needed' is team-only. |
| 25 | `issues` | SYSTEM | yes |  | Hide reason from the catalogue, plus: hidden tab, no title, no source, no code, acast embed missing (Acast done, and neither acast_embed nor acast_episode_id). Joined with '; '. |
| 26 | `ready` | TEAM | no | yes | 'Ready ?' / 'Realy ?' / 'Realy' columns: yes or Yes -> yes; empty -> empty. Not used for visibility or parity. |
| 27 | `notes` | TEAM | no |  | No source; empty. |
| 28 | `source_file` | SYSTEM | yes |  | Drive file id (the .xlsx name in data/source/sheets). |
| 29 | `source_tab` | SYSTEM | yes |  | Tab name, byte-for-byte. |
| 30 | `source_row` | SYSTEM | yes |  | Sheet row number (1-based). |

## Courses tab

One row per distinct non-empty `course_id` of the Lessons rows, in order of first appearance. SYSTEM columns are protected like the Lessons ones; `course_status` is the only TEAM column and is empty at seed. The hidden tab has no course id, so it has no row here.

| # | column | owner | protected | dropdown | source |
| --- | --- | --- | --- | --- | --- |
| 1 | `course_id` | SYSTEM | yes |  | One row per distinct non-empty course_id of the Lessons rows, in order of first appearance (the hidden tab has none). |
| 2 | `course_title_km` | SYSTEM | yes |  | Copied from the course_title_km of the first Lessons row of the course. |
| 3 | `teacher` | SYSTEM | yes |  | Copied from the teacher of the first Lessons row of the course (Khmer display name, or: pending). |
| 4 | `lesson_count` | SYSTEM | yes |  | Number of Lessons rows with this course_id (hidden rows included). |
| 5 | `course_status` | TEAM | no | ongoing / complete | Empty at seed; the team sets it. |

## Rows

- In: every numbered, non-section lesson row of every tab that has a header row, including rows Learn hides today (`issues` = the hide reason) and the rows of the hidden tab (issue `hidden tab`). A numbered row without a title is in with issue `no title`.
- Out: section rows, unnumbered rows (listed in `reports/master-seed-excluded.csv`), tabs named `0_…`, tabs without a header row, files that are not course sheets.
- `row_key` (M00001…) is assigned once at seed, in the order file name, tab order, sheet row, and never changes: it is the row's identity. `lesson_id` is recomputed on every seed/sync and is empty when there is no source and no code (issue `no source, no code`). Two rows may share a `lesson_id` (a duplicate code); the later one is hidden.
- `course_id`, `lesson_id`, `learn_live` and the hide reason come from `scripts/catalogue/catalogue-build.mjs` (`planCatalogue`): the same functions, no copy. `learn_live = yes` means approved media AND visible in the catalogue; it is not what the app shows today.
- Statuses: audio_status `approved` (manifest status approved) > `needs review` (id in `data/queues/failed-review.csv`) > `converted` (any other manifest entry) > `not started`. acast_status / soundwise_status / minicourse_status: `done` -> posted, empty -> to do (an Acast embed link also means posted); `not needed` is only ever set by the team. A value that is neither done nor empty (in Acast, Soundwise, Ready) -> to do / empty and the value goes to Legacy. If an Acast status is done but the row has neither `acast_embed` nor `acast_episode_id`: issue `acast embed missing`.
- Embed-labelled columns (the "Embed link from Acast" label and the other "embed link" label): per cell, a URL whose host contains `acast` -> `acast_embed`; a value that is exactly 24 hex digits (any case) -> `acast_episode_id`; anything else stays in Legacy. A URL is never built from an episode id.
- `ready`: yes/Yes in the Ready ?, Realy ? and Realy columns -> `yes`, empty -> empty. Not used for visibility or parity.
- MiniCourse / minicourse columns: if every value over the rows that go in is done or empty they feed `minicourse_status`; otherwise they go to Legacy. The dry run prints the evidence.

## CSV format (dry run and parity input)

`node scripts/master/seed.mjs --mode dry` writes, in `reports/`:

- `master-seed-preview.csv`: the Lessons tab. UTF-8, no BOM, `\n` line ends, header = the column keys above in order. A value is double-quoted when it contains a comma, a double quote, CR or LF (quotes doubled). Nothing is trimmed or normalised.
- `master-seed-legacy.csv`: the Legacy tab, same rules.
- `master-seed-courses.csv`: the Courses tab, same rules, header = the Courses column keys in order.
- `master-seed-excluded.csv`: `file_id, tab, row, kind, text` for the rows that are out (section rows, unnumbered rows).

`scripts/master/parity.mjs` reads `master-seed-preview.csv` and writes `reports/master-parity.md`.

## Write mode

`.github/workflows/master-seed.yml` (workflow_dispatch, inputs `sheet_id`, `mode` = dry | write). Only the write mode authenticates, with the `https://www.googleapis.com/auth/spreadsheets` scope. It REFUSES (exit 3) if the Lessons tab already has data rows. Order: Legacy, Lists and Courses first, then freeze, dropdowns and protected ranges (Lessons and Courses), and the Lessons rows last, so a failure half way leaves Lessons empty and a re-run is allowed. Values are written RAW (no formula parsing). The sheet owner can always edit a protected range; the protection keeps every other editor out.

## Sync (master-sync.yml)

`scripts/master/sync.mjs`, run by `.github/workflows/master-sync.yml` (manual, and daily at 03:47 UTC in the mode of the repo variable `MASTER_SYNC_MODE`, default `dry`). It writes ONLY these SYSTEM columns, matched by `row_key`, and only cells whose value changed: Lessons `lesson_id`, `audio_status`, `learn_live`, `acast_embed`, `acast_episode_id`, `issues`; Courses `lesson_count`. It never writes a TEAM column, never adds, deletes or resizes anything. A row without `row_key` (added by the team) or with a duplicate `row_key` is left alone and reported.

- `lesson_id`: `lessonIdOf` (code, else `d-<source id>`); source id = the Drive id of the `source_type` link, else mp3 > mp4 > minicourse.
- `audio_status`: from data/media-manifest.json, as at seed (approved > needs review > converted > not started).
- `learn_live`: `yes` when the lesson is in the served public/data.
- `acast_embed` / `acast_episode_id`: from the frozen teacher-sheet exports by `source_file` + `source_tab` + `source_row`; no match = unchanged.
- `issues`: why the row is not shown today (`no source`, `duplicate source (an earlier row has it)`, `no approved media yet`), plus `hidden tab`, `teacher pending`, `no title`, `no source, no code`, `acast embed missing`, `source_type not set`. The first sync replaces the seed's catalogue wording with this wording.
- `lesson_count`: Lessons rows with that `course_id`.

It also writes `public/ops/status.json` (counts per course: lessons, live, audio status; and totals) for the future dashboard; the app does not read it. Dry mode writes `reports/master-sync-preview.csv` (tab, key, column, row, from, to) and `reports/master-sync-report.md`; write mode commits `public/ops/status.json` when it changed.
