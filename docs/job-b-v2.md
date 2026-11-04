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

## B3. Loudness chain — coordinator standard (3 Nov, confirmed by audio/engineering) — FROZEN
Chain (no acompressor, no rescue path):
1. pan=mono|c0=0.5*c0+0.5*c1 (only if 2 channels) → pass-1 ebur128 on that signal → I1, TP1
2. volume=<G>dB
3. aresample=44100
4. alimiter=limit=0.708:attack=5:release=50:level=disabled   (≈ −3 dBFS; stays 0.708)
5. -c:a libmp3lame -b:a 64k mono -map_metadata -1
G loop (approved 3 Nov, coordinator; audio agreed) — G is tuned on the LIMITED signal:
1. pass-1 on the mono signal → I1, TP1. G = target − I1.
2. Loop, max 3: a null pass of the FULL chain incl. alimiter (no mp3) → I_lim.
   |target − I_lim| ≤ 0.2 → stop. Else G += (target − I_lim).
   depth = TP1 + G − 20·log10(0.708). depth > 12 → CAP: G = 12 + 20·log10(0.708) − TP1,
   one more null pass → I_cap (measured); result "cap" if I_cap ≥ −18, else "failed"
   (exception route). Stop. After 3 loops: |target − I_lim| ≤ 0.5 → ok, else failed.
3. Encode ONCE; accept on the mp3: ok → target ±0.5; cap → I_cap ±0.5; TP ≤ −1.5 dBTP
   (accept check, not the limiter setting — MP3 adds overshoot); duration = source ±1 s.
   Otherwise failed, not uploaded.
busy = share of 50 ms frames (asetnsamples=n=2205, astats reset per frame, Peak_level)
above the limiter ceiling on steps 1–3 (no limiter). Measured and LOGGED ONLY, never used.
TARGET_I is one constant (default −16); switch it to −18 to retarget a whole course.
Speed: each source is downloaded ONCE to the runner, its audio extracted to a local file,
all passes run on that file, and it is deleted after each file.
Result: ok | cap | exception | failed.
Failed files also log the timestamps (s) of the 5 largest peaks above the limiter ceiling,
so the coordinator listens only to those moments.
Exception route: data/media-exceptions.json entries {drive_file_id, approved_by, date,
accept_I (≥ −18)}. A listed file runs the same loop at accept_I, ignoring depth;
TP ≤ −1.5 still enforced; result "exception". No entry → failed.
Dry run: course-audio input dry_run=true runs the same loop (null passes; no encode, no
upload, no manifest) and prints a table per part: part | I1 | TP1 | loops | final G |
I_lim or I_cap | depth | busy | expected result. Expected-failed files also log the 5
largest-peak timestamps.
Log per file: pass-1 I1/TP1/LRA, loops, every G and I_lim, I_cap, depth, busy, output
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
