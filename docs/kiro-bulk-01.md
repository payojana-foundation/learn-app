# Kiro bulk task 01 — learn-app (Learn · ថ្នាក់សិក្សា) · 26 Oct 2026

Architect: Product Engineering chat. Names: claude/name-register.md (copy in docs/ if provided).
Rules for this whole file:
- Work on `main` only. No branches, no PRs. Commit + push after each part passes its tests.
- One commit per part (P1…P5). Touch only files the part names. After each part run
  `git diff --stat HEAD~1` and restore anything outside the part's area.
- Report first, then fix, for anything touching data. Write the full report to
  `reports/kiro-bulk-01-report.md` (untracked): per part — commit hash, files changed,
  test files run / skipped / failed, open questions.
- STOP gates: if a file, folder, tool or account named here is not as described, stop
  that part, write what you found in the report, and continue with the next part only
  if it does not depend on the stopped one.
- Never type, correct or reformat Khmer/Pāḷi titles; copy them byte-for-byte from the data files.
- Never use any `sansombucks` address. No `workers.dev` address (`workers_dev: false`).
- Test as much as you can: unit, contract, e2e with mobile emulation (360 px).
- PowerShell 5.1: one command per line, no `&&`, write long output to files.
- Secrets never go into files or logs.

Inputs already in the repo (placed by the coordinator):
- `design/learn-mockup.html` — approved direction for every screen (open it in a browser).
- `data/source/website-courses-2026-09-28.json` — frozen website catalogue
  `{c:[{titleKm,titleEn,teacher,teacherSlug,topics[],lessons:[{num,titleKm,topic,audioEmbedSrc,videoPreviewSrc}]}]}`,
  93 courses, 3,875 lessons.
- `data/source/teachers-2026-10-25/` — corrected teacher file (json, csv, photos, README).
- Proven files to copy from `C:\Users\buphk\Projects\vacana-app` (read, never edit that repo).

## P1 — Setup from vacana-app (no screens yet)
Copy and adapt (rename vacana → learn; remove Vacana-only logic):
`.kiro/steering/` (tech.md, working-style.md; new product.md from this file; protected.md
skeleton; scope-guard.md; testing.md; media.md), `vite.config.ts` (PWA, build-unique cacheId,
prompt update), `public/_headers`, `wrangler.jsonc` (assets-only, SPA fallback, name
`learn-app`, `workers_dev: false`, route `learn.84000.digital` as custom domain),
exact-pinned wrangler, `.node-version`, `scripts/run-e2e.mjs`, `scripts/verify-deploy.mjs`
(`npm run deploy-check <url>`), `scripts/data-integrity-diff.ts`, version-label component,
`src/data/manifest.ts` + `loader.ts`, `src/db/index.ts` (DB name `learn-app`),
`strings.ts` + release-check, `.gitignore` (incl. `*-report.md`, `.wrangler/`), `.kiroignore`,
`docs/STATUS.md`, `docs/DEPLOY.md`, `docs/decisions.md`, `docs/redirects.md`.
Do NOT copy: Vacana's protected.md contents, reading modes, its data contract, word-audio
module, scripture-integrity.md.
Language: `?lang=km|en` → cookie `lang_84000` (domain `.84000.digital`, Path=/, 1 year,
SameSite=Lax, Secure, try/catch) → default `km`; set `<html lang>` and `data-lang`.
Config: one file with `VITE_MEDIA_BASE_URL=https://media.84000.digital`,
`VITE_VACANA_BASE_URL=https://vacana.84000.digital`,
`VITE_LIBRARY_BASE_URL=https://library.84000.digital`. Never derive from location.
Done when: `npm run check` passes and the empty shell shows the version label.

## P2 — Media pipeline (GitHub Actions; coordinator runs it from the browser)
Spec from the audio chat (26 Oct). Auth: `google-github-actions/auth` with Workload
Identity Federation (vars `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`), `token_format:
access_token`, scope `https://www.googleapis.com/auth/drive`. No service-account keys.
R2 via rclone S3 remote from secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and var
`R2_ENDPOINT`. All jobs `workflow_dispatch` only, with input `limit` (default 1).
Job A `word-audio-upload.yml` (build first): input folder var `WORD_AUDIO_DRIVE_FOLDER`
(1NNmePYxy83xaiUSh0fW2cHpTinVIpn_6); download `word-audio_023_batch_2026-10-25_v6.zip`;
unzip keeping UTF-8 NFC names; `rclone checksum md5 MD5SUMS_023.txt 023` = 1366 match or
stop; `rclone copy 023 r2:word-audio/023 --immutable --header-upload "Cache-Control:
public, max-age=31536000, immutable" --header-upload "Content-Type: audio/mpeg"` (copy,
never sync); checksum against `r2:word-audio/023` = 1366 or fail; `curl -I` the URL-encoded
`https://audio.84000.digital/023/023.001.001-កន្ទរកោ.mp3` → 200, audio/mpeg, that
cache-control; write `r2_listing_023.txt` + run log back to the same Drive folder.
With `limit=1` do all steps for ONE file only. Re-runs skip existing keys.
Job B `course-audio.yml` (pilot only now): input `drive_file_id` (pilot:
1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT, Ven. Yon Yi, វេស្សន្តរជាតក part 1). ffprobe decides the
type (some videos are named .mp3). Stream the audio track from the Drive URL with an
Authorization header (no full video download). ffmpeg: `pan=mono|c0=0.5*c0+0.5*c1`,
two-pass `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true`, MP3 64 kbps CBR, 44.1 kHz, no noise
reduction. Key `audio/<drive_file_id>-a64.mp3` in `course-media` (immutable; never
overwrite; corrections get `-v2`). Append to `data/media-manifest.json`: drive_file_id,
key, bytes, duration_s, sha256, status `DRAFT – needs reviewer approval`. Commit the
manifest change from the job only via a PR-free push to main by the workflow token.
Put a `docs/MEDIA-PIPELINE.md` with run steps. Report GitHub's current job time limit,
runner disk and minutes for private repos from GitHub docs (link them).
Done when: workflows pass `actionlint`; scripts have unit tests with fixtures.

## P3 — Data contract + course build
Write `docs/data-contract.md` (one place). Build `scripts/build-courses.mjs`:
source json + teachers + `data/media-manifest.json` → `public/data/catalog.json`
(courses: id, title_km, title_en, teacher, topics, lesson_count, media kinds) and one file
per course `public/data/courses/<id>.json` (lessons: num, title as stored, media
{kind: r2|acast|youtube|drive, src}). IDs: provisional `c###` / `c###-l###` from source
order, flagged `"provisional": true` in catalog — they will be replaced by permanent IDs
from the teacher sheets before launch (keep an `aliases` hook). Teachers: name_km always;
name_en only if `show_english_name` starts with "yes"; bio only if
`bio_approved_by_teacher` starts with "yes"; photos copied as-is.
Checks (fail the build): duplicate lesson num in a course, empty title (report, keep as
`no title`), lesson with no media (report, hidden), teacher slug not in teacher file.
Write `reports/course-issues.csv`. Contract tests in `src/contracts/__tests__/`.

## P4 — Screens, matching design/learn-mockup.html
Home · Search · My Learning · More tab bar; course page; lesson page; teachers; teacher.
Copy behaviour from the mockup, including: Continue row (returning only), Start here
row (course ids from a config list, empty = row hidden), topic chips, course progress %
+ Start/Continue, lessons in sections of 20 with ticks, find-in-course box, Save, Share
(copies the page URL), own audio player for `r2` (resume to the second, speed
0.75/1/1.25/1.5/2, ±15 s, sleep timer 15/30/60 min, autoplay next, completed at 90% or by
button, Media Session lock-screen controls, mini player above the tab bar on other
screens), embeds for acast/youtube/drive, notes with timestamps, My Learning tabs In
progress · Saved · History · Notes, search on-device over courses/lessons/teachers with
U+200B removed and substring match, hand-off links to Vacana and Library when no
result. Paths: `/`, `/search?q=`, `/my`, `/more`, `/courses/<id>`, `/courses/<id>/<num>`,
`/teachers`, `/teachers/<slug>`; old `?teacher ?topic ?q` work on `/courses/`.
IndexedDB `learn-app`: progress, saved, history, notes, settings; Export/Import backup in More.
All interface strings in `strings.ts`, km + en; Khmer strings as in the mockup.
No scripture text anywhere. v1 = streaming only (no download button).
Write `.kiro/steering/protected.md` P-lines for every behaviour above.

## P5 — Quality pass
e2e on 320/360 px × light/dark: open course, play r2 lesson (mock audio), resume after
reload, mark complete, note at timestamp, search Khmer title, hand-off links, language
switch keeps page. Lighthouse-style checks: no horizontal scroll, focus visible.
Update `docs/STATUS.md`. Finish the report.
