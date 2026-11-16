# Launch readiness (2026-11-16T06:35Z)

Live site https://learn.84000.digital (catalog and course files fetched now).

## Live counts

- Courses: **48** (with video: 7)
- Lessons: **2984**; with audio 2984; with video 214
- Manifests: audio approved 2984 of 3045 converted; video approved 214 of 714 converted

## Held (public/ops/checks.json)

1113 items (generated 2026-11-16T06:35:41.483Z).

| media: reason | items |
|---|---:|
| audio: no file link | 629 |
| video: file not shared | 438 |
| audio: file not shared | 16 |
| audio: no approved lesson | 14 |
| audio: duration under 5 min | 4 |
| audio: conversion failed | 3 |
| video: duration under 5 min | 3 |
| audio: source duration unknown | 3 |
| audio: duration differs > 2 % from the Drive source | 2 |
| audio: silence > 60 s in the last 2 min | 1 |

### Work for a person (fixed in the sheet or in Drive, then check_decision "fixed")

- **no file link**: add the Drive file link of the lesson (mp3_link, mp4_link or minicourse_link).
- **file not shared**: share the Drive file with the service account (or restore it from the trash).
- **conversion failed** / pre-check reasons: listen, then fixed (new file) or approve anyway or hold.

Courses with no approved lesson where nothing is waiting for the pipeline: **14**

| course | title | detail |
|---|---|---|
| c002 | 2-ព្រះវិន័យបិដក ភិក្ខុវិភង្គ «ន | 0 of 97 lessons approved and none waiting: 97 no file link |
| c027 | 3-មេរៀនព្រះធម៌ជាភាសាអង់គ្លេស | 0 of 22 lessons approved and none waiting: 22 no file link |
| c028 | 4-សិក្សាព្រះធម៌ និងអក្សរសាស្ត្រ | 0 of 18 lessons approved and none waiting: 18 no file link |
| c029 | 5-សិក្សាព្រះធម៌ និងអក្សរសាស្ត្រ | 0 of 17 lessons approved and none waiting: 17 no file link |
| c030 | 6-អក្សរសាស្ត្រខ្មែរ កាត់ខ្លីៗ២០ | 0 of 7 lessons approved and none waiting: 7 no file link |
| c050 | 5-បរិច្ឆេទទី៥​ វិថីមុត្តសង្គហៈ  | 0 of 155 lessons approved and none waiting: 155 no file link |
| c051 | 6-បរិច្ឆេទទី៦ រូបបរមត្ថ (ឆ្នាំ  | 0 of 91 lessons approved and none waiting: 91 no file link |
| c052 | 7-បរិច្ឆេទទី១ ចិត្តសង្គហៈ (ឆ្នា | 0 of 2 lessons approved and none waiting: 2 no file link |
| c059 | 3-Simultanous class | 0 of 42 lessons approved and none waiting: 42 no file link |
| c060 | 4-បង្រៀនព្រះធម៌ ជាភាសាអង់គ្លេស​ | 0 of 29 lessons approved and none waiting: 29 no file link |
| c061 | 5-បកស្រាយ ព្រះធម៌តាម មលិន្ទបញ្ហ | 0 of 35 lessons approved and none waiting: 35 no file link |
| c062 | 6-ការបង្រៀនសមាធិ និង ចិត្តវិទ្យ | 0 of 23 lessons approved and none waiting: 23 no file link |
| c063 | 7-ធម៌អប់រំចិត្ត | 0 of 11 lessons approved and none waiting: 11 no file link |
| c064 | 8-Dhamma talk in English | 0 of 9 lessons approved and none waiting: 9 no file link |

## Automation

- AUTORUN_ENABLED=true; autorun stopped after a red run: no; lessons tried 19 (at the limit: 19)
  - 2026-11-15T15:54Z · audio data/queues/c008.csv · done 0 · failed 1 · left 1
  - 2026-11-15T21:17Z · audio data/queues/c008.csv · done 0 · failed 1 · left 0
  - 2026-11-16T02:39Z · audio data/queues/c009.csv · done 0 · failed 24 · left 24
- AUTO_APPROVE_PASSING=true; last auto-release: 2026-11-16 · auto-release · audio approved 0 (held: flagged 8, not checked 0, re-converted 0) · video approved 142 (held: flagged 3, audio not approved 63)
- VIDEO_ENABLED=true, VIDEO_RENDITION=480p
- MASTER_SYNC_MODE=unset (dry): the sync only READS the sheet: SYSTEM cells, team row intake and new course ids are NOT written
- Team decisions logged: 0

## Open issues (build of the committed data)

| issue | count |
|---|---:|
| lesson_hidden: no approved media yet | 1202 |
| lesson_hidden: no source | 628 |
| course_hidden: no approved lesson | 38 |

