---
inclusion: auto
name: media
description: Rules for course audio/video — media kinds, R2 keys, media URLs, players, and offline caching of media. Use when working on lesson players, media URLs, R2 keys, or media caching.
---

# Media (course lessons)

## Lesson media (v1)
- Play only the source named in the lesson's media object. `null` = not present;
  never guess a URL.
- `kind` values: `r2` (own native `<audio>`/`<video>` player), `acast` (iframe
  embed), `youtube` (iframe embed), `drive` (Drive preview iframe).
- Starting one player stops any other playing in the app. Third-party iframes
  (Acast, YouTube, Drive) can't be paused from outside, so only one lesson
  player is mounted at a time; opening another removes the previous iframe.
- Embedded (acast/youtube/drive) media need internet. Show a clear offline
  message instead of a broken frame.
- v1 is streaming only: no download button at all.

## R2
- Buckets (approved names, see docs/SETUP-coordinator.md): `word-audio`,
  `course-media`.
- Keys are immutable: once uploaded, a key is never overwritten or renamed. A
  correction gets a new key (`-v2`); the data file points to it.
- The media base address is one config value (`VITE_MEDIA_BASE_URL`,
  `src/config.ts`), e.g. `https://media.84000.digital`. Never scatter it or
  derive it from `location`.
- File/key names may contain Khmer/Pāḷi letters. Use the stored value exactly
  and URL-encode it when building the URL. Never normalize or transliterate it.
- Offline caching of media needs a CORS rule on the public bucket for the app's
  origin. State this in designs; do not assume it exists.
- Media never go in this repo or in `dist/`.

## Audio integrity
- Human recordings only. Never generate, synthesize, or mix in synthetic audio
  or video.
