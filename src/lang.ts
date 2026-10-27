/**
 * src/lang.ts — interface language (Khmer / English).
 *
 * Order of precedence (P1 spec):
 *   1. `?lang=km|en` in the URL  (an explicit choice; also persisted)
 *   2. cookie `lang_84000`       (a previous choice)
 *   3. default `km`
 *
 * The chosen language is written to the cookie `lang_84000` with:
 *   Domain=.84000.digital, Path=/, Max-Age=1 year, SameSite=Lax, Secure.
 * The cookie is shared across the 84000.digital sub-apps so a choice made on
 * the website (which appends `?lang=`) carries over. On a non-84000.digital
 * host (the workers.dev test address, or localhost) the `Domain` attribute is
 * OMITTED and `Secure` is dropped on plain http, so the cookie still sets.
 *
 * All cookie access is wrapped in try/catch: a blocked cookie store must never
 * throw and break start-up — it just falls back to the default.
 *
 * Applying a language sets BOTH `<html lang>` and `<html data-lang>` so CSS and
 * scripts can switch wording and fonts.
 */

export type Lang = 'km' | 'en';

export const DEFAULT_LANG: Lang = 'km';
const COOKIE_NAME = 'lang_84000';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isLang(v: string | null | undefined): v is Lang {
  return v === 'km' || v === 'en';
}

/** Read `?lang=` from a query string. Returns null when absent/invalid. */
export function langFromQuery(search: string): Lang | null {
  try {
    const value = new URLSearchParams(search).get('lang');
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

/** Read the `lang_84000` cookie. Returns null when absent/invalid/blocked. */
export function readLangCookie(doc: Document = document): Lang | null {
  try {
    const raw = doc.cookie || '';
    for (const part of raw.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === COOKIE_NAME) {
        const value = decodeURIComponent(rest.join('='));
        return isLang(value) ? value : null;
      }
    }
  } catch {
    /* cookie store blocked — fall through */
  }
  return null;
}

/**
 * Whether the current host is under 84000.digital (so the shared `Domain`
 * attribute applies). The workers.dev test address and localhost are not, so
 * the cookie is set host-only there.
 */
function is84000Host(host: string): boolean {
  return host === '84000.digital' || host.endsWith('.84000.digital');
}

/** Persist the chosen language in the `lang_84000` cookie. Never throws. */
export function writeLangCookie(
  lang: Lang,
  loc: Pick<Location, 'hostname' | 'protocol'> = window.location,
  doc: Document = document
): void {
  try {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(lang)}`,
      'Path=/',
      `Max-Age=${ONE_YEAR_SECONDS}`,
      'SameSite=Lax',
    ];
    if (is84000Host(loc.hostname)) parts.push('Domain=.84000.digital');
    // Secure is required with SameSite on https; omit on plain http (localhost).
    if (loc.protocol === 'https:') parts.push('Secure');
    doc.cookie = parts.join('; ');
  } catch {
    /* cookie store blocked — the choice simply is not persisted */
  }
}

/**
 * Resolve the language from query → cookie → default. If `?lang=` was present,
 * it is persisted so the choice survives to the next visit.
 */
export function resolveLang(
  loc: Pick<Location, 'search' | 'hostname' | 'protocol'> = window.location,
  doc: Document = document
): Lang {
  const fromQuery = langFromQuery(loc.search);
  if (fromQuery) {
    writeLangCookie(fromQuery, loc, doc);
    return fromQuery;
  }
  return readLangCookie(doc) ?? DEFAULT_LANG;
}

/** Set `<html lang>` and `<html data-lang>` to the given language. */
export function applyLang(lang: Lang, doc: Document = document): void {
  const html = doc.documentElement;
  html.setAttribute('lang', lang);
  html.setAttribute('data-lang', lang);
}

/**
 * Resolve and apply the start-up language in one call. Returns the language so
 * the caller (main.ts) can pass it to the UI string layer.
 */
export function initLang(
  loc: Location = window.location,
  doc: Document = document
): Lang {
  const lang = resolveLang(loc, doc);
  applyLang(lang, doc);
  return lang;
}

/** Switch language at runtime: persist, apply, and return the new language. */
export function setLang(
  lang: Lang,
  loc: Location = window.location,
  doc: Document = document
): Lang {
  writeLangCookie(lang, loc, doc);
  applyLang(lang, doc);
  return lang;
}
