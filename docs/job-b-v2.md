# learn-app — Job B (course-audio) v2 · APPROVED by audio/engineering 2 Nov 2026 (B3/B6 updated 2 Nov, 21:00)

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

## B3. Loudness chain (audio + engineering, 2 Nov, replaces earlier B3)
Chain:
1. pan=mono|c0=0.5*c0+0.5*c1 (only if 2 channels) → pass-1 ebur128 on that signal
2. volume=<G>dB, G = -16 - I(pass 1)
3. acompressor=threshold=0.1:ratio=2:attack=20:release=250:knee=6:makeup=1
4. aresample=44100
5. alimiter=limit=0.708:attack=5:release=50:level=disabled
6. -c:a libmp3lame -b:a 64k -map_metadata -1
Measure (steps 1–4, no limiter, null output):
- depth = TP(ebur128 peak=true) − 20·log10(limit)  [dB]
- busy = share of 50 ms frames (asetnsamples=n=2205, astats reset per frame,
  Peak_level) above the limiter ceiling  [%]
Then verify the finished mp3 with ebur128 peak=true.
Accept: I −16 ±0.5 LUFS and TP ≤ −1.5 dBTP, AND (depth ≤ 6 dB, OR depth ≤ 12 dB
with busy < 0.5 %).
Cap: if the depth rule fails, lower G until it holds; accept the loudest result
within the rule down to I = −18 LUFS (TP ≤ −1.5 still), result "cap".
Stop: if even −18 breaks the rule → failed, no upload, report (source may need a
manual fix: knocks/clipping). Loops max 3. No 6-loop forcing in production.
Log per file: pass-1 I/TP/LRA, G, limit, depth, busy, output I/TP/LRA, loops,
result (ok | cap | failed). Thresholds 6 / 12 / 0.5 are starting values set by A/B.

## B4. Manifest entry (data/media-manifest.json)
lesson_code (from teacher sheet, else null), drive_file_id, drive_name, source_md5,
key, bytes, duration_s, sha256, loudness {pass1:{I,TP,LRA}, G, limit, out:{I,TP,LRA},
loops}, status ("DRAFT – needs reviewer approval").

## B5. Checks
- Build fails if one lesson resolves to two keys.
- Two lessons sharing one source_md5 = same key = one upload. Not a build stop:
  warning + reports/course-issues.csv, silenced when listed in
  data/media-shared-sources.json. Lesson ↔ manifest link is drive_file_id.
- Upload: rclone copy --immutable; verify remote size == local bytes, curl -I 200,
  Range 0-99 → 206.

## B6. A/B test (one-off workflow ab-test.yml, before parts 2–15) — one run, all blind
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

## B6 rev 2 (audio + engineering, 3 Nov — supersedes B6 for the A/B workflow)
- RENDER: run each FULL file through each version's chain, then cut every clip
  from those full renders with `-c copy` at identical timestamps. "current" =
  cut from the uploaded 2 Nov mp3 with `-c copy`. No mp3→mp3 re-encode. Assert
  every clip: 44100 Hz, mono, 64k.
- VERSIONS: Part 1 — current / B3 / B3 matched to current's I (±0.3 LU). Part 4 —
  B3 policy / forced -16 / -18 (matched pair within ±0.3 LU).
- WINDOWS: loud = loudest 90 s by short-term loudness, start ≥ 120 s, end ≤
  duration-120 s (60 s minimum if needed). Pause = a ≥3 s pause at ≥ 300 s in;
  clip 30 s with the pause in the middle. Same windows for all versions.
- ROUNDS: two rounds, each with its own random labels (R1-A…, R2-A…); keys only
  in the private artifact.
- LOG per clip in the RUN SUMMARY: round, label, window start/end, duration,
  sample rate, and for the version: chain, G, limit, I, TP, LRA, depth, busy,
  result.
- Upload under test/2026-11-03/, Cache-Control: no-store; each URL curl -I → 200.

## Resolved 2 Nov
1. Shared sources: warning + CSV, not a build stop (see B5). 2. lesson_code null for
the pilot. 3. test/ deleted by the coordinator by hand.
