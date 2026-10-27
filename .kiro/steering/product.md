---
inclusion: always
---

# Product: Learn (ថ្នាក់សិក្សា)

Learn is the Courses app of 84000.digital: teachers' recorded lessons (audio
and video), organised into courses, for Cambodian Buddhist students on phones.
It is a sibling of the Vacanā reader and the Library; each is its own app under
84000.digital with its own IndexedDB database.

## Who and why
- Audience: Khmer-speaking students following a teacher's course on a phone,
  often on a slow or intermittent connection. Default language Khmer; English
  available via `?lang=en`.
- Goal: find a course, play its lessons, and keep your place — offline-friendly
  for the app shell, streaming for the media.

## v1 scope
- Browse courses; open a course; play its lessons.
- Media kinds: `r2` (own audio player), `acast`/`youtube`/`drive` (embeds).
- Keep progress, saved courses/lessons, history, and notes locally (IndexedDB),
  with an Export/Import backup.
- On-device search over courses, lessons, and teachers; hand-off links to
  Vacanā and Library when there is no result here.
- Streaming only. No download button in v1.

## Not in v1 (do not build without asking)
- Login or accounts. The app is local-first, no server state.
- Any scripture text. Learn shows teachers' lessons, not the Tipiṭaka.
- Generated/synthetic audio or video. Media are human recordings only, hosted
  on R2 or the existing hosts (Acast, YouTube, Drive), never in the repo.
- Download of media in v1.

## Fixed names and addresses
- Repo: `payojana-foundation/learn-app` (private), branch `main` only.
- Cloudflare Worker: `learn-app`, static assets only, `workers_dev: false`.
- Public address: `https://learn.84000.digital` (custom domain, attached in
  `wrangler.jsonc`, never in the dashboard).
- Media host: `https://media.84000.digital` (R2), one config value.
- IndexedDB database: `learn-app`.

## Never
- Never type, correct, or reformat Khmer/Pāḷi titles or teacher names; copy
  them byte-for-byte from the data files.
- Never ship placeholder or sample courses, lessons, or teacher data. Unknown =
  hidden or "not added yet".
