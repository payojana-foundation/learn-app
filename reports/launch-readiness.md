# Launch readiness (2026-11-16T01:57Z)

Live site https://learn.84000.digital (catalog and course files fetched now).

## Live counts

- Courses: **48** (with video: 7)
- Lessons: **2984**; with audio 2984; with video 214
- Manifests: audio approved 2984 of 2992 converted; video approved 214 of 407 converted

## Held (public/ops/checks.json)

61 items (generated 2026-11-16T01:57:32.244Z).

| media: reason | items |
|---|---:|
| audio: conversion failed | 48 |
| audio: duration under 5 min | 4 |
| video: duration under 5 min | 3 |
| audio: source duration unknown | 3 |
| audio: duration differs > 2 % from the Drive source | 2 |
| audio: silence > 60 s in the last 2 min | 1 |

## Automation

- AUTORUN_ENABLED=true; autorun stopped after a red run: no; lessons tried 38 (at the limit: 38)
  - 2026-11-15T07:15Z · audio data/queues/c007.csv · done 0 · failed 3 · left 0
  - 2026-11-15T15:54Z · audio data/queues/c008.csv · done 0 · failed 1 · left 1
  - 2026-11-15T21:17Z · audio data/queues/c008.csv · done 0 · failed 1 · left 0
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

