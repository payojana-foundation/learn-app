#!/usr/bin/env bash
# scripts/media/b3-loop.sh — Job B v2 · B3 helpers, SOURCED by transcode-one.sh
# and ab-clips.sh (one implementation of the approved 3 Nov "G loop").
#
# Everything works on ONE local audio file (the source is downloaded once and its
# audio extracted; no pass re-downloads from Drive). The loop decisions live in
# b3-decide.mjs (pure); this file only runs the ffmpeg null passes and feeds the
# measured I_lim back. Results are returned as JSON on stdout (logs → stderr), so
# callers read them with b3_field.
#
# Overridable for tests: FFMPEG, FFPROBE, CURL, B3_LOG (log prefix).

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
CURL="${CURL:-curl}"
B3_LOG="${B3_LOG:-b3}"
B3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# alimiter `level` (auto-level, ON by default in ffmpeg) is set to `disabled`
# here so the limiter does NOT re-gain the whole signal — we control loudness
# with volume=G. Do not change (CHANGE 4 Nov asks to report, not change it).
B3_ALIMITER_LEVEL="disabled"

# b3_field <json> <key> — print one field (objects as JSON, null/missing as "").
b3_field() {
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v!==null&&typeof v==="object"?JSON.stringify(v):String(v??""))}catch{process.stdout.write("")}})' -- "$2"
}

# b3_chain <pan_af> <G> [limit] — the FULL chain: [pan,] volume G, aresample
# 44100, alimiter(limit, attack 5, release 50, level=disabled). The limit is now
# VARIABLE (CHANGE 4 Nov); default 0.708 for the legacy null-pass helpers.
b3_chain() {
  local limit="${3:-0.708}"
  printf '%s%svolume=%sdB,aresample=44100,alimiter=limit=%s:attack=5:release=50:level=%s' \
    "$1" "${1:+,}" "$2" "$limit" "$B3_ALIMITER_LEVEL"
}

# b3_ebur <file> <af-or-empty> [input opts e.g. -ss S -t D] → "I TP LRA"
b3_ebur() {
  local f="$1" af="$2" eb I TP LRA
  shift 2
  eb="$("$FFMPEG" -hide_banner -nostdin "$@" -i "$f" -af "${af:+$af,}ebur128=peak=true" -f null - 2>&1)"
  I="$(printf '%s' "$eb" | grep -oE 'I:[[:space:]]*-?[0-9.]+ LUFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  TP="$(printf '%s' "$eb" | grep -oE 'Peak:[[:space:]]*-?[0-9.]+ dBFS' | tail -n1 | grep -oE '\-?[0-9.]+')"
  LRA="$(printf '%s' "$eb" | grep -oE 'LRA:[[:space:]]*-?[0-9.]+ LU' | tail -n1 | grep -oE '\-?[0-9.]+')"
  printf '%s %s %s' "${I:-NaN}" "${TP:-NaN}" "${LRA:-NaN}"
}

# b3_null_ilim <file> <pan_af> <G> [input opts] → I_lim of the FULL chain (null out)
b3_null_ilim() {
  local f="$1" pan="$2" g="$3"
  shift 3
  b3_ebur "$f" "$(b3_chain "$pan" "$g")" "$@" | cut -d' ' -f1
}

# b3_gloop <file> <pan_af> <target> <exception accept_I or ""> → final state JSON.
# Logs pass-1, every G and every I_lim (and the cap measurement) to stderr.
b3_gloop() {
  local f="$1" pan="$2" target="$3" exc="$4" p1 i1 tp1 lra1 excj state g ilim ph
  p1="$(b3_ebur "$f" "$pan")"
  i1="${p1%% *}"
  tp1="$(printf '%s' "$p1" | cut -d' ' -f2)"
  lra1="$(printf '%s' "$p1" | cut -d' ' -f3)"
  echo "[${B3_LOG}] stage=pass1 I1=${i1} TP1=${tp1} LRA1=${lra1} target=${target}" >&2
  excj="null"
  [ -n "$exc" ] && excj="{\"accept_I\":\"${exc}\"}"
  state="$(node "$B3_DIR/b3-decide.mjs" init "{\"target\":\"${target}\",\"I1\":\"${i1}\",\"TP1\":\"${tp1}\",\"LRA1\":\"${lra1}\",\"exception\":${excj}}")"
  while [ "$(b3_field "$state" "done")" != "true" ]; do
    g="$(b3_field "$state" G)"
    ph="$(b3_field "$state" phase)"
    ilim="$(b3_null_ilim "$f" "$pan" "$g")"
    state="$(printf '%s' "$state" | node "$B3_DIR/b3-decide.mjs" step "$ilim")"
    echo "[${B3_LOG}] stage=gloop phase=${ph} loop=$(b3_field "$state" loop) G=${g} I_lim=${ilim} next_G=$(b3_field "$state" G) $(b3_field "$state" reason)" >&2
  done
  printf '%s' "$state"
}

# b3_mp3loop <file> <pan_af> <target> <exc_or_""> <out.mp3> — CHANGE 4 Nov loop.
# Each round encodes the mp3 at (G, limit), decodes it, measures ebur128
# peak=true, and feeds {I_mp3, TP_mp3} to b3-decide.mjs until done (≤ 5 encodes).
# Logs every encode's G/limit/I_mp3/TP_mp3. Leaves the FINAL mp3 at <out.mp3>.
# Echoes the final state JSON.
b3_mp3loop() {
  local f="$1" pan="$2" target="$3" exc="$4" outf="$5" p1 i1 tp1 excj state g limit
  p1="$(b3_ebur "$f" "$pan")"
  i1="${p1%% *}"; tp1="$(printf '%s' "$p1" | cut -d' ' -f2)"
  echo "[${B3_LOG}] stage=pass1 I1=${i1} TP1=${tp1} target=${target}" >&2
  excj="null"; [ -n "$exc" ] && excj="{\"accept_I\":\"${exc}\"}"
  state="$(node "$B3_DIR/b3-decide.mjs" init "{\"target\":\"${target}\",\"I1\":\"${i1}\",\"TP1\":\"${tp1}\",\"exception\":${excj}}")"
  while [ "$(b3_field "$state" "done")" != "true" ]; do
    g="$(b3_field "$state" G)"; limit="$(b3_field "$state" limit)"
    if ! "$FFMPEG" -nostdin -y -i "$f" -vn -af "$(b3_chain "$pan" "$g" "$limit")" \
        -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 -map_metadata -1 "$outf" 2>"${outf}.enc.err"; then
      echo "[${B3_LOG}] FAILED encode: $(tail -n 3 "${outf}.enc.err" | tr '\n' ' ')" >&2
      state="$(printf '%s' "$state" | node "$B3_DIR/b3-decide.mjs" step NaN NaN)"
      break
    fi
    read -r im tpm _ <<<"$(b3_ebur "$outf" "")"
    state="$(printf '%s' "$state" | node "$B3_DIR/b3-decide.mjs" step "$im" "$tpm")"
    echo "[${B3_LOG}] stage=encode n=$(b3_field "$state" encodes) G=${g} limit=${limit} I_mp3=${im} TP_mp3=${tpm} → $(b3_field "$state" reason)" >&2
  done
  printf '%s' "$state"
}

# b3_busy <file> <pan_af> <G> [limit] → busy % on steps 1-3 (NO limiter): share
# of 50 ms frames whose Peak_level is above the limiter ceiling. LOGGED ONLY.
b3_busy() {
  local f="$1" pan="$2" g="$3" limit="${4:-0.708}" pre ceil peaks
  pre="${pan}${pan:+,}volume=${g}dB,aresample=44100"
  ceil="$(node -e 'process.stdout.write(String(20*Math.log10(parseFloat(process.argv[1]))))' -- "$limit")"
  peaks="$("$FFMPEG" -hide_banner -nostdin -i "$f" \
    -af "${pre},asetnsamples=n=2205:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level" -f null - 2>&1 \
    | grep -oE 'lavfi.astats.Overall.Peak_level=(-?[0-9.]+|-inf)' | grep -oE '\-?[0-9.]+|-inf')"
  printf '%s\n' "$peaks" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=s.split(/\n/).filter(Boolean).map(x=>x==="-inf"?-120:parseFloat(x));const c=parseFloat(process.argv[1]);const over=v.filter(x=>x>c).length;process.stdout.write(String(v.length?(100*over/v.length):0))})' -- "$ceil"
}

# b3_peak_timestamps <file> <pan_af> <G> [limit] → 5 largest above-ceiling peaks (s).
b3_peak_timestamps() {
  local f="$1" pan="$2" g="$3" limit="${4:-0.708}" pre ceil
  pre="${pan}${pan:+,}volume=${g}dB,aresample=44100"
  ceil="$(node -e 'process.stdout.write(String(20*Math.log10(parseFloat(process.argv[1]))))' -- "$limit")"
  "$FFMPEG" -hide_banner -nostdin -i "$f" \
    -af "${pre},asetnsamples=n=2205:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level" -f null - 2>&1 \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const re=/pts_time:([0-9.]+)[\s\S]*?Peak_level=(-?[0-9.]+|-inf)/g;let m,a=[];while((m=re.exec(s))){a.push([parseFloat(m[1]),m[2]==="-inf"?-120:parseFloat(m[2])])}const c=parseFloat(process.argv[1]);a=a.filter(x=>x[1]>c).sort((x,y)=>y[1]-x[1]).slice(0,5).map(x=>x[0].toFixed(1));process.stdout.write(a.join(", "))})' -- "$ceil"
}

# b3_fetch_audio <drive_id> <tmp-source> <out-base> → prints the local audio path.
# Downloads the source ONCE (refreshing the token once on a 401 when the caller
# defines refresh_token), extracts the first audio stream to <out-base>.mka
# (stream copy; falls back to lossless .flac), and deletes the downloaded source.
b3_fetch_audio() {
  local id="$1" tmp="$2" base="$3" url code
  url="https://www.googleapis.com/drive/v3/files/${id}?alt=media"
  code="$("$CURL" -sS --retry 3 -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer ${ACCESS_TOKEN}" "$url")"
  if [ "$code" = "401" ] && declare -F refresh_token >/dev/null; then
    echo "[${B3_LOG}] download 401 — refreshing token and retrying once" >&2
    refresh_token
    code="$("$CURL" -sS --retry 3 -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer ${ACCESS_TOKEN}" "$url")"
  fi
  if [ "$code" != "200" ]; then
    echo "[${B3_LOG}] download failed HTTP ${code} (token expired or no access)" >&2
    rm -f "$tmp"
    return 1
  fi
  if "$FFMPEG" -nostdin -y -v error -i "$tmp" -vn -map 0:a:0 -c:a copy "${base}.mka" 2>/dev/null; then
    rm -f "$tmp"
    printf '%s' "${base}.mka"
  elif "$FFMPEG" -nostdin -y -v error -i "$tmp" -vn -map 0:a:0 -c:a flac "${base}.flac" 2>/dev/null; then
    rm -f "$tmp" "${base}.mka"
    printf '%s' "${base}.flac"
  else
    echo "[${B3_LOG}] no extractable audio stream" >&2
    rm -f "$tmp" "${base}.mka" "${base}.flac"
    return 1
  fi
}
