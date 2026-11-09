#!/usr/bin/env bash
# scripts/ci/save-manifest.sh - append every entry-*.json in the CWD to the
# manifest and push it to main. Idempotent (append-manifest skips known keys), so
# it is safe to call after every file AND again at the end of the job.
#
# Rebase-proof: instead of rebasing a JSON array that another queue may have
# changed, it starts from origin/main's manifest, re-appends all local entries,
# commits and pushes; up to 3 attempts. Exit 1 if nothing landed.
# Env: MANIFEST (default data/media-manifest.json), SAVE_MSG, PUSH_RETRY_SLEEP.
set -uo pipefail
MANIFEST="${MANIFEST:-data/media-manifest.json}"
MSG="${SAVE_MSG:-course-audio: DRAFT manifest entries (batch)}"
SLEEP="${PUSH_RETRY_SLEEP:-3}"
shopt -s nullglob
entries=(entry-*.json)
if [ "${#entries[@]}" -eq 0 ]; then echo "save-manifest: no entry files"; exit 0; fi
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
for attempt in 1 2 3; do
  git fetch origin main || { sleep "$SLEEP"; continue; }
  git reset -q origin/main 2>/dev/null || true
  git checkout origin/main -- "$MANIFEST" 2>/dev/null || true
  for e in "${entries[@]}"; do
    node scripts/media/append-manifest.mjs "$MANIFEST" "$e" || true
  done
  git add "$MANIFEST"
  if git diff --cached --quiet -- "$MANIFEST"; then
    echo "save-manifest: no manifest change to commit"; exit 0
  fi
  git commit -m "$MSG" -- "$MANIFEST" || exit 1
  if git push origin HEAD:main; then echo "save-manifest: pushed (attempt $attempt)"; exit 0; fi
  echo "save-manifest: push rejected (attempt $attempt)" >&2
  sleep "$SLEEP"
done
echo "::error title=Manifest save failed::could not push the manifest after 3 attempts" >&2
exit 1
