# Protected behaviours

**RULE (read before any change).** If a task would change any behaviour listed
below, STOP on that item, change nothing, and report which line it conflicts
with. Only a prompt that names the line and says `change protected: <line>` may
change it, and the same commit must update this file AND its contract test.

Each line records what the behaviour does, the commit or spec that decided it,
and where it lives (`file:line`). Values are recorded as the CODE has them now;
a `[from commit <sha>]` or `[from spec <id>]` tag names the evidence. Trust the
named symbol over the exact line number if the file has since shifted.

Contract tests for these lines live in `src/contracts/__tests__/`.

---

## Data loading and integrity

- **P-01** The data loader verifies a file's SHA-256 against the manifest BEFORE
  any store write, and never stores unverified bytes; a mismatch, non-2xx,
  network error, or parse error retains the previously stored data.
  `fetchAndVerify`/`loadFile`, `src/data/loader.ts`. [from part P1]
- **P-02** The host returns index.html with HTTP 200 for a missing file, so a
  200 is never treated as proof a file exists: the manifest shape check and the
  SHA-256 verification are the only gates. `isManifest`, `src/data/manifest.ts`;
  SPA-200 `cacheWillUpdate` guard, `vite.config.ts`. [from part P1]
- **P-03** The manifest URL is origin-absolute (`/data/manifest.json`) and data
  files are fetched with an origin-absolute base (`/data/`) and `?h=<sha256>`,
  so a deep-link document path never makes them resolve to the SPA fallback.
  `MANIFEST_URL`, `src/data/manifest.ts`; `dataUrl`, `src/data/loader.ts`.
  [from part P1]

## Language

- **P-04** Interface language resolves `?lang=km|en` → cookie `lang_84000` →
  default `km`; an explicit `?lang=` is persisted; `<html lang>` and `<html
  data-lang>` are set on load; all cookie access is wrapped in try/catch so a
  blocked cookie store never throws. `resolveLang`/`writeLangCookie`/`applyLang`,
  `src/lang.ts`. [from part P1]
- **P-05** The `lang_84000` cookie uses Domain `.84000.digital` only on an
  84000.digital host (omitted on workers.dev/localhost), Path=/, Max-Age one
  year, SameSite=Lax, and Secure only on https. `writeLangCookie`,
  `src/lang.ts`. [from part P1]

## Reliable updates

- **P-06** The service worker is `registerType: 'prompt'`: the version switch is
  never silent — the user accepts the prompt, then the app reloads once the new
  SW takes control (one-time `controllerchange`). Update is re-checked on
  register, hourly, and on foreground. `registerServiceWorker`, `src/main.ts`;
  `cacheId: learn-<hash>`, `vite.config.ts`. [from part P1]

## Screens and navigation (P4)

- **P-07** Routing is over REAL paths (History API), parsed from
  `location.pathname`: `/`, `/search?q=`, `/my`, `/more`, `/courses/<id>`,
  `/courses/<id>/<lessonId>`, `/teachers`, `/teachers/<slug>`. Legacy website
  params on `/courses/` still work: `?q=` → search, `?teacher=` → teacher.
  `?topic=` → home with the chip pre-selected ONLY when at least one course in
  the catalog has topics; with no topics the topic chips are hidden and
  `?topic=` is ignored (the master sheet has no topic column). Teacher pages and
  the teacher list exist only for teachers with at least one shown course.
  `parseRoute`, `src/router.ts`; `homeView`, `src/ui/views.ts`; `loadBase`,
  `startApp`, `src/app.ts`. Contract: `src/ui/views.lesson.test.ts` "topic chips".
  [from part P4; changed in bulk 09, change protected: P-07]
- **P-08** The lesson URL uses the lesson **id**, not the num:
  `/courses/<id>/<lessonId>` (duplicate nums share a num but have distinct ids,
  P3 "b"). `routePath`, `src/router.ts`; progress/history/notes key on lesson
  id. [from part P4]
- **P-09** Bottom tab bar Home · Search · My Learning · More; course, lesson,
  teacher(s) all map to the Home tab. `tabForRoute`, `src/router.ts`;
  `renderTabbar`, `src/app.ts`. [from part P4]
- **P-10** The Continue row shows only for a returning learner (history
  present); the Start here row is driven by path `start-here` in
  `data/paths.json` (served as `public/data/paths.json`): empty `course_ids`,
  `approved=false`, or no known id = row hidden. `homeView`, `src/ui/views.ts`;
  `pathCourseIds`, `src/data/companion.ts`; `loadBase`, `src/app.ts`. Contract:
  `src/contracts/__tests__/companion.contract.test.ts` "P-10". [from part P4;
  changed in bulk-05 P1, change protected: P-10 — was `START_HERE` in
  `src/config.ts`, now removed]
- **P-11** Course page: progress bar + %, Start/Continue button, ticks per
  lesson, lessons in sections of 20, a find-in-course box (substring on the
  stored title or exact num), Save and Share (Share copies the page URL).
  `courseView`, `src/ui/views.ts`. [from part P4]

## r2 audio player (P4)

- **P-12** The app's own player handles `r2` lessons only: resume to the second,
  speed 0.75/1/1.25/1.5/2, ±15 s, sleep timer 15/30/60 min, autoplay next,
  completed at 90% or by the button, Media Session lock-screen controls, and a
  mini player above the tab bar on non-lesson screens. `createPlayer`,
  `src/audio/player.ts`; `mountPlayerIfR2`/`renderMini`, `src/app.ts`. The media
  URL is `MEDIA_BASE_URL` + the URL-encoded R2 key, never derived from location.
  [from part P4]
- **P-13** Progress is persisted ONLY after the initial resume-seek is applied
  AND while the audio is playing, so a fresh mount's paused 0-tick never
  clobbers the saved resume point. `createPlayer` (`resumeApplied`, paused
  guard), `src/audio/player.ts`. [from part P4]
- **P-14** Learn plays ONLY its own R2 audio. The served data never contains
  `acast`, `youtube` or `drive` media (the `MediaKind` type is `'r2'`), no lesson
  page renders an iframe, an embed container or an outside link, and
  `public/_headers` sets `frame-src 'none'`. A lesson with no media shows an
  offline/needs-internet notice. Only one lesson player is mounted at a time. v1
  is streaming only — no download button anywhere. `lessonView`, `src/ui/views.ts`;
  `public/_headers`. Contract: `src/ui/views.lesson.test.ts` "P-14 r2 only",
  `src/contracts/__tests__/master-build.contract.test.mjs` (no non-r2 kind in
  `public/data`, `_headers`), `e2e/embed.e2e.mjs`. [from part P4; embeds removed in
  bulk 09, change protected: P-14]
## My Learning, search, data (P4)

- **P-15** My Learning tabs: In progress · Saved · History · Notes, all local
  (IndexedDB `learn-app`), with Export/Import backup in More. The backup is all
  USER stores (not cached data files) as one JSON `{app:"learn-app", schema,
  exported_at, …}`; Import rejects a backup whose `app` is not `learn-app`.
  `myView`/`moreView`, `src/ui/views.ts`; `exportBackup`/`importBackup`,
  `src/db/index.ts`. [from part P4]
- **P-16** On-device search over courses, lessons, and teachers: U+200B removed
  from both the query and the text (cleaned copy), substring match, the original
  text displayed unchanged. No result → hand-off links to Vacanā and Library.
  `cleanForSearch`, `src/format.ts`; `renderSearch`, `src/app.ts`;
  `searchView`, `src/ui/views.ts`. [from part P4]
- **P-17** All course/lesson/teacher titles and names are displayed exactly as
  stored (escaped for HTML only, never retyped/translated/trimmed). An empty
  title shows the `no title` placeholder; `title_en` is used only when present.
  `src/ui/views.ts`. [from part P4]
- **P-18** No scripture text anywhere in the app (Learn shows teachers' lessons
  only). [from part P4]

## Manifest → app (Q4, bulk-02)

- **P-19** PER-LESSON release. A lesson is shown only when its master-sheet row
  has a Drive source id (the Drive id of the link named by `source_type`) with an
  APPROVED (non-DRAFT) entry in `data/media-manifest.json`; if two rows share a
  source the first row (sheet order) wins. A course is shown only when it has at
  least one shown lesson and a teacher that maps to a teacher record ("pending" or
  unmapped → hidden and reported). There are no mixed-course rules. An r2 lesson's
  `src` is the BARE R2 key (NOT a full URL — the player prepends `MEDIA_BASE_URL`
  and URL-encodes it, per P-12) and carries the real `duration_s` from the
  manifest. DRAFT entries never count. The build fails if a lesson id that had
  approved media would disappear, unless the id is a key of `data/id-aliases.json`.
  `shownRows`/`buildFromMaster`/`approvedIdGuard`, `scripts/build-courses.mjs`.
  Contract: `src/contracts/__tests__/master-build.contract.test.mjs` "P-19 per-lesson
  release". (The old website-based `buildCourses` is kept, unused by the build.)
  [from part Q4, bulk-02; replaced in bulk 09, change protected: P-19]
## Provisional → permanent ids (Q5, bulk-02)

- **P-20** CLEAN CUT (IndexedDB version 3). Course and lesson ids changed when the
  app moved to the master sheet (only `c080` is the same course before and after), so
  anything stored under an old id would point at another course. The v3 upgrade, and
  the import of a backup with schema < 3, KEEP ONLY the pilot course `c080`, and inside
  it only the lessons in `LEGACY_LESSON_MAP` (the same map as `data/id-aliases.json`),
  rewritten to their new lesson ids; saved/history/notes/leaves of other courses and
  progress of unmapped lessons are dropped once; cached data files and their hashes are
  cleared; settings are kept. An old `/courses/c080/c080-l0nn` URL redirects to the new
  lesson id. Nothing is ever pointed at a different course or lesson. The old
  provisional → permanent course-id alias machinery (`migrateAliases`) stays but has
  nothing to move. `cleanCutV3`/`importBackup`, `src/db/index.ts`; `src/db/legacy.ts`;
  `redirectAlias`, `src/app.ts`. Contract: `src/db/legacy.test.ts`,
  `src/db/migration.test.ts`, `src/db/versionchange.test.ts`.
  [from part Q5, bulk-02; leaves added bulk-05 P1; replaced in bulk 09, change
  protected: P-20]
## Study companion (bulk-05)

- **P-21** A guide line shows ONLY if its `approved` is `true` in
  `guide-lines.json`. Unapproved, missing key, empty text, or a missing/malformed
  file shows NOTHING (no fallback text, no placeholder). Unapproved lines show
  only in a DEV build with `?guide=draft`, tagged DRAFT; never in production.
  `guideLine`/`draftAllowed`, `src/data/companion.ts`; `guideLineHtml`,
  `src/ui/companion.ts`. Contract: `src/contracts/__tests__/companion-ui.contract.test.ts`
  "P-21". [from part bulk-05 P1/P2]
- **P-22** The sign (SVG) is chosen from DATA, not code: `course_signs[course id]`
  (a key written with an old provisional id still matches through
  `aliases.json`; the file is never rewritten), else `default_sign`. A name that
  is not a plain `.svg` file, or not in `public/brand/companion/`, falls back to
  `default_sign` with a console warning. Code depends only on the sign file names
  and, in `branch-draft.svg`, on `data-slot="1..12"` and on the two def ids `bl`
  (leaf) and `bb` (bud). A branch file without a `bb` def draws no buds (a slot
  with a bud is hidden); a file without `bl` draws no branch (changed in bulk-06
  P1, change protected: P-22). `chooseSign`,
  `src/data/companion.ts`; `signHtml`/`resolveSignFile`, `src/ui/companion.ts`.
  Contract: "P-22". [from part bulk-05 P1/P2]
- **P-23** A leaf (IndexedDB store `leaves`, key `course_id`) is added once when
  every lesson of a course is shown AND done (`all_shown` in the catalog: no lesson of
  the course is still hidden) AND the course is not `ongoing` (`courseCanFinish`), and
  is NEVER deleted or updated: not when a lesson is added to the course, not when a
  lesson is un-marked, not by importing a backup (Import merges leaves by `course_id`;
  Export includes them). The one exception is the bulk-09 clean cut (P-20), which
  drops leaves of old ids once. Writes happen in one transaction, so two tabs cannot
  make two leaves. `awardLeafIfFinished`/`backfillLeaves`/`importBackup`,
  `src/db/index.ts`; `courseCanFinish`, `src/data/companion.ts`; `checkLeaf`,
  `src/app.ts`. Contract: "P-23 leaf rule" in `src/db/legacy.test.ts`,
  `src/db/leaves.test.ts`, `src/db/migration.test.ts`.
  [from part bulk-05 P1; changed in bulk 09, change protected: P-23]
- **P-24** The branch panel on `/my` shows no numbers, levels, percent,
  comparison or empty slots: one leaf per finished course, slots above the count of leaves plus buds
  are `display="none"`, 13+ leaves add a second branch. The device note is always
  shown. `branchPanelHtml`/`branchesHtml`, `src/ui/companion.ts`. Contract:
  "P-24". [from part bulk-05 P2]
- **P-25** The Home "Start here" row reads ONLY path `start-here` in
  `paths.json` (approved + at least one known id; else hidden). There is no
  config fallback list. People edit `data/paths.json` and `data/guide-lines.json`,
  never `public/data/`; the build copies and hashes them, and a bad shape fails
  the build. `pathCourseIds`, `src/data/companion.ts`; `loadBase`, `src/app.ts`;
  `scripts/companion-check.mjs`. Contract: "P-25" and "P-10" in
  `companion.contract.test.ts`. [from part bulk-05 P1]

## Buds and no guilt (bulk-06)

- **P-26** No guilt: the app sends no notifications or reminders; shows no
  streaks, day counts, points, ranks or leaderboards; never uses wording about
  missing, losing, failing or sadness; nothing on the branch is removed or fades
  because of time. Contract: `src/contracts/__tests__/no-guilt.contract.test.ts`
  "P-26" (no Notification/push/badge API in `src/`, no streak/points/rank words
  in interface strings, no time-based fade on the branch). [from part bulk-06 P2]
- **P-27** Buds: a bud = class started (>=1 lesson done) and without a leaf yet
  (an ongoing class stays a bud, it cannot get a leaf); derived from progress;
  leaves first, then buds. `startedCourseIds`/`orderBranchItems`,
  `src/data/companion.ts`; `branchesHtml`/`markBuds`, `src/ui/companion.ts`;
  `myCompanionCtx`, `src/app.ts`. Contract: "P-27" and "P-23 leaf rule and P-27
  buds" in `src/db/legacy.test.ts`. [from part bulk-06 P1; changed in bulk 09,
  change protected: P-27]
- **P-28** Start here leaf mark: Start here row only, leaf sign only, no text or
  numbers. `leafMarkHtml`, `src/ui/companion.ts`; `homeView`, `src/ui/views.ts`.
  Contract: "P-28". [from part bulk-06 P1]

## Master sheet source (bulk 09)

- **P-29** The only source of courses and lessons is the master sheet export:
  `data/master/lessons.csv` + `courses.csv` (written by `master-export.yml`, header
  checked against `data/master/columns.json`); the website JSON is not read.
  Course and lesson ids are the master ids (`c###` from the registry, lesson id =
  `lesson_id`). Titles are displayed exactly as exported. The `ongoing` label
  (`ONGOING`, `src/strings.ts`) shows only when Courses.course_status = `ongoing`.
  Course ids in `data/paths.json` and `course_signs` (P-10, P-22, P-25) mean master
  ids; `course_signs` was re-keyed on 11 Nov (only c080 could be mapped for certain;
  the others were dropped). `buildFromMaster`, `scripts/build-courses.mjs`;
  `scripts/master/export.mjs`; `courseCard`/`courseView`, `src/ui/views.ts`.
  Contract: `src/contracts/__tests__/master-build.contract.test.mjs` ("ongoing label
  data", "Khmer / title byte equality", "real served data") and "ongoing label" in
  `src/ui/views.lesson.test.ts`. [from part bulk-09 P2/P3]
