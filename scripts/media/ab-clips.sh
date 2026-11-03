#!/usr/bin/env bash
# scripts/media/ab-clips.sh — Job B v2 · B6 one-off A/B/C clip renderer.
#
# From pilot part 1 (DRIVE_FILE_ID), take the loudest 90 s window and one pause
# ≥ 3 s (both located from the ebur128 frame log), render three versions of each
# in a RANDOM A/B/C order, upload the 6 clips to course-media/$DEST with
# Cache-Control: no-store, check each public URL is 200, print the 6 URLs to the
# run summary, and write the A/B/C→version map ONLY to abc-order.json (private
# artifact — never echoed to the summary).
#
# Env: ACCESS_TOKEN (WIF), MEDIA_BASE_URL, DRIVE_FILE_ID, CURRENT_KEY, DEST.
# Overridable for tests: RCLONE, CURL, SHUF, AB_SELFTEST.

set -uo pipefail

RCLONE="${RCLONE:-rclone}"
CURL="${CURL:-curl}"
SHUF="${SHUF:-shuf}"
MEDIA_BASE_URL="${MEDIA_BASE_URL:-https://media.84000.digital}"
MEDIA_BASE_URL="${MEDIA_BASE_URL%/}"
DEST="${DEST:-test/2026-11-02}"

# pick_abc <self> — map the three version ids to A/B/C in a random order and
# write abc-order.json. Pure/offline so a unit test can exercise it with a
# deterministic $SHUF stub. Prints nothing to stdout about the mapping.
pick_abc() {
  local order
  order="$(printf '%s\n' current b3 b3-fixedgain | "$SHUF")"
  # order = the three version ids shuffled; assign to A,B,C in that order.
  local a b c
  a="$(printf '%s\n' "$order" | sed -n '1p')"
  b="$(printf '%s\n' "$order" | sed -n '2p')"
  c="$(printf '%s\n' "$order" | sed -n '3p')"
  node -e 'const fs=require("fs");fs.writeFileSync("abc-order.json",JSON.stringify({A:process.argv[1],B:process.argv[2],C:process.argv[3]}))' -- "$a" "$b" "$c"
}

# A self-test path so the unit test can verify pick_abc without ffmpeg/rclone.
if [ "${AB_SELFTEST:-0}" = "1" ]; then
  pick_abc
  exit 0
fi

: "${ACCESS_TOKEN:?ACCESS_TOKEN not set}"
dl="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media"
hdr="Authorization: Bearer ${ACCESS_TOKEN}"$'\r\n'

# Full-file ebur128 frame log → find the loudest 90 s window and a pause ≥ 3 s.
echo "[ab] measuring part 1 with ebur128 (frame log)…"
ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" -vn \
  -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,ebur128=peak=true" -f null - 2>ebur128-frames.log || {
  echo "::error title=ebur128 failed::could not measure part 1" >&2; exit 1; }

read -r loud_start pause_start <<<"$(node scripts/media/ab-windows.mjs ebur128-frames.log)"
echo "[ab] loudest 90s @ ${loud_start}s · pause ≥3s @ ${pause_start}s"

pick_abc
# fixed gain so version C-style render sits at ~ the current file's I (-18).
fixed_gain_db="-2"

render() { # <version> <start> <dur> <outfile>
  local v="$1" start="$2" dur="$3" outf="$4"
  case "$v" in
    current)
      # Slice the already-uploaded current file (download from R2 first).
      [ -f current.mp3 ] || "$RCLONE" copyto "r2:course-media/${CURRENT_KEY}" current.mp3 >/dev/null 2>&1
      ffmpeg -nostdin -y -ss "$start" -t "$dur" -i current.mp3 -c:a libmp3lame -b:a 64k "$outf" ;;
    b3)
      ffmpeg -nostdin -y -headers "$hdr" -ss "$start" -t "$dur" -i "$dl" -vn \
        -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,alimiter=limit=0.708:attack=5:release=50:level=disabled" \
        -c:a libmp3lame -b:a 64k -map_metadata -1 "$outf" ;;
    b3-fixedgain)
      ffmpeg -nostdin -y -headers "$hdr" -ss "$start" -t "$dur" -i "$dl" -vn \
        -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,volume=${fixed_gain_db}dB,alimiter=limit=0.708:attack=5:release=50:level=disabled" \
        -c:a libmp3lame -b:a 64k -map_metadata -1 "$outf" ;;
  esac
}

urls=""
for slot in A B C; do
  v="$(node -e 'process.stdout.write(require("./abc-order.json")[process.argv[1]])' -- "$slot")"
  for seg in loud pause; do
    if [ "$seg" = loud ]; then start="$loud_start"; dur=90; else start="$pause_start"; dur=6; fi
    outf="${slot}-${seg}.mp3"
    render "$v" "$start" "$dur" "$outf" || { echo "[ab] FAILED render ${outf} (version ${v})" >&2; exit 1; }
    "$RCLONE" copyto --header-upload "Cache-Control: no-store" --header-upload "Content-Type: audio/mpeg" \
      "$outf" "r2:course-media/${DEST}/${outf}" || { echo "[ab] FAILED upload ${outf}" >&2; exit 1; }
    url="${MEDIA_BASE_URL}/${DEST}/${outf}"
    http="$("$CURL" -s -o /dev/null -I -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    echo "[ab] ${outf} → HTTP ${http}"
    [ "$http" = "200" ] || { echo "[ab] FAILED verify ${url} (HTTP ${http})" >&2; exit 1; }
    urls="${urls}${url}"$'\n'
  done
done

{
  echo "### A/B/C listening clips (order is private)"
  printf '%s\n' "$urls" | sed '/^$/d' | sed 's/^/- /'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "[ab] done — 6 clips uploaded; A/B/C order written to abc-order.json (private)"
