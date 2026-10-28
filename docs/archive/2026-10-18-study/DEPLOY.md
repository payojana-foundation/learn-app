# DEPLOY — study-84000

How the app gets from GitHub to the web. Plan written 17 Oct 2026; do the steps when Kiro task 1 (project skeleton) is pushed. Cloudflare menu names change from time to time — if a screen doesn't match, stop and describe what you see.

## What happens on every push
`git push` to `main` → Cloudflare Workers Builds runs `npm ci`, `npm run build`, then `npx wrangler deploy` → the site updates at the preview address `https://study-84000.<your-subdomain>.workers.dev`. Vacanā uses the same setup ("vacana-app").

## One-time setup

### A. Create the GitHub repo
1. Open https://github.com/organizations/payojana-foundation/repositories/new
2. Repository name: `study-84000`. Visibility: **Private**. Leave "Add a README" **unticked** (Kiro will create the files).
3. Click **Create repository**. Keep the page open; it shows the repo address.

### B. Connect Kiro's folder to the repo
Kiro will give the exact commands in the task that creates the project. They will be typed in Kiro's **Terminal** panel (menu **Terminal → New Terminal**), and will look like `git remote add origin …` and `git push -u origin main`.

### C. Create the Worker in Cloudflare
1. Open https://dash.cloudflare.com → left menu **Workers & Pages** (under Compute) → **Create** → tab **Workers** → **Import a repository**.
2. Choose **GitHub** → account **payojana-foundation** → repo **study-84000**. If the repo is not listed, click the link to adjust the GitHub app's repository access and tick `study-84000`.
3. Settings on the next screen:
   - Project name: `study-84000` (must match `name` in `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
   - Production branch: `main`
4. Click **Create and deploy**. Wait for the build log to finish (green tick).
5. Open the `…workers.dev` address shown. Test on your phone.

### D. Build variables (later, when values exist)
Worker **study-84000** → **Settings** → **Build** → **Variables and secrets** → **Add**:
| Name | Value | When |
|---|---|---|
| `VITE_SCANS_BASE_URL` | R2 public address for `study-scans` | after scans are uploaded |
| `VITE_MEDIA_BASE_URL` | R2 public address for `study-media` | after the first course moves to R2 |
| `VITE_SC_BASE_URL` | `https://suttacentral.net` | with the first approved SuttaCentral link |
Vite bakes these in at build time: after changing one, re-run the build (**Deployments** → latest → **Retry build**, or push any commit).

### E. Custom domain (only at launch — not now)
Plan change 18 Oct: at launch this Worker takes over **84000.digital** (domain root) from the current static website. The DNS chat plans that switch and the redirects for study.84000.digital and course.84000.digital; do not change DNS before then. The domain is attached **in `wrangler.jsonc`, never in the dashboard** (DNS chat, 18 Oct 2026; same as Vacanā), so a deploy can never conflict with or remove a dashboard setting.
1. With the DNS chat: confirm how the current website is detached from `84000.digital` and in which order (required — the domain is in use now).
2. Launch commit only: in `wrangler.jsonc` add `"routes": [ { "pattern": "84000.digital", "custom_domain": true } ]` (www: as the DNS chat decides). Keep `"workers_dev": true` for testing.
3. Push to main. The deploy creates the DNS record and the certificate.
4. Tell the DNS chat; it checks Active + SSL and records it.
5. Test every old address in `docs/redirects.md` on the live domain.
Users' saved data on the workers.dev address does not move to the new address.

## Pinned versions
- Node: `.node-version` file in the repo (same as Vacanā: `24.21.0`). Check the first build log shows this version.
- wrangler: devDependency with an exact version (installed with `npm i -D --save-exact wrangler`); `package-lock.json` committed.

## Caching headers
`public/_headers` (copied into `dist/`):
- `/index.html`, `/sw.js`, `/data/*`: `Cache-Control: no-cache`
- `/assets/*` (hashed file names): `Cache-Control: public, max-age=31536000, immutable`

## Undo a bad deploy
Worker **study-84000** → **Deployments** → pick the last good one → **⋯** → **Rollback**. Then fix on main and push.

## Checks after each deploy (phone)
1. Page opens; Khmer text renders in the right fonts.
2. A data file loads (Library opens Volume 23).
3. Airplane mode → reload → app shell still opens.
4. After a new deploy, the "update available" prompt appears; tapping it loads the new version.
