---
inclusion: always
---

# Data contract (summary)

The full contract is `docs/data-contract.md`. Read it before any work on data, URLs, storage or media:
#[[file:docs/data-contract.md]]

If a data file disagrees with the contract, stop and report the difference. Do not adapt silently.

## Facts confirmed from the files (17 Oct 2026)
- `data/vol023.json`: top level `volume, exported_at, source, rows`; 1,426 rows; types `verse` 563, `footnote` 420, `header` 386, `colophon` 29, `title` 28; `verse` is a string like `"[១]"` (brackets + Khmer digits), `""` on headers; `pali_page == khmer_page`; pages 1–406; `order` contiguous 1…1426; `verified` boolean, 10 true.
- `data/words023.json`: 5,615 words, 17,517 occurrences; `occ` verse is a number.
- `data/manifest.json`: SHA-256 of both files match.
- `data/scanmap023.json`: 406 pages with Pāḷi and Khmer Drive ids; ignore any `pali_img`/`khmer_img` fields.
- Course source `course-data-v7-2026-09-28.json`: 93 courses, 3,875 lessons; lesson fields `num, titleKm, topic, audioEmbedSrc, videoPreviewSrc`; audio: Acast 2,188 / Drive 887 / none 800; video: YouTube 1,521 / Drive 465 / none 1,889; 71 courses have `titleEn == titleKm`.

## Rules to remember
- Parse `verse`: strip `[` `]`, Khmer digits → ASCII, integer. Display in Khmer digits.
- IDs: permanent = sheet code without leading A/V; temporary = `TMP-C<3-digit class_index>` / `TMP-C…-L<4-digit position>`. URL slug = ID lowercased, `.` → `-`; build fails on any duplicate.
- Unknown values are `null`. UI hides or says "not added yet".
- Every generator script writes its issue report to `reports/` (not deployed).
