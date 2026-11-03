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
# object_size <key> — bytes of the R2 object (0 if missing/empty/unparseable).
# Empty lsjson output (e.g. no_check_bucket quirks) parses to 0 = not present.
object_size() {
  "$RCLONE" lsjson "r2:course-media/${1}" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);process.stdout.write(String((a[0]&&a[0].Size)||0))}catch{process.stdout.write("0")}})'
}

verify_on_r2() {
  vkey="$1"
  size="$(object_size "$vkey")"
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
  # Range request must be honoured (the player seeks) — expect 206.
  rng="$("$CURL" -s -o /dev/null -r 0-99 -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  echo "[verify] curl -r 0-99 ${url} → HTTP ${rng}"
  if [ "$rng" != "206" ]; then
    echo "[verify] range request did not return 206" >&2
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

# FORCE (set from the workflow's force_ids input): re-measure an already-
# uploaded id WITHOUT re-uploading. Default off.
FORCE="${FORCE:-0}"

# Drive metadata GET up front so drive_name is in the log + entry on every path
# (skip, force, full). A 403/404 here (sharing) is the usual silent-fail cause.
mbody="$("$CURL" -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" -w '\n%{http_code}' "$meta")"
mcode="$(printf '%s' "$mbody" | tail -n1)"
mjson="$(printf '%s' "$mbody" | sed '$d')"
mmime="$(printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).mimeType||"?"))}catch{process.stdout.write("?")}})')"
msize="$(printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).size||"?"))}catch{process.stdout.write("?")}})')"
drive_name="$(printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).name||""))}catch{process.stdout.write("")}})')"
echo "[$DRIVE_FILE_ID] stage=drive-meta http=${mcode} mimeType=${mmime} size=${msize} name=${drive_name}"

# Immutable: never overwrite an existing key. "Already on R2" ONLY if lsjson
# shows an object with size > 0 (the same proof verify uses) — `rclone lsf` with
# no_check_bucket returned exit 0 + empty output for a MISSING key.
existing="$(object_size "$key")"
present=0
[ -n "$existing" ] && [ "$existing" -gt 0 ] 2>/dev/null && present=1
echo "[$DRIVE_FILE_ID] stage=r2-precheck key=$key size=${existing:-0} force=${FORCE}"

if [ "$present" = "1" ]; then
  # Already uploaded. FORCE or not, we NEVER re-upload (immutable); we re-measure
  # the R2 copy below. FORCE only matters upstream (queue-plan lets the id past
  # the manifest-skip so it reaches here).
  echo "[$DRIVE_FILE_ID] on R2 ($key, ${existing} bytes) — no upload; re-measuring"
else
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
  # loudnorm prints its applied-measurement JSON to stderr (print_format=json);
  # capture it so output_i/tp/lra/normalization_type are logged + go in the entry.
  p2err="$(ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
      -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$1:measured_TP=$2:measured_LRA=$3:measured_thresh=$4:linear=true:print_format=json" \
      -c:a libmp3lame -b:a 64k -ar 44100 "$out" 2>&1)"
  p2code=$?
  if [ "$p2code" -ne 0 ]; then
    echo "[$DRIVE_FILE_ID] FAILED stage=ffmpeg-pass2: ${p2err}" >&2
    exit 1
  fi
  ln_json="$(printf '%s' "$p2err" | sed -n '/{/,/}/p')"
  ln_out="$(printf '%s' "$ln_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write([j.output_i,j.output_tp,j.output_lra,j.normalization_type].join(" "))}catch{process.stdout.write("? ? ? ?")}})')"
  norm_type="$(printf '%s' "$ln_out" | awk '{print $4}')"
  echo "[$DRIVE_FILE_ID] stage=ffmpeg-pass2 exit=0 bytes=$(stat -c%s "$out" 2>/dev/null || echo '?') loudnorm(out_i,out_tp,out_lra,norm_type=$ln_out)"

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

# Build the manifest entry from a LOCAL copy of the finished mp3: the just-
# transcoded $out, or (present/force path) the object pulled back from R2.
mp3="$out"
if [ ! -f "$mp3" ]; then
  rclone copyto "r2:course-media/${key}" "r2-${DRIVE_FILE_ID}.mp3" >/dev/null 2>&1 || true
  mp3="r2-${DRIVE_FILE_ID}.mp3"
fi
if [ ! -f "$mp3" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=entry: no local mp3 to measure" >&2
  exit 1
fi
bytes=$(stat -c%s "$mp3")
dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$mp3" | cut -d. -f1)
sha=$(sha256sum "$mp3" | cut -d' ' -f1)

# Measure the FINISHED mp3 with EBU R128: integrated loudness + true peak.
eb="$(ffmpeg -hide_banner -nostdin -i "$mp3" -af ebur128=peak=true -f null - 2>&1)"
lufs_i="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
true_peak_db="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
echo "[$DRIVE_FILE_ID] stage=ebur128 lufs_i=${lufs_i:-?} true_peak_db=${true_peak_db:-?}"
# Flag (do NOT fail) if outside target: I in -17..-15 LUFS, true peak ≤ -1.0 dBTP.
flag="$(node -e 'const i=parseFloat(process.argv[1]),p=parseFloat(process.argv[2]);const bad=[];if(!(i>=-17&&i<=-15))bad.push("I "+process.argv[1]+" outside -17..-15");if(!(p<=-1.0))bad.push("true peak "+process.argv[2]+" > -1.0");process.stdout.write(bad.join("; "))' "${lufs_i:-NaN}" "${true_peak_db:-NaN}")"
[ -n "$flag" ] && echo "[$DRIVE_FILE_ID] LOUDNESS FLAG: $flag"

node -e 'const fs=require("fs");const o={drive_file_id:process.argv[1],drive_name:process.argv[2],key:process.argv[3],bytes:Number(process.argv[4])||0,duration_s:Number(process.argv[5])||0,sha256:process.argv[6],lufs_i:process.argv[7]===""?null:Number(process.argv[7]),true_peak_db:process.argv[8]===""?null:Number(process.argv[8]),normalization_type:process.argv[9]||null,loudness_flag:process.argv[10]||null};if(!/^[0-9a-f]{64}$/.test(o.sha256)){console.error("bad sha for "+o.drive_file_id);process.exit(1)}fs.writeFileSync("entry-"+o.drive_file_id+".json",JSON.stringify(o))' \
  "$DRIVE_FILE_ID" "$drive_name" "$key" "${bytes:-0}" "${dur:-0}" "${sha:-}" "${lufs_i:-}" "${true_peak_db:-}" "${norm_type:-}" "$flag" || {
    echo "[$DRIVE_FILE_ID] could not build a valid manifest entry" >&2; exit 1; }

echo "[$DRIVE_FILE_ID] done → $key"
exit 0
