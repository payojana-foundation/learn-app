# learn-app — Job B (course-audio) v2 · APPROVED by audio/engineering 2 Nov 2026 (B3 rewritten 3 Nov; frozen)

> SPEC FREEZE — STARTED 3 Nov (audio + engineering): B2–B5 as rewritten 3 Nov, until pilot parts 1–15 are live and signed off. Frozen: key rule (B2), B3 chain + thresholds, B4 fields, B5 checks. Allowed: only fixes for a crash or wrong output, logged as "CHANGE: old → new — reason, date". Failing files stop and are reported; spec unchanged. New ideas → "v3 list" at the end of this doc.

Replaces Job B in claude/learn-kiro-bulk-01.md and the course-audio parts of bulk-02 Q3.
Status of every output: "DRAFT – needs reviewer approval" until a person signs off.

## B1. Input and source record
- Queue CSV: one drive_file_id per line (pilot: data/audio-queue.pilot.csv).
- Pilot lesson 1 source = 1EyF4VvMVm5RquR6dEUd-yn_pdznwxYtu (419,966,474 bytes, 25:06).
- data/media-duplicates.json lists ids that must never be converted;
  first entry: 1tvjvDJxPVAsuKSyLJ6TBqE-mU5vUAveT (duplicate of part 1).
  A queued id on this list → skipped, reason "listed duplicate".
- Duplicate guard: if the computed key already exists in course-media (rclone lsjson,
  size > 0) → skipped, reason "key exists". Checked before any download.
- Per id, Drive files.get (fields=name,mimeType,size,md5Checksum) — no download
  for this step. Missing md5Checksum → failed, reason "no md5Checksum".

## B2. Key rule
- key = audio/<first 16 hex of md5Checksum>-a64.mp3 ; correction -a64-v2.mp3 (version last).
- Never overwrite, never reuse. Existing audio/1EyF4VvM…-a64.mp3 stays untouched
  and is not referenced by the new manifest entry for part 1.
- Upload headers: Cache-Control public, max-age=31536000, immutable;
  Content-Type audio/mpeg.

## B3. Loudness chain — FINAL AUDIO STANDARD (4 Nov, audio + coordinator) — FROZEN
Target: TARGET_I = −18 LUFS for all courses (one constant).
Chain (no acompressor, no rescue path):
1. pan=mono|c0=0.5*c0+0.5*c1 (only if 2 channels) → pass-1 ebur128 on that signal → I1, TP1
2. volume=<G>dB
3. aresample=44100
4. alimiter=limit=0.708:attack=5:release=50:level=disabled   (≈ −3 dBFS; stays 0.708)
5. -c:a libmp3lame -b:a 64k mono -map_metadata -1
Loop and ceiling (CHANGE 4 Nov) — the loop measures the ACTUAL encoded mp3 and tunes a
VARIABLE limiter ceiling; it replaces the null-pass G loop and the old "one G-lowering
re-encode" TP rule:
1. Start: alimiter limit=0.60. Starting G from the null pass, capped at
   G_max = 12 + 20·log10(limit) − TP1.
2. Loop, max 5 encodes total: encode mp3 → decode → ebur128=peak=true → I_mp3, TP_mp3.
   In this order:
   a. TP_mp3 > −1.5 dBTP → limit = limit × 0.9 (min 0.50); G unchanged but re-capped to
      the new G_max. Still over at limit 0.50 → failed, stop.
   b. else |−18 − I_mp3| > 0.2 → G += (−18 − I_mp3), capped at G_max.
   c. else stop.
   No adjustment after the 5th encode; the result is judged on the last encoded mp3.
3. Result: ok = I within −18 ±0.5 AND TP ≤ −1.5. cap = −19.0 ≤ I < −18.5 AND TP ≤ −1.5.
   failed = I < −19.0, or TP > −1.5 at the end, or duration off by > 1 s. Failed → no upload
   (exception route unchanged: run at accept_I, accept within accept_I ±0.5).
4. Log per file: for each loop G / limit / I_mp3 / TP_mp3; loops used; final depth; busy.
alimiter `level`: the code sets level=disabled (auto-level, on by default in ffmpeg, is OFF).
busy = share of 50 ms frames (asetnsamples=n=2205, astats reset per frame, Peak_level)
above the limiter ceiling on steps 1–3 (no limiter). Measured and LOGGED ONLY, never used.
Speed: each source is downloaded ONCE to the runner, its audio extracted to a local file,
all passes run on that file, and it is deleted after each file.
Key: part 1 (and every file) uploads under its md5 key audio/<16 hex>-a64.mp3, never -v2
(-v2 is only a later correction of an md5 key).
Queue: a missing or empty queue file FAILS the run with a clear error (list must include
the folder, e.g. data/audio-queue.pilot.csv).
Result: ok | cap | exception | failed.
Failed files also log the timestamps (s) of the 5 largest peaks above the limiter ceiling,
so the coordinator listens only to those moments.
Exception route: data/media-exceptions.json entries {drive_file_id, approved_by, date,
accept_I (≥ −19.0)}. A listed file runs the same loop at accept_I, ignoring depth; the mp3
must be within accept_I ±0.5 and TP ≤ −1.5; result "exception". No entry → failed.
Dry run: course-audio input dry_run=true runs the same loop (null passes; no encode, no
upload, no manifest) and prints a table per part: part | I1 | TP1 | loops | final G |
I_lim or I_cap | depth | busy | expected result. Expected-failed files also log the 5
largest-peak timestamps.
Log per file: pass-1 I1/TP1/LRA, loops, every G and I_lim, I (cap), depth, busy, output
I/TP/LRA, duration source/output, result.Superseded (invalid test, kept for history): the 2 Nov two-pass loudnorm, the 2 Nov
compressor chain (acompressor), B6 rev 2, and the 2 Nov A/B verdict.

## B4. Manifest entry (data/media-manifest.json)
lesson_code (from teacher sheet, else null), drive_file_id, drive_name, source_md5,
key, bytes, duration_s, sha256, loudness {pass1:{I,TP,LRA}, G, limit, depth, busy, out:{I,TP,LRA},
loops, result (ok | cap | exception | failed)}, status ("DRAFT – needs reviewer approval").

## B5. Checks
- Build fails if one lesson resolves to two keys.
- Two lessons sharing one source_md5 = same key = one upload. Not a build stop:
  warning + reports/course-issues.csv, silenced when listed in
  data/media-shared-sources.json. Lesson ↔ manifest link is drive_file_id.
- Upload: rclone copy --immutable; verify remote size == local bytes, curl -I 200,
  Range 0-99 → 206.
- Output duration = source duration ±1 s, else failed (also in B3).

## B6. A/B test — SUPERSEDED 3 Nov (invalid test; not re-run) (one-off workflow ab-test.yml, before parts 2–15) — one run, all blind
- Part 1 (id 1EyF4VvM…), 6 clips: loudest 90 s + one pause ≥ 3 s (from the ebur128
  log); three versions: current (2 Nov upload) / new chain B3 / new chain gained to
  the current I (≈ −18). Names A-loud, B-loud, C-loud, A-pause, B-pause, C-pause;
  same letter = same version in loud and pause.
- Part 4 (id 11UtCc2btipfdDjghsUjivEUP9SmPGsG_), 3 clips: loudest 90 s; three
  versions: policy result (B3) / forced −16 (up to 6 loops, heavy limiting) / −18.
  Names P4-x.mp3, P4-y.mp3, P4-z.mp3, random order.
- All under course-media test/2026-11-02/, Cache-Control: no-store,
  Content-Type audio/mpeg. Order written only to a private artifact.
- 9 URLs in the run summary, each curl -I → 200.
- Cleanup: the coordinator deletes test/ in the Cloudflare dashboard after the
  verdict (workflows never delete). Parts 2–15 wait for the verdict.

## Resolved 2 Nov
1. Shared sources: warning + CSV, not a build stop (see B5). 2. lesson_code null for
the pilot. 3. test/ deleted by the coordinator by hand.

## B6 rev 2 — SUPERSEDED 3 Nov (skipped) — ab-test re-run (audio + engineering, 3 Nov; test workflow only, B3 unchanged)
- Render each FULL file through each version's chain, then cut every clip from those full renders with -c copy at identical timestamps. "current" = cut from the uploaded 2 Nov mp3 with -c copy. No mp3→mp3 re-encode. Assert every clip: 44100 Hz, mono, 64 kbps.
- Versions — Part 1: current / B3 / B3 matched to current's I (±0.3 LU). Part 4: B3 policy / forced −16 / −18 (matched pair within ±0.3 LU).
- Windows: loud = loudest 90 s by short-term loudness, fully inside the file, start ≥ 120 s, end ≤ duration − 120 s (60 s minimum if needed). Pause = a ≥ 3 s pause at ≥ 300 s, clip 30 s with the pause in the middle. Same windows for all versions.
- Rounds: two rounds, each with its own random labels (R1-A…, R2-A…); keys only in the private artifact until the verdict.
- Log per clip in the run summary: round, label, window start/end, duration, sample rate, and for the version: path/chain, G, limit, I, TP, LRA, depth, busy, result.
- Upload under test/2026-11-03/. Send the run-summary log first (audio checks validity), then the clip URLs. Freeze on hold; parts 2–15 wait.

## Coordinator audio standard (3 Nov) — CONFIRMED by audio/engineering 3 Nov (see B3)
1. Target loudness −16 LUFS (accept −16 ±0.5).
2. Processing: limiter only (no compressor). Chain: pan (if 2 ch) → volume G → aresample 44100 → alimiter → libmp3lame 64k mono.
3. Peak ceiling −1.5 dBTP (unchanged).
4. If −16 needs heavy limiting (depth/busy rule fails): accept quieter, down to −18 LUFS, result "cap", listed for the coordinator; below that → failed, not uploaded.
Approval: files with result "ok" may be approved by course by the team without listening; "cap" and "failed" go to the coordinator.

## A/B verdict (coordinator, 2 Nov) — SUPERSEDED 3 Nov (invalid test)
- Part 1: B preferred (loud and pause). Part 4: P4-z preferred.
- Order key: in the ab-test run artifact (coordinator holds it). Thresholds: pending audio + engineering.

## CHANGE log
- CHANGE: 4 Nov 2026 "B3 loop and ceiling": alimiter starts limit=0.60; loop (max 5 encodes) MEASURES the encoded mp3 — TP > -1.5 tightens the limiter (×0.9, min 0.50), else G chases -18; result on the last mp3 (ok -18 ±0.5 / cap -19.0..-18.5 / failed). Replaces the null-pass G loop and the "one G-lowering re-encode" TP rule. Reason: the mp3 encode lowered I by 0.4-0.5 LU vs the null pass; mp3 TP overshot the -3 dBFS ceiling by +1.5 to +2.7 dB; lowering G did not move TP. Approved: coordinator; Audio agreed.
- CHANGE: 4 Nov 2026: course audio standard — target -18; G loop max 5, aim ±0.2, ok ±0.5; cap at depth 12: ok ±0.5 / cap -19.0..-18.5 / failed < -19.0; mp3 TP ≤ -1.5 (one G reduction re-encode); part 1 on md5 key. Replaces 3 Nov -16 and 3 Nov loop/cap changes. Reason: blind pair test 3-4 Nov, part 7 worse at -16 both rounds (caveat: all picks 'a'). Approved: coordinator; Audio agreed.
- CHANGE: 3 Nov 2026: B3 gain G = target - I(pass1) → G loop on the limited signal (max 3, aim ±0.2, accept ±0.5, cap at depth 12 with measured I). Reason: limiter cost 1.2-1.8 LU on part 8. Approved: coordinator; Audio agreed.
- CHANGE: busy via plain astats stderr grep → `asetnsamples=2205,astats=metadata=1:reset=1,ametadata=mode=print:key=…Peak_level` parsed per frame (same filter for the failed-file peak timestamps) — per-frame values are not in stderr so busy was always 0, 3 Nov.
- CHANGE: b3-decide cap capI = I(pass1) − cut → capI = −16 − cut — the chain targets −16 before the cap, so the floor check used the wrong I, 3 Nov.
- CHANGE: Drive token used once for the whole job → refreshed before each file and once on a 401 (REFRESH_TOKEN_CMD); 401 hint "check sharing" → "token expired or no access" — tokens expire after 60 min, 3 Nov.
- CHANGE: accept rule "depth ≤ 6, or ≤ 12 with busy < 0.5 %" with cap to 6/12 → accept = depth ≤ 12 only, busy logged not used, cap G − (depth − 12), cap I = TARGET_I − cut (TARGET_I one constant, default −16) — audio + coordinator rule change, 3 Nov (pending test).
- CHANGE: "already in manifest" skip on any entry → only when that id's entry has the B2 md5 key; a legacy `audio/<drive_id>` entry is re-processed and replaced in the manifest on success (old R2 object untouched), 3 Nov.

## v3 list
(empty)

## Pilot plan (3 Nov)
1. Run all 15 from data/audio-queue.pilot.csv with dry_run=true first; send the table
   (part, G, depth, busy, expected result) to audio. Real run only after the coordinator reads it.
2. Real run: part 1 uploads under its md5 key (-a64.mp3).
3. Coordinator listens to part 1 (2 min start + 2 min middle), every "cap", and the logged
   peak moments of every "failed" (→ exception or manual fix).
