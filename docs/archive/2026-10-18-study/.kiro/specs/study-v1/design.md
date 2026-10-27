# Design — 84000.digital v1 (Library + Courses + site pages)

Plan change 18 Oct 2026 (coordinator): this product becomes **84000.digital** at the domain root once approved; the static website retires then, and study.84000.digital / course.84000.digital redirect to it. Internal names stay as approved 17 Oct (repo, Worker and IndexedDB `study-84000`, spec folder `study-v1`).

Read with `requirements.md`, `docs/data-contract.md`, `.kiro/steering/*`.

## 1. Stack
Same toolchain as vacana-app: Vite, Tailwind, vite-plugin-pwa (generateSW, registerType "prompt"), TypeScript if vacana-app uses it. UI approach: copy vacana-app's (read its `package.json` first; report what it uses before writing code). Unit tests: the test runner vacana-app uses; if none, Vitest. Fonts in `public/fonts/` (Battambang, Moul, Lora latin + latin-ext, Moulpali, Metal), `font-display: swap`.

## 2. Repo layout
```
.kiro/steering/  .kiro/specs/study-v1/
docs/data-contract.md   DEPLOY.md   wrangler.jsonc   .node-version
inputs/            source files for scripts (frozen JSON, CSVs, teachers JSON) — not deployed
scripts/           build:courses, check:library (Node, no network)
reports/           script output — committed (the coordinator reads them on GitHub), not deployed
public/
  data/            manifest.json, vol023.json, words023.json (archive, copied by a person)
                   study-manifest.json, scanmap023.json, links/sc023.json,
                   courses/courses.json, courses/c/<slug>.json, teachers.json, partners.json, aliases.json
  teachers/        <slug>.jpg (copied by build:courses from inputs, renamed to new slugs)
  brand/  fonts/  _headers
src/
  config.ts        VITE_SCANS_BASE_URL, VITE_MEDIA_BASE_URL, VITE_SC_BASE_URL, FEEDBACK_URL (unknown → null), SHOW_UNAPPROVED_BIOS=false
  i18n/            strings.km.ts, strings.en.ts (Khmer marked DRAFT), lang.ts (cookie + ?lang)
  data/            manifest.ts, loader.ts, verify.ts (sha256 via crypto.subtle), db.ts
  library/         rows.ts (verse parse, page grouping), footnotes.ts, reader view, scan pane, sclinks.ts
  courses/         catalogue, course page, lesson page, player.ts
  search/          clean.ts, index.ts
  user/            store.ts (reading, bookmarks, lessonsOpened, settings), backup.ts, aliases.ts
  router.ts        History API routes (§4)
  legacy.ts        old website paths → new (R17)
  content/         apps.ts (R16.3); About text loaded from inputs/site-text/ at build time when supplied
  pages/           home.ts, about.ts, apps.ts, teachers-index.ts
```
Reuse from vacana-app: `manifest.ts`, `loader.ts`, `db/index.ts` — read them, copy what fits, rename the database to `study-84000`, keep its verification logic. Report what was reused.

## 3. Data flow
1. Start → render shell from precache → `loader.sync()`.
2. `sync()`: fetch both manifests with `cache: "no-store"`. For each file whose sha256 ≠ stored: fetch, check `Content-Type` contains `json`, parse, `verify.shape(file)`, compare sha256 of the raw bytes. All OK → one IndexedDB transaction writes files + new manifest. Any failure → abort, keep old, log to console, show nothing to the user unless no data exists at all.
3. Cross-tab: a Web Lock (`navigator.locks.request("study-sync")`) around `sync()`; other tabs wait, then re-read. BroadcastChannel `study-84000` tells open tabs to reload data after a successful switch.
4. Course lesson files: fetched on first open of a course, same verify path, cached in IndexedDB; re-fetched when its sha changes in the study manifest.

## 4. Routes
`/` (home, R15), `/about`, `/apps`, `/teachers/`, `/library/`, `/library/:vol`, `/library/:vol/:verse`, `/library/:vol/p/:page`, `/courses/`, `/courses/:course`, `/courses/:course/:lesson`, `/teachers/:slug`, `/p/:partner`, `/search`. Unknown route → small "not found" page with links home (the host already returns index.html). Old teacher slugs and aliased temp ids → `history.replaceState` to the new path. Old website paths (`*.html`, `#slug`) → table in R17.1, one function `legacy.ts` run before routing; it reads `location.hash` for `/instructors.html#<slug>`.

## 5. IndexedDB `study-84000` v1
| Store | Key | Value |
|---|---|---|
| `files` | file key from manifests (e.g. `vol/023`, `course/<id>`) | `{sha256, json}` |
| `manifests` | `archive` / `study` | manifest JSON |
| `reading` | `current` | `{volume, verse, page, at}` |
| `bookmarks` | auto | `{type:"verse", volume, verse}` / `{type:"lesson", course_id, lesson_id}`, `at` |
| `lessonsOpened` | `course_id` | `{lesson_id, at}` |
| `settings` | key | value |
Migrations: `onupgradeneeded` switch by `oldVersion`; never delete user stores. Backup = all user stores (not `files`) as one JSON with `{app:"study-84000", schema:1, exported_at}`.

## 6. Library
- `rows.ts`: group rows by `pali_page`; verse integer from `verse` string; "first verse row of each number" computed once per volume.
- Rendering window: IntersectionObserver on page containers; keep visible ±2 pages in DOM; position indicator "ទំព័រ N" in Khmer digits; reading position saved debounced (1 s) as volume + verse + page.
- Footnotes: regex for `(n)` with Khmer digits in `pali`/`khmer` of every row type; footnote rows parsed for leading number list `១-២-៣ …`; link by page + side + number. Unmatched marks render as plain superscript (no link).
- Scan pane: image URL = `VITE_SCANS_BASE_URL/<vol3>/<vol3>-<side>-<page3>.<ext>`; `<ext>` from config once decided. `onerror` → "not added yet" message.
- SuttaCentral: index `sc0NN.json` rows with `status === "approved"` by verse; button rendered on the sutta's title row and in the verse menu.

## 7. Courses
- Catalogue from `courses.json` only (small; always offline).
- Player: one `<div id="player">`; mounting a new lesson clears it. `acast` → `<iframe src>` as stored; `youtube` → stored embed URL; `drive` → stored preview URL. `loading="lazy"`, `allow` minimal, title attribute = lesson title. Offline (`navigator.onLine === false` or `offline` event) → "needs internet" block.
- Audio + video lessons: show video, with an "audio only" toggle that swaps to the audio embed (saves data on phones).

## 8. Search
- Library: per volume, an in-memory array of `{volume, verse, page, side, cleaned}` built on first search from stored rows (Vol 23: 1,426 rows — measure build time on a low-end phone and report). Later volumes: same per volume; a global index file is a later decision.
- Courses: cleaned titles from `courses.json` + lesson files already cached; lesson titles of uncached courses are not searched offline (state this in the UI: "lessons of courses you haven't opened are searched online"). [Alternative to decide in task 11: ship one `courses/search.json` with all lesson titles (~ size to measure).]
- `clean(s) = s.replaceAll("​","")`; NFC is not applied (data is NFC already; never normalize scripture).

## 9. Service worker
generateSW: `globPatterns` app shell + fonts + icons; `navigateFallback: index.html`; `navigateFallbackDenylist: [/^\/data\//]`; `cleanupOutdatedCaches: true`; `cacheId: "study-84000-" + build id`. Update prompt: `onNeedRefresh` → banner "update available" → `updateSW(true)`.

## 10. Scripts
- `build:courses` (Node, reads `inputs/`, writes `public/data/…` and `reports/`): parse frozen JSON; per course `class_index`; lessons with audio or video; media kind by URL host (`embed.acast.com` → acast, `youtube.com/embed` → youtube, `drive.google.com` → drive); apply YouTube fixes; IDs/slugs; flags; teachers (rename slugs, copy photos); partners; empty `aliases.json`; study-manifest sha256 of each written file; deterministic key order.
- `check:library`: reads `public/data/vol0NN.json`, `scanmap0NN.json`, `links/sc0NN.json`; writes `reports/library-issues.csv`.

## 11. Testing
- Unit: verse parse, footnote mark/list parse, clean(), slug(), manifest verify (good / wrong hash / HTML body), alias migration.
- Script tests: `build:courses` on the real inputs → expect 93 courses in source → 92 released (one course has no media), 3,749 lessons released (3,875 − 126 without media; counted 17 Oct), 39 YouTube fixes applied, 0 duplicate slugs. The script prints its own counts; any difference is reported, not adjusted.
- Phone test after each task (DEPLOY.md checks + the task's own checks).

## 12. Risks
- Third-party embeds (Acast, YouTube, Drive) may set cookies or block in some browsers → test on Android Chrome and iOS Safari in task 5.
- Drive preview video is throttled → acceptable for v1 (decision 2), R2 later.
- Search memory on low-end phones → measured in task 11.
- Dotted IDs in URLs → avoided by slug rule; test on first deploy.
