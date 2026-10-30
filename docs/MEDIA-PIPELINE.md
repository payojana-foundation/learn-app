# Media pipeline (P2)

A manual GitHub Actions workflow moves teacher course recordings from Google
Drive to Cloudflare R2. It is `workflow_dispatch` only; the coordinator runs it
from the browser (repo → Actions → pick the workflow → Run workflow). See
`docs/SETUP-coordinator.md` for the one-time Google Cloud / R2 / secrets setup.

> **Word audio is not in this repo.** The word-audio upload job moved to
> `payojana-foundation/word-audio-pipeline` (coordinator decision, 30 Oct 2026).
> learn-app only **reads** word audio, over `https://audio.84000.digital`, and
> never writes to the `word-audio` bucket. The `WORD_AUDIO_R2_*` secrets are not
> used here.

No service-account keys: Drive access uses Workload Identity Federation
(`google-github-actions/auth` with `token_format: access_token`, Drive scope).
R2 uses an rclone S3 remote built from repo secrets. Secrets are read from
`secrets`/`vars` and never written to a committed file or printed to a log.

## Secrets and variables (set by the coordinator, DNS desk 28–30 Oct 2026)
The R2 S3 endpoint is **built from the account id** (`https://<R2_ACCOUNT_ID>.r2
.cloudflarestorage.com`); there is no `R2_ENDPOINT` variable.

- Secrets:
  - `R2_ACCOUNT_ID` — Cloudflare account id; the endpoint is derived from it.
  - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — the **course-media** token,
    scoped to the `course-media` bucket ONLY. Used by `course-audio.yml`.
- Variables: `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`.

The word-audio token (`WORD_AUDIO_R2_*`) and the `WORD_AUDIO_DRIVE_FOLDER` var
belong to `payojana-foundation/word-audio-pipeline`, not this repo.

Which workflow needs what:

| workflow | R2 secrets | WIF vars | purpose |
| --- | --- | --- | --- |
| `course-audio.yml` | `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT` | Drive → transcode → `course-media` bucket |
| `approve-media.yml` | none (edits `data/media-manifest.json`, no bucket access) | none | reviewer approve/reject |

## Word audio (read-only here)
Word audio is served from `https://audio.84000.digital` (the `word-audio` R2
bucket). The upload job that fills that bucket lives in
`payojana-foundation/word-audio-pipeline`. learn-app only plays those files by
URL; it holds no word-audio R2 token and runs no word-audio workflow.

## course-audio.yml (batch, Q3)
Transcodes a BATCH of recordings to normalised 64 kbps mono MP3s on the
`course-media` bucket, then appends one DRAFT entry per file to
`data/media-manifest.json`.
- Inputs: `list` (queue CSV of `drive_file_id`s, default `data/audio-queue.csv`),
  `limit` (default 5), `max_minutes` (wall-clock budget; stop starting new files
  before the GitHub job time limit, default 300), `concurrency` (default 2).
- The run plan (`scripts/media/queue-plan.mjs`) SKIPS any id already in
  `data/media-manifest.json` and processes the first `limit` of the rest; the
  remainder is left for the next run.
- Per file (`scripts/media/transcode-one.sh`): `ffprobe` decides the real type
  (some videos are named `.mp3`) — `scripts/media/ffprobe-decide.mjs`. For a
  video, only the audio TRACK is streamed from the Drive URL with an
  `Authorization` header (no full video download). ffmpeg:
  `pan=mono|c0=0.5*c0+0.5*c1`, two-pass `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true`,
  MP3 64 kbps CBR, 44.1 kHz, no noise reduction.
- Key `audio/<drive_file_id>-a64.mp3` in `course-media` (immutable; never
  overwrite; a present key = already done; a correction is re-uploaded as
  `audio/<drive_file_id>-a64-v2.mp3`, never an overwrite). The key is derived
  from the Drive file id — no Drive id → that line STOPS, never an invented key.
  The pipeline writes ONLY to `course-media`, never to `course-originals`.
- Every R2 upload sets `Cache-Control: public, max-age=31536000, immutable` and
  `Content-Type: audio/mpeg` (DNS-desk rule), set on the course-audio upload in
  `transcode-one.sh`.
- Each success writes `{drive_file_id, key, bytes, duration_s, sha256, status:
  "DRAFT – needs reviewer approval"}` via `scripts/media/append-manifest.mjs`.
  The manifest is committed at the END of the run AND on cancellation (whatever
  finished so far), via the workflow token pushing to `main` (no PR).
- A Markdown summary table (done / skipped / failed with reason) is written to
  the job summary (`scripts/media/queue-plan.mjs` `summaryTable`).
- Re-runs skip a key already on R2 and an id already in the manifest.

## Approve a lesson's audio (R4)

After `course-audio.yml` uploads a recording, its manifest entry is a **DRAFT**
and the app will NOT play it. A reviewer approves it from the browser — no JSON
editing, no local tools.

1. Repo → **Actions** → **approve-media** → **Run workflow**.
2. Fill the three boxes:
   - **decision**: `approved` (or `rejected`).
   - **drive_file_ids**: the Drive file id(s), comma-separated.
   - **reviewer**: your name (recorded in the manifest).
3. **Run workflow**.

The job sets `status`, `reviewer`, and `reviewed_at` (UTC date) on each matching
entry and commits `media: <decision> <n> files by <reviewer>` to `main`. An id
that is not in the manifest is listed as "not found" and the job still succeeds
for the rest.

- An **approved** file becomes playable: `build-courses` counts only an
  `approved` status toward the course-level all-or-nothing r2 switch (P-19), so
  a course flips to the app player once ALL its Drive-backed lessons are
  approved.
- A **rejected** file is KEPT in the manifest for the audit trail but is never
  played. A corrected recording is re-uploaded under a NEW key (`-v2`) by
  `course-audio.yml`; the rejected entry is never overwritten.

The logic lives in `scripts/media/approve-manifest.mjs` (pure, unit-tested in
`scripts/media/__tests__/approve-manifest.test.mjs`).

## Scripts and tests
Pure, unit-tested helpers (fixtures in `scripts/media/__tests__/fixtures/`):
- `ffprobe-decide.mjs` — audio vs video from ffprobe JSON (cover art ≠ video).
- `append-manifest.mjs` — idempotent DRAFT append, never overwrites a key.
- `approve-manifest.mjs` — apply a reviewer `approved`/`rejected` decision
  (`status`/`reviewer`/`reviewed_at`); unknown ids reported, not fatal (R4).
- `queue-plan.mjs` — pure batch plan (parse queue, skip manifest ids, cap at
  `limit`) + the run summary table (Q3).
- `transcode-one.sh` — per-file transcode (ffprobe → loudnorm 2-pass → 64k CBR →
  immutable R2 → `entry-<id>.json`), run in parallel by the batch loop (Q3).
Run with `npm test`. The workflows are linted with `actionlint` in CI
(`.github/workflows/lint-workflows.yml`).

## GitHub Actions limits (reported from GitHub docs, private repo)
- **Per-job maximum run time:** 6 hours (360 minutes) on GitHub-hosted runners;
  a job that exceeds it is cancelled. (Self-hosted runners allow up to 5 days.)
  Source: [Actions limits](https://docs.github.com/en/actions/reference/limits).
  `course-audio.yml` sets `timeout-minutes: 340` (its `max_minutes` budget stops
  it starting new files well before that), under GitHub's hard cap.
- **Runner disk:** a standard `ubuntu-latest` GitHub-hosted runner is a VM with
  a large total disk (~150 GB reported by GitHub), but only roughly 14 GB of
  that is free SSD space for a job after the preinstalled OS image and tool
  cache. Plan the batch/transcode temp files against ~14 GB usable, not 150 GB.
  Source: [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
  and the runner-images notes.
- **Included minutes (private repos):** each account gets a monthly quota of
  free GitHub-hosted minutes that depends on the plan; usage beyond it is
  billed. Confirm the exact per-plan number (Free/Pro/Team/Enterprise) for
  `payojana-foundation` on the billing page before a full (`limit=0`) run.
  Source: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  and [Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage).

Content on the GitHub docs pages above was rephrased here for licensing
compliance.
