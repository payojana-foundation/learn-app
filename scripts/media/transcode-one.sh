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
meta="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=mimeType,size,name"
hdr="Authorization: Bearer ${ACCESS_TOKEN}"$'\r\n'

# Every stage logs its own result + exit code inline (no hidden files), and the
# FIRST failing stage is the reason. $CURL is overridable for the unit test.
CURL="${CURL:-curl}"

# Immutable: never overwrite an existing key. A present key = already done.
if rclone lsf "r2:course-media/${key}" >/dev/null 2>&1; then
  echo "[$DRIVE_FILE_ID] already on R2 ($key) — skipping upload, writing manifest entry"
else
  # Stage 1: Drive metadata GET — log HTTP status, mimeType, size. A 403/404
  # here (sharing/permission) is the usual cause of an otherwise-silent failure.
  mbody="$("$CURL" -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" -w '\n%{http_code}' "$meta")"
  mcode="$(printf '%s' "$mbody" | tail -n1)"
  mjson="$(printf '%s' "$mbody" | sed '$d')"
  mmime="$(printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).mimeType||"?"))}catch{process.stdout.write("?")}})')"
  msize="$(printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).size||"?"))}catch{process.stdout.write("?")}})')"
  echo "[$DRIVE_FILE_ID] stage=drive-meta http=${mcode} mimeType=${mmime} size=${msize}"
  if [ "$mcode" != "200" ]; then
    echo "[$DRIVE_FILE_ID] FAILED stage=drive-meta: HTTP ${mcode} (check Drive sharing/permission for this id)" >&2
    exit 1
  fi

  # Stage 2: ffprobe the real type (some videos are named .mp3). Fail if no
  # audio track. Capture ffprobe stderr so a Drive-stream error is visible.
  probe_err="$(ffprobe -v error -print_format json -show_streams \
        -headers "$hdr" "$dl" 2>&1 > "probe-${DRIVE_FILE_ID}.json")"
  pcode=$?
  echo "[$DRIVE_FILE_ID] stage=ffprobe exit=${pcode}"
  if [ "$pcode" -ne 0 ]; then
    echo "[$DRIVE_FILE_ID] FAILED stage=ffprobe: ${probe_err}" >&2
    exit 1
  fi
  if ! node scripts/media/ffprobe-decide.mjs "probe-${DRIVE_FILE_ID}.json" >/dev/null; then
    echo "[$DRIVE_FILE_ID] FAILED stage=ffprobe-decide: no audio stream — nothing to transcode" >&2
    exit 1
  fi

  # Stage 3a: loudness pass 1.
  measured=$(ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
    -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" \
    -f null - 2>&1 | sed -n '/{/,/}/p')
  mi=$(echo "$measured" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write([j.input_i,j.input_tp,j.input_lra,j.input_thresh].join(" "))}catch(e){process.exit(1)}})') || {
    echo "[$DRIVE_FILE_ID] FAILED stage=ffmpeg-pass1: loudnorm measure/parse failed" >&2; exit 1; }
  echo "[$DRIVE_FILE_ID] stage=ffmpeg-pass1 exit=0 (I,TP,LRA,thresh=$mi)"
  # shellcheck disable=SC2086
  set -- $mi

  # Stage 3b: pass 2 — apply linear normalisation; 64k CBR mono 44.1 kHz.
  if ! ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
      -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$1:measured_TP=$2:measured_LRA=$3:measured_thresh=$4:linear=true" \
      -c:a libmp3lame -b:a 64k -ar 44100 "$out"; then
    echo "[$DRIVE_FILE_ID] FAILED stage=ffmpeg-pass2: transcode failed" >&2
    exit 1
  fi
  echo "[$DRIVE_FILE_ID] stage=ffmpeg-pass2 exit=0 bytes=$(stat -c%s "$out" 2>/dev/null || echo '?')"

  # Stage 4: upload immutably, straight to the final key. copyto exit + output
  # are logged; a failure here previously went unnoticed (id marked "done").
  up="$(rclone copyto --immutable \
      --header-upload "Cache-Control: public, max-age=31536000, immutable" \
      --header-upload "Content-Type: audio/mpeg" \
      "$out" "r2:course-media/${key}" 2>&1)"
  ucode=$?
  printf '%s\n' "$up"
  echo "[$DRIVE_FILE_ID] stage=rclone-copyto exit=${ucode}"
  if [ "$ucode" -ne 0 ]; then
    echo "[$DRIVE_FILE_ID] FAILED stage=rclone-copyto: ${up}" >&2
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
