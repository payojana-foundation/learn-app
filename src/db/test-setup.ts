/**
 * src/db/test-setup.ts
 *
 * Vitest setup file: installs fake-indexeddb globals so `idb` and openLearnDB()
 * work in a Node environment without a real browser.
 *
 * Imported by the `test.setupFiles` entry in vite.config.ts.
 */
import 'fake-indexeddb/auto';
