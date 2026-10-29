/**
 * e2e/offline.e2e.mjs — offline behaviour (bulk-04 S5).
 *
 * Unlike the other e2e scripts, this one does NOT block the service worker:
 * offline rendering IS the service worker. Flow:
 *   1. First ONLINE visit — the SW installs, precaches the app shell + fonts +
 *      icons, and the data runtime cache ('data', NetworkFirst) fills as pages
 *      load. Visit ONE course so its course JSON is cached.
 *   2. context.setOffline(true), then reload:
 *        - the app shell and fonts render (served from precache),
 *        - the VISITED course's data loads from cache,
 *        - an UNVISITED course shows the existing offline/needs-internet notice
 *          (no crash, no blank screen),
 *        - My Learning (IndexedDB, local) still works.
 *   3. Report what is cached and its size (CacheStorage).
 *
 * Media is NOT fetched (we never open an r2 clip here); only the app's own
 * same-origin shell/data from the preview server.
 */

import { chromium, devices } from 'playwright';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

/** Wait until a service worker controls the page (precache is ready). */
async function waitForController(page, timeoutMs = 20000) {
  return page
    .waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/** Summarise CacheStorage: per-cache entry count + total bytes. */
async function cacheReport(page) {
  return page.evaluate(async () => {
    const out = [];
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      let bytes = 0;
      for (const req of reqs) {
        const res = await cache.match(req);
        if (!res) continue;
        try {
          const b = await res.clone().blob();
          bytes += b.size;
        } catch {
          /* opaque / unreadable — skip size */
        }
      }
      out.push({ name, entries: reqs.length, bytes });
    }
    return out;
  });
}

async function run() {
  const browser = await chromium.launch();
  let failures = 0;
  const fail = (m) => {
    console.error('  ✗ ' + m);
    failures++;
  };
  const ok = (m) => console.log('  ✓ ' + m);

  const context = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 780 },
    colorScheme: 'light',
    // Do NOT block the service worker — it is what serves offline.
  });
  const page = await context.newPage();

  console.log('[offline 360px light]');

  // 1. First online visit — let the SW install and take control.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const controlled = await waitForController(page);
  controlled ? ok('service worker controls the page (shell precached)') : fail('service worker did not take control');

  // Discover a visited vs an unvisited course from the catalog.
  const { visited, unvisited } = await page.evaluate(async () => {
    const cat = await (await fetch('/data/catalog.json')).json();
    const ids = cat.courses.map((c) => c.id);
    return { visited: ids[0], unvisited: ids[ids.length - 1] };
  });

  // Visit ONE course online so its course JSON enters the data cache.
  await page.goto(`${BASE}/courses/${visited}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.les, #app-main');
  ok(`visited course ${visited} online (its data now cached)`);

  // A reload while still controlled, to be sure the SW is the one serving.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  // 2. Go OFFLINE and reload.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Shell renders: header + tab bar present.
  const shellOk = await page.waitForSelector('#tabbar button', { timeout: 10000 }).then(() => true).catch(() => false);
  shellOk ? ok('app shell renders offline (tab bar present)') : fail('shell did not render offline');

  // Fonts: the bundled Moul face is loaded from precache (no network).
  const fontsOk = await page.evaluate(async () => {
    try {
      await document.fonts.ready;
      return document.fonts.check('16px Moul') || document.fonts.check('16px Battambang');
    } catch {
      return false;
    }
  });
  fontsOk ? ok('bundled fonts available offline') : fail('bundled fonts not available offline');

  // Visited course loads from cache offline.
  await page.goto(`${BASE}/courses/${visited}`, { waitUntil: 'domcontentloaded' });
  const visitedOk = await page.waitForSelector('.les button', { timeout: 10000 }).then(() => true).catch(() => false);
  visitedOk ? ok(`visited course ${visited} loads from cache offline`) : fail(`visited course ${visited} did not load offline`);

  // Unvisited course: no crash, no blank — the app shell still renders and the
  // screen shows content (the offline/empty message or a graceful state).
  await page.goto(`${BASE}/courses/${unvisited}`, { waitUntil: 'domcontentloaded' });
  const unvisitedShell = await page.waitForSelector('#tabbar button', { timeout: 10000 }).then(() => true).catch(() => false);
  const mainText = (await page.locator('#app-main').textContent().catch(() => '')) ?? '';
  const notBlank = mainText.trim().length > 0;
  unvisitedShell && notBlank
    ? ok('unvisited course offline: shell renders, screen not blank (graceful)')
    : fail(`unvisited course offline crashed or blank (shell=${unvisitedShell}, text=${mainText.length})`);

  // My Learning works offline (local IndexedDB).
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  const myOk = await page.waitForSelector('#app-main', { timeout: 10000 }).then(() => true).catch(() => false);
  const myText = (await page.locator('#app-main').textContent().catch(() => '')) ?? '';
  myOk && myText.trim().length > 0 ? ok('My Learning renders offline') : fail('My Learning blank/failed offline');

  // 3. Report cache contents (back online to read sizes reliably).
  await context.setOffline(false);
  const report = await cacheReport(page);
  console.log('  — cache report —');
  let total = 0;
  for (const c of report) {
    total += c.bytes;
    console.log(`    ${c.name}: ${c.entries} entries, ${(c.bytes / 1024).toFixed(1)} KiB`);
  }
  console.log(`    TOTAL: ${(total / 1024).toFixed(1)} KiB across ${report.length} cache(s)`);

  await context.close();
  await browser.close();

  if (failures) {
    console.error(`\n[offline.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[offline.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[offline.e2e] error:', err);
  process.exit(1);
});
