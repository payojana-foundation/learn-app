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
  params on `/courses/` still work: `?q=` → search, `?teacher=` → teacher,
  `?topic=` → home with the chip pre-selected. `parseRoute`, `src/router.ts`.
  [from part P4]
- **P-08** The lesson URL uses the lesson **id**, not the num:
  `/courses/<id>/<lessonId>` (duplicate nums share a num but have distinct ids,
  P3 "b"). `routePath`, `src/router.ts`; progress/history/notes key on lesson
  id. [from part P4]
- **P-09** Bottom tab bar Home · Search · My Learning · More; course, lesson,
  teacher(s) all map to the Home tab. `tabForRoute`, `src/router.ts`;
  `renderTabbar`, `src/app.ts`. [from part P4]
- **P-10** The Continue row shows only for a returning learner (history
  present); the Start here row is driven by `START_HERE` (empty = row hidden).
  `homeView`, `src/ui/views.ts`; `START_HERE`, `src/strings.ts`. [from part P4]
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
- **P-14** `acast`/`youtube` lessons render the REAL embed in an iframe whose
  `src` is the embed URL stored in the lesson data (never guessed): acast is
  audio-only (short height), youtube is 16:9; lazy-loaded, `allow`
  autoplay/encrypted-media/fullscreen; a small "open in <host>" link below opens
  the source in a new tab. `drive` lessons NEVER play in-app (coordinator
  decision — Drive only after R2 conversion): a drive-only lesson shows
  "កំពុងរៀបចំ — មកដល់ឆាប់ៗ" (no player, no Drive link). `public/_headers` CSP
  `frame-src` allows ONLY embed.acast.com, www.youtube.com,
  www.youtube-nocookie.com (NOT drive.google.com). A lesson with no media shows
  an offline/needs-internet notice. Only one lesson player is mounted at a time.
  v1 is streaming only — no download button anywhere. `embedMedia`/`lessonView`,
  `src/ui/views.ts`; `public/_headers`. [from part P4; embed+CSP from team-test
  fix; drive-off from coordinator decision, change protected: P-14]

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

- **P-19** A course switches to `r2` ONLY when EVERY Drive-backed audio lesson
  in it has an APPROVED (non-DRAFT) entry in `data/media-manifest.json` — no
  mixed courses. An r2 lesson's `src` is the BARE R2 key (NOT a full URL — the
  player prepends `MEDIA_BASE_URL` and URL-encodes it, per P-12) and carries the
  real `duration_s` from the manifest; the player shows that duration from the
  data. DRAFT entries never count. `courseAllDriveApproved`/`lessonMedia`,
  `scripts/build-courses.mjs`; `duration_s` seed in `lessonView`,
  `src/ui/views.ts`. Contract: `src/contracts/__tests__/course-build.contract.test.mjs`
  "P-19 course-level all-or-nothing r2". [from part Q4, bulk-02]

## Provisional → permanent ids (Q5, bulk-02)

- **P-20** `data/id-aliases.json` (empty `{}` now) is the SOURCE alias map
  (provisional course id → permanent); the build copies it verbatim into the
  served `public/data/aliases.json`. On app start the app reads the served file
  and moves IndexedDB user data (progress/saved/history/notes) from a
  provisional key to its permanent key ONCE, inside ONE transaction,
  idempotently — a record is moved only if it still lives under the provisional
  key, an existing permanent record is never clobbered, and a second run is a
  no-op. Old `/courses/<provisional>` (and its lesson URL) redirect in-app to
  the permanent id via `history.replaceState`. No real permanent ids are
  invented. `migrateAliases`/`resolveAlias`/`rewriteLessonId`, `src/db/aliases.ts`;
  `redirectAlias`, `src/app.ts`; alias merge in `scripts/build-courses.mjs`.
  Contract: `src/db/aliases.test.ts`. [from part Q5, bulk-02]
