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

## P2 — Media pipeline — pending
## P3 — Data contract + course build — pending
## P4 — Screens — pending
## P5 — Quality pass — pending
