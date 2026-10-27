# Requirements — 84000.digital v1 (Library + Courses + site pages)

Source of truth for data shapes: `docs/data-contract.md` (v0.2). Rules: `.kiro/steering/*`. Khmer UI strings are DRAFT – needs reviewer approval. "The app" = the PWA that will run at the root of https://84000.digital/ (preview: workers.dev). Plan change 18 Oct 2026 (coordinator): this product becomes **84000.digital** at the domain root once approved; the static website retires then, and study.84000.digital / course.84000.digital redirect to it. Internal names stay as approved 17 Oct (repo, Worker and IndexedDB `study-84000`, spec folder `study-v1`).

## R1 App shell and language
1.1 THE app SHALL show a header (leaf → `/`; links បណ្ណាល័យ · Library, ថ្នាក់សិក្សា · Courses, គ្រូបង្រៀន · Teachers, អំពីយើង · About, Apps [Khmer label: take from website v8 text when supplied; until then mark it in the strings file as missing]; search box; ខ្មែរ / EN switch) and a footer (© line as on the website, "84000.Digital", 3 px leaf-orange top line) on every page.
1.2 WHEN no language is chosen THE app SHALL display Khmer. Order: `?lang=` → cookie `lang_84000` → old website key `localStorage["84000-lang"]` (read once, inside try/catch; if valid, write the cookie) → `km`.
1.3 WHEN the URL has `?lang=km` or `?lang=en` THE app SHALL use it and write the `lang_84000` cookie (attributes per contract §7; no `Domain` on workers.dev).
1.4 WHEN the user switches language THE app SHALL switch every interface string without reload, set `<html lang>` and `data-lang`, and write the cookie.
1.5 IF cookie access throws THEN THE app SHALL continue in the default language without error.
1.6 THE app SHALL never show both languages stacked for interface strings; scripture and stored titles are shown as stored regardless of language.
1.7 THE layout SHALL have no horizontal scroll at 320 px width and content width ≤ 760 px.

## R2 Data loading and updates
2.1 WHEN the app starts online THE app SHALL fetch `data/manifest.json` and `data/study-manifest.json` without cache.
2.2 WHEN a listed file's SHA-256 differs from the stored copy THE app SHALL download it, verify its SHA-256 and JSON shape, and only after all changed files of that manifest verify, replace them in one IndexedDB transaction.
2.3 IF any file fails (HTTP error, wrong Content-Type, HTML instead of JSON, shape or hash mismatch) THEN THE app SHALL keep the previous data and show no partial update.
2.4 WHEN offline THE app SHALL use the stored data.
2.5 WHEN two tabs update at the same time THE app SHALL end with one consistent data set (no mixed files).

## R3 Library reader
3.1 THE Library SHALL list available volumes (v1: Volume 23).
3.2 THE reader SHALL show rows in `order`, Pāḷi then Khmer per verse, with `title` centered/large, `colophon` centered/small, `header` as running header, footnotes per page.
3.3 THE reader SHALL show the verse number [n] in Khmer digits only on the first `verse` row of each verse number.
3.4 WHEN a row's `verified` is not `true` THE reader SHALL show the badge មិនទាន់ផ្ទៀងផ្ទាត់ and tinted background (light and dark).
3.5 THE reader SHALL keep U+200B and `\n`, and never alter characters.
3.6 THE reader SHALL show footnote marks (n) as superscript linked to the footnote on the same page and side by printed number (multi-number footnotes parsed as a list).
3.7 THE URLs `/library/23`, `/library/23/<verse>` and `/library/23/p/<page>` SHALL open at that place.
3.8 THE reader SHALL render only the visible printed page ±2.
3.9 THE reader SHALL offer Pāḷi font Moulpali (default) ⇄ Battambang; Khmer translation in Metal.

## R4 Scans
4.1 THE reader SHALL show the scanned Pāḷi and Khmer printed page for the page in view (stacked on phones, beside the text on wide screens).
4.2 WHILE scans are not on R2 (`VITE_SCANS_BASE_URL` unset or image fails) THE scan pane SHALL say the page image is not added yet; never a broken image.
4.3 THE app SHALL never load scans from Google Drive.

## R5 SuttaCentral links
5.1 WHEN a sutta has an `approved` row in `data/links/sc0NN.json` THE reader SHALL show "English · SuttaCentral ↗" on its title row and in the verse menu of each verse in range, opening `VITE_SC_BASE_URL/<sc_uid>` in a new tab.
5.2 IF the row is `proposed` THEN THE app SHALL show nothing.
5.3 WHEN offline THE link SHALL be shown disabled with "needs internet".

## R6 Search
6.1 THE search box SHALL search Library text (Pāḷi and Khmer) and Courses (course and lesson titles) on the device, online and offline.
6.2 THE search SHALL compare cleaned copies (U+200B removed) and display originals unchanged.
6.3 THE results SHALL be ranked exact → starts-with → contains, grouped by section.
6.4 Library results SHALL link to the verse and show its printed page.
6.5 Queries shorter than 2 characters SHALL not search (measure and report on real data).
6.6 `/search?q=` SHALL open with results.
6.7 Khmer has no spaces between words: search SHALL match a query anywhere inside a title or row (substring on the cleaned copy, no word splitting). Before launch, test on real course and lesson titles and Vol 23 text: a list of at least 20 real queries, expected hits, actual hits, misses explained — committed as `reports/search-test-khmer.csv`. Misses are reported, never hidden.

## R7 Courses catalogue
7.1 THE catalogue SHALL list every course in `courses.json` (only courses with ≥1 released lesson exist there).
7.2 THE catalogue SHALL filter by topic and by teacher, and accept `?topic=`, `?teacher=`, `?q=` (old slugs `hun-khemara`, `sok-heng` accepted).
7.3 WHEN `title_en` is `null` and language is EN THE app SHALL show the Khmer title marked `lang="km"`.
7.4 Each course card SHALL show title, teacher, lesson count, and audio/video availability.

## R8 Course and lesson pages
8.1 `/courses/<course-slug>` SHALL list lessons in `position` order with `num` and title as stored.
8.2 `/courses/<course-slug>/<lesson-slug>` SHALL show the lesson player for exactly the media present: audio + video, audio only, or video only.
8.3 THE app SHALL mount only one lesson player at a time.
8.4 WHEN offline THE player area SHALL show "needs internet" instead of an embed.
8.5 THE app SHALL show no download button in v1.
8.6 WHEN a lesson page opens THE app SHALL record it as the course's last opened lesson; the course page SHALL offer "continue" to it.
8.7 WHEN an old temporary lesson URL is in `aliases.json` THE app SHALL redirect to the new URL.

## R9 Teachers and partners
9.1 `/teachers/<slug>` SHALL show name (as stored), photo if present, and the teacher's courses; old slugs redirect.
9.2 THE bio SHALL be shown only if approved by the teacher (pending user decision; until decided: implement behind one config flag, default = approved-only).
9.3 `/p/<partner-id>` SHALL show the partner name and its teachers' courses.
9.4 "Ask the teacher" SHALL appear only when `ask_teacher_url` is not null.

## R10 User data
10.1 THE app SHALL store reading position, bookmarks (verse or lesson), last opened lesson per course, and settings in IndexedDB `study-84000`, schema v1.
10.2 THE app SHALL store only volume + verse (+ page), course id, lesson id.
10.3 THE app SHALL provide Export (download JSON) and Import (restore, with confirmation).
10.4 WHEN `aliases.json` maps a stored temporary id THE app SHALL rewrite it once, in a transaction.
10.5 Continue Reading SHALL return to the last verse read.

## R11 Offline and updates
11.1 THE app shell, fonts and icons SHALL work offline after the first visit.
11.2 WHEN a new version is deployed THE app SHALL show an "update available" prompt; the new version loads only after the user taps it.
11.3 Old service-worker caches SHALL be deleted after an update.
11.4 Data files, scans and media SHALL not be precached.

## R12 Course data build (script, not shipped)
12.1 `npm run build:courses` SHALL read `inputs/course-data-v7-2026-09-28.json` (SHA-256 checked), `inputs/youtube-broken-links-by-position.csv`, `inputs/teachers-v8-2026-10-16.json`, and write the course files, `teachers.json`, `partners.json`, `aliases.json`, and update `study-manifest.json`.
12.2 THE script SHALL release every lesson with audio, video or both; drop lessons with neither and courses with none.
12.3 THE script SHALL apply the 39 YouTube fixes by class_index + lesson number only when the stored link equals `broken_link`, and flag the 7 one-character cases.
12.4 THE script SHALL assign temporary IDs and slugs per contract §4.2 and fail on any duplicate slug.
12.5 THE script SHALL copy titles and names byte-for-byte.
12.6 THE script SHALL write `reports/course-issues.csv` (issues listed in contract §9) and print counts.
12.7 Running it twice on the same inputs SHALL produce identical output.

## R13 Library data checks (script, not shipped)
13.1 `npm run check:library` SHALL write `reports/library-issues.csv`: footnote marks without footnotes, footnotes without marks (all row types scanned), stray CR, SuttaCentral rows not approved, verse ranges overlapping or outside the volume.
13.2 THE script SHALL never modify `data/`.

## R15 Home page `/`
15.1 THE first screen SHALL show the tagline ផ្សព្វផ្សាយ និងចែករំលែកព្រះពុទ្ធោវាទ (km) / Sharing the Buddha's Teaching (en) — text exactly as given by the coordinator 18 Oct; one search box (Library + Courses, same as R6); two buttons បណ្ណាល័យ · Library → `/library/` and ថ្នាក់សិក្សា · Courses → `/courses/`.
15.2 Below SHALL be: Teachers (from `teachers.json` in `order`, each → `/teachers/<slug>`; photo or nothing), then Podcast links: Acast https://shows.acast.com/dhamma, Spotify https://open.spotify.com/show/6ao38KeXsgHTGRobP5VDJE, Soundwise https://mysoundwise.com/soundcasts/1740185697645s (website handoff §3), opening in a new tab.
15.3 At the bottom SHALL be: Apps (from the apps list, R16.3), a link to About, then the footer.
15.4 WHILE search is not built (before task 11) THE search box SHALL be hidden, not faked.

## R16 Site pages
16.1 `/about` SHALL show the About text from the current website (v8), copied byte-for-byte, both languages. Until the text is in `inputs/site-text/`, the page says "not added yet".
16.2 `/teachers/` SHALL list all teachers (same data as R9); `/teachers/<slug>` per R9.
16.3 `/apps` SHALL list apps from one file `src/content/apps.ts` (`name_km`, `name_en`, `url`, `status`); entries come only from the user / website chat. Empty list → "not added yet". No invented app names or links.

## R17 Old website addresses keep working
17.1 THE app SHALL map these old paths, keeping `?lang=` and the other query parameters, with `history.replaceState` (client side; the host already serves index.html for unknown paths):
| Old | New |
|---|---|
| `/index.html` | `/` |
| `/classes.html?teacher=&topic=&q=` | `/courses/?teacher=&topic=&q=` (old teacher slugs accepted, R7.2) |
| `/instructors.html` and `/instructors.html#<slug>` | `/teachers/` and `/teachers/<new-slug>` (the `#slug` never reaches the server, so this must be done in the page; old slugs mapped) |
| `/about.html` | `/about` |
| `/apps.html` | `/apps` |
| `/other-work.html` (page deleted) | `/` |
17.2 THE service worker's navigation fallback SHALL also serve these paths (so they work offline).
17.3 Unit tests SHALL cover every row of 17.1, including a hash slug and an old teacher slug.
17.4 The final list of old → new addresses SHALL be written to `docs/redirects.md` for the website and DNS chats (server 301s, if wanted, are decided at launch with the DNS chat).

## R14 Quality
14.1 `h-dvh`, never `h-screen`; no `select-none` on scripture or titles.
14.2 All interactive elements reachable by keyboard; focus ring 2 px `#7F0204`.
14.3 Contrast of text on cream meets WCAG AA.
14.4 Unit tests cover: verse parsing, footnote parsing, cleaned-copy search, ID/slug generation, manifest verification. Tests use placeholder strings, never real verse text.
