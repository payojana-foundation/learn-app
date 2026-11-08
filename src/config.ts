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

/**
 * Launch placeholders the coordinator fills (R5, bulk-03). All live here, in
 * ONE place, so there is a single file to edit at launch. No values are
 * invented — the defaults are the "nothing yet" state.
 */

// "Start here" course ids now live in data/paths.json (path "start-here"),
// not here (bulk-05 P1). Empty or approved=false = the row is hidden (P-10).

/**
 * Feedback destination for the "Send feedback" row in More. EMPTY string = the
 * row is hidden (no link invented). The coordinator sets a mailto: or form URL.
 */
export const FEEDBACK_URL: string = '';

/**
 * Whether offline listening (media download for offline play) is offered. v1 is
 * streaming only, so this is `false`. The coordinator flips it when offline
 * media ships. Keep as a literal `false` type so dead branches are caught.
 */
export const OFFLINE_ALLOWED: boolean = false;

/** IndexedDB database name. Shared by all stores in this app. */
export const DB_NAME = 'learn-app' as const;

/** IndexedDB schema version. Increment when the schema changes. */
export const DB_VERSION = 2 as const;
