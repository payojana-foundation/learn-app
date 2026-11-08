/**
 * src/strings.ts
 *
 * Single source of truth for every user-visible interface string, in both
 * Khmer (km) and English (en). No string literals in components — import from
 * here and pick the language with `t(key, lang)`.
 *
 * Khmer wording is copied as approved in the mockup (design/learn-mockup.html);
 * it is interface chrome only, never course/teacher data, and is never retyped
 * or reformatted here beyond copying.
 *
 * Release gate (kept from vacana-app): an un-reviewed string's value is
 * prefixed with "[VERIFY] ". `displayString()` strips that prefix for display
 * only, and `npm run release-check` (scripts/check-verify.ts) scans the source
 * for any remaining [VERIFY] markers (0 = clean).
 */

import type { Lang } from './lang';

/** Strip a leading "[VERIFY] " marker for DISPLAY only (release gate). */
export function displayString(s: string): string {
  return s.replace(/^\[VERIFY\]\s*/, '');
}

export interface Str {
  km: string;
  en: string;
}

/** All interface strings (from the mockup STR table). Keys are stable ids. */
export const STRINGS = {
  APP_NAME: { km: 'ថ្នាក់សិក្សា', en: 'Learn' },
  TAGLINE: {
    km: 'រៀនព្រះធម៌ពីលោកគ្រូ — ស្តាប់ មើល និងតាមដានការសិក្សារបស់អ្នក',
    en: 'Learn the Dhamma from teachers — listen, watch, and track your study',
  },
  FIND: { km: 'ស្វែងរកថ្នាក់ មេរៀន ឬលោកគ្រូ', en: 'Search courses, lessons or teachers' },
  TAB_HOME: { km: 'ទំព័រដើម', en: 'Home' },
  TAB_SEARCH: { km: 'ស្វែងរក', en: 'Search' },
  TAB_MY: { km: 'ការសិក្សារបស់ខ្ញុំ', en: 'My Learning' },
  TAB_MORE: { km: 'ផ្សេងៗ', en: 'More' },
  CONT: { km: 'បន្តសិក្សា', en: 'Continue' },
  START_HERE: { km: 'ចាប់ផ្ដើមនៅទីនេះ', en: 'Start here' },
  COURSES: { km: 'ថ្នាក់សិក្សា', en: 'Courses' },
  TEACHERS: { km: 'លោកគ្រូ', en: 'Teachers' },
  ALL: { km: 'ទាំងអស់', en: 'All' },
  SEE_ALL: { km: 'មើលទាំងអស់', en: 'See all' },
  LESSONS: { km: 'មេរៀន', en: 'lessons' },
  LESSON: { km: 'មេរៀនទី', en: 'Lesson' },
  START_COURSE: { km: 'ចាប់ផ្ដើម', en: 'Start course' },
  CONT_LESSON: { km: 'បន្តមេរៀនទី', en: 'Continue lesson' },
  SAVE: { km: 'រក្សាទុក', en: 'Save' },
  SAVED: { km: 'បានរក្សាទុក', en: 'Saved' },
  SHARE: { km: 'ចែករំលែក', en: 'Share' },
  DONE: { km: 'បានបញ្ចប់', en: 'completed' },
  MARK_DONE: { km: 'សម្គាល់ថាបានបញ្ចប់', en: 'Mark as completed' },
  UNDONE: { km: 'បានបញ្ចប់ ✓', en: 'Completed ✓' },
  FILTER: { km: 'រកមេរៀនក្នុងថ្នាក់នេះ', en: 'Find a lesson in this course' },
  NEXT: { km: 'មេរៀនបន្ទាប់', en: 'Next lesson' },
  PREV: { km: 'មេរៀនមុន', en: 'Previous' },
  NOTES: { km: 'កំណត់ចំណាំ', en: 'Notes' },
  ADD_NOTE: { km: 'បន្ថែមកំណត់ចំណាំនៅ', en: 'Add note at' },
  NOTE_HINT: { km: 'សរសេរកំណត់ចំណាំ…', en: 'Write a note…' },
  IN_PROGRESS: { km: 'កំពុងរៀន', en: 'In progress' },
  HISTORY: { km: 'ប្រវត្តិ', en: 'History' },
  NOTHING: { km: 'មិនទាន់មានទេ។', en: 'Nothing here yet.' },
  SPEED: { km: 'ល្បឿន', en: 'Speed' },
  SLEEP: { km: 'ឈប់ក្រោយ', en: 'Sleep' },
  AUTO: { km: 'ចាក់បន្តដោយស្វ័យប្រវត្តិ', en: 'Autoplay next' },
  RESUMED: { km: 'បន្តពី', en: 'Resumed at' },
  NO_RESULT: { km: 'រកមិនឃើញក្នុងថ្នាក់សិក្សាទេ។', en: 'No match in Learn.' },
  TRY_THIS: { km: 'ស្វែងរកក្នុងកម្មវិធីផ្សេង៖', en: 'Try another app:' },
  APPS: { km: 'កម្មវិធី', en: 'Apps' },
  ABOUT: { km: 'អំពីយើង', en: 'About' },
  FEEDBACK: { km: 'ផ្ដល់មតិ', en: 'Send feedback' },
  LANGUAGE: { km: 'ភាសា', en: 'Language' },
  OFFLINE: { km: 'ស្តាប់ពេលគ្មានអ៊ីនធឺណិត', en: 'Offline listening' },
  LINK_COPIED: { km: 'បានចម្លងតំណ', en: 'Link copied' },
  EMBED_MSG: { km: 'មេរៀននេះនៅលើ', en: 'This lesson still plays from' },
  OPEN_IN: { km: 'បើកនៅ', en: 'Open in' },
  COMING_SOON: { km: 'កំពុងរៀបចំ — មកដល់ឆាប់ៗ', en: 'Being prepared — coming soon' },
  RIGHTS: {
    km: '© ២០២៦ មូលនិធិប្រយោជន៍ និងលោកគ្រូអ្នកបង្រៀន។ សម្រាប់ការសិក្សាផ្ទាល់ខ្លួនប៉ុណ្ណោះ។ សូមកុំយកទៅផ្សាយបន្ត ឬប្រើក្នុងគោលបំណងពាណិជ្ជកម្ម ដោយគ្មានការអនុញ្ញាត។',
    en: '© 2026 Payojana Foundation and the teachers. For personal study only. Please do not re-publish or use commercially without permission.',
  },
  OUR_PLAYER: { km: 'ចាក់ពី media.84000.digital', en: 'Plays from media.84000.digital' },
  RESULTS: { km: 'លទ្ធផល', en: 'results' },
  NO_TITLE: { km: 'គ្មានចំណងជើង', en: 'no title' },
  OFFLINE_MEDIA: {
    km: 'មេរៀននេះត្រូវការអ៊ីនធឺណិត។',
    en: 'This lesson needs an internet connection.',
  },
  EXPORT: { km: 'នាំចេញទិន្នន័យ', en: 'Export backup' },
  IMPORT: { km: 'នាំចូលទិន្នន័យ', en: 'Import backup' },

  // Study branch (bulk-05 P2). km is DRAFT: [VERIFY] until a reviewer approves.
  'my.branch.label': { km: '[VERIFY] មែកសិក្សារបស់អ្នក', en: 'Your study branch' },
  'my.branch.device_note': {
    km: '[VERIFY] ស្លឹកទាំងនេះរក្សាទុកតែនៅលើឧបករណ៍នេះប៉ុណ្ណោះ។ បើលុបទិន្នន័យកម្មវិធីរុករក ស្លឹកទាំងនេះនឹងបាត់។ ប្រើ {exportLabel} ដើម្បីរក្សាទុកច្បាប់ចម្លង។',
    en: 'These leaves are kept only on this device. Clearing your browser data removes them. Use {exportLabel} to keep a copy.',
  },
  // Service-worker update prompt (reliable updates).
  APP_UPDATE: {
    km: 'មានកំណែថ្មី។ ផ្ទុកឡើងវិញឥឡូវនេះ?',
    en: 'A new version is available. Reload now?',
  },
} satisfies Record<string, Str>;

export type StringKey = keyof typeof STRINGS;

/** Resolve a string in the given language, with the [VERIFY] marker stripped. */
export function t(key: StringKey, lang: Lang): string {
  return displayString(STRINGS[key][lang]);
}

/** Topic chips (id, Khmer, English), from the mockup TOPICS table. */
export const TOPICS: { id: string; km: string; en: string }[] = [
  { id: 'vinaya', km: 'វិន័យ', en: 'Vinaya' },
  { id: 'sutta', km: 'ព្រះសូត្រ', en: 'Suttas' },
  { id: 'abhidhamma', km: 'អភិធម្ម', en: 'Abhidhamma' },
  { id: 'meditation', km: 'សមាធិ វិបស្សនា', en: 'Meditation' },
  { id: 'english', km: 'ថ្នាក់អង់គ្លេស', en: 'English Courses' },
  { id: 'pali-grammar', km: 'វេយ្យាករណ៍បាលី', en: 'Pali Grammar' },
  { id: 'jataka', km: 'និទានជាតក', en: 'Jataka Tales' },
  { id: 'reference', km: 'សេចក្តីយោង', en: 'Reference' },
  { id: 'devotional', km: 'ធម្មទាន', en: 'Dhamma Talks' },
  { id: 'kids', km: 'ថ្នាក់កុមារ', en: "Children's Classes" },
];

export function topicLabel(id: string, lang: Lang): string {
  const tp = TOPICS.find((x) => x.id === id);
  return tp ? tp[lang] : id;
}
