# learn-app — Job B (course-audio) v2 · APPROVED by audio/engineering 2 Nov 2026 (changes applied)

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

## B3. Loudness chain (replaces two-pass loudnorm)
1. Pass 1: ebur128 on the mono-mixed signal (after pan, after aresample) → I, TP, LRA.
2. Filter order: pan=mono|c0=0.5*c0+0.5*c1 (only if source has 2 channels) →
   aresample=44100 → volume=<G>dB with G = -16 - I(pass 1) →
   alimiter=limit=0.708:attack=5:release=50:level=disabled →
   encode -c:a libmp3lame -b:a 64k -map_metadata -1.
3. Verify the finished mp3: ebur128=peak=true → I, TP, LRA.
4. Loop, max 3: first TP > -1.5 → limit × 0.9; then I < -16.5 → G += (-16 - I);
   I > -15.5 → G -= (I + 16). Limit never below 0.5 → stop, report.
5. Accept only I = -16 ±0.5 LUFS and TP ≤ -1.5 dBTP; otherwise failed, no upload.
6. Log per file: pass-1 I/TP/LRA, final G, limit, output I/TP/LRA, loops.

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

## B6. A/B test (one-off workflow ab-test.yml, before parts 2–15)
- From part 1: loudest 90 s and one pause ≥ 3 s, located from the ebur128 log.
- Renders 3 versions, random order across A/B/C: current (as uploaded 2 Nov),
  chain B3, and chain B3 with a fixed gain down to the current file's I (≈ -18)
  so the listener judges the limiter, not the volume.
- Upload to course-media test/2026-11-02/: A-loud.mp3, B-loud.mp3, C-loud.mp3,
  A-pause.mp3, B-pause.mp3, C-pause.mp3 (6 clips), Cache-Control: no-store, Content-Type audio/mpeg.
- The A/B/C order is written only to a private artifact (not the run summary).
- Each URL checked with curl -I → 200; the 6 URLs are printed in the summary.
- Cleanup: the coordinator deletes test/ in the Cloudflare dashboard after the
  verdict (workflows never delete).

## Resolved 2 Nov
1. Shared sources: warning + CSV, not a build stop (see B5). 2. lesson_code null for
the pilot. 3. test/ deleted by the coordinator by hand.
