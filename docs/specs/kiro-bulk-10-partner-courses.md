# Kiro bulk 10 — learn-app · partner YouTube classes (wave 1) · 19 Nov 2026 (replaces the 18 Nov versions)

Owner of Kiro runs: the Learn chat (Product Engineering). Partner Courses chat owns the sheet, the sync script and this spec's content.
Background: claude/partner-courses-workflow.md, claude/partner-courses-brief.md. Decision log: claude/study-kiro-handoff-status.md (18 Nov CHANGE).
**Where this spec and the workflow doc differ, this spec wins** (changes 18–19 Nov listed at the end).

Partner sheet: `125ESieDhoezwhb-7RS54O2BSBhJtZOyTW59V7SfFDFA` — tabs README, Example, Partners, Playlists, Videos, Terms (copy), Meta. Header names are the contract. **Ignore tabs README and Example.**
Master sheet: `12MOXAOHwwtKa6DFVwbfRMj8UtaKmN1758boN1EUKNZs` (own lessons; unchanged except P2b).
Sync YouTube → partner sheet: already built as a Google Apps Script inside the partner sheet (project doc claude/partner-sync-apps-script.gs). **Kiro does not build a sync.** First sync ran 18 Nov: 3 partners, 203 playlists, 8,763 videos.

Rules: git pull first; main only; one commit per part; tests must pass (unit + e2e) before each push; push with retry; report reports/kiro-bulk-10-report.md (untracked). Touch only what each part names. Do NOT change course-audio, approve-media, media workflows, the manifest, master-export behaviour for Lessons/Courses, scripts/master/seed.mjs, or own (R2) lesson behaviour except where a part says so. Never retype Khmer: byte-for-byte from the sheet. Never invent ids, titles, slugs, teaching points or statuses. Never download from YouTube or KillerPlayer. Windows: one e2e suite at a time; stop port 4321 servers before/after.

Protected rules: coordinator approved changing **P-07** and **P-19** (18 Nov). **P-14** text must be approved by the coordinator after P0 (player is per playlist, needs frame-src AND script-src for killerplayer.com).

## Decisions that shape the build (coordinator, 18–19 Nov)
- **One KillerPlayer playlist player per partner class** (wave 1). One embed code per playlist, pasted by the team into Playlists.kp_embed. No per-lesson player; per-video embeds may come later.
- Partner classes: course page shows the KillerPlayer playlist player (loads only after a tap on the cover) and the list of lesson titles (for reading and find-in-course). **No per-lesson progress for partner classes**: course shows "started" after first play tap, plus a manual "mark class done". (KillerPlayer exposes no public player events.)
- Label on partner courses: icon + "from YouTube, needs internet" (km: DRAFT – needs reviewer approval). No download/offline.
- A playlist is released only when the team confirmed it: **decision = Add AND decided_at filled AND kp_embed valid AND teacher mapped**. Partial is not used in wave 1 (the playlist player would play skipped videos): a Partial row → hidden + reported.
- Search: option A — partner courses enter catalog.json as course entries (title/display_title, teacher, partner, teaching points). Own-lesson search unchanged.
- Partner view: /partners/<slug>; slugs dhammika-life · abhidhamma-daily-life · wat-khmer-arizona.
- Ids: course yt-pl-<playlist_id>; lesson yt-<11-char video id>; never c###.
- What Learn already has is never added again (team marks Skip). Build duplicate guard as backup.
- Adoption later: own master lesson whose youtube_link = a partner video retires that partner lesson (alias, progress kept).

## P0 — Review + report (no code). STOP after.
- Conflicts with protected.md P-lines, data contract, earlier decisions (file:line each).
- Exact text for P-07, P-19 and **P-14** (frame-src + script-src `https://killerplayer.com` only; iframe rendered by Learn, not pasted HTML; tap-to-load; own lessons stay R2-only). Coordinator approves P-14 from this report.
- How catalog.json, course files, routes and search are built today; least-change entry point for partner courses.
- Teacher records: slugs for Ven. Sok Theavy, Ven. Yon Yi, Ven. Sor Ratha (sor-ratha), Ven. Sem Chanthy (លោកម្ចាស់គ្រូ សែម ចាន់ធី, no record yet: list required fields; do NOT create him).
- Master sheet: does any job read tabs other than Lessons/Courses? Safe to add a tab "Teaching points"?
- Service account email that the build/export will use to read the partner sheet (coordinator shares it as Viewer).
- STOP.

## P1 — partner export
- Workflow (dispatch + daily, after the 03:00 sync window; off-peak minute) reading the partner sheet → data/partners/{partners,playlists,videos,terms}.csv, byte-exact, header check against the contract (fail loudly on a renamed or missing header). Ignore README, Example. Commit only when changed; push with retry.

## P2 — build merge
- Partner course = Playlists row meeting the release rule above. Lessons = its Videos rows with playable = yes and status ≠ Skip/Hidden/Moved, in position order (titles byte-for-byte).
- **Embed safety:** never inject kp_embed HTML. Extract the playlist UUID with a strict pattern `https://killerplayer.com/watch/video/playlist/<uuid v4>`; no match → course hidden + reported. Learn renders its own iframe from the UUID; the helper script URL is a fixed constant in code (`https://killerplayer.com/watch/embed.js`; report whether the `?v=` value matters).
- Teacher: Playlists.teacher_slugs, else Partners.teacher_slugs; unmapped → hidden + reported (P-19). Never parse the notes column.
- Duplicate guard: partner course with the same normalised title + teacher as an own course → refused + reported.
- Retirement: partner course/lesson that disappears or stops meeting the rule keeps its id in a retired list; saved progress never dropped; My Learning shows it as no longer available (km DRAFT – needs reviewer approval, en "No longer available").
- Adoption: own lesson with youtube_link resolving to a partner video id → that partner lesson retired, alias to the own lesson id; report how progress is carried.
- Tests: prefixes (yt-, yt-pl-, never c###), release rule, embed-UUID parser (rejects other hosts, scripts, javascript: URLs), duplicate guard, retirement.
- Commit "change protected: P-19 …".

## P2b — master "Teaching points" tab (only if P0 says safe)
- Tab "Teaching points" in the master sheet: term_id (stable, never reused, SYSTEM) · term_km · term_pali · term_en · other_spellings (`;`) · approved_by · approved_at · notes. Approvers: Renovann / Chansy. Schema in data/master/columns.json (or sibling). No Lessons/Courses columns now.

## P3 — partner view + search
- Routes /partners and /partners/<slug> (commit "change protected: P-07 …"). Partner page: name km/en, teachers, courses. Teacher pages also list that teacher's partner courses.
- catalog.json partner entries; teaching points resolved via Terms (term_km, then other_spellings) → term_id; unknown term → report. Search matches term_km/term_pali/term_en/other_spellings; normalise (fold diacritics, strip zero-width/invisible characters, case-fold Latin).
- Label strings in strings.ts.

## P4 — player (after coordinator approves P-14)
- Course page: cover image first; on tap, render the KillerPlayer iframe for the UUID + load the helper script once. CSP in public/_headers: frame-src and script-src add `https://killerplayer.com` only. Commit "change protected: P-14 …".
- Course progress: "started" on first tap; manual "mark class done". No per-lesson ticks for partner courses.
- Until P-14 is approved, partner courses stay out of the live build (no "coming soon").

## Report (end of each part)
Commit hash, tests (unit/e2e counts), files touched, skipped items and why, open questions. Never guess an id, slug or title.

## Changes vs 18 Nov spec
- P1 sync removed (Apps Script in the sheet does it). Old P2 export is now P1.
- Player per playlist (Playlists.kp_embed), not per video; Videos.kp_embed unused in wave 1.
- Release needs decided_at (team confirmation) and a valid kp_embed; Partial not used in wave 1.
- Embed is parsed to a UUID; pasted HTML is never injected. CSP needs script-src too.
- No per-lesson progress for partner courses.
- Tabs README/Example ignored; Playlists has a team "notes" column (never parsed).
