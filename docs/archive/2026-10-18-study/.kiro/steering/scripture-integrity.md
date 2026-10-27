---
inclusion: always
---

# Scripture and content integrity

Why: the Library shows the verified 110-volume Cambodian Tipiṭaka; monks prepare sermons from it and scholars cite it. The Courses section shows teachers' lessons. One silent change breaks that trust.

## Scripture
- Pāḷi and Khmer scripture comes only from the archive export in `data/` (`vol0NN.json`, `words0NN.json`, `manifest.json`, copied from vacana-app by a person). Never type, retype, paste, "fix", trim, or normalize it (Unicode form, spaces, zero-width characters, brackets, digits) in code, data files, tests, or fixtures. If a change seems necessary, stop and ask.
- Never edit those archive files. New exports are uploaded by a person through GitHub.
- Rendering code may wrap or style text. It never changes characters.
- Tests and examples refer to rows by volume + verse number, or use placeholder strings like `[verse text]`. Never put real verse text in them.
- Row `id`, `key` and `order` are valid within one export only. Never store them in user data, URLs, or link tables. Permanent reference = volume + verse number (+ printed page).
- If text looks wrong, don't fix it. Report volume, verse, page and the problem; the team corrects it in the archive Sheet.
- Every row whose `verified` is not `true` shows **មិនទាន់ផ្ទៀងផ្ទាត់**. The scan does not remove that label.

## Titles, names and teacher data
- Course titles, lesson titles, teacher names, titles and bios are displayed exactly as stored. No machine translation, no stripping of `.mp3`/`.mp4` from titles, no choosing between spellings. Corrections happen in the teacher sheets, never in code.
- English course title is `null` when the source has Khmer in the English field; show the Khmer title marked `lang="km"`.
- A teacher bio is shown only when the data marks it approved by the teacher.

## Links to other works
- SuttaCentral links appear only when their row in `data/links/sc0NN.json` has `status: "approved"`. Never generate, guess, or extend a mapping in code.

## Drafts and audio
- Word meanings, grammar notes, doctrinal explanations, and translations start with **DRAFT – needs reviewer approval**. v1 shows none.
- Never generate or synthesize audio or video. Media are human recordings only, kept in R2 or the existing hosts (YouTube, Acast, Drive), never in the repo.
- Never ship placeholder or sample scripture, sample lessons, or fake teacher data. Unknown = hidden or "not added yet".
