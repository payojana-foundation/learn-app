# Tasks — 84000.digital v1 (Library + Courses + site pages)

Plan change 18 Oct 2026 (coordinator): this product becomes **84000.digital** at the domain root once approved; the static website retires then, and study.84000.digital / course.84000.digital redirect to it. Internal names stay as approved 17 Oct (repo, Worker and IndexedDB `study-84000`, spec folder `study-v1`).

One task per Kiro session. After each: run tests, commit and push to main, wait for the Cloudflare build, do the phone test, then tell Kiro "next". Each task ends with What changed · How to test · How to undo. Requirement numbers refer to `requirements.md`.

- [ ] 1. Project skeleton and first deploy
  - Read vacana-app `package.json`, `vite.config.*`, `src/` structure; report the stack and what will be reused. Create the same toolchain here; bundle fonts; brand tokens in Tailwind config; header/footer; i18n strings files; language cookie + `?lang` (R1); router with placeholder pages ("not added yet") for every route in design §4; home page `/` per R15 (tagline, Library/Courses buttons, podcast links, footer; Teachers and Apps sections show "not added yet"; search box hidden, R15.4); old-address mapping `legacy.ts` + unit tests (R17); `wrangler.jsonc`, `.node-version`, `public/_headers`; pinned wrangler.
  - User: DEPLOY.md steps A–C.
  - Phone test: preview opens on the home page; ខ្មែរ/EN switch works and survives reload; `?lang=en` works; `/classes.html?teacher=hun-khemara` lands on `/courses/?teacher=…`; `/instructors.html#sok-heng` lands on `/teachers/mam-sokheng`; `/other-work.html` lands on `/`; no horizontal scroll at phone width.
  - _R1, R14.1, R15, R17_

- [ ] 2. Data loader, manifests, IndexedDB
  - User copies `vol023.json`, `words023.json`, `manifest.json` from vacana-app `data/` into `public/data/` (GitHub upload, click-by-click), plus `scanmap023.json` without `*_img` fields (Kiro writes a one-off script that removes only those fields and reports the count).
  - Reuse vacana-app manifest/loader/db logic; DB `study-84000` v1 (design §5); Web Lock + BroadcastChannel; HTML-instead-of-JSON detection. Unit tests for verify (good, wrong hash, HTML body).
  - Phone test: Library page shows "Volume 23 · 1,426 rows loaded"; airplane mode → reload → still loaded.
  - _R2_

- [ ] 3. Course data build script
  - Put inputs in `inputs/` (user uploads `course-data-v7-2026-09-28.json`, `youtube-broken-links-by-position.csv`, `teachers-v8-2026-10-16.json`, teacher photos). Implement `npm run build:courses` (design §10). Commit outputs and `reports/course-issues.csv`.
  - Test: counts as in design §11; running twice gives no git diff.
  - Phone test: none (data only); user opens `reports/course-issues.csv` on GitHub and checks it reads sensibly.
  - _R12_

- [ ] 4. Courses catalogue
  - `/courses/` with topic and teacher filters, `?topic= ?teacher= ?q=`, old slugs; cards (R7.4); `title_en` null rule.
  - Phone test: filter by a topic, by a teacher; open `/courses/?teacher=hun-khemara` → Hun Khamra's courses.
  - _R7_

- [ ] 5. Course page and lesson player
  - Course page (R8.1, 8.6 continue); lesson page player for 3 states; one player mounted; audio-only toggle; offline message; no download button.
  - Phone test on Android Chrome and iOS Safari if available: one Acast-only lesson, one YouTube lesson, one Drive video lesson, one of the 7 fixed YouTube lessons; open lesson A then B → A stops.
  - _R8_

- [ ] 6. Teacher and partner pages
  - `/teachers/<slug>`, `/p/<partner>`; bio flag (approved-only default); photo or nothing; Ask-the-teacher hidden while null.
  - Also `/teachers/` index and the home page Teachers section (R15.2, R16.2). Needs the corrected teacher file (18 Oct names) from the website chat — ask before task 3, which writes `teachers.json`.
  - Phone test: Vinh Sovoeurng shows bio; Leng Sideoun shows no photo and no broken image; `/teachers/sok-heng` redirects; home page lists teachers in order.
  - _R9, R15.2, R16.2_

- [ ] 6a. About and Apps pages
  - User puts the About text (from the website chat) in `inputs/site-text/` and gives the apps list. `/about`, `/apps`, home Apps section (R16.1, R16.3). Text copied byte-for-byte.
  - Phone test: both languages, no stacked text, links open.
  - _R16_

- [ ] 7. Library reader — text
  - Reader for Vol 23 (R3.1–3.6, 3.8, 3.9): page grouping, verse numbers, unverified label, footnotes, render window, font toggle, URLs `/library/23`, `/library/23/<verse>`, `/library/23/p/<page>`. Unit tests for verse and footnote parsing (placeholder strings).
  - Phone test: open `/library/23/56` → verse ៥៦ at top; a verified row has no badge, an unverified row has it; tap a footnote mark.
  - _R3_

- [ ] 8. Library reader — scan pane
  - Scan pane per design §6; "not added yet" while no base URL; stacked on phone, side by side on wide screens.
  - Phone test: scan pane shows the "not added yet" message, no broken image; layout correct portrait and landscape.
  - _R4_

- [ ] 9. Library checks script
  - `npm run check:library` (R13). Commit `reports/library-issues.csv`. Expected from Vacanā: footnote marks 384 Pāḷi + 63 Khmer in verse rows + 4 Pāḷi in colophons; 1 stray CR (p38). Report differences, don't adjust.
  - _R13_

- [ ] 10. SuttaCentral links
  - User uploads `public/data/links/sc023.json` (from `sc023.proposed.json`, statuses as the reviewer set them). Implement R5. Test with a fixture file in tests (placeholder titles), not by changing the real file.
  - Phone test: with all rows `proposed`, no link appears; reviewer-approved rows (if any) open suttacentral.net in a new tab.
  - _R5_

- [ ] 11. Search
  - Header search box + `/search` (R6). Measure index build time and memory for Vol 23 on the phone and report. Decide with the user: lesson titles of unopened courses (design §8 alternative).
  - Show the home-page search box (R15.1). Khmer real-title test (R6.7) → `reports/search-test-khmer.csv`.
  - Phone test: search a word from a verse you can see → result opens that verse; search part of a Khmer course title (no spaces) → course found; airplane mode → search still works.
  - _R6, R15.1_

- [ ] 12. User data
  - Continue Reading, bookmarks (verse, lesson), last opened lesson, Export/Import backup, alias migration (R10).
  - Phone test: read to a verse, close the app, reopen → continue there; export, clear site data, import → bookmarks back.
  - _R10_

- [ ] 13. Offline and update prompt
  - SW config (design §9), update banner, old-cache cleanup check.
  - Phone test: deploy a trivial change → banner appears → tap → new version; airplane mode → app opens.
  - _R11_

- [ ] 14. Quality pass
  - Keyboard, focus ring, contrast, 320 px width, dark mode label tint, `h-dvh`, no `select-none`. Fix list, then user review of Khmer strings with the coordinator.
  - _R14_

## Blocked until a decision
- [ ] 15. Scans to R2 — needs scan image format/size decision and R2 bucket + public address (DNS chat). Then: a script the user runs on their computer that reads Drive ids from `scanmap023.json`, converts, and uploads with wrangler to `study-scans`; CORS rule; set `VITE_SCANS_BASE_URL`.
- [ ] 16. Courses switch to teacher sheets — needs the team's "Ready ?" marks (column missing on some tabs) and the permanent-ID rule applied per sheet; writes `aliases.json` and `reports/course-differences.csv`.
- [ ] 17. Launch (switch 84000.digital to this app) — coordinator approval; Khmer strings review; Khmer search test passed (R6.7); `docs/redirects.md` sent to website and DNS chats; DNS chat plans the switch from the current static site to this Worker (DEPLOY.md E) and the study./course. redirects; custom domain via `routes` in wrangler.jsonc only; after the switch, test every old address in R17.1 on the live domain.
