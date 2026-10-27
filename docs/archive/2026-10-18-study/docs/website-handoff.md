# Website → Product Engineering handoff for study.84000.digital

**From:** website chat (Desk 7) · **Date:** 16 Oct 2026 · **Source:** website build v8 (`84000-digital-site-v8.zip`, 16 Oct 2026). Everything below is read from that build. Where the build or our files don't cover something, it says "Not in our files".

## 1. Teacher data

Files: `teachers-v8-2026-10-16.json` and `.csv` (same content), photos in `teacher-photos/`.

| Field | Meaning |
|---|---|
| `order` | Display order on the website (coordinator decision 14 Oct: Vinh Sovoeurng 1st, Yon Yi 2nd, rest unchanged) |
| `slug` | Teacher ID, same as `teacherSlug` in COURSE_DATA and the anchor `instructors.html#<slug>` |
| `name_km` / `name_en` | Name and title exactly as shown on the card |
| `bio_km` / `bio_en` | Bio exactly as shown on the card. "Not in our files" = no bio |
| `topics` | Topic badges on the card |
| `photo_file` | Path inside this package |
| `title_status` | Every title is marked [VERIFY TITLE]; known conflicts are listed |
| `bio_approved_by_teacher` | Only Ven. Vinh Sovoeurng's approval is recorded (coordinator, 14 Oct). Others: Not in our files |

Not covered: Ven. Hun Khemara and Leng Sideoun have no bio; Leng Sideoun has no photo. English lines on the cards were written from the Khmer bios; English for Vinh Sovoeurng is DRAFT – needs reviewer approval (29 Sep). Bios come only from facts the teacher supplied, and each teacher approves his own (SOP-001).

Photo notes: the photos are the files the website uses (sizes vary). Vinh Sovoeurng's photo was cropped from a framed image the coordinator supplied on 14 Oct. Original photo files: Not in our files.

## 2. Design tokens

There is no separate tokens file. Each page has the tokens in its own `<style>` block. Values in v8:

**Colours** (brand kit; hex sampled from the foundation's files, official until designer source files exist)
| Token | Value | Use on the website |
|---|---|---|
| `--brand-red` (also `--ink`, `--maroon`) | `#7F0204` | Body text, headings, links, buttons |
| `--cream` (also `--paper`, `--bg`) | `#EDE3C8` | Page background |
| `--leaf-orange` | `#F26000` | Graphics only (3 px footer top line) — never text on cream |
| `--wordmark-gold` | `#FCB029` | Not used as text on cream |
| `--panel` | `#F6EFDD` | Cards and panels (index, classes, instructors) |
| `--line` | `#C9B896` | Borders and dividers (index, classes, instructors) |
| `--ink-muted` | `#6B5D48` | Secondary text (index, classes, instructors) |
| `--surface-line` / `--ink-soft` | `#DCCEA6` / `#6B5D42` | Same roles on about / other-work (the two page groups use different names — merge when building) |

**Fonts** (Google Fonts; self-hosting prepared in `fonts.css` but not active)
| Token | Value | Use |
|---|---|---|
| `--font-km` | Battambang | Khmer body |
| `--font-display` | Moul (never bold) | Khmer headings h1–h3. Moul vs Moulpali for headings is NOT decided yet |
| `--font-pali` | Moulpali | Anything marked `lang="pi-Khmr"` |
| `--font-en` | Lora | English and romanized Pāḷi |

Google Fonts request used: `Battambang:wght@400;700 · Moul · Moulpali · Lora:ital,wght@0,400;0,500;1,400;1,500`.

**Sizes and spacing**
- Content width: `--max` 700 px (home) / 760 px (classes, teachers). Header inner width 900 px.
- Header: sticky, cream at 92 % opacity with blur, 1 px bottom border `--line`, 12 px top/bottom padding.
- Header leaf: 44 px tall. Homepage logo: 150 px wide.
- Body line-height 1.75. Menu text 0.92 rem. Language buttons 0.8 rem (0.75 rem on phones).
- Focus ring: 2 px `#7F0204`, 3 px offset.
- Phone breakpoint 600 px: menu wraps to a second row.
- Other spacing values (section margins, card padding) differ by page: Not in our files as a system — read them from the pages.

## 3. Header and footer

**Header (v8, all pages):** leaf → `index.html` (alt "84000.Digital"); menu; language switch.

| Khmer | English | Link |
|---|---|---|
| ថ្នាក់សិក្សា | Courses | classes.html (until study.84000.digital is live) |
| គ្រូបង្រៀន | Teachers | instructors.html |
| អំពីយើង | About | about.html |
| កិច្ចការផ្សេងទៀត | Other Work | other-work.html |
| ខ្មែរ / EN | | language switch buttons |

For study.84000.digital: link the leaf to `https://84000.digital/`. Planned website menu item for your product: សិក្សា · Study → study.84000.digital (DRAFT – needs reviewer approval; added only when you confirm it works).

Note: the header HTML is not identical on every page — index, classes and instructors use `<nav class="topnav">`; about and other-work use a simpler `<header>`. Same items, same order.

**Footer:**
- Home: links Acast (https://shows.acast.com/dhamma), Spotify (https://open.spotify.com/show/6ao38KeXsgHTGRobP5VDJE), Soundwise (https://mysoundwise.com/soundcasts/1740185697645s); then "© 2026 មូលនិធិប្រយោជន៍" / "© 2026 Payojana Foundation"; then "84000.Digital".
- Other pages: copyright line + "84000.Digital" only.
- 3 px leaf-orange line on top of the footer.
- Licence/attribution line: blocked — licence not chosen (Not in our files).

## 4. Language switch

- Two buttons, ខ្មែរ and EN. **Default: Khmer.**
- Every text exists twice: `class="km"` and `class="en" lang="en"`. CSS hides the other language: `html[data-lang="km"] .en {display:none}` and the reverse. Languages are never stacked.
- Choice is saved in the browser: `localStorage` key **`84000-lang`**, value `km` or `en`. A small script in `<head>` applies it before the page draws.
- Clicking a button sets `data-lang` and `lang` on `<html>`, saves the key, and updates `aria-pressed`.
- **Important for study.84000.digital:** browser storage is per address, so study.84000.digital cannot read 84000.digital's saved choice. Your proposed `?lang=km|en` on links between the two sites solves this; the website will add it to its link once your product is live.

Known issues in v8 (not fixed yet):
1. The `<head>` script reads `localStorage` without a guard; where storage is blocked the language script can fail. Use try/catch in your version.
2. On page load the saved English choice sets `data-lang` but not `<html lang>` (only a button click sets both).

Separate review aid: `?headings=moul|moulpali` + `localStorage` key `84000-headings` shows a heading-font switch. Remove once the font is chosen; don't copy it.

## 5. Brand files (`brand/`)
`logo-84000digital-480.png` / `-240.png` (full logo, transparent), `leaf-header.png` (header), `leaf-mark-32/180/512.png` (favicon, touch icon). All raster; vector logo does not exist yet (designer needed).
