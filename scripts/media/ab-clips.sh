#!/usr/bin/env bash
# scripts/media/ab-clips.sh — Job B v2 listening test (3 Nov). NO R2 upload.
#
# Parts 8, 11, 4. Per part the source is downloaded ONCE and its audio extracted
# to a local file; every pass runs on that file. Two full renders per part, ONE
# mp3 encode each, both under the approved B3 G loop (b3-decide.mjs):
#   Y = target −18 chain.
#   X = target −16 chain, then a pure volume gain AFTER the limiter. That gain
#       comes from a null-pass measurement of X's chain vs Y's chain inside the
#       clip window (so X's clip I matches Y's within ±0.3 LU), then X is encoded.
# Clips: `-c copy` cuts at identical timestamps from the full renders; loudest
# 90 s by short-term loudness, start ≥ 120 s, end ≤ duration − 120 s.
# Two rounds with their own random labels (R1-8a/R1-8b …, R2-…): 12 clips.
# Every clip asserted 44100 Hz / mono / 64 kbps.
# Outputs: clips/*.mp3 (the 12 clips only) and keys-do-not-open.json
# (label → X/Y per round). Summary tables → $GITHUB_STEP_SUMMARY.
#
# Env: ACCESS_TOKEN (+ optional REFRESH_TOKEN_CMD), PART8_ID, PART11_ID, PART4_ID.
# Test hook: AB_SELFTEST=1 writes a label map only (no ffmpeg/Drive).

set -uo pipefail

# write_keys — two rounds of random labels per part. For each round and part the
# two renders (X, Y) are assigned to labels <p>a / <p>b in random order.
# Writes keys-do-not-open.json: { "R1-8a": "X", "R1-8b": "Y", … }.
write_keys() {
  # shellcheck disable=SC2016  # the single-quoted body is Node code (JS template literals), not shell
  node -e '
    const fs=require("fs");
    const m={};
    for(const R of ["R1","R2"]) for(const p of ["8","11","4"]){
      const flip=Math.random()<0.5;
      m[`${R}-${p}a`]=flip?"X":"Y";
      m[`${R}-${p}b`]=flip?"Y":"X";
    }
    fs.writeFileSync("keys-do-not-open.json",JSON.stringify(m,null,1));
  '
}

if [ "${AB_SELFTEST:-0}" = "1" ]; then
  write_keys
  exit 0
fi

: "${ACCESS_TOKEN:?ACCESS_TOKEN not set}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
CURL="${CURL:-curl}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/b3-loop.sh"
mkdir -p clips work
write_keys

refresh_token() {
  [ -n "${REFRESH_TOKEN_CMD:-}" ] || return 0
  local t; t="$(eval "$REFRESH_TOKEN_CMD" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$t" ] && ACCESS_TOKEN="$t"
  return 0
}

nn() { local code="$1"; shift; node -e "$code" -- "$@"; }

assert_format() { # <clip> — 44100 Hz, mono, 64 kbps
  local sr ch br
  sr="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$1")"
  ch="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$1")"
  br="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=bit_rate -of csv=p=0 "$1")"
  [ "$sr" = "44100" ] || { echo "[ab] FAILED ${1}: sample_rate=${sr}" >&2; exit 1; }
  [ "$ch" = "1" ] || { echo "[ab] FAILED ${1}: channels=${ch}" >&2; exit 1; }
  nn 'process.exit(Math.abs(parseInt(process.argv[1]||"0",10)-64000)<=4000?0:1)' "$br" \
    || { echo "[ab] FAILED ${1}: bit_rate=${br} (want ~64000)" >&2; exit 1; }
}

LIMIT="0.708"
declare -A PID=( [8]="$PART8_ID" [11]="$PART11_ID" [4]="$PART4_ID" )
clip_rows=""
render_rows=""

for part in 8 11 4; do
  refresh_token
  export B3_LOG="part${part}"
  aud="$(b3_fetch_audio "${PID[$part]}" "work/src-${part}.bin" "work/aud-${part}")" || { echo "[ab] FAILED part ${part}: download/extract" >&2; exit 1; }
  chans="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$aud" | head -n1)"
  pan_af=""; [ "${chans:-1}" -ge 2 ] 2>/dev/null && pan_af="pan=mono|c0=0.5*c0+0.5*c1"
  dur="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$aud" | cut -d. -f1)"

  # Both renders go through the SAME B3 rule (G loop on the limited signal).
  ystate="$(b3_gloop "$aud" "$pan_af" -18 "")"
  xstate="$(b3_gloop "$aud" "$pan_af" -16 "")"
  for v in X Y; do
    st="$ystate"; [ "$v" = X ] && st="$xstate"
    r="$(b3_field "$st" result)"
    case "$r" in ok|cap) ;; *) echo "[ab] FAILED part ${part} ${v}: B3 result ${r} — $(b3_field "$st" reason)" >&2; exit 1 ;; esac
  done
  gy="$(b3_field "$ystate" G)"; gx="$(b3_field "$xstate" G)"

  # Window: loudest 90 s by short-term loudness (from Y's limited chain),
  # start ≥ 120 s, end ≤ duration − 120 s.
  "$FFMPEG" -hide_banner -nostdin -i "$aud" -af "$(b3_chain "$pan_af" "$gy"),ebur128" -f null - 2>"work/frames-${part}.log"
  read -r wstart wdur <<<"$(node -e 'import("./scripts/media/ab-windows.mjs").then(m=>{const fs=require("fs");const f=m.parseFrames(fs.readFileSync(process.argv[1],"utf8"));const w=m.loudestWindowBounded(f,Number(process.argv[2]));process.stdout.write(w.start+" "+w.dur)})' "work/frames-${part}.log" "$dur")"
  echo "[ab] part ${part}: dur=${dur}s window ${wstart}s +${wdur}s"

  # X's post-limiter gain: null-pass I of X's chain vs Y's chain in the window.
  ix_w="$(b3_null_ilim "$aud" "$pan_af" "$gx" -ss "$wstart" -t "$wdur")"
  iy_w="$(b3_null_ilim "$aud" "$pan_af" "$gy" -ss "$wstart" -t "$wdur")"
  post="$(nn 'process.stdout.write(String(parseFloat(process.argv[1])-parseFloat(process.argv[2])))' "$iy_w" "$ix_w")"
  echo "[ab] part ${part}: window I  X=${ix_w}  Y=${iy_w}  → X post-limiter gain ${post} dB"

  # ONE mp3 encode each.
  "$FFMPEG" -nostdin -y -i "$aud" -vn -af "$(b3_chain "$pan_af" "$gy")" \
    -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 -map_metadata -1 "work/full-${part}-Y.mp3" 2>work/enc.err \
    || { echo "[ab] FAILED encode Y part ${part}: $(tail -n 3 work/enc.err | tr '\n' ' ')" >&2; exit 1; }
  "$FFMPEG" -nostdin -y -i "$aud" -vn -af "$(b3_chain "$pan_af" "$gx"),volume=${post}dB" \
    -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 -map_metadata -1 "work/full-${part}-X.mp3" 2>work/enc.err \
    || { echo "[ab] FAILED encode X part ${part}: $(tail -n 3 work/enc.err | tr '\n' ' ')" >&2; exit 1; }

  # Clips: -c copy at identical timestamps from the full renders.
  for v in X Y; do
    "$FFMPEG" -nostdin -y -ss "$wstart" -t "$wdur" -i "work/full-${part}-${v}.mp3" -c copy "work/cut-${part}-${v}.mp3" 2>work/cut.err \
      || { echo "[ab] FAILED cut ${v} part ${part}: $(tail -n 2 work/cut.err | tr '\n' ' ')" >&2; exit 1; }
    assert_format "work/cut-${part}-${v}.mp3"
  done
  read -r cx_i cx_tp _ <<<"$(b3_ebur "work/cut-${part}-X.mp3" "")"
  read -r cy_i cy_tp _ <<<"$(b3_ebur "work/cut-${part}-Y.mp3" "")"
  delta="$(nn 'process.stdout.write(String(Math.abs(parseFloat(process.argv[1])-parseFloat(process.argv[2]))))' "$cx_i" "$cy_i")"
  nn 'process.exit(parseFloat(process.argv[1])<=0.3?0:1)' "$delta" \
    || { echo "[ab] FAILED part ${part}: clip I X=${cx_i} vs Y=${cy_i} differ by ${delta} LU (> 0.3)" >&2; exit 1; }

  # Busy is logged only.
  bx="$(b3_busy "$aud" "$pan_af" "$gx")"; by="$(b3_busy "$aud" "$pan_af" "$gy")"
  render_rows="${render_rows}| ${part} | X | -16 | $(b3_field "$xstate" loop) | ${gx} | ${LIMIT} | $(b3_field "$xstate" depth) | ${bx} | ${cx_i} | ${cx_tp} | $(b3_field "$xstate" result) |"$'\n'
  render_rows="${render_rows}| ${part} | Y | -18 | $(b3_field "$ystate" loop) | ${gy} | ${LIMIT} | $(b3_field "$ystate" depth) | ${by} | ${cy_i} | ${cy_tp} | $(b3_field "$ystate" result) |"$'\n'

  for R in R1 R2; do
    for suffix in a b; do
      label="${R}-${part}${suffix}"
      v="$(node -e 'process.stdout.write(require("./keys-do-not-open.json")[process.argv[1]])' -- "$label")"
      cp "work/cut-${part}-${v}.mp3" "clips/${label}.mp3"
      assert_format "clips/${label}.mp3"
      clip_rows="${clip_rows}| ${R} | ${label} | ${part} | ${wstart} | $((wstart+wdur)) | ${wdur}s | 44100 |"$'\n'
    done
  done
  rm -f "$aud" "work/full-${part}-X.mp3" "work/full-${part}-Y.mp3"
done

{
  echo "### Listening clips — labels are random per round (key is a separate artifact)"
  echo "| round | label | part | start | end | dur | Hz |"
  echo "| --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$clip_rows"
  echo
  echo "### Renders (one encode each; I/TP measured on the clip)"
  echo "| part | render | target | loops | G | limit | depth | busy | I | TP | result |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$render_rows"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

count="$(find clips -name '*.mp3' | wc -l | tr -d ' ')"
[ "$count" = "12" ] || { echo "[ab] FAILED: expected 12 clips, got ${count}" >&2; exit 1; }
echo "[ab] done — 12 clips in clips/, label key in keys-do-not-open.json"
