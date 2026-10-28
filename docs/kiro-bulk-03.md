# Kiro bulk task 03 — learn-app · launch readiness + automation · 27 Oct 2026

Start after bulk-02 is finished. Same rules as bulk-01/02 (main only, `git pull` first,
one commit per part, push after tests pass, safety check before push, STOP gates, report
first for data, no secrets, never retype Khmer/Pāḷi). First: review this file for
conflicts with protected.md / contract tests and list them before coding.
Report: `reports/kiro-bulk-03-report.md` (untracked).

## R1 — Fonts bundled (app currently falls back to system fonts)
Self-host Battambang (400, 700), Moul (400), Lora (400, 600) as woff2 in `public/fonts/`,
from the official Google Fonts / google/fonts sources (OFL; copy each OFL.txt next to the
files). `@font-face` with `font-display: swap`; precache in the service worker; no request
to fonts.googleapis.com at runtime. e2e: computed font-family of a Khmer heading and body
text uses the bundled face (document.fonts.check). Report total font bytes.

## R2 — Housekeeping
- `git mv DEPLOY.md docs/archive/2026-10-18-study/DEPLOY.md` (superseded by docs/DEPLOY.md).
- Delete the LOCAL branch `old-website-history` (`git branch -D`); confirm it was never on
  origin (`git ls-remote origin` shows only main).
- Leave `learn-app.code-workspace` as is.

## R3 — Data always rebuilt from source
`npm run build` runs `build-courses` first, then vite (so a manifest or source change can
never ship stale `public/data/`). Add CI workflow `data-check.yml` (push to main touching
`data/**` or `scripts/build-courses.mjs`): run build-courses, fail if the regenerated
`public/data/` differs from the committed one, and print the diff summary. Keep
`.gitattributes` eol rules.

## R4 — Media approval without editing JSON
Workflow `approve-media.yml` (workflow_dispatch): inputs `drive_file_ids` (comma list),
`reviewer` (name), `decision` (approved | rejected). For each id present in
`data/media-manifest.json`: set `status`, `reviewer`, `reviewed_at` (UTC date); unknown id
→ listed as not found, job still succeeds for the rest. Commit "media: <decision> <n>
files by <reviewer>" and push. A rejected file is never played; a later corrected file gets
a new key (`-v2`). Unit tests for the manifest update. Add a section "Approve a lesson's
audio" to `docs/MEDIA-PIPELINE.md` (3 clicks, for the team).

## R5 — Config placeholders the coordinator will fill
In `src/config.ts` (single place): `START_HERE: string[]` (course ids, empty = row hidden),
`FEEDBACK_URL: string` (empty = row hidden), `OFFLINE_ALLOWED: false`. Move any existing
START_HERE out of strings.ts. Document each in `docs/DEPLOY.md` §Config. No values invented.

## R6 — Deploy check after every deploy
Workflow `deploy-check.yml`: on push to main, wait/retry up to 10 min until
https://learn.84000.digital serves a version label equal to the pushed commit, then run
`npm run deploy-check https://learn.84000.digital`. If learn.84000.digital is not reachable
yet (no deploy set up), the job ends with a clear "not deployed yet" notice, not a failure.
Report what the check covers.

## R7 — App template (only if the repo exists)
If `https://github.com/payojana-foundation/app-template` exists and `git ls-remote` shows it
EMPTY: in a separate local folder `C:\Users\buphk\Projects\app-template`, build the template
from learn-app per claude/sop-new-app.md §4 (steering skeletons incl. protected.md /
scope-guard.md / testing.md, contracts test pattern, manifest + loader, db, strings +
release-check, version label, lang cookie layer, vite PWA config, `_headers`, assets-only
wrangler with `workers_dev: false` and a placeholder route, run-e2e, verify-deploy,
data-integrity-diff, .gitignore, docs stubs, the media-pipeline workflows with the app name
as a variable). No Learn screens, data or strings. `npm run check` green on the empty
template. Push to app-template main. If the repo doesn't exist or isn't empty: skip R7 and
say so.
