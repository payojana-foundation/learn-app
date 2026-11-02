/**
 * e2e/embed.e2e.mjs — P-14 (changed): acast/youtube/drive lessons render the
 * REAL embed in an iframe whose src is the URL stored in the data.
 *
 * We patch c080's first lesson to an acast embed and its second to a drive
 * /preview, keep the manifest hash honest (P-01), and BLOCK the external embed
 * hosts so no real network fetch happens (mock media only — never a real
 * R2/embed fetch). We assert the iframe src attribute in the DOM, not a load.
 * 360 px light.
 */

import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

const ACAST = 'https://embed.acast.com/abc123/def456?subscribe=false';
const DRIVE = 'https://drive.google.com/file/d/E2E_DRIVE_ID/preview';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function installMocks(page, origin) {
  const course = await (await fetch(`${origin}/data/courses/c080.json`)).json();
  course.lessons[0].media = [{ kind: 'acast', src: ACAST }];
  if (course.lessons[1]) course.lessons[1].media = [{ kind: 'drive', src: DRIVE }];
  const body = JSON.stringify(course, null, 2) + '\n';
  const bodyHash = sha256(Buffer.from(body, 'utf-8'));

  await page.route('**/data/manifest.json*', async (route) => {
    const res = await route.fetch();
    const manifest = await res.json();
    if (manifest.files?.c080) manifest.files.c080.sha256 = bodyHash;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('**/data/courses/c080.json*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  // Never fetch the real embed: answer with an empty stub so the iframe stays
  // local. We only assert the src attribute, not that it loaded.
  await page.route('https://embed.acast.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' })
  );
  await page.route('https://drive.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' })
  );
}

async function openLesson(page, index) {
  await page.goto(`${BASE}/courses/c080`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.les button');
  await page.locator('.les button').nth(index).click();
  await page.waitForSelector('[data-embed] iframe');
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
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await installMocks(page, BASE);
  console.log('[embed 360px light] P-14 real-embed checks');

  // ── acast lesson (first) ────────────────────────────────────────────────────
  await openLesson(page, 0);
  const acastSrc = await page.locator('[data-embed] iframe').getAttribute('src');
  acastSrc === ACAST ? ok('acast lesson iframe src is the stored embed URL') : fail(`acast iframe src wrong: ${acastSrc}`);
  const acastLazy = await page.locator('[data-embed] iframe').getAttribute('loading');
  acastLazy === 'lazy' ? ok('acast iframe is lazy') : fail(`acast iframe loading=${acastLazy}`);
  const acastAllow = await page.locator('[data-embed] iframe').getAttribute('allow');
  /autoplay/.test(acastAllow || '') && /encrypted-media/.test(acastAllow || '') && /fullscreen/.test(acastAllow || '')
    ? ok('acast iframe allow has autoplay/encrypted-media/fullscreen')
    : fail(`acast iframe allow=${acastAllow}`);
  const acastLink = await page.locator('a[target="_blank"]').first().getAttribute('href');
  acastLink === ACAST ? ok('acast open-in link points to the source') : fail(`acast link href=${acastLink}`);

  // ── drive lesson (second) ────────────────────────────────────────────────────
  await openLesson(page, 1);
  const driveSrc = await page.locator('[data-embed] iframe').getAttribute('src');
  driveSrc === DRIVE ? ok('drive lesson iframe src is the stored /preview URL') : fail(`drive iframe src wrong: ${driveSrc}`);
  const driveStyle = await page.locator('[data-embed] iframe').getAttribute('style');
  /16\s*\/\s*9/.test(driveStyle || '') ? ok('drive iframe is 16:9') : fail(`drive iframe style=${driveStyle}`);

  await context.close();
  await browser.close();

  if (failures) {
    console.error(`\n[embed.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[embed.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[embed.e2e] error:', err);
  process.exit(1);
});
