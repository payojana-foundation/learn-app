# DEPLOY — learn-app

How Learn (ថ្នាក់សិក្សា) gets from GitHub to the web. Same setup as vacana-app.
Cloudflare menu names change from time to time — if a screen doesn't match,
stop and describe what you see.

## What happens on every push
`git push` to `main` → Cloudflare Workers Builds runs `npm ci`, `npm run build`,
then `npx wrangler deploy` → the site updates at the custom domain
`https://learn.84000.digital`. There is no workers.dev test address
(`workers_dev: false`); the custom domain is the only public address.

## One-time setup

### A. GitHub repo
Repo `payojana-foundation/learn-app` (private). It is the new empty repo that
replaced the old GitHub redirect to `84000-digital`. Kiro connects the folder
with `git remote add origin …` and `git push -u origin main`.

### B. Create the Worker in Cloudflare
1. dash.cloudflare.com → Workers & Pages → Create → Workers → Import a
   repository → GitHub → account `payojana-foundation` → repo `learn-app`.
2. Settings:
   - Project name: `learn-app` (must match `name` in `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
   - Production branch: `main`
3. Create and deploy. Wait for the green tick.
4. Because `workers_dev: false`, test on the custom domain once DNS is active
   (see C). The deploy attaches the domain from `wrangler.jsonc`.

### C. Custom domain
The domain `learn.84000.digital` is attached **in `wrangler.jsonc`, never in the
dashboard** (`"routes":[{"pattern":"learn.84000.digital","custom_domain":true}]`),
so a deploy can never conflict with a dashboard setting. The push creates the
DNS record and the certificate. Coordinate the DNS switch with the DNS chat.

### D. Build variables
Worker `learn-app` → Settings → Build → Variables and secrets → Add. Vite bakes
these in at build time; after changing one, re-run the build.
| Name | Value |
|---|---|
| `VITE_MEDIA_BASE_URL` | `https://media.84000.digital` |
| `VITE_VACANA_BASE_URL` | `https://vacana.84000.digital` |
| `VITE_LIBRARY_BASE_URL` | `https://library.84000.digital` |

## Pinned versions
- Node: `.node-version` (`24.21.0`). Check the first build log shows this.
- wrangler: a devDependency pinned to an exact version; `package-lock.json`
  committed.

## Caching headers
`public/_headers` (copied into `dist/`):
- `/index.html`, `/sw.js`, `/`, `/data/*`: `Cache-Control: no-cache`
- `/assets/*` (hashed file names): immutable (default long-lived cache)

## Undo a bad deploy
Worker `learn-app` → Deployments → last good one → ⋯ → Rollback. Then fix on
main and push.

## Checks after each deploy (phone)
1. Page opens; the version label shows the new build hash.
2. Khmer text renders.
3. Airplane mode → reload → app shell still opens.
4. After a new deploy, the "update available" prompt appears; tapping it loads
   the new version.
