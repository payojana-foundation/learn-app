#!/usr/bin/env bash
# scripts/media/transcode-one.sh — transcode ONE Drive recording to a
# normalised 64 kbps mono MP3 on R2 and write entry-<id>.json for the manifest
# step (Q3, course-audio.yml). Called once per drive_file_id by the batch loop.
#
# Requires in the environment: ACCESS_TOKEN (WIF Drive access token).
# Immutable: if the R2 key already exists, this is a no-op success (the id is
# "done" without re-uploading). Exit 0 on success/skip, non-zero on failure.
#
# This is the same pilot pipeline as before, factored into a per-file script so
# the workflow can run several in parallel and keep going past a single failure.

set -uo pipefail

# Overridable commands + public base so the verifier is unit-testable with stubs.
RCLONE="${RCLONE:-rclone}"
CURL="${CURL:-curl}"
MEDIA_BASE_URL="${MEDIA_BASE_URL:-https://media.84000.digital}"
MEDIA_BASE_URL="${MEDIA_BASE_URL%/}"

# verify_on_r2 <key> — true only when the object exists in R2 with size > 0 AND
# its public URL returns HTTP 200. Logs each check (no secrets).
verify_on_r2() {
  vkey="$1"
  size="$("$RCLONE" lsjson "r2:course-media/${vkey}" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);process.stdout.write(String((a[0]&&a[0].Size)||0))}catch{process.stdout.write("0")}})')"
  echo "[verify] rclone lsjson r2:course-media/${vkey} → size=${size:-0}"
  if [ -z "$size" ] || [ "$size" -le 0 ] 2>/dev/null; then
    echo "[verify] object missing or empty on R2" >&2
    return 1
  fi
  url="${MEDIA_BASE_URL}/${vkey}"
  http="$("$CURL" -s -o /dev/null -I -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  echo "[verify] curl -I ${url} → HTTP ${http}"
  if [ "$http" != "200" ]; then
    echo "[verify] public URL did not return 200" >&2
    return 1
  fi
  return 0
}

# Sourced by the unit test to exercise verify_on_r2 without running a transcode:
# when TRANSCODE_ONE_LIB=1 we stop here (the test sources the file, so `return`
# is valid and nothing below runs).
if [ "${TRANSCODE_ONE_LIB:-0}" = "1" ]; then
  return 0
fi

DRIVE_FILE_ID="${1:-}"
if [ -z "$DRIVE_FILE_ID" ]; then
  echo "usage: transcode-one.sh <drive_file_id>" >&2
  exit 2
fi
if [ -z "${ACCESS_TOKEN:-}" ]; then
  echo "ACCESS_TOKEN not set" >&2
  exit 2
fi

# Key convention (DNS-desk rules, 28–30 Oct): the normalised audio lives ONLY
# under `course-media` at `audio/<drive_file_id>-a64.mp3`. A corrected recording
# is re-uploaded under `audio/<drive_file_id>-a64-v2.mp3` (never an overwrite).
# The key is derived from the Drive file id above (which is required, else this
# script already exited 2) — never invented from anything else. This script
# NEVER writes to the `course-originals` bucket.
key="audio/${DRIVE_FILE_ID}-a64.mp3"
out="out-${DRIVE_FILE_ID}-a64.mp3"
dl="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media"
hdr="Authorization: Bearer ${ACCESS_TOKEN}"$'\r\n'

# Immutable: never overwrite an existing key. A present key = already done.
if rclone lsf "r2:course-media/${key}" >/dev/null 2>&1; then
  echo "[$DRIVE_FILE_ID] already on R2 ($key) — skipping upload, writing manifest entry"
else
  # Probe the real type (some videos are named .mp3). Fail if no audio track.
  if ! ffprobe -v quiet -print_format json -show_streams \
        -headers "$hdr" "$dl" > "probe-${DRIVE_FILE_ID}.json"; then
    echo "[$DRIVE_FILE_ID] ffprobe failed" >&2
    exit 1
  fi
  if ! node scripts/media/ffprobe-decide.mjs "probe-${DRIVE_FILE_ID}.json" >/dev/null; then
    echo "[$DRIVE_FILE_ID] no audio stream — nothing to transcode" >&2
    exit 1
  fi

  # Pass 1: measure loudness.
  measured=$(ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
    -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" \
    -f null - 2>&1 | sed -n '/{/,/}/p')
  mi=$(echo "$measured" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write([j.input_i,j.input_tp,j.input_lra,j.input_thresh].join(" "))}catch(e){process.exit(1)}})') || {
    echo "[$DRIVE_FILE_ID] loudnorm pass-1 parse failed" >&2; exit 1; }
  # shellcheck disable=SC2086
  set -- $mi

  # Pass 2: apply linear normalisation; 64k CBR mono 44.1 kHz.
  if ! ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
      -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$1:measured_TP=$2:measured_LRA=$3:measured_thresh=$4:linear=true" \
      -c:a libmp3lame -b:a 64k -ar 44100 "$out"; then
    echo "[$DRIVE_FILE_ID] ffmpeg pass-2 failed" >&2
    exit 1
  fi

  # Upload immutably. A failed copy/move previously went UNNOTICED (exit code
  # ignored), so the id was marked "done" with nothing in R2. Check both.
  if ! rclone copy --immutable \
      --header-upload "Cache-Control: public, max-age=31536000, immutable" \
      --header-upload "Content-Type: audio/mpeg" \
      "$out" "r2:course-media/audio/"; then
    echo "[$DRIVE_FILE_ID] rclone copy to R2 failed" >&2
    exit 1
  fi
  if ! rclone moveto "r2:course-media/audio/${out}" "r2:course-media/${key}"; then
    echo "[$DRIVE_FILE_ID] rclone moveto to final key failed" >&2
    exit 1
  fi
fi

# VERIFY before claiming success: the object must exist in R2 with size > 0 AND
# the public URL must return 200. Without this, a silent upload failure (or a
# bucket/endpoint misconfig) still reported "done" with an empty bucket.
if ! verify_on_r2 "$key"; then
  echo "[$DRIVE_FILE_ID] R2/public verification failed for $key — NOT done" >&2
  exit 1
fi

# Build the manifest entry. If the local transcode exists, use it; else probe R2.
if [ -f "$out" ]; then
  bytes=$(stat -c%s "$out")
  dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1)
  sha=$(sha256sum "$out" | cut -d' ' -f1)
else
  # Key existed already: fetch size + hash from R2 for a faithful entry.
  bytes=$(rclone size "r2:course-media/${key}" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).bytes||0))}catch{process.stdout.write("0")}})')
  rclone copyto "r2:course-media/${key}" "r2-${DRIVE_FILE_ID}.mp3" >/dev/null 2>&1 || true
  if [ -f "r2-${DRIVE_FILE_ID}.mp3" ]; then
    dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "r2-${DRIVE_FILE_ID}.mp3" | cut -d. -f1)
    sha=$(sha256sum "r2-${DRIVE_FILE_ID}.mp3" | cut -d' ' -f1)
  else
    dur=0
    sha=""
  fi
fi

node -e 'const fs=require("fs");const o={drive_file_id:process.argv[1],key:process.argv[2],bytes:Number(process.argv[3])||0,duration_s:Number(process.argv[4])||0,sha256:process.argv[5]};if(!/^[0-9a-f]{64}$/.test(o.sha256)){console.error("bad sha for "+o.drive_file_id);process.exit(1)}fs.writeFileSync("entry-"+o.drive_file_id+".json",JSON.stringify(o))' \
  "$DRIVE_FILE_ID" "$key" "${bytes:-0}" "${dur:-0}" "${sha:-}" || {
    echo "[$DRIVE_FILE_ID] could not build a valid manifest entry" >&2; exit 1; }

echo "[$DRIVE_FILE_ID] done → $key"
exit 0
