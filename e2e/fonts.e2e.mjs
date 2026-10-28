/**
 * e2e/fonts.e2e.mjs — bundled fonts (R1).
 *
 * Proves the app uses the SELF-HOSTED faces, not a CDN:
 *   1. No request ever goes to fonts.googleapis.com / fonts.gstatic.com.
 *   2. The bundled woff2 files are served from /fonts/ with status 200.
 *   3. document.fonts.check reports the bundled faces are available for the
 *      Khmer heading face (Moul), the Khmer body face (Battambang) and the
 *      Latin face (Lora) — after document.fonts.ready.
 *   4. A Khmer heading's computed font-family resolves to the display face and
 *      the body resolves to the Khmer body face.
 *
 * Mobile emulation at 360 px, light + dark. No real media is fetched.
 */

import { chromium, devices } from 'playwright';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

async function run() {
  const browser = await chromium.launch();
  let failures = 0;
  const fail = (msg) => {
    console.error('  ✗ ' + msg);
    failures++;
  };
  const ok = (msg) => console.log('  ✓ ' + msg);

  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      viewport: { width: 360, height: 780 },
      colorScheme: scheme,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();

    const cdnHits = [];
    page.on('request', (req) => {
      const h = new URL(req.url()).host;
      if (h.includes('fonts.googleapis.com') || h.includes('fonts.gstatic.com')) cdnHits.push(req.url());
    });

    console.log(`[fonts 360px ${scheme}]`);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // 1. No CDN font request.
    cdnHits.length === 0 ? ok('no request to fonts.googleapis.com / fonts.gstatic.com') : fail(`CDN font request made: ${cdnHits[0]}`);

    // 2. A bundled woff2 is served from the origin with 200.
    const res = await page.request.get(`${BASE}/fonts/moul-400-khmer.woff2`);
    res.status() === 200 ? ok('bundled Moul woff2 served from /fonts/') : fail(`/fonts/moul-400-khmer.woff2 → HTTP ${res.status()}`);

    // 3. Fonts are loaded and checkable. `document.fonts.check` alone is false
    //    for a declared-but-not-yet-used face (font-display: swap loads lazily),
    //    so first `load` each family — that actively fetches the bundled woff2
    //    from /fonts/ (there is no CDN) — then check. Lora is the Latin face and
    //    the default screen is Khmer, so without this load it would never fetch.
    await page.evaluate(() => document.fonts.ready);
    const checks = await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('16px Moul', 'ក'),
        document.fonts.load('16px Battambang', 'ក'),
        document.fonts.load('16px Lora', 'A'),
      ]);
      return {
        moul: document.fonts.check('16px Moul', 'ក'),
        battambang: document.fonts.check('16px Battambang', 'ក'),
        lora: document.fonts.check('16px Lora', 'A'),
      };
    });
    checks.moul ? ok('document.fonts.check: Moul available') : fail('Moul not available via document.fonts.check');
    checks.battambang ? ok('document.fonts.check: Battambang available') : fail('Battambang not available');
    checks.lora ? ok('document.fonts.check: Lora available') : fail('Lora not available');

    // 4. Computed font-family: a Khmer heading uses the display face (Moul);
    //    the body uses the Khmer body face (Battambang).
    const famHeading = await page.evaluate(() => {
      const h = document.querySelector('h1, h2, .brand');
      return h ? getComputedStyle(h).fontFamily : '';
    });
    const famBody = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    /Moul/i.test(famHeading) ? ok(`heading font-family uses Moul (${famHeading})`) : fail(`heading font-family is "${famHeading}"`);
    /Battambang/i.test(famBody) ? ok(`body font-family uses Battambang (${famBody})`) : fail(`body font-family is "${famBody}"`);

    await context.close();
  }

  await browser.close();
  if (failures) {
    console.error(`\n[fonts.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[fonts.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[fonts.e2e] error:', err);
  process.exit(1);
});
