import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Build identity (reliable updates + version label).
 *
 * Every build gets a UNIQUE id so the service worker's cache namespace differs
 * between deploys and no old cache can satisfy a new build's requests. The id
 * is the short git commit hash when available (stable, meaningful), else a
 * short hash of the build time (always unique). Both are injected into the app
 * via `define` and shown as a small version label in the app shell.
 */
function buildInfo(): { hash: string; date: string } {
  // An explicit override (CI, or an update test that builds twice on the same
  // commit) always wins, so two builds can be made distinct deliberately.
  const override = process.env.LEARN_BUILD_ID?.trim();
  if (override) {
    return { hash: override, date: new Date().toISOString().slice(0, 10) };
  }
  let hash = '';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    hash = '';
  }
  if (!hash) {
    hash = createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 7);
  }
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (build day)
  return { hash, date };
}

const BUILD = buildInfo();

export default defineConfig({
  // Expose the build identity to the app as compile-time constants (src/version.ts).
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD.hash),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
  },
  test: {
    // Node environment; IndexedDB is shimmed via src/db/test-setup.ts.
    environment: 'node',
    setupFiles: ['src/db/test-setup.ts'],
    // Stable Windows pool: Vitest's default on Windows spawned one worker PER
    // test file, which intermittently SKIPPED whole files and inflated wall
    // time. Pin to `forks`, cap at 2 concurrent workers; `isolate` stays ON so
    // each file gets fresh module state (the fake-indexeddb shim is
    // module-global per worker).
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 2,
  },
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // App shell only — data files are NOT precached. They are fetched,
      // hash-verified, and stored in IndexedDB by the data layer.
      manifest: {
        name: 'Learn · ថ្នាក់សិក្សា',
        short_name: 'Learn',
        description: 'Courses from 84000.digital teachers',
        // Deep links (/courses/:id/:num) are served by the SPA shell. Pin the
        // installed-PWA identity/launch to the root so a deep link never
        // becomes the start_url or narrows the scope.
        id: '/',
        start_url: '/',
        scope: '/',
        lang: 'km',
        theme_color: '#EDE3C8',
        background_color: '#EDE3C8',
        display: 'standalone',
        icons: [
          { src: 'brand/leaf-mark-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: 'brand/leaf-mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // cacheId makes the precache cache NAME build-unique (learn-<hash>), so
        // a new deploy never reads a previous build's precache.
        cacheId: `learn-${BUILD.hash}`,
        // On activate, delete precaches from older builds so stale shell files
        // cannot linger.
        cleanupOutdatedCaches: true,
        // The new SW takes control of all open tabs as soon as it activates
        // (after the user accepts the prompt → skipWaiting).
        clientsClaim: true,
        // Precache app shell assets only; data JSON is excluded.
        globPatterns: ['**/*.{js,css,html,woff2,ttf,png,svg,ico}'],
        globIgnores: ['**/data/**'],
        runtimeCaching: [
          {
            // Data files (manifest + catalog + per-course json): network-first
            // so freshness checks see the latest hashes; fall back to the last
            // response offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/data/') && url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200 },
              plugins: [
                {
                  // SPA 200 guard: the host returns index.html with status 200
                  // for a MISSING file, so "200" is not proof the file exists.
                  // Cache a response ONLY when it is a real 200 whose
                  // content-type is JSON; otherwise store nothing, so an HTML
                  // fallback never enters the data cache.
                  cacheWillUpdate: async ({ response }) => {
                    const type = response.headers.get('content-type') || '';
                    return response.status === 200 && type.includes('json') ? response : null;
                  },
                },
              ],
            },
          },
          {
            // Course media (R2 audio/video), fetched at runtime only after a
            // lesson is played — never precached. CacheFirst so a replay is
            // instant and works offline; the cap bounds phone storage.
            // statuses:[200] rejects 404 and opaque cross-origin (status 0), so
            // a clip caches only once R2 sends CORS headers for this origin;
            // the cacheWillUpdate guard additionally rejects a 200 whose
            // content-type is not media (an HTML/SPA fallback at a .mp3 URL).
            urlPattern: ({ url }) => /\.(?:mp3|m4a|ogg|opus|wav|mp4|webm)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'media',
              rangeRequests: true,
              expiration: { maxEntries: 200 },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  cacheWillUpdate: async ({ response }) => {
                    if (response.status !== 200) return null;
                    const type = (response.headers.get('content-type') || '').toLowerCase();
                    const ok = type.includes('audio') || type.includes('video') || type.includes('octet-stream');
                    return ok ? response : null;
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
});
