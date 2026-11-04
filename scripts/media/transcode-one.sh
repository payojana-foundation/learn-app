#!/usr/bin/env bash
# scripts/media/transcode-one.sh — Job B v2 (docs/job-b-v2.md): transcode ONE
# Drive recording to a normalised 64 kbps mono MP3 on R2 and write
# entry-<id>.json for the manifest step. Called once per drive_file_id.
#
# Requires in the environment: ACCESS_TOKEN (WIF Drive access token).
# Key = audio/<first 16 hex of Drive md5Checksum>-a64.mp3 (B2).
# B3 (approved 3 Nov, "G loop"): the source is downloaded ONCE, its audio
# extracted to a local file, and every pass runs on that file. G is tuned on the
# LIMITED signal (null passes, max 3), capped at depth 12 with a measured I_cap;
# then ONE mp3 encode, accepted on the mp3 (see scripts/media/b3-decide.mjs).
# Exit 0 = done, 3 = skipped (listed duplicate / key exists), non-zero = failed.
#
# DRY_RUN=1: the same loop (null passes only) — no encode, no upload, no manifest;
# writes dryrun-<id>.json for the run-summary table.

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

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/b3-loop.sh"

DRIVE_FILE_ID="${1:-}"
if [ -z "$DRIVE_FILE_ID" ]; then
  echo "usage: transcode-one.sh <drive_file_id>" >&2
  exit 2
fi
if [ -z "${ACCESS_TOKEN:-}" ]; then
  echo "ACCESS_TOKEN not set" >&2
  exit 2
fi
export B3_LOG="$DRIVE_FILE_ID"

DUPLICATES="${DUPLICATES:-data/media-duplicates.json}"
EXCEPTIONS="${EXCEPTIONS:-data/media-exceptions.json}"
DRY_RUN="${DRY_RUN:-0}"   # 1 = measure + log only; no upload, no manifest
# TARGET_I: the ONE target-loudness constant (default -16); set -18 to retarget
# a whole course. Keep in sync with TARGET_I in b3-decide.mjs.
TARGET_I="${TARGET_I:--16}"

# nn <args…> — run `node -e` passing args after `--` so a leading-dash value
# (e.g. a negative LUFS like -16.5) is NOT parsed by node as an option.
# (fixes "node: bad option").
nn() { local code="$1"; shift; node -e "$code" -- "$@"; }

meta="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=name,mimeType,size,md5Checksum"

# Drive tokens expire after ~60 min. If REFRESH_TOKEN_CMD is set (the workflow
# supplies a gcloud command that prints a fresh access token), re-mint the token
# before EACH file, and once more on a 401.
refresh_token() {
  [ -n "${REFRESH_TOKEN_CMD:-}" ] || return 0
  local t; t="$(eval "$REFRESH_TOKEN_CMD" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$t" ] && ACCESS_TOKEN="$t"
  return 0
}
refresh_token

# B1: never convert a listed duplicate.
if [ -f "$DUPLICATES" ] && nn 'const l=require("fs").readFileSync(process.argv[1],"utf8");process.exit(JSON.parse(l).includes(process.argv[2])?0:1)' "$DUPLICATES" "$DRIVE_FILE_ID"; then
  echo "[$DRIVE_FILE_ID] SKIPPED: listed duplicate" >&2
  echo "::skip-reason::listed duplicate"
  exit 3
fi

# B1: Drive files.get (name, mimeType, size, md5Checksum) — no download yet.
drive_meta() { "$CURL" -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" -w '\n%{http_code}' "$meta"; }
mbody="$(drive_meta)"
mcode="$(printf '%s' "$mbody" | tail -n1)"
if [ "$mcode" = "401" ]; then
  # Token expired mid-run → refresh once and retry.
  echo "[$DRIVE_FILE_ID] drive-meta 401 — refreshing token and retrying once" >&2
  refresh_token
  mbody="$(drive_meta)"
  mcode="$(printf '%s' "$mbody" | tail -n1)"
fi
mjson="$(printf '%s' "$mbody" | sed '$d')"
meta_field() { printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)[process.argv[1]]||""))}catch{process.stdout.write("")}})' -- "$1"; }
drive_name="$(meta_field name)"
msize="$(meta_field size)"
md5="$(meta_field md5Checksum)"
echo "[$DRIVE_FILE_ID] stage=drive-meta http=${mcode} size=${msize} md5=${md5:-none} name=${drive_name}"
if [ "$mcode" != "200" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=drive-meta: HTTP ${mcode} (token expired or no access)" >&2
  exit 1
fi
if [ -z "$md5" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=drive-meta: no md5Checksum" >&2
  exit 1
fi

# B2: key = audio/<first 16 hex of md5Checksum>-a64.mp3 (NOT the drive id).
md5hex="$(printf '%s' "$md5" | tr '[:upper:]' '[:lower:]' | grep -oE '^[0-9a-f]{16}')"
if [ -z "$md5hex" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=key: md5Checksum is not hex" >&2
  exit 1
fi
key="audio/${md5hex}-a64.mp3"
out="out-${md5hex}-a64.mp3"
echo "[$DRIVE_FILE_ID] stage=key key=${key} source_md5=${md5}"

# B1: duplicate guard — if the key already exists (size > 0), skip before any
# download. Checked AFTER the key is known (depends on md5).
existing="$(object_size "$key")"
if [ -n "$existing" ] && [ "$existing" -gt 0 ] 2>/dev/null; then
  echo "[$DRIVE_FILE_ID] SKIPPED: key exists (${key}, ${existing} bytes)" >&2
  echo "::skip-reason::key exists"
  exit 3
fi

# Speed: download the source ONCE, extract the audio to a local file, run every
# pass on it, and delete everything after this file (also on failure).
work_src="src-${md5hex}.bin"
work_base="aud-${md5hex}"
# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup_work() { rm -f "$work_src" "${work_base}.mka" "${work_base}.flac" "$out" "ffmpeg-${md5hex}.err"; }
trap 'cleanup_work' EXIT
aud="$(b3_fetch_audio "$DRIVE_FILE_ID" "$work_src" "$work_base")" || {
  echo "[$DRIVE_FILE_ID] FAILED stage=download: could not fetch/extract audio (token expired or no access)" >&2
  exit 1
}
echo "[$DRIVE_FILE_ID] stage=extract file=${aud} bytes=$(stat -c%s "$aud")"

chans="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$aud" 2>/dev/null | head -n1)"
if [ -z "$chans" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=ffprobe: no audio stream" >&2
  exit 1
fi
pan_af=""
[ "$chans" -ge 2 ] 2>/dev/null && pan_af="pan=mono|c0=0.5*c0+0.5*c1"
src_dur="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$aud" 2>/dev/null | cut -d. -f1)"

# Exception lookup for this id (accept_I ≥ -18: same loop at accept_I, depth ignored).
exc_i="$(node -e 'try{const l=require("fs").readFileSync(process.argv[1],"utf8");const e=(JSON.parse(l)||[]).find(x=>x.drive_file_id===process.argv[2]);process.stdout.write(e&&Number.isFinite(e.accept_I)?String(e.accept_I):"")}catch{process.stdout.write("")}' "$EXCEPTIONS" "$DRIVE_FILE_ID" 2>/dev/null)"

# B3 G loop (null passes of the FULL chain incl. alimiter; max 3 + cap).
limit="0.708"
state="$(b3_gloop "$aud" "$pan_af" "$TARGET_I" "$exc_i")"
result="$(b3_field "$state" result)"
G="$(b3_field "$state" G)"
loops="$(b3_field "$state" loop)"
depth="$(b3_field "$state" depth)"
i_final="$(b3_field "$state" I_final)"
expect_i="$(b3_field "$state" expectI)"
p1_i="$(b3_field "$state" I1)"
p1_tp="$(b3_field "$state" TP1)"
p1_lra="$(b3_field "$state" LRA1)"
busy="$(b3_busy "$aud" "$pan_af" "$G")"
echo "[$DRIVE_FILE_ID] stage=gloop-result result=${result} loops=${loops} G=${G} I_lim_or_cap=${i_final} depth=${depth} busy=${busy} (busy logged only) $(b3_field "$state" reason)"

if [ "$DRY_RUN" = "1" ]; then
  printf '%s' "$state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);o.id=process.argv[1];o.busy=Number(process.argv[2]);require("fs").writeFileSync("dryrun-"+process.argv[1]+".json",JSON.stringify(o))})' -- "$DRIVE_FILE_ID" "${busy:-0}"
  echo "[$DRIVE_FILE_ID] DRY-RUN expected_result=${result} (no encode, no upload, no manifest)"
  if [ "$result" = "failed" ]; then
    echo "[$DRIVE_FILE_ID] DRY-RUN failed: 5 loudest peaks above ceiling at s: $(b3_peak_timestamps "$aud" "$pan_af" "$G" || true)"
  fi
  exit 0
fi

if [ "$result" = "failed" ]; then
  # The 5 largest peaks above the ceiling: the coordinator listens only there.
  peaks="$(b3_peak_timestamps "$aud" "$pan_af" "$G")"
  echo "[$DRIVE_FILE_ID] FAILED stage=gloop: $(b3_field "$state" reason) — 5 loudest peaks above ceiling at s: ${peaks:-none}" >&2
  exit 1
fi

# Encode ONCE: pan → volume G → aresample 44100 → alimiter 0.708 → mp3 64k mono.
if ! "$FFMPEG" -nostdin -y -i "$aud" -vn -af "$(b3_chain "$pan_af" "$G")" \
    -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 -map_metadata -1 "$out" 2>"ffmpeg-${md5hex}.err"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=encode: $(tail -n 3 "ffmpeg-${md5hex}.err" | tr '\n' ' ')" >&2
  exit 1
fi
read -r out_i out_tp out_lra <<<"$(b3_ebur "$out" "")"
out_dur="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1)"
echo "[$DRIVE_FILE_ID] stage=encode G=${G} limit=${limit} out_I=${out_i} out_TP=${out_tp} out_LRA=${out_lra} dur=${out_dur}/${src_dur} result=${result}"

# Accept on the FINISHED mp3: I within expected ±0.5 (ok → target, cap → I_cap,
# exception → accept_I), TP ≤ -1.5, duration ±1 s.
if ! nn 'const i=parseFloat(process.argv[1]),e=parseFloat(process.argv[2]);process.exit(Math.abs(i-e)<=0.5?0:1)' "$out_i" "$expect_i"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: finished I=${out_i} outside ${expect_i} ±0.5 (result ${result})" >&2
  exit 1
fi
if ! nn 'const t=parseFloat(process.argv[1]);process.exit(t<=-1.5?0:1)' "$out_tp"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: finished TP=${out_tp} > -1.5 dBTP" >&2
  exit 1
fi
if ! nn 'process.exit(Math.abs((parseInt(process.argv[1],10)||0)-(parseInt(process.argv[2],10)||0))<=1?0:1)' "${out_dur:-0}" "${src_dur:-0}"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: duration ${out_dur}s vs source ${src_dur}s (> ±1 s)" >&2
  exit 1
fi
echo "[$DRIVE_FILE_ID] stage=result result=${result}"

# B5 upload: rclone copy --immutable, then verify (size == local, 200, 206).
bytes=$(stat -c%s "$out")
dur=$("$FFPROBE" -v quiet -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1)
sha=$(sha256sum "$out" | cut -d' ' -f1)
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
remote_size="$(object_size "$key")"
if [ "${remote_size:-0}" != "$bytes" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=verify: remote size ${remote_size} != local ${bytes}" >&2
  exit 1
fi
if ! verify_on_r2 "$key"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=verify: 200/206 check failed for ${key}" >&2
  exit 1
fi

# B4: manifest entry.
LESSON_CODE="${LESSON_CODE:-}"
nn 'const fs=require("fs");const a=process.argv;const o={lesson_code:a[11]||null,drive_file_id:a[1],drive_name:a[2],source_md5:a[3],key:a[4],bytes:Number(a[5])||0,duration_s:Number(a[6])||0,sha256:a[7],loudness:{pass1:{I:Number(a[8].split(",")[0]),TP:Number(a[8].split(",")[1]),LRA:Number(a[8].split(",")[2])},G:Number(a[9].split(",")[0]),limit:Number(a[9].split(",")[1]),depth:Number(a[12].split(",")[0]),busy:Number(a[12].split(",")[1]),out:{I:Number(a[10].split(",")[0]),TP:Number(a[10].split(",")[1]),LRA:Number(a[10].split(",")[2])},loops:Number(a[9].split(",")[2]),result:a[13]||null}};if(!/^[0-9a-f]{64}$/.test(o.sha256)){console.error("bad sha");process.exit(1)}fs.writeFileSync("entry-"+a[1]+".json",JSON.stringify(o))' \
  "$DRIVE_FILE_ID" "$drive_name" "$md5" "$key" "${bytes:-0}" "${dur:-0}" "${sha:-}" \
  "${p1_i},${p1_tp},${p1_lra}" "${G},${limit},${loops}" "${out_i},${out_tp},${out_lra}" "$LESSON_CODE" \
  "${depth},${busy}" "$result" || {
    echo "[$DRIVE_FILE_ID] could not build a valid manifest entry" >&2; exit 1; }

echo "[$DRIVE_FILE_ID] done → $key"
exit 0
