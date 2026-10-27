/**
 * src/version.ts — the running build's identity, for the version label.
 *
 * `__BUILD_HASH__` and `__BUILD_DATE__` are compile-time constants injected by
 * Vite `define` (vite.config.ts): the short git commit hash (or a time hash
 * when git is unavailable) and the build day (YYYY-MM-DD). They let a user tell
 * exactly which deployed build their browser is showing — the whole point of
 * the version label, given the stale-service-worker risk this addresses.
 *
 * The `typeof` guards keep this safe under vitest/Node, where the constants may
 * not be defined; there we fall back to "dev" / "" so nothing throws.
 */

export const BUILD_HASH: string =
  typeof __BUILD_HASH__ === 'string' ? __BUILD_HASH__ : 'dev';
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

/** The label shown in the UI, e.g. "v1a2b3c · 2026-10-14". */
export function versionLabel(): string {
  return BUILD_DATE ? `v${BUILD_HASH} · ${BUILD_DATE}` : `v${BUILD_HASH}`;
}
