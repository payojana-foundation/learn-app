#!/usr/bin/env bash
# scripts/media/batch-run.sh — run the course-audio batch loop over a plan file
# of drive_file_ids (Q3, course-audio.yml). Extracted from the workflow so it is
# testable with a fixture plan + a stub transcode script.
#
# Args:   $1 = path to the plan file (one drive_file_id per line)
# Env:    MAX_MINUTES     wall-clock budget in minutes (default 300)
#         TRANSCODE_ONE   the per-file script to run (default
#                         scripts/media/transcode-one.sh) — overridable in tests
# Writes: results.done.ndjson, results.failed.ndjson (one JSON line per id), and
#         appends both to results.ndjson. Each id's status is proven by the exit
#         code of TRANSCODE_ONE; any non-zero exit counts as failed with the
#         captured reason. Each id is logged as it starts, with the script's
#         stdout/stderr and its exit code.
#
# Runs ids SEQUENTIALLY: correctness and a legible log beat parallelism here, and
# the old backgrounded loop silently dispatched nothing / raced its result files.

set -uo pipefail

PLAN="${1:-to-process.txt}"
TRANSCODE_ONE="${TRANSCODE_ONE:-scripts/media/transcode-one.sh}"
MAX_MINUTES="${MAX_MINUTES:-300}"

: > results.failed.ndjson
: > results.done.ndjson

if [ ! -f "$PLAN" ]; then
  echo "batch-run: plan file '$PLAN' not found — nothing to do" >&2
  echo "batch finished"
  exit 0
fi

json_escape() {
  # Escape a string for embedding in a JSON string value.
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]).slice(1,-1))' "$1"
}

start=$(date +%s)
budget=$(( MAX_MINUTES * 60 ))
count=0

while IFS= read -r fid || [ -n "$fid" ]; do
  fid="$(printf '%s' "$fid" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$fid" ] || continue

  now=$(date +%s)
  if [ $(( now - start )) -ge "$budget" ]; then
    echo "time budget ($MAX_MINUTES min) reached — leaving the rest for the next run"
    break
  fi

  count=$(( count + 1 ))
  # Re-measure (no re-upload) when this id is in the forced set from the plan.
  force=0
  if [ -f force-ids.txt ] && grep -qxF "$fid" force-ids.txt; then force=1; fi
  echo "::group::[$count] transcode $fid (force=$force)"
  echo "[$fid] starting ($TRANSCODE_ONE)"
  out="$(FORCE="$force" "$TRANSCODE_ONE" "$fid" 2>&1)"
  code=$?
  printf '%s\n' "$out"
  echo "[$fid] exit $code"
  echo "::endgroup::"

  if [ "$code" -eq 0 ]; then
    echo "{\"id\":\"$fid\",\"status\":\"done\"}" >> results.done.ndjson
  elif [ "$code" -eq 3 ]; then
    # Exit 3 = a deliberate skip (listed duplicate / key exists), not a failure.
    reason="$(json_escape "$(printf '%s' "$out" | grep -oE '::skip-reason::.*' | head -n1 | sed 's/::skip-reason:://')")"
    [ -n "$reason" ] || reason="skipped"
    echo "{\"id\":\"$fid\",\"status\":\"skipped\",\"reason\":\"$reason\"}" >> results.ndjson
  else
    reason="$(json_escape "$(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')")"
    echo "{\"id\":\"$fid\",\"status\":\"failed\",\"reason\":\"transcode-one exit $code: $reason\"}" >> results.failed.ndjson
  fi
done < "$PLAN"

cat results.done.ndjson results.failed.ndjson >> results.ndjson || true
echo "batch finished: dispatched $count"
