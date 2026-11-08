# STATUS — learn-app

Running status of the build. Updated at the end of each part.

## P1 — Setup from vacana-app ✅ (this commit)
- Toolchain copied/adapted from vacana-app: Vite + Tailwind v4 + vite-plugin-pwa
  (prompt update, build-unique `cacheId` = `learn-<hash>`), pinned devDeps
  (wrangler 4.151.1, vite 8.3.2, vite-plugin-pwa 2.0.0, vitest 5.0.3, tailwind
  4.3.3), `.node-version` 24.21.0.
- Hosting: `wrangler.jsonc` assets-only, SPA fallback, name `learn-app`,
  `workers_dev: false`, custom-domain route `learn.84000.digital`.
  `public/_headers` no-cache for shell + data.
- App shell: `index.html` + `src/main.ts` render the tab bar (Home · Search · My
  Learning · More) and the version label; service worker registered with the
  prompt update.
- Language: `src/lang.ts` — `?lang=km|en` → cookie `lang_84000` → `km`; sets
  `<html lang>` + `data-lang`.
- Config: `src/config.ts` — `VITE_MEDIA_BASE_URL`, `VITE_VACANA_BASE_URL`,
  `VITE_LIBRARY_BASE_URL`; never derived from location. DB name `learn-app`.
- Data layer: `src/data/manifest.ts` + `loader.ts` (hash-verify, SPA-200 guard);
  `src/db/index.ts` (IndexedDB `learn-app`, stores progress/saved/history/notes/
  settings/files/dataHashes).
- Strings: `src/strings.ts` (km + en) + `scripts/check-verify.ts` release gate.
- Scripts: `run-e2e.mjs`, `verify-deploy.mjs` (`npm run deploy-check <url>`),
  `data-integrity-diff.ts`.
- Steering: product.md, tech.md, working-style.md, media.md, testing.md,
  scope-guard.md, protected.md (skeleton).
- Docs: DEPLOY.md, STATUS.md, decisions.md, redirects.md.
- Done gate: `npm run check` passes; the empty shell shows the version label.

## P2 — Media pipeline ✅
`course-audio.yml` (`workflow_dispatch`), WIF auth, rclone R2, tested pipeline
scripts + fixtures, `docs/MEDIA-PIPELINE.md`. actionlint clean. The word-audio
upload job moved to `payojana-foundation/word-audio-pipeline` (30 Oct 2026);
learn-app reads word audio only, over `https://audio.84000.digital`.

## P3 — Data contract + course build ✅
`docs/data-contract.md`, `scripts/build-courses.mjs` → `public/data/`
(catalog.json, 93 courses, teachers.json, aliases.json, manifest.json, photos).
Duplicate lesson num = warning, both kept, id suffixed (coordinator "b").
Contract tests in `src/contracts/__tests__/`.

## P4 — Screens ✅
SPA matching `design/learn-mockup.html`: Home (continue/start-here/topic chips/
teachers), Search (on-device, U+200B-stripped substring, hand-off links),
My Learning (In progress · Saved · History · Notes), More (Export/Import,
language), course page (progress %, sections of 20, ticks, find box, Save/Share),
lesson page (own r2 player: resume/speed/±15s/sleep/autoplay/MediaSession/mini
player; embeds for acast/youtube/drive; notes with timestamps). IndexedDB
`learn-app` stores progress/saved/history/notes/settings. Router over real paths
(`/`, `/search`, `/my`, `/more`, `/courses/<id>`, `/courses/<id>/<lessonId>`,
`/teachers`, `/teachers/<slug>`) + legacy `?teacher ?topic ?q`. Strings km+en.
protected.md P-07…P-18 added.

## P5 — Quality pass ✅
`e2e/learn.e2e.mjs` runs the full matrix 320/360 px × light/dark (mock media,
service worker blocked so route mocks are authoritative): home renders + no
horizontal scroll + focus visible, open course, play r2 lesson, resume after
reload (position persisted), mark complete, note at a timestamp, Khmer-title
search, no-result hand-off links to Vacanā + Library, language switch keeps the
page. All cells pass.

## bulk-02 — data and media at scale ✅
- Q1 `sheets-inventory.yml` + `scripts/media/sheets-inventory.mjs` / `xlsx-dump.mjs`:
  recursive Drive discovery of the teacher sheets → raw `.xlsx` in `data/source/sheets/`
  (never edited) + `reports/sheets-inventory.md` (structure only, no mapping). WIF
  `drive.readonly`.
- Q2 `media-inventory.yml` + `media-inventory.mjs` / `ffprobe-summary.mjs`: READ-ONLY
  inventory of `data/media-folders.csv` folders (id/name/mime/size/md5/created + ffprobe
  duration/has_video/has_audio/codec) → `reports/media-inventory.csv` + `media-gaps.md`.
  Empty CSV = nothing to do.
- Q3 `course-audio.yml` extended to BATCH: inputs `list`/`limit`/`max_minutes`/`concurrency`;
  `queue-plan.mjs` skips ids already in `data/media-manifest.json`; `transcode-one.sh` per
  file; manifest committed at end and on cancellation; summary table.
- Q4 `build-courses.mjs`: course-level all-or-nothing r2 (only approved, non-DRAFT manifest
  entries; no mixed courses), r2 media carries `duration_s`, `src` stays the bare R2 key
  (P-12 unchanged); player shows real duration from the data. protected **P-19** + contract.
- Q5 `src/db/aliases.ts`: `data/id-aliases.json` (empty `{}`) merged into
  `public/data/aliases.json`; one-transaction idempotent migration of user data
  provisional→permanent; in-app redirect `/courses/<provisional>` → permanent. protected
  **P-20** + unit tests with a fixture map. No real permanent ids invented.
- CI: `lint-workflows.yml` runs actionlint on pushes to `main` touching `.github/**`.
- Unit: Test Files 17 / Tests 119. e2e: PASS. `npm run check` clean locally.
## bulk-05 — study companion (guide leaf, paths, branch) ✅
- P1 (`9d0c8dc` regenerate served data, `050f3cf`): `data/paths.json` and
  `data/guide-lines.json` (people edit `data/`, the build copies + hashes them to
  `public/data/`; bad shape fails the build; unknown ids go to
  `reports/paths-issues.csv`). Home "Start here" now reads path `start-here`
  (`START_HERE` removed from `config.ts`; protected P-10 changed). IndexedDB v2
  adds store `leaves` (one per finished course, never removed); first-run
  backfill; Export includes leaves, Import merges; the alias rewrite moves leaves
  (protected P-20 changed). Kids' classes c021-c024 and c080 use `moon-hare` via
  `course_signs`, resolved through aliases at lookup time.
- P2 (`c5818c4`): GuideLine (sign + one approved line) in 3 places; branch panel
  at the top of `/my` (second branch from 13 leaves, no numbers, device note
  always); draft SVGs in `public/brand/companion/` (bundled, so they work
  offline); `e2e/companion.e2e.mjs`.
- Fix (`126fec0`): km spacing in `my.branch.device_note`.
- P3: protected **P-21..P-25** + contract tests (`companion-ui.contract.test.ts`).
- All guide lines ship `approved:false`; `paths.json` ships hidden. Open: Khmer
  reviewer approval of the lines and the 2 km UI strings (`[VERIFY]`); brand
  replacement of the draft SVGs (same file names, `data-slot` 1..12).
- Known: two shell-script tests (`push-with-retry`, `b3-loop`) can time out
  (5000 ms) when the machine is busy; they pass on a rerun.
