# Decisions — learn-app

Settled decisions, newest first. A decision here is not re-opened without a
prompt that names it.

## P1 (26 Oct 2026)
- **Copied from vacana-app, adapted:** toolchain, PWA config, scripts, data
  loader/manifest, db layer, version label, strings mechanism, steering
  structure. Renamed vacana→learn; removed Vacana-only logic (scripture, reading
  modes, word audio, the vol/words manifest shape, scripture-integrity rules).
- **Not copied** (per the task): Vacanā's protected.md contents, reading modes,
  its data contract, word-audio module, scripture-integrity.md.
- **IndexedDB database name:** `learn-app`. Origin-scoped; fixed first because
  moving origins loses users' saved data.
- **Public address:** `https://learn.84000.digital`, custom domain attached in
  `wrangler.jsonc`. `workers_dev: false` — no workers.dev address at all.
- **Data manifest shape:** flat `files` map (key → {file, updated, sha256}),
  replacing vacana's per-volume text/words pairs, because learn-app serves a
  catalog file + one file per course (P3), not paired volume files. The
  hash-verify and SPA-200 guard are kept unchanged.
- **Served data location:** `public/data/` (built by P3), so Vite copies it into
  `dist/` automatically; the vacana `copyDirPlugin('data','dist/data')` is not
  needed and was dropped.
- **Language:** new in learn-app (vacana is Khmer-only). `?lang=km|en` → cookie
  `lang_84000` → `km`. Cookie Domain `.84000.digital`, omitted off that host.
- **Config base URLs:** `VITE_MEDIA_BASE_URL`, `VITE_VACANA_BASE_URL`,
  `VITE_LIBRARY_BASE_URL`, build-time only, never derived from `location`.
- **`npm run check`:** type-check + unit suite; `npm run deploy-check <url>` =
  post-deploy hash verification.
