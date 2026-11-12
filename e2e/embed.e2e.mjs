#!/usr/bin/env node
/**
 * e2e/embed.e2e.mjs — P-14 (bulk 09): Learn plays its own R2 audio only. No lesson page
 * renders an iframe, an embed container or an outside link, and the lesson plays from
 * the R2 address built from the stored key.
 *
 * Also (bulk 09): the home page lists exactly the courses of the catalog (the approved
 * course(s)), and the course page lists exactly the lessons of the course file.
 *
 * Real data: every lesson of the real course c080 (the approved lessons). The former
 * embed hosts are blocked and the R2 audio is answered with an empty stub, so nothing
 * outside the preview server is fetched (mock media only, never a real R2/embed fetch).
 * 360 px light and 320 px dark.
 */
import { chromium, devices } from 'playwright';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => {
  console.error('  ✗ ' + m);
  failures++;
};

async function run() {
  const browser = await chromium.launch();
  for (const { width, scheme } of [{ width: 360, scheme: 'light' }, { width: 320, scheme: 'dark' }]) {
    const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width, height: 780 }, colorScheme: scheme, serviceWorkers: 'block' });
    const requested = [];
    context.on('request', (r) => requested.push(r.url()));
    await context.route(/embed\.acast\.com|youtube(-nocookie)?\.com|youtu\.be|drive\.google\.com/, (r) => r.abort());
    await context.route('**/audio/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.alloc(44) }));
    const page = await context.newPage();
    console.log(`[embed ${width}px ${scheme}] P-14 no iframe, plays from R2`);

    const course = await (await fetch(`${BASE}/data/courses/c080.json`)).json();
    course.lessons.length > 0 ? ok(`the real course has ${course.lessons.length} lessons`) : fail('the real course has no lessons');
    const kinds = new Set(course.lessons.flatMap((l) => l.media.map((m) => m.kind)));
    [...kinds].join() === 'r2' ? ok('every media entry in the data is r2') : fail(`media kinds in the data: ${[...kinds].join()}`);

    // home lists the approved course(s) only; the course page lists the course file's lessons
    const catalog = await (await fetch(`${BASE}/data/catalog.json`)).json();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app-main .card[data-nav="course"]');
    const cards = await page.locator('#app-main .card[data-nav="course"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    JSON.stringify([...cards].sort()) === JSON.stringify(catalog.courses.map((c) => c.id).sort())
      ? ok(`home lists exactly the ${cards.length} catalog course(s)`)
      : fail(`home cards ${cards} differ from the catalog ${catalog.courses.map((c) => c.id)}`);
    await page.goto(`${BASE}/courses/c080`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.les button');
    const rows = await page.locator('.les button').count();
    rows === course.lessons.length ? ok(`the course page lists the ${rows} lessons of the course file`) : fail(`course page rows ${rows} vs ${course.lessons.length}`);

    let frames = 0;
    let embeds = 0;
    let outside = 0;
    let players = 0;
    let audioSrcOk = 0;
    for (const l of course.lessons) {
      await page.goto(`${BASE}/courses/c080/${encodeURIComponent(l.id)}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('h1');
      frames += await page.locator('iframe').count();
      embeds += await page.locator('[data-embed]').count();
      outside += await page.locator('#app-main a[target="_blank"]').count();
      players += await page.locator('[data-player]').count();
      const src = await page.evaluate(() => (window.__learnAudio ? window.__learnAudio.src : ''));
      if (src.includes('/' + l.media[0].src.split('/').map(encodeURIComponent).join('/'))) audioSrcOk++;
    }
    frames === 0 ? ok('no iframe on any lesson page') : fail(`${frames} iframe(s) on lesson pages`);
    embeds === 0 ? ok('no embed container on any lesson page') : fail(`${embeds} embed container(s)`);
    outside === 0 ? ok('no outside link on any lesson page') : fail(`${outside} outside link(s)`);
    players === course.lessons.length ? ok('every lesson page has the own player') : fail(`players: ${players}/${course.lessons.length}`);
    audioSrcOk === course.lessons.length ? ok('the audio source is the R2 address built from the stored key') : fail(`audio source ok on ${audioSrcOk}/${course.lessons.length} lessons`);
    const external = requested.filter((u) => /acast|youtube|youtu\.be|drive\.google/.test(u));
    external.length === 0 ? ok('no request to a former embed host') : fail(`requests to embed hosts: ${external.length}`);
    await context.close();
  }
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
