# Data contract — learn-app (P3)

One place. Describes every data file the app consumes, how it is built, and the
rules the build enforces. Nothing here is typed by hand into the data; the build
script (`scripts/build-courses.mjs`) produces the served files from the frozen
source inputs. The app only reads these files.

## Sources (inputs, never edited by the build)
- `data/source/website-courses-2026-09-28.json` — frozen website catalogue.
  Shape: `{ c: [ { titleKm, titleEn, teacher, teacherSlug, topics[], lessons: [
  { num, titleKm, topic, audioEmbedSrc, videoPreviewSrc } ] } ] }`. 93 courses,
  3,875 lessons (confirmed by the build).
- `data/source/teachers-2026-10-25/teachers-2026-10-25.json` — corrected teacher
  file (array of 12). Fields: `order, slug, name_km, name_en, bio_km, bio_en,
  topics, photo_file, title_status, bio_approved_by_teacher, show_english_name`.
  The `.csv` is the same data for humans; the build reads the `.json`.
- `data/source/teachers-2026-10-25/teacher-photos/*.jpg` — copied as-is.
- `data/media-manifest.json` — produced by the media pipeline (P2). Array of
  `{ drive_file_id, key, bytes, duration_s, sha256, status }`. Absent = no R2
  media yet (the build treats it as an empty list).

## Outputs (served; built into `public/data/`)
- `public/data/catalog.json` — the course index:
  `{ generated, provisional, courses: [ { id, title_km, title_en, teacher,
  teacher_slug, topics[], lesson_count, media_kinds[], provisional } ] }`.
  `media_kinds` is the set of media kinds across the course's lessons.
- `public/data/courses/<id>.json` — one file per course:
  `{ id, provisional, title_km, title_en, teacher, teacher_slug, topics[],
  lessons: [ { num, title_km, topic, media: [ { kind, src } ] } ] }`.
- `public/data/teachers.json` — the teacher index (built from the teacher file,
  display rules applied): `{ teachers: [ { slug, name_km, name_en|null, bio_km|
  null, bio_en|null, topics[], photo } ] }`.
- `public/data/manifest.json` — the data manifest the loader reads
  (`{ generated, files: { catalog, teachers, <course id>… : {file, updated,
  sha256} } }`). Each served file has an entry with its SHA-256.

## IDs (provisional; replaced before launch)
- Course id: `c###` from source order (1-based, zero-padded to 3), e.g. `c001`.
- Lesson id: `c###-l###`. The lesson number part is the num's FIRST source
  position in the course. A **duplicate lesson `num`** (two lessons with the
  same `num` in one course) is kept — no lesson is dropped and no `num` is
  edited — and disambiguated only by a letter suffix on the provisional id:
  2nd occurrence → `b`, 3rd → `c`, e.g. `c007-l013` and `c007-l013b` (coordinator
  decision, 26 Oct 2026). The displayed `num` is byte-for-byte as stored.
- The lesson URL uses the lesson **id**, not the `num`:
  `/courses/<course-id>/<lesson-id>`.
- Every id carries `"provisional": true` in the catalog and course files, and
  the catalog's top-level `provisional` is `true`. Permanent ids will come from
  the teacher sheets before launch; keep an **`aliases`** hook
  (`public/data/aliases.json`, `{ "<old id>": "<new id>" }`) so saved user data
  and links migrate. The build writes an empty `aliases.json` until permanent
  ids exist.

## Titles and names (copied byte-for-byte)
- Course/lesson titles and teacher names are stored exactly as in the source.
  No machine translation, no `.mp3`/`.mp4` stripping, no spelling choices.
- `title_en` is `null` when the source `titleEn` equals `titleKm` (the source
  put Khmer in the English field); the UI then shows the Khmer title.
- Teacher display rules:
  - `name_km` is always shown.
  - `name_en` is included only when `show_english_name` starts with "yes"
    (case-insensitive); otherwise `null`.
  - `bio_km`/`bio_en` are included only when `bio_approved_by_teacher` starts
    with "yes"; otherwise `null`.
  - `photo` = the `photo_file` path, copied as-is; `null` when absent.

## Media kinds
Each lesson's `media` array holds `{ kind, src }` objects, derived from the
source and the media manifest:
- `acast` — `audioEmbedSrc` on `embed.acast.com` (iframe embed).
- `youtube` — `videoPreviewSrc` on `www.youtube.com` (iframe embed).
- `drive` — a `drive.google.com` `audioEmbedSrc` or `videoPreviewSrc` (Drive
  preview iframe).
- `r2` — a lesson whose recording has been transcoded to R2 (its
  `drive_file_id` has a non-DRAFT entry in `data/media-manifest.json`); `src` is
  the R2 key. v1 has none until a reviewer approves the pilot.
A `null`/empty source contributes no media entry. A lesson with an empty media
array is hidden (reported).

## Build checks
Hard fail (build exits non-zero):
- A course `teacherSlug` that is not in the teacher file → FAIL (cannot render).

Warnings (handled and reported, build still succeeds):
- Duplicate lesson `num` within a course → WARNING. Both lessons are kept; the
  later one gets an id suffix (see IDs above). Each case is recorded in
  `reports/course-issues.csv` as `duplicate-num` with the course title, the
  `num`, and BOTH lesson titles (coordinator decision, 26 Oct 2026).
- A lesson with an empty title → keep as `no title`, report.
- A lesson with no media → hidden, report.
All issues are written to `reports/course-issues.csv` (untracked working note).

## Contract tests
`src/contracts/__tests__/` holds tests that assert the output shape and the
rules above against a small fixture (never the real titles). A failing contract
test means the built shape drifted — fix the build, never the test.

## Study companion files (bulk-05)

**People edit `data/paths.json` and `data/guide-lines.json`, never
`public/data/`.** The build copies both byte-for-byte to `public/data/`, lists
them in `manifest.json` under the keys `paths` and `guide-lines` (with SHA-256),
and the app loads them through the same hash-verified path as the catalog.

### `paths.json`
```
{ "version": 1, "paths": [
  { "id": "start-here", "title_km": null, "title_en": null,
    "course_ids": [], "approved": false } ] }
```
- `course_ids` are ordered course ids; titles are `null` or text people wrote.
- The Home "Start here" row reads path `start-here`. Empty `course_ids` or
  `approved: false` = row hidden. Unknown course ids are skipped by the app.
- No other path UI yet.

### `guide-lines.json`
```
{ "version": 1, "default_sign": "leaf-sign-draft.svg",
  "course_signs": { "<course id>": "<file>.svg" },
  "lines": { "<key>": { "km": "...", "en": "...", "approved": false } } }
```
- Keys in use: `home.start_here`, `course.finished`, `my.branch.empty`.
- **A line shows only if `approved` is `true`.** Unapproved or missing = nothing
  is shown (no fallback text). In a DEV build only, `?guide=draft` also shows
  unapproved lines with a DRAFT tag; production never does.
- Sign: `course_signs[course id]`, else `default_sign`. Files live in
  `public/brand/companion/`. A plain `.svg` file name is required; anything
  else falls back to `default_sign` with a console warning.
- A `course_signs` key written with an old (provisional) id still works after
  the id is rewritten: the app resolves it through `aliases.json` when it
  looks the sign up. The file is never rewritten by code.

### Build checks
- Bad shape in either file → **build fails** (no bad file gets a hash). The app
  also treats a malformed file as empty.
- Unknown course ids in `paths.json`, or `course_signs` keys that are neither in
  the catalogue nor an alias of a catalogue id, are listed in
  `reports/paths-issues.csv` (untracked). They are not build failures.

### Leaves (device only, not a data file)
IndexedDB store `leaves` (DB version 2): key `course_id`, value
`{ course_id, at }`. One per finished course, added once, never updated or
removed. Included in Export; Import merges by `course_id`.
