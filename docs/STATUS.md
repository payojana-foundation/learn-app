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
Two `workflow_dispatch` workflows (`word-audio-upload.yml`, `course-audio.yml`),
WIF auth, rclone R2, tested pipeline scripts + fixtures, `docs/MEDIA-PIPELINE.md`.
actionlint clean.

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

## P5 — Quality pass — in progress
e2e on 320/360 px × light/dark (mock media): open course, play r2 lesson, resume
after reload, mark complete, note at timestamp, Khmer search, hand-off links,
language switch keeps the page, no horizontal scroll.
