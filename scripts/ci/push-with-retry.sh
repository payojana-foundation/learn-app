#!/usr/bin/env bash
# scripts/ci/push-with-retry.sh — push the current HEAD to main without losing a
# race against another job/bot that pushed in the meantime.
#
# Before every push: `git pull --rebase`. If the push (or the rebase) fails, try
# again, up to 3 attempts in total. A failed FINAL attempt fails the job loudly
# (non-zero exit + a ::error annotation); it never reports success on a push that
# did not land.
#
# Usage: scripts/ci/push-with-retry.sh [remote] [branch]     (default: origin main)
# Env:   PUSH_RETRY_SLEEP  seconds to wait between attempts (default 3; tests use 0)

set -uo pipefail

REMOTE="${1:-origin}"
BRANCH="${2:-main}"
SLEEP="${PUSH_RETRY_SLEEP:-3}"
MAX=3

attempt=1
while [ "$attempt" -le "$MAX" ]; do
  echo "push attempt ${attempt}/${MAX}: git pull --rebase --autostash ${REMOTE} ${BRANCH}"
  # --autostash: a dirty tree (e.g. the workflow's `chmod +x`) must not block the rebase.
  if git pull --rebase --autostash "$REMOTE" "$BRANCH"; then
    if git push "$REMOTE" "HEAD:${BRANCH}"; then
      echo "pushed to ${REMOTE}/${BRANCH} on attempt ${attempt}"
      exit 0
    fi
    echo "push rejected on attempt ${attempt}" >&2
  else
    echo "pull --rebase failed on attempt ${attempt}" >&2
    # Never leave a half-finished rebase behind for the next attempt.
    git rebase --abort 2>/dev/null || true
  fi
  attempt=$(( attempt + 1 ))
  [ "$attempt" -le "$MAX" ] && sleep "$SLEEP"
done

echo "::error title=Push failed::could not push to ${REMOTE}/${BRANCH} after ${MAX} attempts — the commit did NOT land." >&2
exit 1
