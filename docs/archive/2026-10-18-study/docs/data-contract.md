# 84000.digital (Library + Courses) — data contract v0.3 (18 Oct 2026)

v0.3 change: Plan change 18 Oct 2026 (coordinator): this product becomes **84000.digital** at the domain root once approved; the static website retires then, and study.84000.digital / course.84000.digital redirect to it. Internal names stay as approved 17 Oct (repo, Worker and IndexedDB `study-84000`, spec folder `study-v1`). URLs below that said study.84000.digital now mean https://84000.digital.

Status: **draft for coordinator review.** Nothing here is code. Items marked **[PROPOSED]** need a "yes" before Kiro builds on them; items marked **[OPEN]** are not decided and the build must not guess them.
Khmer interface labels in this file are **DRAFT – needs reviewer approval**. Every teacher title stays **[VERIFY TITLE]**.

Sources read for this contract: `vol023.json`, `words023.json`, `manifest.json` (vacana-app `data/`, SHA-256 matches manifest), `scanmap023.json`, `course-data-v7-2026-09-28.json` (SHA-256 `e75b2d3b…25fe`), `teachers-v8-2026-10-16.json` + website handoff README, `youtube-broken-links-by-position.csv`, the 3 sheet exports, the 6 Vacanā steering files, `study-build-handoff.md`, `library-architecture-brief.md`, `course-chat-final-handoff.md` (16 Oct 20:15 version), SuttaCentral API (`/api/suttaplex/mn51`, `/mn61`, read 17 Oct).

---

## 0. Decisions added 17 Oct (user)

16. **English parallel in v1 = links to SuttaCentral**, sutta level, reviewer-approved only (§3.3). This replaces library brief §14(b) "English parallel not in v1". No English text is copied or hosted.
17. **D4 written permission for the Khmer translation: confirmed OK** (user, 17 Oct). Record where the signed document is filed: [OPEN — location not in our files].
18. **Proposed names approved** (user, 17 Oct, "D1 ok"): slugs §4.2/§4.5, partner ids §4.6, URL paths §5, cookie §7, R2 bucket names §8. Their [PROPOSED] tags below now read as approved; the dotted-ID slug rule is still to be confirmed on the first test deploy.
19. **Release = every lesson with audio only, video only, or both** (user, 17 Oct). Same rule for both sources.
20. **Teacher sheets "Ready ?"** (checked in Drive 17 Oct): no teacher sheet in the folder was modified after 9 Oct, so the team's new "ready" marks are not visible yet. Sor Ratha's sheet has a "Ready ?" column on tabs 1–2 (all yes) but **none on tabs 3–4**. Rule: a sheet tab without a "Ready ?" column is reported, and its lessons are not released from the sheet (the course stays on website data) until the column exists. 9 files are still .xlsx. Folder also holds a file not on the 15 Oct list: "លោកគ្រូអគ្គបណ្ឌិតប៊ុត សាវង្ស" (created 14 Sep 2026) [VERIFY TITLE] — not on the website; status unknown.
21. **YouTube fixes:** all 39 applied in study data; the team checks all 39 by hand using `youtube-fix-verification-2026-10-17.csv`; unchecked rows stay flagged in the issue report.

## 1. Rules that apply to every file

1. Scripture text (`pali`, `khmer`) and all titles (course, lesson, sutta) are copied byte-for-byte. No trimming, NFC/NFD change, zero-width removal, extension stripping or "fixes". Display code may wrap and style only.
2. `data/` archive files (`vol0NN.json`, `words0NN.json`, `manifest.json`) are uploaded by a person from vacana-app; never edited or generated in study-84000.
3. Study-owned data files (§2.2) are produced only by repo scripts from the inputs listed in each section, never typed by hand, and each script writes an issue report.
4. **SPA trap:** the Worker returns `index.html` with HTTP 200 for any missing path, including `data/*.json`. A 200 is never proof of success: the app checks JSON shape and SHA-256 from the manifest before using any file.
5. Never mix exports: download every changed file of one manifest, verify all hashes, then switch in one IndexedDB transaction.
6. User data stores only permanent references (§6). Never row `id`/`key`/`order`, never array positions.
7. Unknown values are `null` (not `""`, not a guess). The UI shows "not added yet" / hides the element — never placeholder text.

## 2. Files and manifests

### 2.1 Archive files (reused as-is from Vacanā)
| File | Contract |
|---|---|
| `data/manifest.json` | Vacanā shape, unchanged: `{generated, volumes: {"23": {text:{file,updated,sha256}, words:{…}}}}`. Volume key unpadded string. |
| `data/vol023.json` | Vacanā data-contract.md. Confirmed 17 Oct: top level `volume, exported_at, source, rows`; 1,426 rows (563 verse, 420 footnote, 386 header, 29 colophon, 28 title); `verse` is a **string** like `"[១]"` (brackets + Khmer digits), `""` on headers; `pali_page == khmer_page` on all rows; pages 1–406; `order` 1…1426 contiguous; `verified` boolean, 10 true. |
| `data/words023.json` | Vacanā contract: 5,615 words, 17,517 occurrences; `occ` verse is a number. |

Parsing rule for `verse`: strip `[` `]`, map Khmer digits ០–៩ → 0–9, parse integer. Display stays Khmer digits.

### 2.2 Study-owned files
All listed in **`data/study-manifest.json`**, same shape idea as the archive manifest:
```json
{ "generated": "ISO8601",
  "files": {
    "scanmap/023":  { "file": "scanmap023.json",        "sha256": "…" },
    "sclinks/023":  { "file": "links/sc023.json",       "sha256": "…" },
    "courses":      { "file": "courses/courses.json",   "sha256": "…" },
    "course/<id>":  { "file": "courses/c/<slug>.json",  "sha256": "…" },
    "teachers":     { "file": "teachers.json",          "sha256": "…" },
    "partners":     { "file": "partners.json",          "sha256": "…" },
    "aliases":      { "file": "aliases.json",           "sha256": "…" } } }
```
The app re-downloads only files whose SHA-256 changed. Course lesson files load on demand (one file per course), so the catalogue stays small (website inline data was 1.6 MB).

## 3. Library

### 3.1 Reader
- Data: `vol0NN.json` rows in `order`. Panes v1: retyped text + scanned printed page (both always shown; scan is proof, it does not remove the unverified label).
- Unverified label **មិនទាន់ផ្ទៀងផ្ទាត់** on every row where `verified !== true`.
- Footnote linking, U+200B/`\n` handling, verse-number display: Vacanā data-contract.md and tech.md, unchanged.

### 3.2 `scanmap0NN.json`
```json
{ "volume": 23, "source_pdf": "Bedok No.023.pdf",
  "rule": "Pali page n = PDF page 2n+2; Khmer page n = PDF page 2n+3",
  "pages": { "1": { "pali_pdf": 4, "khmer_pdf": 5, "pali_drive": "<id>", "khmer_drive": "<id>" } } }
```
- Vol 23 file received: 406 pages, all with both Drive ids. The `pali_img` / `khmer_img` fields (19 pages, `/_blob/…`) are temporary planning-chat paths: **dropped**, never used.
- The app never loads scans from Drive (throttling, no CORS). Drive ids are input for the R2 upload script only. App URL = `VITE_SCANS_BASE_URL` + R2 key (§8).

### 3.3 SuttaCentral links (decision 16) — `data/links/sc0NN.json`
```json
{ "volume": 23, "status": "…",
  "links": [ { "volume": 23, "verse_from": 1, "verse_to": 17, "title_row_page": 1,
               "edition_title_pali": "<copied from vol023.json title row>",
               "edition_title_khmer": "<copied from vol023.json title row>",
               "sc_uid": "mn51",
               "status": "proposed | approved",
               "approved_by": null, "approved_date": null } ] }
```
- **Link out:** `https://suttacentral.net/<sc_uid>` (SuttaCentral's sutta card, which lists every translation; we do not pick a translator). Base URL in one config value `VITE_SC_BASE_URL`.
- Shown on the sutta's title row and in the verse menu for every verse in `verse_from…verse_to`, **only when `status = "approved"`**. Label (DRAFT – needs reviewer approval): "English · SuttaCentral ↗". Opens in a new tab; offline: hidden or greyed with "needs internet".
- Sutta level only in v1. Segment-level deep links (SuttaCentral's `mn51:3.1` style) need a verse ↔ segment table: not v1.
- **Vol 23 draft attached:** `sc023.proposed.json` — 20 suttas, verse ranges computed from the title rows (Gahapativagga v1–123 → mn51–60; Bhikkhuvagga v125–238 → mn61–70; ranges stop before each vagga uddāna, v124 and v239). The uid is assigned **by position**; a reviewer must confirm each one on suttacentral.net. Known naming difference to check: the edition titles verse 125 ចូឡរាហុលោវាទសុត្តំ, while SuttaCentral names mn61 "Ambalaṭṭhikarāhulovādasutta".
- **Link in (SuttaCentral → us):** not under our control. Needs a request to SuttaCentral; whether they accept: Not in our files. Our side is ready once URLs are stable: `84000.digital/library/23/56` (§5).
- Generalises later to other volumes and to commentaries via the same link-table idea (library brief §3).

## 4. Courses

### 4.1 Source per course
- `source = "website-2026-09-28"`: from `course-data-v7-2026-09-28.json`. Release rule for these: lesson has audio or video; no "Ready ?" field exists in this file.
- `source = "sheet:<file name>"`: after the teacher sheet is converted and read. Release rule: "Ready ?" equals `yes` case-insensitively (other values → issue report) **and** audio or video present.
- Hide no-media lessons; hide courses with zero released lessons. Every sheet-vs-JSON difference → `reports/course-differences.csv`. Never silent overwrite.

### 4.2 IDs (decision 4)
| | Permanent (sheet read) | Temporary (website JSON) |
|---|---|---|
| Course | course-level code without leading A/V, e.g. `ENGST00001` | `TMP-C<class_index 3 digits>`, e.g. `TMP-C090` |
| Lesson | lesson code without leading A/V, e.g. `ENGST0000101` | `TMP-C090-L<position 4 digits>`, e.g. `TMP-C090-L0001` |

- Temporary IDs are stable because the website JSON is frozen (array position never changes). `id_status: "temporary" | "permanent"`.
- When a course switches to its sheet, the build writes `aliases.json` `{ "TMP-C090-L0001": "…permanent id…" }`; the app rewrites stored references on update. Old URLs keep working through the same table.
- Duplicate permanent codes (known: `AABH000VS2025.5027`) → build fails for that course and reports; no automatic renaming.
- **URL slug** = ID lowercased, `.` replaced by `-` (e.g. `ABH000VS2022.1001` → `abh000vs2022-1001`). Build checks every slug is unique. [PROPOSED — avoids dotted paths being treated as files by the static host; confirm on first test deploy.]

### 4.3 `courses/courses.json` (catalogue, always offline)
```json
{ "generated": "ISO8601", "source_sha256": "…",
  "topics": [ { "id": "sutta", "label_km": "ព្រះសូត្រ", "label_en": "Suttas" } ],
  "courses": [ {
    "id": "TMP-C090", "id_status": "temporary", "slug": "tmp-c090",
    "title_km": "<verbatim>", "title_en": null,
    "teacher": "yon-yi", "owner": "abhidhamma-daily-life",
    "topics": ["sutta"], "released_lessons": 11,
    "has_audio": true, "has_video": true,
    "download_allowed": false,
    "source": "website-2026-09-28", "class_index": 90 } ] }
```
- `title_en` = `null` when the website `titleEn` equals `titleKm` (71 courses). English mode then shows the Khmer title marked `lang="km"` — never a machine translation.
- Topic labels copied from the 9 Oct brief table (10 ids; `reference` unused).
- `owner`: partner id from §4.6, or `"payojana"` only once confirmed; `null` = not confirmed.
- `download_allowed`: `false` for every partner course (decision: streaming only until written permission). For Payojana's own courses: **[OPEN]** — default `false` until decided.

### 4.4 `courses/c/<slug>.json` (lessons, loaded on demand)
```json
{ "course": "TMP-C090",
  "lessons": [ {
    "id": "TMP-C090-L0001", "id_status": "temporary", "slug": "tmp-c090-l0001",
    "position": 1, "num": 1,
    "title_km": "<verbatim, file extensions kept>",
    "topic": null,
    "audio": { "kind": "acast", "src": "https://embed.acast.com/…" },
    "video": { "kind": "youtube", "src": "https://www.youtube.com/embed/…" },
    "flags": [] } ] }
```
- `position` = display order (array order); `num` = as stored (3 courses have duplicates — shown as stored, not renumbered).
- `audio.kind`: `acast` (2,188 in JSON) | `drive` (887) | later `r2`. `video.kind`: `youtube` (1,521) | `drive` (465) | later `r2`. Absent media = `null`.
- `flags` (shown only in the issue report, not to learners): `youtube-fixed`, `youtube-fixed-position-only` (the 7), `youtube-unchecked`, `media-reused` (10 links × 20 lessons), `duplicate-num`, `title-has-extension` (778).
- v1 media need internet (embeds). Offline lessons only after the R2 move.

### 4.5 `teachers.json`
Copied from `teachers-v8-2026-10-16.json` field by field (`order, name_km, name_en, bio_km, bio_en, topics, title_status, bio_approved_by_teacher`), plus:
```json
{ "slug": "hun-khamra", "slug_aliases": ["hun-khemara"], "photo": "teachers/hun-khamra.jpg",
  "ask_teacher_url": null }
```
- Slug changes [PROPOSED, decision 11]: `hun-khemara → hun-khamra`, `sok-heng → mam-sokheng`. Photo files are copied to the new name at build; source files untouched.
- Bios shown only where `bio_approved_by_teacher` starts with `yes` (today: Vinh Sovoeurng only). Others: name and photo only. [PROPOSED — matches SOP-001; confirm.]
- `ask_teacher_url`: none collected; button hidden while `null`.
- Leng Sideoun: no photo → no image, no placeholder face.

### 4.6 `partners.json` [PROPOSED ids]
```json
[ { "id": "abhidhamma-daily-life", "name_km": "គម្រោងព្រះអភិធម្មក្នុងជីវិតប្រចាំថ្ងៃ",
    "name_en": "Abhidhamma for Daily Life Project", "teachers": ["yon-yi"],
    "site": null, "redirect_domain": null, "download_permission": "none" },
  { "id": "dhammika-life", "name_km": "មូលនិធិធម្មិកជីវិត", "name_en": "Dhammika Life Foundation",
    "teachers": ["sok-theavy"], "site": "https://dhammikalife.org", "redirect_domain": null,
    "download_permission": "none" } ]
```
- Names copied from course-chat handoff §10. Hun Khamra's partner: name not in our files → no entry until named. Vipassana Dhurak Center: courses not in our files → no entry. Partner page = `/p/<id>`.

## 5. URL paths [PROPOSED]
| Path | Page |
|---|---|
| `/` | Home: both sections + search |
| `/library/` | Volume list |
| `/library/23` | Volume 23, from verse 1 |
| `/library/23/56` | Volume 23, verse 56 (permanent, citable) |
| `/library/23/p/83` | Volume 23, printed page 83 |
| `/courses/` | Catalogue; keeps website params `?topic=<id>`, `?teacher=<slug>`, `?q=<text>` |
| `/courses/<course-slug>` | Course |
| `/courses/<course-slug>/<lesson-slug>` | Lesson |
| `/teachers/<slug>` | Teacher page (old slugs redirect) |
| `/p/<partner-id>` | Partner page |
| `/search?q=` | Search across both sections |
- Numbers in URLs are ASCII digits, volumes unpadded. Any `?lang=km|en` is accepted on every path.
- Old website links `classes.html?topic=|teacher=|q=` → `/courses/?…` with the same params (website chat implements).
- course.84000.digital (Mini Course Generator): out of scope for this build (user, 17 Oct). Handled separately at the switch.

## 6. User data on the device
- IndexedDB database name **`study-84000`** (unique on the origin). Schema version 1. Export/backup button (JSON file).
- Stores: `reading` `{volume, verse, page}` · `bookmarks` `{type:"verse", volume, verse}` or `{type:"lesson", lesson_id}` · `lessonsOpened` `{course_id, lesson_id, opened_at}` (resume = last lesson opened) · `settings` `{pali_font, …}`.
- Temporary lesson IDs are allowed in user data only because `aliases.json` migrates them (§4.2).

## 7. Language cookie [PROPOSED — website chat to adopt the same]
| Attribute | Value |
|---|---|
| Name | `lang_84000` |
| Value | `km` or `en` |
| Domain | `.84000.digital` (omit on `*.workers.dev` previews: host-only) |
| Path | `/` |
| Max-Age | `31536000` (1 year) |
| SameSite / Secure | `Lax` / yes |
| HttpOnly | no (read by page script) |
- Order: `?lang=` in the URL → cookie → default `km`. A `?lang=` value is written to the cookie.
- On load set both `data-lang` and `<html lang>`; wrap cookie access in try/catch (fixes website v8 issues 1–2).

## 8. R2 storage [PROPOSED names]
| Bucket | Access | Key pattern |
|---|---|---|
| `study-scans` | public read | `<vol3>/<vol3>-<side>-<page3>.<ext>` e.g. `023/023-pali-083.webp`; side = `pali` \| `khmer` |
| `study-media` | public read | `<course-slug>/<lesson-slug>/<rendition>.<ext>` |
| `study-originals` | private, Infrequent Access | `<teacher-slug>/<course-slug>/<lesson-slug>-original.<original ext>` |
- Keys are immutable: never overwrite; a corrected file gets a new key (`-v2`) and the data file points to it.
- Image format/size for scans and rendition names for media: **[OPEN]** until the 10-video test encode and a scan conversion test.
- Base addresses: one config value each (`VITE_SCANS_BASE_URL`, `VITE_MEDIA_BASE_URL`, set in Cloudflare Builds → Variables); custom domain [OPEN] (DNS chat).
- CORS rule allowing `https://84000.digital` (and the preview origin) is required for offline caching — state it, don't assume it.
- Word audio (`vacana-audio`): not used in study until the audio chat confirms permission and CORS.

## 9. Issue reports (repo `reports/`, never shipped)
`course-issues.csv`: `course_id, lesson_id, class_index, position, issue, detail, source_file`. Issues: no-media (hidden), youtube-fixed-unchecked, media-reused, duplicate-num, title-has-extension, titleEn-equals-titleKm, ready-value-not-yes, duplicate-code, sheet-json-difference.
`library-issues.csv`: footnote mark without footnote / footnote without mark, stray CR (Vol 23 p38 v23 khmer), sc-link proposed-not-approved.

## 10. Open items this contract depends on
1. Bio rule (§4.5): show only teacher-approved bios — not yet answered.
2. Reviewer check of the 20 SuttaCentral uids (`sc023.proposed.json`).
3. Download rule for Payojana's own courses.
4. Scan image format; media renditions (test encode).
5. Media/scan custom domain (DNS chat).
7. Team's "Ready ?" marks in the sheets; .xlsx conversion; the extra sheet (decision 20).

## Messages to send (drafts)
**To website chat (superseded 18 Oct — the app replaces the website; old addresses handled per requirements R17):** "study.84000.digital paths (proposed): /courses/?topic=|teacher=|q= keeps your params; /teachers/<slug> with new slugs hun-khamra and mam-sokheng (old slugs redirect); language cookie lang_84000=km|en on .84000.digital, Path=/, 1 year, SameSite=Lax, Secure — please adopt instead of localStorage 84000-lang, and add ?lang= on links to study. Final after coordinator approval."
**To DNS chat (superseded 18 Oct — launch = switch 84000.digital to Worker study-84000; study. and course. redirect to 84000.digital):** "No study DNS record until launch. At launch: study.84000.digital → Worker study-84000 (name proposed). Later: course.84000.digital page-to-page redirects (302 → 301 after approval, 2-week notice) — list follows once the MCG URL pattern arrives. Possible media/scan subdomain — not decided."
