#!/usr/bin/env bash
# Stub ffmpeg for b3-loop.test.mjs — models encode + ebur128 decode of the
# CHANGE-4-Nov B3 loop. An encode (an .mp3 output + an alimiter chain) records
# G/limit and writes the output; a subsequent ebur128 read reports
#   I_mp3 = I1 + G - LOSS,  TP_mp3 = min(TP1 + G, 20*log10(limit) + OVER).
af=""; prev=""; out=""
for a in "$@"; do
  [ "$prev" = "-af" ] && af="$a"
  case "$a" in *.mp3) [ "$prev" != "-i" ] && out="$a";; esac
  prev="$a"
done
g="$(printf '%s' "$af" | sed -n 's/.*volume=\(-\{0,1\}[0-9.]*\)dB.*/\1/p')"
lim="$(printf '%s' "$af" | sed -n 's/.*alimiter=limit=\([0-9.]*\).*/\1/p')"
i1="${STUB_I1:--24}"; tp1="${STUB_TP1:--9}"; loss="${STUB_LOSS:-1.5}"; over="${STUB_OVER:-0}"
# An ENCODE has libmp3lame + an .mp3 OUTPUT (not -i input); it records G/limit.
if [ -n "$out" ] && printf '%s' "$*" | grep -q 'libmp3lame'; then
  printf '%s %s' "${g:-0}" "${lim:-0.6}" > .lastenc
  : > "$out"
  exit 0
fi
# A READ (ebur128). Pass-1 (no prior encode) → raw I1/TP1. After an encode →
# the mp3 numbers for the recorded G/limit.
if [ -f .lastenc ]; then
  read -r G L < .lastenc
  I="$(awk -v i="$i1" -v g="${G:-0}" -v l="$loss" 'BEGIN{printf "%.4f", i+g-l}')"
  ceil="$(awk -v x="$L" 'BEGIN{printf "%.4f", 20*log(x)/log(10)}')"
  TP="$(awk -v t="$tp1" -v g="${G:-0}" -v c="$ceil" -v o="$over" 'BEGIN{v=t+g; cap=c+o; if(v>cap)v=cap; printf "%.4f", v}')"
else
  I="$i1"; TP="$tp1"
fi
cat >&2 <<EOT
  Integrated loudness:
    I:         $I LUFS
  True peak:
    Peak:       $TP dBFS
  Loudness range:
    LRA:         5.0 LU
EOT
