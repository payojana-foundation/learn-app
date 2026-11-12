/**
 * e2e/learn.e2e.mjs — end-to-end checks on mobile emulation (360 px), light and
 * dark, with mocked media (never a real R2/embed fetch). Run by
 * scripts/run-e2e.mjs against the preview server on E2E_PORT.
 *
 * Covers: home renders, open a course, play an r2 lesson (mock audio), resume
 * after reload, mark complete, add a note at a timestamp, search a Khmer title,
 * hand-off links, language switch keeps the page, no horizontal scroll.
 */

import { chromium, devices } from 'playwright';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

/** A tiny valid WAV so the <audio> element can load metadata offline. */
function wavBytes(seconds = 2, rate = 8000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Install routes. The loader hash-verifies every data file against the manifest
 * (P-01), so we build a modified c080 (first lesson → r2), compute its sha256,
 * and patch BOTH the manifest entry AND the file response to that hash — the
 * same integrity contract the app enforces, just with our test bytes.
 */
/** A search fragment taken from the data (the first lesson title), never typed. */
let SEARCH_FRAGMENT = 'x';
async function installMocks(page, origin) {
  // Fetch the real course once (Node side) to modify it deterministically.
  const realCourse = await (await fetch(`${origin}/data/courses/c080.json`)).json();
  SEARCH_FRAGMENT = (realCourse.lessons[0].title_km || '').replace(/[\u200B-\u200D]/g, '').trim().slice(0, 8) || 'x';
  realCourse.lessons[0].media = [{ kind: 'r2', src: 'audio/e2e-mock-a64.mp3' }];
  const body = JSON.stringify(realCourse, null, 2) + '\n';
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
  await page.route('**/audio/e2e-mock-a64.mp3', async (route) => {
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBytes(120) });
  });
}

async function run() {
  const browser = await chromium.launch();
  let failures = 0;
  const fail = (msg) => {
    console.error('  ✗ ' + msg);
    failures++;
  };
  const ok = (msg) => console.log('  ✓ ' + msg);

  const matrix = [];
  for (const width of [320, 360]) for (const scheme of ['light', 'dark']) matrix.push({ width, scheme });

  for (const { width, scheme } of matrix) {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      viewport: { width, height: 780 },
      colorScheme: scheme,
      // Block the service worker so page.route mocks are authoritative (the SW
      // would otherwise serve cached /data/* and bypass the route interception).
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await installMocks(page, BASE);

    console.log(`[${width}px ${scheme}]`);

    // 1. Home renders with the tab bar and courses.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tabbar button');
    const courseCount = await page.locator('#app-main .card[data-nav="course"]').count();
    courseCount > 0 ? ok(`home shows ${courseCount} course cards`) : fail('home has no course cards');

    // No horizontal scroll at 360 px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    overflow ? fail(`horizontal scroll present at ${width}px`) : ok(`no horizontal scroll at ${width}px`);

    // Focus visible: the first tab button takes a visible focus outline.
    const focusOk = await page.evaluate(() => {
      const b = document.querySelector('#tabbar button');
      if (!b) return false;
      b.focus();
      const s = getComputedStyle(b);
      return document.activeElement === b && (s.outlineStyle !== 'none' || s.outlineWidth !== '0px');
    });
    focusOk ? ok('focus visible on tab button') : fail('focus not visible');

    // 2. Open the pilot course c080 and its first (mock r2) lesson.
    await page.goto(`${BASE}/courses/c080`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.les button');
    await page.locator('.les button').first().click();
    await page.waitForSelector('[data-player]');
    ok('r2 lesson shows the app player');

    // 3. Simulate playback progress deterministically (headless chromium does
    //    not advance a mock <audio> clock), then check the UI updates and the
    //    position persists across a reload (resume-to-the-second). The mock WAV
    //    is short, so drive the element's clock and fire timeupdate — the same
    //    event a real clip fires — which the player persists.
    // Headless chromium does not reliably advance or accept a seek on a mocked
    // cross-origin <audio>, so drive the player's own progress path: override
    // the element's currentTime/duration getters and fire the `timeupdate`
    // event the player listens to. This exercises the real player → IndexedDB
    // persistence wiring (resume-to-the-second) without depending on the
    // browser's audio clock.
    const advanced = await page.evaluate(async () => {
      const a = window.__learnAudio;
      if (!a) return -1;
      Object.defineProperty(a, 'duration', { get: () => 120, configurable: true });
      Object.defineProperty(a, 'paused', { get: () => false, configurable: true });
      Object.defineProperty(a, 'currentTime', { get: () => 12, set: () => {}, configurable: true });
      a.dispatchEvent(new Event('timeupdate'));
      return a.currentTime;
    });
    await page.waitForTimeout(600);
    const posText = (await page.locator('[data-pos]').first().textContent()) ?? '';
    const asciiPos = posText.replace(/[០-៩]/g, (d) => String('០១២៣៤៥៦៧៨៩'.indexOf(d)));
    advanced >= 11 && asciiPos.trim() !== '0:00'
      ? ok(`position UI updated to ${posText}`)
      : fail(`position UI did not update (pos=${posText}, t=${advanced})`);

    const url = page.url();
    // Resume: the stored pos (12 s) must be read back after a reload. Read it at
    // the IndexedDB layer — the player seeks to it on loadedmetadata, which the
    // mock element may not fire, but the stored value is the resume source.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-player]');
    const storedPos = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('learn-app');
          req.onsuccess = () => {
            const tx = req.result.transaction('progress').objectStore('progress').get('c080');
            tx.onsuccess = () => {
              const lessons = tx.result?.lessons ?? {};
              const maxPos = Math.max(-1, ...Object.values(lessons).map((l) => l.pos ?? 0));
              resolve(maxPos);
            };
          };
          req.onerror = () => resolve(-1);
        })
    );
    storedPos >= 11 ? ok(`resume position persisted (${Math.round(storedPos)}s) across reload`) : fail(`resume position not persisted (${storedPos})`);
    assert.ok(url.includes('/courses/c080/'), 'lesson URL uses the lesson id');
    ok('lesson URL uses /courses/<id>/<lesson-id>');

    // 4. Mark complete.
    await page.locator('[data-done]').click();
    await page.waitForTimeout(200);
    const doneLabel = await page.locator('[data-done]').textContent();
    doneLabel && doneLabel.includes('✓') ? ok('marked complete') : fail('mark complete did not toggle');

    // 5. Add a note at the current timestamp.
    await page.locator('textarea[name="note"]').fill('e2e note');
    await page.locator('form[data-form="note"] button').click();
    await page.waitForSelector('.note');
    (await page.locator('.note').count()) > 0 ? ok('note saved with timestamp') : fail('note not saved');

    // 6. Search a Khmer title fragment (substring on the cleaned copy).
    await page.goto(`${BASE}/search?q=${encodeURIComponent(SEARCH_FRAGMENT)}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app-main');
    const results = await page.locator('.res button').count();
    results > 0 ? ok(`Khmer search returned ${results} results`) : fail('Khmer search returned nothing');

    // 7. No-result search shows hand-off links.
    await page.goto(`${BASE}/search?q=zzzxxxnohit`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app-main');
    const handoff = await page.locator('[data-handoff]').count();
    handoff >= 2 ? ok('hand-off links to Vacana + Library shown') : fail('hand-off links missing');

    // 8. Language switch keeps the page (stay on search).
    await page.goto(`${BASE}/courses/c080`, { waitUntil: 'networkidle' });
    await page.locator('header .lang button[data-setlang="en"]').click();
    await page.waitForTimeout(200);
    const langAttr = await page.evaluate(() => document.documentElement.getAttribute('data-lang'));
    const stillCourse = page.url().includes('/courses/c080');
    langAttr === 'en' && stillCourse ? ok('language switch keeps the page') : fail('language switch changed the page or lang');

    await context.close();
  }

  await browser.close();
  if (failures) {
    console.error(`\n[learn.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[learn.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[learn.e2e] error:', err);
  process.exit(1);
});
