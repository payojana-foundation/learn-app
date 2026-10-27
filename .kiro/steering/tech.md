---
inclusion: always
---

# Tech: stack and fixed decisions

These decisions are settled. Do not redesign them. If one blocks you, stop and explain why.

## Stack
- Offline-first PWA. Same toolchain as vacana-app: Vite, Tailwind v4 (CSS-first,
  `@tailwindcss/vite`, no tailwind.config), vite-plugin-pwa (`registerType:
  'prompt'`). No new framework without asking. Read vacana-app's package.json
  for the proven versions (wrangler, vite, vite-plugin-pwa, vitest, playwright).
- Fonts bundled locally, no CDNs: Battambang (Khmer interface body), Moul (Khmer
  headings, never bold), Lora with latin-ext (English). (Fonts are added with
  the screens; the empty P1 shell uses system fonts.)
- Brand tokens (website v8): `#7F0204` text/links on `#EDE3C8` background; panel
  `#F6EFDD`; line `#C9B896`; muted `#6B5D48`. Leaf orange `#F26000` for graphics
  only, never text. Content width ≤ 760 px; no horizontal scroll at phone width.
- No login. Local-first: user data in IndexedDB database **`learn-app`**.
  Export/Import backup.
- Repo: `payojana-foundation/learn-app` (private), branch `main` only.
- Hosting: Cloudflare Workers static assets, Worker `learn-app`, auto-deploy
  from `main` (see docs/DEPLOY.md). `wrangler.jsonc` is committed and is the ONLY
  source of Worker settings; wrangler is a pinned devDependency.
- The app only CONSUMES data. Source inputs live in `data/source/`; the served
  data files in `public/data/` are produced by scripts in `scripts/` (see
  docs/data-contract.md, P3). Never hand-edit generated files.

## Wrangler
- Assets-only, no Worker script, no `@cloudflare/vite-plugin`.
- `workers_dev: false`: there is no workers.dev address. The public address is
  the custom domain `learn.84000.digital`, attached by `"routes":[{"pattern":
  "learn.84000.digital","custom_domain":true}]` in `wrangler.jsonc`, never in
  the dashboard.
- Kiro never runs a real `wrangler deploy` or `wrangler login`; only
  `npx wrangler deploy --dry-run`. Cloudflare deploys `main` by itself.

## Service worker
- vite-plugin-pwa `generateSW`, `registerType: 'prompt'` (user taps to update).
- Precache only the app shell, fonts, icons. Never precache `data/` files or
  media.
- `cleanupOutdatedCaches: true`; one `cacheId` per build (`learn-<build hash>`).
  `clientsClaim: true` so the accepted update takes over open tabs.

## Data loading
- `data/manifest.json` lists every served data file with its SHA-256. Download
  only changed files; verify every hash; store a file only after it verifies.
- **The host returns index.html with HTTP 200 for a missing file.** Never treat
  200 as success. Check `Content-Type`, parse, validate shape and SHA-256
  before use.
- Course lesson files load on demand per course and are cached in IndexedDB.

## Storage and addresses
- Browser storage belongs to the origin. Production origin:
  `https://learn.84000.digital`. Data saved on the production origin is not
  visible on any other origin. All external base URLs (media, Vacanā, Library)
  are single config values set at build time (`src/config.ts`), NEVER derived
  from `location`.
- Saved user data stores only stable references: course id and lesson number.
  Never array positions. Provisional ids (`c###`/`c###-l###`) are migrated
  through an `aliases` hook when permanent ids arrive.

## Language
- Default Khmer. Order: `?lang=km|en` → cookie `lang_84000` → `km`. Cookie:
  Domain `.84000.digital` (omitted on the workers.dev/localhost host), Path=/,
  Max-Age 1 year, SameSite=Lax, Secure (dropped on plain http). Wrap cookie
  access in try/catch. Set `<html lang>` and `<html data-lang>` on load. See
  `src/lang.ts`.

## Search
- Compare against a cleaned copy: remove U+200B from query and text. Display the
  original unchanged.
- Substring match over courses, lessons, and teachers, on-device.
- When there is no result, offer hand-off links to Vacanā and Library.

## Media
- See media.md. Play only the source named in the lesson's media object; never
  guess a URL. v1 is streaming only (no download button).

## Rejected (do not propose again)
- Synthetic or TTS audio/video.
- A search server.
- Fabricated sample courses, lessons, or teacher data.
- Any scripture text in this app.
- Engagement hooks, streaks, or "Blue Ocean" framing for monastic audiences.
