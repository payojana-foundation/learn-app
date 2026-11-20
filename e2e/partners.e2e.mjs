/**
 * e2e/partners.e2e.mjs — bulk 10 partner YouTube classes, both partners-switch states.
 *
 * OFF (the real served data, PARTNERS_ENABLED off): /partners and a class URL show "not found",
 *     home has no partner text, no request for a partner file.
 * ON  (the real catalog + manifest patched with one placeholder partner, one class and one
 *     teaching point; manifest hashes kept honest, P-01): partner list, partner page, class
 *     page (no progress bar, no ticks), the teacher page lists the class, search finds it by
 *     title and by a teaching point.
 * P4 (ON): Learn's cover first, no frame and no KillerPlayer request before the tap; the tap
 *     makes exactly one iframe (KillerPlayer base + UUID) and one helper script, stops the R2
 *     audio and the mini player; "started" persists across reload; "mark class done" (keyboard
 *     too) keeps the frame; My Learning lists a started, not-done class; offline = notice.
 * Every state: no request to youtube.com / ytimg.com or any player host but KillerPlayer (all
 * of them are stubbed here and counted, never fetched), no horizontal scroll, focus visible.
 * Matrix: 360/320 px × light/dark × km/en.
 */
import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
/** A short JS-generated WAV (mock R2 audio, never a real fetch). */
function wavBytes(seconds, rate = 8000) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2);
  return buf;
}
const CLIP = wavBytes(30);
function serveClip(route) {
  const range = route.request().headers()['range'];
  const total = CLIP.length;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: CLIP.subarray(start, end + 1) });
  }
  return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: CLIP });
}
const UUID = 'a21376b7-12b0-45bc-9a7b-6f594534cb09';
const CID = 'yt-pl-PLe2eTest01';
const TEACHER = 'sor-ratha'; // a real teacher record with a shown own course
const PCLASS = { id: CID, kind: 'partner', partner_slug: 'e2e-partner', title: 'e2e partner class title', teacher_slugs: [TEACHER], lesson_count: 23, teaching_points: ['E2E1'] };
const PFILE = {
  id: CID, kind: 'partner', partner_slug: 'e2e-partner', title: PCLASS.title, teacher_slugs: [TEACHER], playlist_uuid: UUID, teaching_points: ['E2E1'],
  lessons: Array.from({ length: 23 }, (_, i) => ({ id: `yt-e2eVid${String(i).padStart(5, '0')}`, num: i + 1, title: `e2e video ${i + 1}`, duration_s: 60 })),
};

async function install(context, on) {
  const realCatalog = await (await fetch(`${BASE}/data/catalog.json`)).json();
  if (!on) return { realCatalog };
  realCatalog.partners = [{ slug: 'e2e-partner', name_km: 'e2e partner km', name_en: 'e2e partner en', teacher_slugs: [TEACHER], course_ids: [CID] }];
  realCatalog.partner_courses = [PCLASS];
  realCatalog.partner_terms = [{ term_id: 'E2E1', term_km: 'e2eterm', term_pali: 'e2epali', term_en: 'e2eenglish', other_spellings: ['e2ealt'] }];
  realCatalog.partner_retired = { courses: {}, lessons: {} };
  const catBody = JSON.stringify(realCatalog, null, 2) + '\n';
  const fileBody = JSON.stringify(PFILE, null, 2) + '\n';
  await context.route('**/data/manifest.json*', async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    m.files.catalog.sha256 = sha256(Buffer.from(catBody, 'utf-8'));
    m.files[CID] = { file: `partners/${CID}.json`, updated: m.generated, sha256: sha256(Buffer.from(fileBody, 'utf-8')) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
  });
  await context.route('**/data/catalog.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: catBody }));
  await context.route(`**/data/partners/${CID}.json*`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fileBody }));
  return { realCatalog };
}

async function run() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failures = 0;
  const fail = (m) => { console.error('  ✗ ' + m); failures++; };
  const ok = (m) => console.log('  ✓ ' + m);
  const check = (cond, m) => (cond ? ok(m) : fail(m));
  const matrix = [];
  for (const w of [360, 320]) for (const scheme of ['light', 'dark']) for (const lang of ['km', 'en']) matrix.push([w, scheme, lang]);

  for (const on of [false, true]) {
    for (const [w, scheme, lang] of matrix) {
      console.log(`[partners ${on ? 'ON' : 'OFF'} ${w}px ${scheme} ${lang}]`);
      const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: w, height: 780 }, colorScheme: scheme, serviceWorkers: 'block' });
      const outside = [];
      const partnerFiles = [];
      context.on('request', (req) => {
        const u = req.url();
        if (/killerplayer\.com|youtube\.com|youtu\.be|ytimg\.com/.test(u)) outside.push(u);
        if (/\/data\/partners\//.test(u)) partnerFiles.push(u);
      });
      // Never reach a real third-party host (counted above, answered here).
      await context.route(/^https:\/\/(killerplayer\.com|[a-z0-9.-]*youtube\.com|youtu\.be|[a-z0-9.-]*ytimg\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
      await context.route(/\/(audio|video)\/[^?]*\.(mp3|mp4)(\?.*)?$/, serveClip);
      await install(context, on);
      const page = await context.newPage();
      const q = `?lang=${lang}`;
      const noScroll = async (where) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll (${where})`);
      const noFrame = async (where) => check((await page.locator('iframe').count()) === 0, `no iframe (${where})`);

      await page.goto(`${BASE}/${q}`, { waitUntil: 'networkidle' });
      check((await page.locator('[data-nav="pclass"]').count()) === 0, 'home: no partner card (own catalog only)');
      await noScroll('home');

      if (!on) {
        await page.goto(`${BASE}/partners${q}`, { waitUntil: 'networkidle' });
        check((await page.locator('#app-main').innerText()).includes('404'), '/partners is not found');
        await page.goto(`${BASE}/partners/e2e-partner/${CID}${q}`, { waitUntil: 'networkidle' });
        check((await page.locator('#app-main').innerText()).includes('404'), 'class URL is not found');
        check(partnerFiles.length === 0, `no partner file requested (${partnerFiles.length})`);
        await noFrame('off');
        check(outside.length === 0, `no request to KillerPlayer/YouTube (${outside.length})`);
        await context.close();
        continue;
      }

      await page.goto(`${BASE}/partners${q}`, { waitUntil: 'networkidle' });
      check((await page.locator('[data-nav="partner"]').count()) === 1, 'partner list shows the partner');
      check((await page.locator('#app-main').innerText()).includes(lang === 'en' ? 'e2e partner en' : 'e2e partner km'), 'partner name as stored');
      await noScroll('partner list');
      await page.locator('[data-nav="partner"]').first().click();
      await page.waitForSelector('[data-nav="pclass"]');
      check(page.url().includes('/partners/e2e-partner'), 'partner page URL');
      const label = await page.locator('.plabel').first().innerText();
      check(lang === 'en' ? label.includes('from YouTube, needs internet') : label.includes('DRAFT – needs reviewer approval'), `label (${lang})`);
      await noScroll('partner page');
      // focus visible on the class card (keyboard)
      await page.focus('[data-nav="pclass"]');
      const outline = await page.evaluate(() => { const el = document.activeElement; el.blur(); el.focus({ focusVisible: true }); return getComputedStyle(el).outlineStyle; });
      check(outline !== 'none', `class card focus visible (outline ${outline})`);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.les li');
      check(page.url().includes(`/partners/e2e-partner/${CID}`), 'class page URL');
      check((await page.locator('details.sect').first().locator('li').count()) === 20, 'first section holds 20 lessons');
      check((await page.locator('details.sect').count()) === 2, 'two sections (23 lessons)');
      check((await page.locator('.pbar').count()) === 0, 'no progress bar (P-11 partner exemption)');
      check((await page.locator('.tick').count()) === 0, 'no ticks');
      check((await page.locator('[data-nav="lesson"]').count()) === 0, 'no per-lesson links');
      await page.fill('form[data-form="course-filter"] input[name="f"]', 'e2e video 2');
      // P4: the filter works in place (a re-render would reload an open player frame)
      await page.waitForFunction(() => [...document.querySelectorAll('.les li')].filter((li) => !li.hidden).length === 5);
      ok('find-in-course filters the titles (5)');
      await page.fill('form[data-form="course-filter"] input[name="f"]', '');
      await noScroll('class page');
      await noFrame('class page before the tap');
      check(outside.length === 0, `no request to KillerPlayer/YouTube before the tap (${outside.length})`);
      check((await page.locator('[data-kp-play]').count()) === 1, 'the cover is a button');
      await noScroll('class page cover');

      // ── P4: the tap ──
      await page.locator('[data-kp-play]').click();
      await page.waitForSelector('iframe[data-kp-frame]');
      const frames = await page.locator('iframe').count();
      check(frames === 1, `exactly one iframe after the tap (${frames})`);
      check((await page.getAttribute('iframe', 'src')) === `https://killerplayer.com/watch/video/playlist/${UUID}`, 'iframe src = KillerPlayer base + UUID');
      const helpers = await page.evaluate(() => [...document.querySelectorAll('script[data-kp-embed-helper]')].map((s) => s.getAttribute('src')));
      check(helpers.length === 1 && helpers[0] === 'https://killerplayer.com/watch/embed.js', `helper script once (${helpers.length})`);
      check(outside.every((u) => u.startsWith('https://killerplayer.com/')), `only KillerPlayer requested (${outside.filter((u) => !u.startsWith('https://killerplayer.com/')).length} other)`);
      check((await page.locator('[data-pstatus]').innerText()).includes(lang === 'en' ? 'Started' : 'DRAFT'), 'started shown after the tap');
      check((await page.getAttribute('[data-pdone]', 'aria-pressed')) === 'false', 'mark class done: not pressed');
      await page.fill('form[data-form="course-filter"] input[name="f"]', '7');
      await page.waitForFunction(() => [...document.querySelectorAll('.les li')].filter((li) => !li.hidden).length === 2);
      check((await page.locator('iframe[data-kp-frame]').count()) === 1, 'filtering keeps the frame');
      await noScroll('class page frame');
      // focus visible on the done toggle (keyboard)
      const outline2 = await page.evaluate(() => { const el = document.querySelector('[data-pdone]'); el.focus({ focusVisible: true }); return getComputedStyle(el).outlineStyle; });
      check(outline2 !== 'none', `done toggle focus visible (outline ${outline2})`);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-pdone]')?.getAttribute('aria-pressed') === 'true');
      check((await page.locator('iframe[data-kp-frame]').count()) === 1, 'mark done keeps the frame');
      ok('mark class done (keyboard)');

      // My Learning: done = not in progress; undo → in progress
      await page.locator('[data-pdone]').click();
      await page.waitForFunction(() => document.querySelector('[data-pdone]')?.getAttribute('aria-pressed') === 'false');
      await page.goto(`${BASE}/my${q}`, { waitUntil: 'networkidle' });
      check((await page.locator(`.pcard[data-id="${CID}"]`).count()) === 1, 'My Learning: started class in progress');
      check((await page.locator('iframe').count()) === 0, 'no iframe on My Learning');
      await noScroll('my');

      // started persisted across reload; the cover again (no frame until a new tap)
      await page.goto(`${BASE}/partners/e2e-partner/${CID}${q}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-pstatus]');
      check((await page.locator('iframe').count()) === 0 && (await page.locator('[data-kp-play]').count()) === 1, 'after reload: started kept, cover again, no frame');
      await page.locator('[data-pdone]').click();
      await page.waitForFunction(() => document.querySelector('[data-pdone]')?.getAttribute('aria-pressed') === 'true');
      await page.goto(`${BASE}/my${q}`, { waitUntil: 'networkidle' });
      check((await page.locator(`.pcard[data-id="${CID}"]`).count()) === 0, 'My Learning: a done class is not in progress');

      // offline: the tap shows the needs-internet notice, no frame
      await page.goto(`${BASE}/partners/e2e-partner/${CID}${q}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-kp-play]');
      await context.setOffline(true);
      await page.locator('[data-kp-play]').click();
      await page.waitForSelector('.chead .empty');
      check((await page.locator('iframe').count()) === 0, 'offline: no iframe, needs-internet notice');
      await context.setOffline(false);

      // one player at a time: R2 audio playing → the tap stops it and the mini player
      if ((w === 360 && scheme === 'light' && lang === 'km') || (w === 320 && scheme === 'dark' && lang === 'en')) {
        await page.goto(`${BASE}/courses/c080${q}`, { waitUntil: 'networkidle' });
        await page.locator('.les button').first().click();
        await page.waitForFunction(() => !!window.__learnAudio);
        await page.locator('[data-pp]').click();
        await page.waitForFunction(() => window.__learnAudio && !window.__learnAudio.paused && window.__learnAudio.currentTime > 0.3, null, { timeout: 15000 });
        await page.evaluate((path) => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, `/partners/e2e-partner/${CID}${q}`);
        await page.waitForSelector('[data-kp-play]');
        check(await page.evaluate(() => !document.getElementById('mini').hidden), 'mini player shown before the tap (audio playing)');
        await page.locator('[data-kp-play]').click();
        await page.waitForSelector('iframe[data-kp-frame]');
        check(await page.evaluate(() => window.__learnAudio.paused), 'the tap paused the R2 audio');
        check(await page.evaluate(() => document.getElementById('mini').hidden), 'the tap removed the mini player');
        // leave and come back in-app: the frame is removed; a second tap adds no second helper
        await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
        await page.waitForFunction(() => !document.querySelector('iframe'));
        ok('leaving the class page removes the frame');
        await page.evaluate((path) => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, `/partners/e2e-partner/${CID}${q}`);
        await page.locator('[data-kp-play]').click();
        await page.waitForSelector('iframe[data-kp-frame]');
        check((await page.locator('script[data-kp-embed-helper]').count()) === 1, 'helper script still once after a second tap');
      }

      await page.goto(`${BASE}/teachers/${TEACHER}${q}`, { waitUntil: 'networkidle' });
      check((await page.locator(`[data-nav="pclass"][data-id="${CID}"]`).count()) === 1, 'teacher page lists the partner class');
      check((await page.locator('[data-nav="course"]').count()) > 0, 'teacher page still lists the own courses');
      await noScroll('teacher page');

      for (const term of ['partner class title', 'e2epali', 'e2ealt']) {
        await page.goto(`${BASE}/search?q=${encodeURIComponent(term)}&lang=${lang}`, { waitUntil: 'networkidle' });
        check((await page.locator(`[data-nav="pclass"][data-id="${CID}"]`).count()) === 1, `search finds the class by "${term}"`);
      }
      await noScroll('search');
      await noFrame('search');
      const other = outside.filter((u) => !u.startsWith('https://killerplayer.com/'));
      check(other.length === 0, `no request to YouTube / ytimg / any other player host (${other.length})`);
      await context.close();
    }
  }
  await browser.close();
  if (failures) {
    console.error(`[partners.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('[partners.e2e] all checks passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
