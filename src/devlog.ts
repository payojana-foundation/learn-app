/**
 * src/devlog.ts — a single, quiet logging helper.
 *
 * Logs to the console only in development (import.meta.env.DEV). In production
 * it is a no-op, so internal diagnostics never clutter a user's console. The
 * `typeof` guard keeps it safe under vitest/Node where import.meta.env.DEV may
 * be undefined.
 */

export function devLog(...args: unknown[]): void {
  try {
    const dev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
    if (dev) console.log('[learn]', ...args);
  } catch {
    /* never throw from a logger */
  }
}
