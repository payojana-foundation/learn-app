/**
 * e2e/video.e2e.mjs — P-14 (15 Nov): Watch / Listen on R2 media, both switch states.
 *
 * OFF (the real served data, video switch off): no toggle, no <video>, no video mark.
 * ON  (c080 lesson 1 and the catalog patched with an approved-style video; manifest
 *      hashes kept honest): Listen is the default; Watch plays the R2 video with its
 *      poster; the position carries over both ways; speed changes keep the video;
 *      leaving the lesson in Watch keeps the audio playing in the mini player.
 * Every state: no iframe, no horizontal scroll, the toggle focus is visible.
 * Matrix: 360 px light km and 320 px dark en.
 *
 * Mock media only: a short JS-generated WAV with Range support is served for both the
 * audio and the video key (Chromium plays it in a <video> element), never a real R2 fetch.
 */
import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;
const AUDIO_KEY = 'audio/e2e-v-a64.mp3';
const VIDEO_KEY = 'video/e2e0000000000001-480p.mp4';
const POSTER_KEY = 'video/e2e0000000000001-480p.webp';

function wavBytes(seconds, rate = 8000) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2);
  return buf;
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function serveClip(route, bytes) {
  const range = route.request().headers()['range'];
  const total = bytes.length;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    const chunk = bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunk.length) }, body: chunk });
  }
  return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(total) }, body: bytes });
}

/** ON state: patch c080 lesson 1 + the catalog; keep the manifest hashes honest (P-01). */
async function installVideoOn(context, clipS) {
  const realCourse = await (await fetch(`${BASE}/data/courses/c080.json`)).json();
  const realCatalog = await (await fetch(`${BASE}/data/catalog.json`)).json();
  realCourse.lessons[0].media = [{ kind: 'r2', src: AUDIO_KEY, duration_s: clipS }];
  realCourse.lessons[0].video = { src: VIDEO_KEY, poster: POSTER_KEY, duration_s: clipS };
  for (const c of realCatalog.courses) if (c.id === 'c080') c.has_video = true;
  const courseBody = JSON.stringify(realCourse, null, 2) + '\n';
  const catBody = JSON.stringify(realCatalog, null, 2) + '\n';
  await context.route('**/data/manifest.json*', async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    if (m.files?.c080) m.files.c080.sha256 = sha256(Buffer.from(courseBody, 'utf-8'));
    if (m.files?.catalog) m.files.catalog.sha256 = sha256(Buffer.from(catBody, 'utf-8'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
  });
  await context.route('**/data/courses/c080.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: courseBody }));
  await context.route('**/data/catalog.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: catBody }));
}

async function run() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failures = 0;
  const fail = (m) => { console.error('  ✗ ' + m); failures++; };
  const ok = (m) => console.log('  ✓ ' + m);
  const check = (cond, m) => (cond ? ok(m) : fail(m));
  const clipS = 40;
  const clip = wavBytes(clipS);

  for (const [w, scheme, lang] of [[360, 'light', 'km'], [320, 'dark', 'en']]) {
    for (const on of [false, true]) {
      console.log(`[video ${on ? 'ON' : 'OFF'} ${w}px ${scheme} ${lang}]`);
      const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: w, height: 780 }, colorScheme: scheme, serviceWorkers: 'block' });
      const outside = [];
      context.on('request', (req) => { if (/acast|youtube|drive\.google/.test(req.url())) outside.push(req.url()); });
      // Mock every R2 media path (never a real fetch).
      await context.route(/\/(audio|video)\/[^?]*\.(mp3|mp4)(\?.*)?$/, (r) => serveClip(r, clip));
      await context.route(/\/video\/[^?]*\.webp(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(16) }));
      if (on) await installVideoOn(context, clipS);
      const page = await context.newPage();
      const noScroll = async (where) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll (${where})`);

      await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' });
      const vmark = await page.locator('.card .vmark').count();
      check(on ? vmark > 0 : vmark === 0, on ? 'video mark on the course card' : 'no video mark on any card');
      await noScroll('home');

      await page.goto(`${BASE}/courses/c080?lang=${lang}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.les button');
      await page.locator('.les button').first().click();
      await page.waitForSelector('[data-player]');
      await page.waitForFunction(() => !!window.__learnAudio);
      const toggles = await page.locator('[data-mode]').count();
      if (!on) {
        check(toggles === 0, 'no Watch/Listen toggle');
        check((await page.locator('video').count()) === 0, 'no <video> element');
        check((await page.locator('iframe').count()) === 0, 'no iframe');
        await noScroll('lesson');
        await context.close();
        continue;
      }
      check(toggles === 2, 'Watch/Listen toggle shown');
      check((await page.getAttribute('[data-mode="listen"]', 'aria-pressed')) === 'true', 'Listen is the default');
      check((await page.locator('video').count()) === 0, 'no <video> while listening');
      await noScroll('lesson listen');

      // Focus visible on the toggle (keyboard).
      await page.focus('[data-mode="watch"]');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      check(outline !== 'none', `toggle focus is visible (outline ${outline})`);

      // Listen: play to >= 4 s, then Watch: the video starts from the same second.
      await page.click('[data-pp]');
      await page.waitForFunction(() => (window.__learnAudio?.currentTime ?? 0) >= 4, null, { timeout: 10000 });
      const atSwitch = await page.evaluate(() => window.__learnAudio.currentTime);
      await page.click('[data-mode="watch"]');
      await page.waitForFunction(() => !!window.__learnVideo && document.querySelector('.vbox video') === window.__learnVideo && window.__learnAudio === window.__learnVideo, null, { timeout: 5000 }).catch(() => {});
      const v = await page.evaluate(() => ({ inBox: !!document.querySelector('.vbox video'), src: window.__learnVideo?.src || '', poster: window.__learnVideo?.poster || '', same: window.__learnAudio === window.__learnVideo }));
      check(v.inBox, 'Watch: the <video> is in the lesson box');
      check(v.src.includes(VIDEO_KEY), 'Watch: plays the R2 video key from the data');
      check(v.poster.includes(POSTER_KEY), 'Watch: WebP poster from the data');
      check(v.same, 'Watch: the player drives the video element');
      try {
        await page.waitForFunction((t) => !window.__learnVideo.paused && window.__learnVideo.currentTime >= t - 1, atSwitch, { timeout: 8000 });
        ok(`position carried Listen → Watch (${atSwitch.toFixed(1)} s)`);
      } catch { fail(`position not carried to the video (${await page.evaluate(() => window.__learnVideo.currentTime)} vs ${atSwitch})`); }
      await noScroll('lesson watch');

      // Speed change re-renders; the same video element keeps playing.
      await page.click('[data-speed]');
      const sp = await page.evaluate(() => ({ el: document.querySelector('.vbox video') === window.__learnVideo, rate: window.__learnVideo.playbackRate, paused: window.__learnVideo.paused }));
      check(sp.el && sp.rate === 1.25 && !sp.paused, `speed in Watch keeps the video playing (${sp.rate}×)`);

      // Watch → Listen: audio resumes at the video's second.
      const vAt = await page.evaluate(() => window.__learnVideo.currentTime);
      await page.click('[data-mode="listen"]');
      try {
        await page.waitForFunction((t) => window.__learnAudio !== window.__learnVideo && !window.__learnAudio.paused && window.__learnAudio.currentTime >= t - 1, vAt, { timeout: 8000 });
        ok(`position carried Watch → Listen (${vAt.toFixed(1)} s)`);
      } catch { fail('audio did not resume at the video position'); }
      check((await page.locator('video').count()) === 0, 'Listen: no <video> on the page');

      // Watch again, then leave the lesson: the audio keeps playing in the mini player.
      await page.click('[data-mode="watch"]');
      await page.waitForFunction(() => window.__learnAudio === window.__learnVideo && !window.__learnVideo.paused, null, { timeout: 8000 }).catch(() => {});
      await page.click('[data-nav="home"]');
      try {
        await page.waitForFunction(() => window.__learnAudio !== window.__learnVideo && !window.__learnAudio.paused, null, { timeout: 8000 });
        ok('leaving the lesson in Watch: audio continues (Listen)');
      } catch { fail('audio did not continue after leaving the lesson in Watch'); }
      check(await page.locator('#mini').isVisible(), 'mini player shown on Home');
      check((await page.locator('iframe').count()) === 0, 'no iframe anywhere');
      await noScroll('home after watch');
      check(outside.length === 0, `no request to an embed host (${outside.length})`);
      await context.close();
    }
  }
  await browser.close();
  if (failures) {
    console.error(`[video.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('[video.e2e] all checks passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
