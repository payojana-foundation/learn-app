#!/usr/bin/env bash
# scripts/media/transcode-one.sh — Job B v2 (docs/job-b-v2.md): transcode ONE
# Drive recording to a normalised 64 kbps mono MP3 on R2 and write
# entry-<id>.json for the manifest step. Called once per drive_file_id.
#
# Requires in the environment: ACCESS_TOKEN (WIF Drive access token).
# Key = audio/<first 16 hex of Drive md5Checksum>-a64.mp3 (B2). Loudness is the
# ebur128 → volume → alimiter chain with a 3-loop feedback (B3); accept only
# I = -16 ±0.5 LUFS AND TP ≤ -1.5 dBTP, else fail with no upload.
# Exit 0 = done, 3 = skipped (listed duplicate / key exists), non-zero = failed.

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

CURL="${CURL:-curl}"
DUPLICATES="${DUPLICATES:-data/media-duplicates.json}"
EXCEPTIONS="${EXCEPTIONS:-data/media-exceptions.json}"
DRY_RUN="${DRY_RUN:-0}"   # 1 = measure + log only; no upload, no manifest

# nn <args…> — run `node -e` passing args after `--` so a leading-dash value
# (e.g. a negative LUFS like -16.5) is NOT parsed by node as an option.
# (fixes "node: bad option").
nn() { local code="$1"; shift; node -e "$code" -- "$@"; }

dl="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media"
meta="https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=name,mimeType,size,md5Checksum"
hdr="Authorization: Bearer ${ACCESS_TOKEN}"$'\r\n'

# B1: never convert a listed duplicate.
if [ -f "$DUPLICATES" ] && nn 'const l=require("fs").readFileSync(process.argv[1],"utf8");process.exit(JSON.parse(l).includes(process.argv[2])?0:1)' "$DUPLICATES" "$DRIVE_FILE_ID"; then
  echo "[$DRIVE_FILE_ID] SKIPPED: listed duplicate" >&2
  echo "::skip-reason::listed duplicate"
  exit 3
fi

# B1: Drive files.get (name, mimeType, size, md5Checksum) — no download yet.
mbody="$("$CURL" -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" -w '\n%{http_code}' "$meta")"
mcode="$(printf '%s' "$mbody" | tail -n1)"
mjson="$(printf '%s' "$mbody" | sed '$d')"
meta_field() { printf '%s' "$mjson" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)[process.argv[1]]||""))}catch{process.stdout.write("")}})' -- "$1"; }
drive_name="$(meta_field name)"
msize="$(meta_field size)"
md5="$(meta_field md5Checksum)"
echo "[$DRIVE_FILE_ID] stage=drive-meta http=${mcode} size=${msize} md5=${md5:-none} name=${drive_name}"
if [ "$mcode" != "200" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=drive-meta: HTTP ${mcode} (check Drive sharing/permission)" >&2
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

# B3 stage 1: pass-1 ebur128 on the mono-mixed, 44.1 kHz signal → I, TP, LRA.
chans="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 -headers "$hdr" "$dl" 2>/dev/null | head -n1)"
if [ -z "$chans" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=ffprobe: no audio stream" >&2
  exit 1
fi
pan=""
[ "$chans" -ge 2 ] 2>/dev/null && pan="pan=mono|c0=0.5*c0+0.5*c1,"
base_af="${pan}aresample=44100"

measure_ebur128() { # <file-or-"-dl"> → "I TP LRA"
  local src="$1" af="$2" eb
  if [ "$src" = "-dl" ]; then
    eb="$(ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" -af "${af},ebur128=peak=true" -f null - 2>&1)"
  else
    eb="$(ffmpeg -hide_banner -nostdin -i "$src" -af "ebur128=peak=true" -f null - 2>&1)"
  fi
  local I TP LRA
  I="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  TP="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  LRA="$(printf '%s' "$eb" | grep -oE 'LRA:[[:space:]]*-?[0-9.]+ LU' | tail -n1 | grep -oE '\-?[0-9.]+')"
  printf '%s %s %s' "${I:-NaN}" "${TP:-NaN}" "${LRA:-NaN}"
}

read -r p1_i p1_tp p1_lra <<<"$(measure_ebur128 -dl "$base_af")"
echo "[$DRIVE_FILE_ID] stage=pass1 I=${p1_i} TP=${p1_tp} LRA=${p1_lra}"
if [ "$p1_i" = "NaN" ]; then
  echo "[$DRIVE_FILE_ID] FAILED stage=pass1: could not measure loudness" >&2
  exit 1
fi

# B3 (frozen 3 Nov): pan → volume=G → aresample 44100 → alimiter 0.708 → mp3.
# No acompressor, no rescue loop. G = -16 - I(pass1). limit fixed at 0.708.
limit="0.708"
G="$(nn 'process.stdout.write(String(-16 - parseFloat(process.argv[1])))' "$p1_i")"
ceil="$(nn 'process.stdout.write(String(20*Math.log10(0.708)))')"
src_dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 -headers "$hdr" "$dl" 2>/dev/null | cut -d. -f1)"

# Steps 1-3 ONLY (pan,volume,aresample — NO limiter): depth + busy.
measure_depth_busy() { # uses $G → prints "depth busy"
  local pre eb tp astats
  pre="${base_af%aresample=44100}volume=${G}dB,aresample=44100"
  eb="$(ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" -af "${pre},ebur128=peak=true" -f null - 2>&1)"
  tp="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  local depth; depth="$(nn 'process.stdout.write(String((parseFloat(process.argv[1])||0)-parseFloat(process.argv[2])))' "${tp:-0}" "$ceil")"
  astats="$(ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" \
    -af "${pre},asetnsamples=n=2205:p=0,astats=metadata=1:reset=1" -f null - 2>&1 \
    | grep -oE 'Peak level dB: -?[0-9.]+|Peak level dB: -inf' | grep -oE '\-?[0-9.]+|-inf')"
  local busy; busy="$(printf '%s\n' "$astats" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=s.split(/\n/).filter(Boolean).map(x=>x==="-inf"?-120:parseFloat(x));const c=parseFloat(process.argv[1]);const over=v.filter(x=>x>c).length;process.stdout.write(String(v.length?(100*over/v.length):0))})' -- "$ceil")"
  printf '%s %s' "${depth:-0}" "${busy:-0}"
}

encode_once() { # uses $G → writes $out
  ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn \
    -af "${base_af%aresample=44100}volume=${G}dB,aresample=44100,alimiter=limit=${limit}:attack=5:release=50:level=disabled" \
    -c:a libmp3lame -b:a 64k -ar 44100 -map_metadata -1 "$out"
}

# Exception lookup for this id (accept_I ≥ -18 processed regardless of depth).
exc_i="$(node -e 'try{const l=require("fs").readFileSync(process.argv[1],"utf8");const e=(JSON.parse(l)||[]).find(x=>x.drive_file_id===process.argv[2]);process.stdout.write(e&&Number.isFinite(e.accept_I)?String(e.accept_I):"")}catch{process.stdout.write("")}' "$EXCEPTIONS" "$DRIVE_FILE_ID" 2>/dev/null)"

read -r depth busy <<<"$(measure_depth_busy)"
exc_json="null"; [ -n "$exc_i" ] && exc_json="{\"accept_I\":${exc_i}}"
dec="$(node scripts/media/b3-decide.mjs "{\"depth\":${depth},\"busy\":${busy},\"G\":${G},\"I\":${p1_i},\"exception\":${exc_json}}" 2>/dev/null)"
verdict="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).verdict))')"
echo "[$DRIVE_FILE_ID] stage=decide depth=${depth} busy=${busy} G=${G} verdict=${verdict} $(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).reason||""))')"
result="failed"
case "$verdict" in
  accept) result="ok" ;;
  cap) result="cap"; G="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).capG)))')" ;;
  exception) result="exception"; G="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).capG)))')" ;;
  fail) result="failed" ;;
esac

if [ "$DRY_RUN" = "1" ]; then
  echo "[$DRIVE_FILE_ID] DRY-RUN G=${G} depth=${depth} busy=${busy} expected_result=${result} (no encode, no upload, no manifest)"
  exit 0
fi

if [ "$result" = "failed" ]; then
  # Log the timestamps (s) of the 5 largest peaks above the ceiling so the
  # coordinator listens only to those moments.
  peaks="$(ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" \
    -af "${base_af%aresample=44100}volume=${G}dB,aresample=44100,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level" -f null - 2>&1 \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const re=/pts_time:([0-9.]+)[\s\S]*?Peak_level=(-?[0-9.]+|-inf)/g;let m,a=[];while((m=re.exec(s))){a.push([parseFloat(m[1]),m[2]==="-inf"?-120:parseFloat(m[2])])}const c=parseFloat(process.argv[1]);a=a.filter(x=>x[1]>c).sort((x,y)=>y[1]-x[1]).slice(0,5).map(x=>x[0].toFixed(1));process.stdout.write(a.join(", "))}' -- "$ceil")"
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: depth=${depth} busy=${busy} — 5 loudest peaks above ceiling at s: ${peaks:-none}" >&2
  exit 1
fi

if ! encode_once 2>"ffmpeg-${md5hex}.err"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=encode: $(tail -n 3 "ffmpeg-${md5hex}.err" | tr '\n' ' ')" >&2
  exit 1
fi
read -r out_i out_tp out_lra <<<"$(measure_ebur128 "$out" "")"
out_dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1)"
echo "[$DRIVE_FILE_ID] stage=encode G=${G} limit=${limit} out_I=${out_i} out_TP=${out_tp} out_LRA=${out_lra} dur=${out_dur}/${src_dur} result=${result}"

# Accept on the FINISHED mp3: TP ≤ -1.5, duration ±1 s. (I band only for "ok".)
if ! nn 'const t=parseFloat(process.argv[1]);process.exit(t<=-1.5?0:1)' "$out_tp"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: finished TP=${out_tp} > -1.5 dBTP" >&2
  exit 1
fi
if ! nn 'process.exit(Math.abs((parseInt(process.argv[1],10)||0)-(parseInt(process.argv[2],10)||0))<=1?0:1)' "${out_dur:-0}" "${src_dur:-0}"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: duration ${out_dur}s vs source ${src_dur}s (> ±1 s)" >&2
  exit 1
fi
if [ "$result" = "ok" ] && ! nn 'const i=parseFloat(process.argv[1]);process.exit(i>=-16.5&&i<=-15.5?0:1)' "$out_i"; then
  echo "[$DRIVE_FILE_ID] FAILED stage=accept: result ok but finished I=${out_i} outside -16 ±0.5" >&2
  exit 1
fi
echo "[$DRIVE_FILE_ID] stage=result result=${result}"

# B5 upload: rclone copy --immutable, then verify (size == local, 200, 206).
bytes=$(stat -c%s "$out")
dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1)
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
  "${p1_i},${p1_tp},${p1_lra}" "${G},${limit},1" "${out_i},${out_tp},${out_lra}" "$LESSON_CODE" \
  "${depth},${busy}" "$result" || {
    echo "[$DRIVE_FILE_ID] could not build a valid manifest entry" >&2; exit 1; }

echo "[$DRIVE_FILE_ID] done → $key"
exit 0
