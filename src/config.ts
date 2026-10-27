/**
 * src/config.ts — app-wide configuration constants.
 *
 * All external base URLs are single config values, set at BUILD time from Vite
 * env vars (Cloudflare Builds → Variables, or .env.local in development). They
 * are NEVER derived from `location`, so the app behaves the same on the
 * workers.dev test address, on a subpath, and on the custom domain.
 *
 * Each base URL must NOT end with a slash.
 */

function trimBase(v: string | undefined): string {
  return (v ?? '').trim().replace(/\/+$/, '');
}

/**
 * R2 media host for course audio/video (`VITE_MEDIA_BASE_URL`), e.g.
 * https://media.84000.digital. The only place this env var is read.
 */
export const MEDIA_BASE_URL: string = trimBase(import.meta.env.VITE_MEDIA_BASE_URL);

/**
 * The Vacanā app (`VITE_VACANA_BASE_URL`), e.g. https://vacana.84000.digital —
 * used for hand-off links when a search has no result here.
 */
export const VACANA_BASE_URL: string = trimBase(import.meta.env.VITE_VACANA_BASE_URL);

/**
 * The Library app (`VITE_LIBRARY_BASE_URL`), e.g. https://library.84000.digital —
 * used for hand-off links when a search has no result here.
 */
export const LIBRARY_BASE_URL: string = trimBase(import.meta.env.VITE_LIBRARY_BASE_URL);

/** IndexedDB database name. Shared by all stores in this app. */
export const DB_NAME = 'learn-app' as const;

/** IndexedDB schema version. Increment when the schema changes. */
export const DB_VERSION = 1 as const;
