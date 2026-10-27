/**
 * src/strings.ts
 *
 * Single source of truth for every user-visible interface string, in both
 * Khmer (km) and English (en). No string literals in components — import from
 * here and pick the language with `t(key, lang)`.
 *
 * Release gate (kept from vacana-app): an un-reviewed string's value is
 * prefixed with "[VERIFY] ". `displayString()` strips that prefix for display
 * only, and `npm run release-check` (scripts/check-verify.ts) scans the source
 * for any remaining [VERIFY] markers (0 = clean). When a reviewer approves a
 * string, remove ONLY the [VERIFY] prefix.
 *
 * Khmer wording is copied as approved in the mockup (design/learn-mockup.html);
 * never retype or reformat Khmer text.
 */

import type { Lang } from './lang';

/**
 * Strip a leading "[VERIFY] " marker for DISPLAY only. The prefix is a release
 * gate (release-check scans the source), never something a user should see.
 */
export function displayString(s: string): string {
  return s.replace(/^\[VERIFY\]\s*/, '');
}

/** A bilingual string: Khmer and English values. */
export interface Str {
  km: string;
  en: string;
}

/**
 * All interface strings. P1 seeds only the shell strings needed for the empty
 * app (brand, the four tab labels, and the update prompt); P4 adds the rest
 * from the mockup. Keys are stable identifiers, not display text.
 */
export const STRINGS = {
  APP_NAME: { km: 'ថ្នាក់សិក្សា', en: 'Learn' },
  TAB_HOME: { km: 'ទំព័រដើម', en: 'Home' },
  TAB_SEARCH: { km: 'ស្វែងរក', en: 'Search' },
  TAB_MY: { km: 'ការសិក្សារបស់ខ្ញុំ', en: 'My Learning' },
  TAB_MORE: { km: 'ច្រើនទៀត', en: 'More' },
  // Shown by the service-worker update prompt (reliable updates).
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
