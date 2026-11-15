#!/usr/bin/env node
/**
 * scripts/live-video-check.mjs — Watch check against the LIVE site (P-14, 15 Nov). Kept out
 * of e2e/ so `npm run e2e` never calls the network. Usage:
 *   node scripts/live-video-check.mjs [https://learn.84000.digital] [--no-sw]
 * Uses Microsoft Edge (Playwright channel "msedge"): Playwright's own Chromium cannot decode
 * H.264/AAC, so it cannot tell whether a real MP4 plays. Opens the first lesson with a
 * video on a 360 px phone emulation WITH the service worker (as a phone has it, unless
 * --no-sw), taps Watch, then play, and checks the video clock moves. Read-only (GETs).
 * Exit 0 = plays, 1 = does not.
 */
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'https://learn.84000.digital').replace(/\/+$/, '');
const noSw = args.includes('--no-sw');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { console.error('  ✗ ' + m); failures++; };

const catalog = await (await fetch(`${BASE}/data/catalog.json`)).json();
let course = null;
let lesson = null;
for (const c of catalog.courses.filter((x) => x.has_video)) {
  const cf = await (await fetch(`${BASE}/data/courses/${c.id}.json`)).json();
  lesson = cf.lessons.find((l) => l.video);
  if (lesson) { course = cf; break; }
}
if (!lesson) { console.error('no lesson with a video on the live site'); process.exit(1); }
console.log(`[live-video ${BASE}${noSw ? ' no-sw' : ' with sw'}] course ${course.id}, lesson ${lesson.id}, key ${lesson.video.src}`);

const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, serviceWorkers: noSw ? 'block' : 'allow' });
const page = await ctx.newPage();
const logs = [];
const media = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('response', (r) => { if (/\/video\//.test(r.url())) media.push({ url: r.url().replace(/^.*\/video\//, 'video/'), status: r.status(), type: r.headers()['content-type'], sw: r.fromServiceWorker() }); });

const url = `${BASE}/courses/${course.id}/${encodeURIComponent(lesson.id)}`;
await page.goto(url, { waitUntil: 'networkidle' });
if (!noSw) {
  // Second load so the service worker controls the page (as on a phone after the first visit).
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });
  (await page.evaluate(() => !!navigator.serviceWorker?.controller)) ? ok('page is controlled by the service worker') : fail('service worker did not take control');
}
await page.waitForSelector('[data-mode="watch"]', { timeout: 15000 }).then(() => ok('Watch toggle shown')).catch(() => fail('no Watch toggle'));
await page.click('[data-mode="watch"]');
await page.waitForSelector('.vbox video', { timeout: 10000 }).then(() => ok('<video> in the lesson box')).catch(() => fail('no <video> in the box'));
await page.locator('[data-pp]').click();
await page.waitForFunction(() => (window.__learnVideo?.currentTime ?? 0) > 2, null, { timeout: 30000 }).catch(() => {});
const st = await page.evaluate(() => {
  const v = window.__learnVideo;
  return v ? { paused: v.paused, t: v.currentTime, dur: v.duration, err: v.error && `${v.error.code} ${v.error.message}`, ready: v.readyState, net: v.networkState, w: v.videoWidth, h: v.videoHeight, src: v.currentSrc } : null;
});
console.log('  state:', JSON.stringify(st));
if (!st) fail('no video element');
else {
  st.err == null ? ok('no media error') : fail(`media error ${st.err}`);
  st.t > 2 && !st.paused ? ok(`playing: clock at ${st.t.toFixed(1)} s`) : fail('the video clock did not advance');
  st.w > 0 ? ok(`frame size ${st.w}×${st.h}`) : fail('no video frame decoded');
}
console.log('  video responses:', JSON.stringify(media.slice(0, 6)));
logs.length === 0 ? ok('no console errors or warnings') : console.log('  console:', JSON.stringify(logs.slice(0, 8)));
await browser.close();
if (failures) { console.error(`\n[live-video] ${failures} check(s) FAILED`); process.exit(1); }
console.log('\n[live-video] all checks passed');
