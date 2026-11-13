#!/usr/bin/env bash
# scripts/media/transcode-video.sh — PART V3: transcode ONE Drive video to an
# H.264 + AAC faststart MP4 on R2 plus a WebP poster, and write
# entry-<id>.json for data/video-manifest.json. Called once per drive_file_id by
# scripts/media/batch-run.sh (TRANSCODE_ONE=scripts/media/transcode-video.sh).
# The audio pipeline (transcode-one.sh, audio keys, the -18 standard) is not
# touched; only its R2 check helpers are reused (sourced with TRANSCODE_ONE_LIB=1).
#
# Env: ACCESS_TOKEN (WIF Drive token), RENDITION (480p|720p, required),
#      VIDEO_CRF (default 23), VIDEO_AUDIO_BITRATE (default 96k),
#      MANIFEST (default data/video-manifest.json), DRY_RUN (1 = plan only).
# Keys (immutable, never overwritten):
#   video/<first 16 hex of Drive md5Checksum>-<rendition>.mp4
#   video/<first 16 hex of Drive md5Checksum>-<rendition>.webp   (poster, ~10 % in)
# Exit 0 = done, 3 = skipped (listed duplicate / key in manifest),
#      4 = R2 orphan (object, no manifest entry), other non-zero = failed.

set -uo pipefail

RCLONE="${RCLONE:-rclone}"
CURL="${CURL:-curl}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
MANIFEST="${MANIFEST:-data/video-manifest.json}"
DUPLICATES="${DUPLICATES:-data/media-duplicates.json}"
DRY_RUN="${DRY_RUN:-0}"
VIDEO_CRF="${VIDEO_CRF:-23}"
VIDEO_AUDIO_BITRATE="${VIDEO_AUDIO_BITRATE:-96k}"

# object_size + verify_on_r2 (200 + 206) from the audio script, unchanged.
# shellcheck source=/dev/null
TRANSCODE_ONE_LIB=1 source "$(dirname "${BASH_SOURCE[0]}")/transcode-one.sh"

DRIVE_FILE_ID="${1:-}"
[ -n "$DRIVE_FILE_ID" ] || { echo "usage: transcode-video.sh <drive_file_id>" >&2; exit 2; }
[ -n "${ACCESS_TOKEN:-}" ] || { echo "ACCESS_TOKEN not set" >&2; exit 2; }
case "${RENDITION:-}" in
  480p) height=480 ;;
  720p) height=720 ;;
  *) echo "[$DRIVE_FILE_ID] FAILED: RENDITION must be 480p or 720p (repo variable VIDEO_RENDITION)" >&2; exit 2 ;;
esac
[[ "$VIDEO_CRF" =~ ^[0-9]{1,2}$ ]] || { echo "VIDEO_CRF must be a number" >&2; exit 2; }
[[ "$VIDEO_AUDIO_BITRATE" =~ ^[0-9]{2,3}k$ ]] || { echo "VIDEO_AUDIO_BITRATE like 96k" >&2; exit 2; }

nn() { local code="$1"; shift; node -e "$code" -- "$@"; }

refresh_token() {
  [ -n "${REFRESH_TOKEN_CMD:-}" ] || return 0
  local t; t="$(eval "$REFRESH_TOKEN_CMD" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$t" ] && ACCESS_TOKEN="$t"
  return 0
}
refresh_token

if [ -f "$DUPLICATES" ] && nn 'const l=require("fs").readFileSync(process.argv[1],"utf8");process.exit(JSON.parse(l).includes(process.argv[2])?0:1)' "$DUPLICATES" "$DRIVE_FILE_ID"; then
  echo "[$DRIVE_FILE_ID] SKIPPED: listed duplicate" >&2
  echo "::skip-reason::listed duplicate"
  exit 3
fi

meta="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=name,mimeType,size,md5Checksum&supportsAllDrives=true"
drive_meta() { "$CURL" -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" -w '\n%{http_code}' "$meta"; }
mbody="$(drive_meta)"
mcode="$(printf '%s' "$mbody" | tail -n1)"
if [ "$mcode" = "401" ]; then refresh_token; mbody="$(drive_meta)"; mcode="$(printf '%s' "$mbody" | tail -n1)"; fi
mjson="$(printf '%s' "$mbody" | sed '$d')"
meta_field() { printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)[process.argv[1]]||""))}catch{process.stdout.write("")}})' -- "$1"; }
drive_name="$(meta_field name)"
md5="$(meta_field md5Checksum)"
echo "[$DRIVE_FILE_ID] stage=drive-meta http=${mcode} md5=${md5:-none}"
[ "$mcode" = "200" ] || { echo "[$DRIVE_FILE_ID] FAILED stage=drive-meta: HTTP ${mcode}" >&2; exit 1; }
md5hex="$(printf '%s' "$md5" | tr '[:upper:]' '[:lower:]' | grep -oE '^[0-9a-f]{16}' || true)"
[ -n "$md5hex" ] || { echo "[$DRIVE_FILE_ID] FAILED stage=key: no hex md5Checksum" >&2; exit 1; }

key="video/${md5hex}-${RENDITION}.mp4"
poster_key="video/${md5hex}-${RENDITION}.webp"
echo "[$DRIVE_FILE_ID] stage=key key=${key} poster=${poster_key}"

# Orphan guard: an existing key is skipped only when the video manifest lists it.
existing="$(object_size "$key")"
if [ -n "$existing" ] && [ "$existing" -gt 0 ] 2>/dev/null; then
  if nn 'const fs=require("fs");const m=fs.existsSync(process.argv[1])?JSON.parse(fs.readFileSync(process.argv[1],"utf8")):[];process.exit((Array.isArray(m)?m:[]).some(e=>e&&e.key===process.argv[2])?0:1)' "$MANIFEST" "$key"; then
    echo "[$DRIVE_FILE_ID] SKIPPED: key exists (${key})" >&2
    echo "::skip-reason::key exists"
    exit 3
  fi
  echo "[$DRIVE_FILE_ID] ORPHAN: ${key} is on R2 without a manifest entry" >&2
  echo "::skip-reason::R2 object without manifest entry"
  exit 4
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[$DRIVE_FILE_ID] DRY-RUN would encode ${RENDITION} → ${key} + ${poster_key} (no download, no upload, no manifest)"
  exit 0
fi

src="vsrc-${md5hex}.bin"
out="vout-${md5hex}-${RENDITION}.mp4"
poster="vout-${md5hex}-${RENDITION}.webp"
# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup_work() { rm -f "$src" "$out" "$poster"; }
trap 'cleanup_work' EXIT

dl="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&supportsAllDrives=true"
if ! "$CURL" -fsSL -H "Authorization: Bearer ${ACCESS_TOKEN}" "$dl" -o "$src"; then
  refresh_token
  "$CURL" -fsSL -H "Authorization: Bearer ${ACCESS_TOKEN}" "$dl" -o "$src" || { echo "[$DRIVE_FILE_ID] FAILED stage=download" >&2; exit 1; }
fi
src_dur="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$src" 2>/dev/null | head -n1)"
has_v="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "$src" 2>/dev/null | head -n1)"
[ "$has_v" = "video" ] || { echo "[$DRIVE_FILE_ID] FAILED stage=ffprobe: no video stream" >&2; exit 1; }

# H.264 veryfast + AAC, faststart, never upscaled.
if ! "$FFMPEG" -nostdin -hide_banner -loglevel error -y -i "$src" \
  -vf "scale=-2:'min(${height},ih)'" -c:v libx264 -preset veryfast -crf "$VIDEO_CRF" -pix_fmt yuv420p \
  -c:a aac -b:a "$VIDEO_AUDIO_BITRATE" -movflags +faststart "$out"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=encode" >&2; exit 1
fi
out_dur="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null | head -n1)"
if ! nn 'const a=Number(process.argv[1]),b=Number(process.argv[2]);process.exit(a>0&&b>0&&Math.abs(a-b)<=1?0:1)' "${out_dur:-0}" "${src_dur:-0}"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=duration: ${out_dur}s vs source ${src_dur}s (> ±1 s)" >&2; exit 1
fi
width="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$out" | head -n1)"
oh="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$out" | head -n1)"

# Poster: one frame ~10 % in, WebP.
at="$(nn 'process.stdout.write((Number(process.argv[1])*0.1).toFixed(1))' "$out_dur")"
"$FFMPEG" -nostdin -hide_banner -loglevel error -y -ss "$at" -i "$out" -frames:v 1 -c:v libwebp -quality 80 "$poster" || rm -f "$poster"

bytes=$(stat -c%s "$out")
sha=$(sha256sum "$out" | cut -d' ' -f1)
write_entry() {
  # $1 = poster key or empty
  nn 'const fs=require("fs");const a=process.argv;const o={kind:"video",drive_file_id:a[1],drive_name:a[2],source_md5:a[3],key:a[4],poster_key:a[5]||null,rendition:a[6],bytes:Number(a[7])||0,duration_s:Math.round(Number(a[8])||0),src_duration_s:Math.round(Number(a[9])||0),width:Number(a[10])||0,height:Number(a[11])||0,sha256:a[12]};if(!/^[0-9a-f]{64}$/.test(o.sha256)){console.error("bad sha");process.exit(1)}fs.writeFileSync("entry-"+a[1]+".json",JSON.stringify(o))' \
    "$DRIVE_FILE_ID" "$drive_name" "$md5" "$key" "$1" "$RENDITION" "$bytes" "$out_dur" "$src_dur" "${width:-0}" "${oh:-0}" "$sha"
}

up="$("$RCLONE" copyto --immutable \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --header-upload "Content-Type: video/mp4" \
  "$out" "r2:course-media/${key}" 2>&1)" || { printf '%s\n' "$up"; echo "[$DRIVE_FILE_ID] FAILED stage=rclone-copyto" >&2; exit 1; }
# The entry is written RIGHT AFTER the video upload (manifest-first save): the
# object is on R2 now, so it must never be left without an entry.
write_entry "" || { echo "[$DRIVE_FILE_ID] could not build a valid manifest entry" >&2; exit 1; }

if [ -f "$poster" ] && "$RCLONE" copyto --immutable \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --header-upload "Content-Type: image/webp" \
  "$poster" "r2:course-media/${poster_key}" >/dev/null 2>&1; then
  write_entry "$poster_key" || true
else
  echo "::warning title=Poster missing::[$DRIVE_FILE_ID] no poster uploaded; the entry has poster_key null"
fi

remote_size="$(object_size "$key")"
[ "${remote_size:-0}" = "$bytes" ] || { echo "[$DRIVE_FILE_ID] FAILED stage=verify: remote size ${remote_size} != local ${bytes}" >&2; exit 1; }
verify_on_r2 "$key" || { echo "[$DRIVE_FILE_ID] FAILED stage=verify: 200/206 check failed for ${key}" >&2; exit 1; }
echo "[$DRIVE_FILE_ID] done → $key"
exit 0
