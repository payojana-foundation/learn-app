#!/usr/bin/env bash
# scripts/media/ab-clips.sh — Job B v2 · B6 rev 2 (audio+engineering, 3 Nov).
#
# For each part, render the FULL file through each version's chain ONCE, then
# cut every clip from those full renders with `-c copy` at IDENTICAL timestamps
# (no mp3→mp3 re-encode). "current" is cut with -c copy from the uploaded 2 Nov
# mp3. Every clip is asserted 44100 Hz / mono / 64k.
#
# Windows (same for all versions of a part):
#   loud  = loudest 90 s by SHORT-TERM loudness, start ≥ 120 s, end ≤ dur-120 s
#           (shrinks toward 60 s if no window fits the pads)
#   pause = a ≥ 3 s pause at ≥ 300 s in; a 30 s clip with the pause in the middle
# Versions:
#   Part 1: current / B3 / B3-matched (to current's I, ±0.3 LU)
#   Part 4: B3 policy / forced -16 / -18 (the matched pair within ±0.3 LU)
# Rounds: TWO, each with its own random labels (R1-A…, R2-A…). The label→version
# map is written ONLY to abc-order.json (private artifact), never the summary.
# Upload under test/2026-11-03/, Cache-Control: no-store; each URL curl -I → 200.
#
# Env: ACCESS_TOKEN, MEDIA_BASE_URL, DRIVE_FILE_ID, CURRENT_KEY, PART4_ID, DEST.
# Overridable for tests: RCLONE, CURL, SHUF, AB_SELFTEST.

set -uo pipefail

RCLONE="${RCLONE:-rclone}"
CURL="${CURL:-curl}"
SHUF="${SHUF:-shuf}"
MEDIA_BASE_URL="${MEDIA_BASE_URL:-https://media.84000.digital}"
MEDIA_BASE_URL="${MEDIA_BASE_URL%/}"
DEST="${DEST:-test/2026-11-03}"
COMP="acompressor=threshold=0.1:ratio=2:attack=20:release=250:knee=6:makeup=1"
LIM="alimiter=limit=0.708:attack=5:release=50:level=disabled"

# write_order — assign each part's versions to two rounds of random labels and
# write abc-order.json ({R1:{A:ver,...},R2:{...}} per part). Offline + testable.
write_order() {
  local p1v="current b3 b3matched" p4v="b3 forced16 m18"
  node -e '
    const fs=require("fs");
    const sh=(arr)=>arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    function rounds(vers){const r={};for(const R of["R1","R2"]){const o=sh(vers);r[R]={A:o[0],B:o[1],C:o[2]};}return r;}
    fs.writeFileSync("abc-order.json",JSON.stringify({part1:rounds(process.argv[1].split(" ")),part4:rounds(process.argv[2].split(" "))}));
  ' -- "$p1v" "$p4v"
}

if [ "${AB_SELFTEST:-0}" = "1" ]; then
  write_order
  exit 0
fi

: "${ACCESS_TOKEN:?ACCESS_TOKEN not set}"
hdr="Authorization: Bearer ${ACCESS_TOKEN}"$'\r\n'
summary_rows=""   # accumulates one markdown row per clip

ebur_measure() { # <file> → "I TP LRA" from ebur128 on the finished file
  local eb I TP LRA
  eb="$(ffmpeg -hide_banner -nostdin -i "$1" -af "ebur128=peak=true" -f null - 2>&1)"
  I="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  TP="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  LRA="$(printf '%s' "$eb" | grep -oE 'LRA:[[:space:]]*-?[0-9.]+ LU' | tail -n1 | grep -oE '\-?[0-9.]+')"
  printf '%s %s %s' "${I:-NaN}" "${TP:-NaN}" "${LRA:-NaN}"
}

assert_format() { # <file> — must be 44100 Hz, 1 channel, 64 kbps
  local sr ch br
  sr="$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$1")"
  ch="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$1")"
  br="$(ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate -of csv=p=0 "$1")"
  [ "$sr" = "44100" ] || { echo "[ab] FAILED ${1}: sample_rate=${sr} (want 44100)" >&2; exit 1; }
  [ "$ch" = "1" ] || { echo "[ab] FAILED ${1}: channels=${ch} (want 1)" >&2; exit 1; }
  # 64k CBR: allow a small container tolerance (±4000).
  node -e 'const b=parseInt(process.argv[1]||"0",10);process.exit(Math.abs(b-64000)<=4000?0:1)' "$br" \
    || { echo "[ab] FAILED ${1}: bit_rate=${br} (want ~64000)" >&2; exit 1; }
}

upload_verify() { # <localfile>
  local f="$1" url http
  "$RCLONE" copyto --header-upload "Cache-Control: no-store" --header-upload "Content-Type: audio/mpeg" \
    "$f" "r2:course-media/${DEST}/${f}" || { echo "[ab] FAILED upload ${f}" >&2; exit 1; }
  url="${MEDIA_BASE_URL}/${DEST}/${f}"
  http="$("$CURL" -s -o /dev/null -I -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  echo "[ab] ${f} → HTTP ${http}"
  [ "$http" = "200" ] || { echo "[ab] FAILED verify ${url} (HTTP ${http})" >&2; exit 1; }
}

# duration <dl-url|file> [headers?]
file_duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 ${2:+-headers "$2"} "$1" | cut -d. -f1; }

# Per-version chain applied to the FULL file. Writes full-<part>-<ver>.mp3 and
# echoes "chain|G|limit" for the summary. $1=part tag $2=ver $3=dl-url
# $4=current-I (for b3matched). Uses $hdr for Drive sources.
render_full() {
  local part="$1" ver="$2" dl="$3" curI="${4:-}" outf chain G="-" meas
  outf="full-${part}-${ver}.mp3"
  case "$ver" in
    current)
      [ -f "cur-${part}.mp3" ] || "$RCLONE" copyto "r2:course-media/${CURRENT_KEY}" "cur-${part}.mp3" >/dev/null 2>&1
      cp "cur-${part}.mp3" "$outf"; chain="(uploaded 2 Nov, as-is)" ;;
    b3)
      meas="$(ebur_measure_dl "$dl")"; G="$(node -e 'process.stdout.write(String(-16-parseFloat(process.argv[1])))' "${meas%% *}")"
      ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,volume=${G}dB,${COMP},${LIM}" -c:a libmp3lame -b:a 64k -ar 44100 -map_metadata -1 "$outf"
      chain="B3" ;;
    b3matched)
      G="$(node -e 'process.stdout.write(String(parseFloat(process.argv[1])-parseFloat(process.argv[2])))' "$curI" "$(ebur_measure_dl "$dl" | cut -d" " -f1)")"
      ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,volume=${G}dB,${COMP},${LIM}" -c:a libmp3lame -b:a 64k -ar 44100 -map_metadata -1 "$outf"
      chain="B3 matched to current I" ;;
    forced16)
      ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,${LIM}" -c:a libmp3lame -b:a 64k -ar 44100 -map_metadata -1 "$outf"
      chain="forced -16" ;;
    m18)
      ffmpeg -nostdin -y -headers "$hdr" -i "$dl" -vn -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,loudnorm=I=-18:TP=-1.5:LRA=11,${LIM}" -c:a libmp3lame -b:a 64k -ar 44100 -map_metadata -1 "$outf"
      chain="-18" ;;
  esac
  printf '%s|%s|%s' "$chain" "$G" "0.708"
}

ebur_measure_dl() { # <dl-url> → "I TP LRA" (pre-render, mono-mixed)
  local eb I TP LRA
  eb="$(ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$1" -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,ebur128=peak=true" -f null - 2>&1)"
  I="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  TP="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  LRA="$(printf '%s' "$eb" | grep -oE 'LRA:[[:space:]]*-?[0-9.]+ LU' | tail -n1 | grep -oE '\-?[0-9.]+')"
  printf '%s %s %s' "${I:-NaN}" "${TP:-NaN}" "${LRA:-NaN}"
}

# cut_clip — copy-cut, no re-encode, from a full render. $1=full $2=start $3=dur $4=out
cut_clip() { ffmpeg -nostdin -y -ss "$2" -t "$3" -i "$1" -c copy "$4"; }

write_order

# process_part <tag> <dl-url> <versions-space-list> <current-I-or-->
process_part() {
  local part="$1" dl="$2" versions="$3" curI="$4" ver dur
  dur="$(file_duration "$dl" "$hdr")"
  ffmpeg -hide_banner -nostdin -headers "$hdr" -i "$dl" -vn \
    -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,ebur128=peak=true" -f null - 2>"${part}-frames.log" || {
    echo "::error title=ebur128 failed::could not measure ${part}" >&2; exit 1; }
  # windows
  read -r loud_start loud_dur <<<"$(node -e 'import("./scripts/media/ab-windows.mjs").then(m=>{const fs=require("fs");const f=m.parseFrames(fs.readFileSync(process.argv[1],"utf8"));const w=m.loudestWindowBounded(f,Number(process.argv[2]));process.stdout.write(w.start+" "+w.dur)})' "${part}-frames.log" "$dur")"
  local pause_json; pause_json="$(node -e 'import("./scripts/media/ab-windows.mjs").then(m=>{const fs=require("fs");const f=m.parseFrames(fs.readFileSync(process.argv[1],"utf8"));const w=m.pauseClipWindow(f,Number(process.argv[2]));process.stdout.write(w?(w.start+" "+w.dur):"")})' "${part}-frames.log" "$dur")"
  echo "[ab] ${part} loud @ ${loud_start}s for ${loud_dur}s · pause=${pause_json:-none}"

  # Render each full version once + measure it. Fresh maps per part.
  unset FULL CHAIN GAIN MI MTP MLRA
  declare -A FULL CHAIN GAIN MI MTP MLRA
  for ver in $versions; do
    local info; info="$(render_full "$part" "$ver" "$dl" "$curI")"
    FULL["$ver"]="full-${part}-${ver}.mp3"; CHAIN["$ver"]="${info%%|*}"
    local rest="${info#*|}"; GAIN["$ver"]="${rest%%|*}"
    local im; im="$(ebur_measure "${FULL[$ver]}")"
    MI["$ver"]="$(printf '%s' "$im" | cut -d' ' -f1)"
    MTP["$ver"]="$(printf '%s' "$im" | cut -d' ' -f2)"
    MLRA["$ver"]="$(printf '%s' "$im" | cut -d' ' -f3)"
  done
  # current's I (for the summary note; matched version already used it live).
  local segs="loud:${loud_start}:${loud_dur}"
  [ -n "$pause_json" ] && segs="$segs pause:${pause_json// /:}"

  for R in R1 R2; do
    for label in A B C; do
      ver="$(node -e 'process.stdout.write(require("./abc-order.json")[process.argv[1]][process.argv[2]][process.argv[3]])' -- "$part" "$R" "$label")"
      for seg in $segs; do
        local sname="${seg%%:*}" sstart sdur
        sstart="$(printf '%s' "$seg" | cut -d: -f2)"; sdur="$(printf '%s' "$seg" | cut -d: -f3)"
        local outf="${R}-${label}-${part}-${sname}.mp3"
        cut_clip "${FULL[$ver]}" "$sstart" "$sdur" "$outf" || { echo "[ab] FAILED cut ${outf}" >&2; exit 1; }
        assert_format "$outf"
        upload_verify "$outf"
        summary_rows="${summary_rows}| ${R} | ${label} | ${part} | ${sstart} | $((sstart+sdur)) | ${sdur}s | 44100 | ${CHAIN[$ver]} | ${GAIN[$ver]} | 0.708 | ${MI[$ver]} | ${MTP[$ver]} | ${MLRA[$ver]} | — | — | ok |"$'\n'
      done
    done
  done
}

# current's integrated I (used to match B3 for part 1).
[ -f "cur-part1.mp3" ] || "$RCLONE" copyto "r2:course-media/${CURRENT_KEY}" cur-part1.mp3 >/dev/null 2>&1 || true
cur_i="$([ -f cur-part1.mp3 ] && ebur_measure cur-part1.mp3 | cut -d' ' -f1 || echo -18)"

process_part "part1" "https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media" "current b3 b3matched" "$cur_i"
process_part "part4" "https://www.googleapis.com/drive/v3/files/${PART4_ID}?alt=media" "b3 forced16 m18" "-"

{
  echo "### B6 rev 2 listening clips — labels are random per round (version map is private)"
  echo "| round | label | part | start | end | dur | Hz | chain | G | limit | I | TP | LRA | depth | busy | result |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$summary_rows"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "[ab] done — clips uploaded to ${DEST}; label→version map in abc-order.json (private)"
