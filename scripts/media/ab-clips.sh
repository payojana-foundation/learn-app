#!/usr/bin/env bash
# scripts/media/ab-clips.sh — Job B v2 listening test (3 Nov). NO R2 upload.
#
# Parts 8, 11, 4. Per part, TWO full renders from the source, ONE encode each,
# both under the B3 rule (accept depth ≤ 12; else cap G − (depth − 12), capped
# I = target − cut, floor −18):
#   Y = target −18 chain.
#   X = target −16 chain, then a pure volume gain AFTER the limiter so X's
#       measured I matches Y's within ±0.3 LU (part 8 caps at −16.6, so the gain
#       is computed, not a fixed −2 dB).
# Clips: `-c copy` cuts at identical timestamps from the full renders; loudest
# 90 s by short-term loudness, start ≥ 120 s, end ≤ duration − 120 s.
# Two rounds with their own random labels (R1-8a/R1-8b …, R2-…): 12 clips.
# Every clip asserted 44100 Hz / mono / 64 kbps.
# Outputs: clips/*.mp3 (the 12 clips only) and keys-do-not-open.json
# (label → X/Y per round). Summary table → $GITHUB_STEP_SUMMARY.
#
# Env: ACCESS_TOKEN (+ optional REFRESH_TOKEN_CMD), PART8_ID, PART11_ID, PART4_ID.
# Test hook: AB_SELFTEST=1 writes a label map only (no ffmpeg/Drive).

set -uo pipefail

LIMIT="0.708"

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
mkdir -p clips work
write_keys

refresh_token() {
  [ -n "${REFRESH_TOKEN_CMD:-}" ] || return 0
  local t; t="$(eval "$REFRESH_TOKEN_CMD" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$t" ] && ACCESS_TOKEN="$t"
  return 0
}
hdr_now() { printf 'Authorization: Bearer %s\r\n' "$ACCESS_TOKEN"; }

nn() { local code="$1"; shift; node -e "$code" -- "$@"; }

ebur() { # <af-chain-or-empty> <input> [headers] → "I TP LRA"
  local af="$1" in="$2" h="${3:-}" eb I TP LRA
  if [ -n "$h" ]; then
    eb="$(ffmpeg -hide_banner -nostdin -headers "$h" -i "$in" -af "${af:+$af,}ebur128=peak=true" -f null - 2>&1)"
  else
    eb="$(ffmpeg -hide_banner -nostdin -i "$in" -af "${af:+$af,}ebur128=peak=true" -f null - 2>&1)"
  fi
  I="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  TP="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  LRA="$(printf '%s' "$eb" | grep -oE 'LRA:[[:space:]]*-?[0-9.]+ LU' | tail -n1 | grep -oE '\-?[0-9.]+')"
  printf '%s %s %s' "${I:-NaN}" "${TP:-NaN}" "${LRA:-NaN}"
}

assert_format() { # <clip> — 44100 Hz, mono, 64 kbps
  local sr ch br
  sr="$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$1")"
  ch="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$1")"
  br="$(ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate -of csv=p=0 "$1")"
  [ "$sr" = "44100" ] || { echo "[ab] FAILED ${1}: sample_rate=${sr}" >&2; exit 1; }
  [ "$ch" = "1" ] || { echo "[ab] FAILED ${1}: channels=${ch}" >&2; exit 1; }
  nn 'process.exit(Math.abs(parseInt(process.argv[1]||"0",10)-64000)<=4000?0:1)' "$br" \
    || { echo "[ab] FAILED ${1}: bit_rate=${br} (want ~64000)" >&2; exit 1; }
}

# measure_depth_busy <dl> <pre-af> → "depth busy" (steps 1-3, no limiter)
measure_depth_busy() {
  local dl="$1" pre="$2" h tp ceil depth astats busy
  h="$(hdr_now)"
  ceil="$(nn 'process.stdout.write(String(20*Math.log10(0.708)))')"
  tp="$(ebur "$pre" "$dl" "$h" | cut -d' ' -f2)"
  depth="$(nn 'process.stdout.write(String((parseFloat(process.argv[1])||0)-parseFloat(process.argv[2])))' "${tp:-0}" "$ceil")"
  astats="$(ffmpeg -hide_banner -nostdin -headers "$h" -i "$dl" \
    -af "${pre},asetnsamples=n=2205:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level" -f null - 2>&1 \
    | grep -oE 'lavfi.astats.Overall.Peak_level=(-?[0-9.]+|-inf)' | grep -oE '\-?[0-9.]+|-inf')"
  busy="$(printf '%s\n' "$astats" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=s.split(/\n/).filter(Boolean).map(x=>x==="-inf"?-120:parseFloat(x));const c=parseFloat(process.argv[1]);const over=v.filter(x=>x>c).length;process.stdout.write(String(v.length?(100*over/v.length):0))})' -- "$ceil")"
  printf '%s %s' "${depth:-0}" "${busy:-0}"
}

# render_variant <dl> <base_af> <target> <post_gain_db> <outfile>
# Runs the B3 rule for `target`, then ONE encode (post_gain applied AFTER the
# limiter). Sets globals: R_G R_DEPTH R_BUSY R_RESULT R_EXPECT_I R_I R_TP R_LRA.
render_variant() {
  local dl="$1" base="$2" target="$3" post="$4" outf="$5" h p1 p1i dec verdict
  h="$(hdr_now)"
  p1="$(ebur "$base" "$dl" "$h")"; p1i="${p1%% *}"
  R_G="$(nn 'process.stdout.write(String(parseFloat(process.argv[1])-parseFloat(process.argv[2])))' "$target" "$p1i")"
  local pre="${base:+$base,}volume=${R_G}dB,aresample=44100"
  read -r R_DEPTH R_BUSY <<<"$(measure_depth_busy "$dl" "$pre")"
  dec="$(node scripts/media/b3-decide.mjs "{\"depth\":${R_DEPTH},\"busy\":${R_BUSY},\"G\":${R_G},\"I\":${p1i},\"target\":${target}}")"
  verdict="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).verdict))')"
  R_EXPECT_I="$target"
  case "$verdict" in
    accept) R_RESULT="ok" ;;
    cap)
      R_RESULT="cap"
      R_G="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).capG)))')"
      R_EXPECT_I="$(printf '%s' "$dec" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).capI)))')" ;;
    *) R_RESULT="failed"; echo "[ab] ${outf}: B3 verdict ${verdict} — $(printf '%s' "$dec")" >&2; return 1 ;;
  esac
  # post = "AUTO:<yI>" → pure gain AFTER the limiter from the decision's expected
  # I to Y's measured I (decided before the single encode; verified afterwards).
  case "$post" in
    AUTO:*) post="$(nn 'process.stdout.write(String(parseFloat(process.argv[1])-parseFloat(process.argv[2])))' "${post#AUTO:}" "$R_EXPECT_I")" ;;
  esac
  R_POST="$post"
  local tail="alimiter=limit=${LIMIT}:attack=5:release=50:level=disabled"
  [ "$post" != "0" ] && tail="${tail},volume=${post}dB"
  # ONE encode, mono 44.1 kHz 64k.
  ffmpeg -nostdin -y -headers "$h" -i "$dl" -vn \
    -af "${base:+$base,}volume=${R_G}dB,aresample=44100,${tail}" \
    -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 -map_metadata -1 "$outf" 2>"work/enc.err" \
    || { echo "[ab] FAILED encode ${outf}: $(tail -n 3 work/enc.err | tr '\n' ' ')" >&2; return 1; }
  read -r R_I R_TP _ <<<"$(ebur "" "$outf")"
}

summary_rows=""
R_POST="0"
add_render_row() { # <part> <variant> <target> <post_gain>
  summary_rows="${summary_rows}| render | ${1} | ${2} | ${3} | ${4} | ${R_G} | ${LIMIT} | ${R_DEPTH} | ${R_BUSY} | ${R_I} | ${R_TP} | ${R_RESULT} |"$'\n'
}

declare -A PID=( [8]="$PART8_ID" [11]="$PART11_ID" [4]="$PART4_ID" )
clip_rows=""

for part in 8 11 4; do
  refresh_token
  dl="https://www.googleapis.com/drive/v3/files/${PID[$part]}?alt=media"
  h="$(hdr_now)"
  chans="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 -headers "$h" "$dl" 2>/dev/null | head -n1)"
  base=""; [ "${chans:-1}" -ge 2 ] 2>/dev/null && base="pan=mono|c0=0.5*c0+0.5*c1"
  base="${base:+$base,}aresample=44100"
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 -headers "$h" "$dl" | cut -d. -f1)"

  # Y first (target -18), then X (target -16) with a post-limiter gain that
  # brings X's expected I onto Y's MEASURED I, verified within ±0.3 LU.
  render_variant "$dl" "$base" -18 0 "work/full-${part}-Y.mp3" || { echo "[ab] part ${part} Y failed" >&2; exit 1; }
  y_i="$R_I"; add_render_row "$part" Y -18 0
  # X: ONE encode; the post-limiter gain is computed from X's expected I (target
  # − cut) to Y's measured I before encoding, then verified within ±0.3 LU.
  render_variant "$dl" "$base" -16 "AUTO:${y_i}" "work/full-${part}-X.mp3" || { echo "[ab] part ${part} X failed" >&2; exit 1; }
  add_render_row "$part" X -16 "$R_POST"
  delta="$(nn 'process.stdout.write(String(Math.abs(parseFloat(process.argv[1])-parseFloat(process.argv[2]))))' "$R_I" "$y_i")"
  nn 'process.exit(parseFloat(process.argv[1])<=0.3?0:1)' "$delta" \
    || { echo "[ab] FAILED part ${part}: X I=${R_I} vs Y I=${y_i} differ by ${delta} LU (> 0.3)" >&2; exit 1; }

  # Window: loudest 90 s by short-term loudness, start ≥120, end ≤ dur-120.
  ffmpeg -hide_banner -nostdin -i "work/full-${part}-Y.mp3" -af ebur128 -f null - 2>"work/frames-${part}.log"
  read -r wstart wdur <<<"$(node -e 'import("./scripts/media/ab-windows.mjs").then(m=>{const fs=require("fs");const f=m.parseFrames(fs.readFileSync(process.argv[1],"utf8"));const w=m.loudestWindowBounded(f,Number(process.argv[2]));process.stdout.write(w.start+" "+w.dur)})' "work/frames-${part}.log" "$dur")"
  echo "[ab] part ${part}: dur=${dur}s window ${wstart}s +${wdur}s"

  for R in R1 R2; do
    for suffix in a b; do
      label="${R}-${part}${suffix}"
      v="$(node -e 'process.stdout.write(require("./keys-do-not-open.json")[process.argv[1]])' -- "$label")"
      cp_out="clips/${label}.mp3"
      ffmpeg -nostdin -y -ss "$wstart" -t "$wdur" -i "work/full-${part}-${v}.mp3" -c copy "$cp_out" 2>"work/cut.err" \
        || { echo "[ab] FAILED cut ${label}: $(tail -n 2 work/cut.err | tr '\n' ' ')" >&2; exit 1; }
      assert_format "$cp_out"
      clip_rows="${clip_rows}| ${R} | ${label} | ${part} | ${wstart} | $((wstart+wdur)) | ${wdur}s | 44100 |"$'\n'
    done
  done
done

{
  echo "### Listening clips — labels are random per round (key is a separate artifact)"
  echo "| round | label | part | start | end | dur | Hz |"
  echo "| --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$clip_rows"
  echo
  echo "### Renders (one encode each)"
  echo "| | part | variant | target | post-gain | G | limit | depth | busy | I | TP | result |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$summary_rows"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

count="$(find clips -name '*.mp3' | wc -l | tr -d ' ')"
[ "$count" = "12" ] || { echo "[ab] FAILED: expected 12 clips, got ${count}" >&2; exit 1; }
echo "[ab] done — 12 clips in clips/, label key in keys-do-not-open.json"
