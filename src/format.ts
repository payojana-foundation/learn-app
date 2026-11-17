/**
 * src/format.ts — small display helpers shared by the screens.
 */

import type { Lang } from './lang';

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';

/** Render a number in Khmer digits for km, ASCII for en (mockup `num`). */
export function num(n: number | string, lang: Lang): string {
  const s = String(n);
  return lang === 'km' ? s.replace(/\d/g, (d) => KHMER_DIGITS[Number(d)]) : s;
}

/** Format seconds as m:ss, digits localised (mockup `tm`). */
export function time(seconds: number, lang: Lang): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const x = s % 60;
  return `${num(m, lang)}:${num(String(x).padStart(2, '0'), lang)}`;
}

/**
 * Display-only title: hide a trailing media file extension (.mp4/.mp3, any
 * case) at the very end of a lesson title. The stored data is never changed.
 */
export function displayTitle(title: string): string {
  return String(title ?? '').replace(/\.(mp4|mp3)$/i, '');
}

/**
 * A cleaned copy for search comparison: remove U+200B zero-width spaces and
 * lowercase. The ORIGINAL text is always displayed unchanged (tech.md).
 */
export function cleanForSearch(s: string): string {
  return String(s).replace(/\u200B/g, '').toLowerCase();
}

/**
 * PART 9 (17 Nov): the cleaned text a title is searched by: the title(s) shown plus the old titles
 * kept after a rename (title_aliases). Only searched; the shown title is the current one.
 */
export function searchable(titles: (string | null | undefined)[], aliases?: string[]): string {
  return cleanForSearch([...titles, ...(aliases ?? [])].filter((x): x is string => !!x).join(' '));
}

/** Escape text for safe insertion into innerHTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
