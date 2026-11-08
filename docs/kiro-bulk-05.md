# Bulk 05 — Study companion (guide leaf, paths, branch)

## Rules for this task

- Work on main. Commit + push only when tests pass.
- No branches, no pull requests.
- Touch ONLY what this file asks. Do not change any existing flow, screen, string, route, store or test unless a part below names it. If a change seems needed elsewhere, write it in the report and STOP.
- Never type, edit or generate scripture or teaching text. Guide lines and path titles come from data files filled by people.
- Nothing leaves the device. No account, no network calls beyond the existing data loader.
- Test as much as you can (unit + e2e). Report anything you could not test.
- Report file: reports/kiro-bulk-05-report.md (append one section per part).

## What we are building

1. Guide leaf: a small plain leaf sign (SVG) beside one short fixed line of text. No face, no character, no animation, nothing generated.
2. Learning paths: data only (ordered course ids).
3. Branch: on /my, a plain branch that shows one leaf per finished course. No numbers, levels, empty slots, percent or comparison. Leaves never disappear after a pause.

Not in scope: points, ranks, streaks, badges, quizzes, AI text.

## P0 — Read and report (no code)

Read the spec files, .kiro/steering/*, strings.ts, the IndexedDB code, backup Export/Import, aliases rewrite, data loader, the Start here config, the /my page and the course page. Report:

a. exact shape of the progress store, and how "lesson completed" (90 % or button) is saved
b. how to tell "every visible lesson of a course is completed" (hidden lessons excluded) from data that already exists
c. where the Start here course list lives now
d. how catalog/course JSON is loaded and verified, and how a new data file should join that path
e. what Export/Import includes; current DB version
f. how provisional course ids get rewritten
g. whether c021-c024 and c080 are provisional ids; if so, how course_signs keys will follow the rewrite
h. any conflict between this file and the spec or protected.md

STOP. Wait for "go P1".

## P1 — Data and logic (one commit)

1. public/data/paths.json

   ```json
   { "version": 1, "paths": [
     { "id": "start-here", "title_km": null,
       "title_en": null, "course_ids": [],
       "approved": false } ] }
   ```

   - Load and verify it the same way as catalog data (P0 d). Bad file = keep previous copy.
   - The existing Start here row reads path "start-here" instead of its old config list. Move the current config ids into course_ids as they are (do not invent ids). Keep the rule: empty or approved=false = row hidden.
   - Unknown course ids are skipped and listed in reports/paths-issues.csv by the build/check.
   - No other path UI in this task.

2. public/data/guide-lines.json

   ```json
   { "version": 1,
     "default_sign": "leaf-sign-draft.svg",
     "course_signs": {
       "c021": "moon-hare-draft.svg",
       "c022": "moon-hare-draft.svg",
       "c023": "moon-hare-draft.svg",
       "c024": "moon-hare-draft.svg",
       "c080": "moon-hare-draft.svg" },
     "lines": { "<key>": { "km": "...",
       "en": "...", "approved": false } } }
   ```

   Keys (fill km/en from the block at the end of this file, all approved=false): home.start_here, course.finished, my.branch.empty

   - App shows a line ONLY if approved=true. Unapproved or missing = show nothing (no fallback text, no placeholder).
   - Dev build only (import.meta.env.DEV): query ?guide=draft also shows unapproved lines, with a visible "DRAFT" tag. Never in prod.
   - Sign: course_signs[course_id] if present, else default_sign. Files live in public/brand/companion/. A person can change course_signs later with no code change. If a course id in course_signs is not in the catalogue, list it in reports/paths-issues.csv. Unknown file name = use default_sign and log a console warning.

3. Leaves store (one tiny new store; needed so a leaf never disappears if a course later gets new lessons):

   - store `leaves`: key course_id, value { course_id, at }.
   - When completion state changes and a course has every visible lesson completed (P0 b), add its leaf once. Never delete or update a leaf, even if lessons are added later or a lesson is un-marked.
   - On first run after the update, add leaves for courses that are already finished (one transaction).
   - Bump the DB version with a migration that never deletes or clears existing stores.
   - Cross-tab: write inside one transaction; adding an existing key is a no-op, so two tabs cannot create duplicates.
   - Export includes `leaves`. Import merges leaves (union by course_id); an older backup without `leaves` must not remove any.
   - The provisional-id rewrite (P0 f) also rewrites leaves keys and course_signs keys.

4. Update docs/data-contract.md for both files.

5. Unit tests: line gating (approved / unapproved / missing), sign choice (default, course_signs hit, unknown file), paths parsing and unknown ids, leaf added once, leaf kept after a lesson is added, migration keeps old stores, export/import merge, alias rewrite of leaves.

Commit: "bulk-05 P1: paths, guide lines, leaves".

## P2 — Visuals and screens (one commit)

1. Save the three SVGs exactly as given at the end of this file:
   public/brand/companion/leaf-sign-draft.svg
   public/brand/companion/moon-hare-draft.svg
   public/brand/companion/branch-draft.svg

   moon-hare-draft.svg is used for the kids' classes listed in course_signs.

   They are DRAFT visuals; the brand team will replace the files later with the same names and slot classes. Code must not depend on anything except: the sign file names, and in the branch file the elements with class "slot" and data-slot="1..12".

2. GuideLine component: sign 22 px + line text. Text colour = existing text colour (brand red on cream/panel). Leaf orange #F26000 only for the graphic, never for text. Battambang body font. Sign aria-hidden.

3. Place GuideLine in exactly 3 places:
   a. home, just above the Start here row (key home.start_here; only when the row shows)
   b. course page, when that course has a leaf (key course.finished)
   c. /my branch panel when 0 leaves (key my.branch.empty)

4. Branch panel at the top of /my, above the existing tabs (tabs unchanged):

   - Inline the branch SVG; show slots 1..N where N = leaves count, hide the rest. 13+ leaves: a second branch below (slots 13..24 map to 1..12), and so on. Order = leaf `at` time.
   - 0 leaves: bare branch + guide line.
   - Under it, always, one interface string in strings.ts (km + en, mark km DRAFT): my.branch.device_note — text at the end of this file. Use the existing Export button label from strings.ts where it says {exportLabel}.
   - No numbers anywhere in the panel. Screen reader label: strings.ts my.branch.label (km DRAFT "មែកសិក្សារបស់អ្នក", en "Your study branch").
   - Works in light and dark; stem uses the current text colour (currentColor), leaves stay #F26000.

5. e2e at 320 and 360 px, light and dark:

   - fresh device: /my shows bare branch, no guide text (lines unapproved), device note shown
   - with a test guide-lines fixture approved: lines show in the 3 places only
   - kids' class page (course_signs) shows the hare; other course pages show the leaf
   - finish all lessons of a test course (mock audio to 90 %): leaf appears on /my and the course line shows; reload: still there; offline reload: still there
   - add a lesson to that course in fixture data: leaf stays
   - 13 finished courses: second branch appears
   - no horizontal scroll; focus visible

Commit: "bulk-05 P2: guide leaf and branch".

STOP. Wait for the coordinator's phone test.

## P3 — Protect and close (one commit)

- Add P-lines to .kiro/steering/protected.md for: approved-only guide lines, sign chosen from data (course_signs / default_sign), leaves never removed, no numbers on the branch, Start here reads paths.json.
- Update docs/STATUS.md. Finish the report with: files changed, tests run, tests not possible.

Commit: "bulk-05 P3: protect companion".

## Text for guide-lines.json (all approved=false)

Khmer = DRAFT – needs reviewer approval.

home.start_here
  km: មិនដឹងចាប់ផ្តើមពីណា? សូមចាប់ផ្តើមពីទីនេះ។
  en: Not sure where to begin? Start here.

course.finished
  km: អ្នកបានសិក្សាថ្នាក់នេះចប់ហើយ។ ស្លឹកថ្មីមួយបានដុះលើមែករបស់អ្នក។
  en: You have finished this class. A new leaf has grown on your branch.

my.branch.empty
  km: មែកនេះនឹងដុះស្លឹកមួយ រាល់ពេលអ្នកសិក្សាថ្នាក់មួយចប់។
  en: This branch grows one leaf each time you finish a class.

(Each km/en value is one line of text; the line breaks in the original brief were only for layout.)

## Text for strings.ts my.branch.device_note

km (DRAFT): ស្លឹកទាំងនេះរក្សាទុកតែនៅលើឧបករណ៍នេះ ប៉ុណ្ណោះ។ បើលុបទិន្នន័យកម្មវិធីរុករក ស្លឹកទាំងនេះនឹងបាត់។ ប្រើ {exportLabel} ដើម្បីរក្សាទុកច្បាប់ចម្លង។

en: These leaves are kept only on this device. Clearing your browser data removes them. Use {exportLabel} to keep a copy.

## File: leaf-sign-draft.svg

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-labelledby="t">
<title id="t">draft visual - guide leaf</title>
<path fill="#F26000" d="M12 1.5C6 6.5 4.5 13 7 18c1.3 2.6 3 4 5 4.5 2-.5 3.7-1.9 5-4.5 2.5-5 1-11.5-5-16.5Z"/>
<path fill="none" stroke="#F6EFDD" stroke-width="1.2" stroke-linecap="round" d="M12 6v14"/>
</svg>
```

## File: moon-hare-draft.svg

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-labelledby="t">
<title id="t">draft visual - moon hare</title>
<circle cx="12" cy="12" r="11" fill="#F26000"/>
<g fill="#F6EFDD">
<ellipse cx="13.5" cy="15.2" rx="5.2" ry="3.8"/>
<circle cx="8.6" cy="12" r="2.7"/>
<ellipse cx="8" cy="6.6" rx="1" ry="3.3" transform="rotate(-14 8 6.6)"/>
<ellipse cx="10" cy="6.9" rx="1" ry="3.1" transform="rotate(12 10 6.9)"/>
<circle cx="18.9" cy="14.2" r="1.2"/>
<ellipse cx="10.4" cy="18.6" rx="2" ry=".9"/>
</g>
</svg>
```

## File: branch-draft.svg

Build it from this table (keep it this simple):

- viewBox "0 16 336 100"
- `<title>`: draft visual - study branch
- stem: path d="M12 100C100 70 200 104 308 44" fill none, stroke currentColor, width 3, round caps
- leaf def id "bl": d="M0 0C-7-6-8-16 0-26C8-16 7-6 0 0Z"
- group fill #F26000; 12 `<use href="#bl" class="slot" data-slot="n" transform="translate(x y) rotate(r)">`

  n : x y r
  1 : 44 92 29
  2 : 64 89 133
  3 : 84 87 36
  4 : 105 85 137
  5 : 125 85 38
  6 : 147 84 137
  7 : 168 82 36
  8 : 190 80 133
  9 : 212 77 30
  10: 234 73 127
  11: 257 66 22
  12: 308 44 61
