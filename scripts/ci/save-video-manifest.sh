#!/usr/bin/env bash
# scripts/ci/save-video-manifest.sh - PART V3: the video twin of save-manifest.sh
# (left unchanged for audio). Appends every entry-*.json in the CWD to
# data/video-manifest.json and pushes it to main; idempotent, so it runs after
# every file AND at the end of the job. Starts from origin/main's manifest each
# attempt (rebase-proof), up to 3 attempts. Exit 1 if nothing landed.
set -uo pipefail
MANIFEST="${MANIFEST:-data/video-manifest.json}"
MSG="${SAVE_MSG:-course-video: DRAFT video manifest entries (batch)}"
SLEEP="${PUSH_RETRY_SLEEP:-3}"
shopt -s nullglob
entries=(entry-*.json)
if [ "${#entries[@]}" -eq 0 ]; then echo "save-video-manifest: no entry files"; exit 0; fi
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
for attempt in 1 2 3; do
  git fetch origin main || { sleep "$SLEEP"; continue; }
  git reset -q origin/main 2>/dev/null || true
  git checkout origin/main -- "$MANIFEST" 2>/dev/null || true
  for e in "${entries[@]}"; do
    node scripts/media/append-video-manifest.mjs "$MANIFEST" "$e" || true
  done
  git add "$MANIFEST"
  if git diff --cached --quiet -- "$MANIFEST"; then
    echo "save-video-manifest: no manifest change to commit"; exit 0
  fi
  git commit -m "$MSG" -- "$MANIFEST" || exit 1
  if git push origin HEAD:main; then echo "save-video-manifest: pushed (attempt $attempt)"; exit 0; fi
  echo "save-video-manifest: push rejected (attempt $attempt)" >&2
  sleep "$SLEEP"
done
echo "::error title=Manifest save failed::could not push the video manifest after 3 attempts" >&2
exit 1
