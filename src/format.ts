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
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const x = s % 60;
  return `${num(m, lang)}:${num(String(x).padStart(2, '0'), lang)}`;
}

/**
 * A cleaned copy for search comparison: remove U+200B zero-width spaces and
 * lowercase. The ORIGINAL text is always displayed unchanged (tech.md).
 */
export function cleanForSearch(s: string): string {
  return String(s).replace(/\u200B/g, '').toLowerCase();
}

/** Escape text for safe insertion into innerHTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
