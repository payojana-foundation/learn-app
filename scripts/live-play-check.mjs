#!/usr/bin/env node
/**
 * scripts/live-play-check.mjs — play check against the LIVE site. Kept out of e2e/ so
 * `npm run e2e` never calls the network. Usage:
 *   node scripts/live-play-check.mjs [https://learn.84000.digital]
 * Opens the first lesson of the first catalog course on a 360 px phone emulation,
 * presses play with the REAL audio (no mocks), and checks that the audio source is on
 * the media host, the response is audio, CORS and Range work, and the clock moves.
 * Read-only: it only GETs. Exit 0 = plays, 1 = does not.
 */
import { chromium, devices } from 'playwright';

const BASE = (process.argv[2] || 'https://learn.84000.digital').replace(/\/+$/, '');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => {
  console.error('  ✗ ' + m);
  failures++;
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const logs = [];
const audioResponses = [];
page.on('console', (m) => {
  // the blocked service worker is this script's own choice, not a site problem
  if (['error', 'warning'].includes(m.type()) && !/Service Worker registration blocked/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('response', (r) => {
  if (/\/audio\//.test(r.url())) audioResponses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] });
});

const catalog = await (await fetch(`${BASE}/data/catalog.json`)).json();
const cid = catalog.courses[0].id;
const course = await (await fetch(`${BASE}/data/courses/${cid}.json`)).json();
const lesson = course.lessons.find((l) => l.media?.[0]?.kind === 'r2');
console.log(`[live ${BASE}] course ${cid}, lesson ${lesson.id}, key ${lesson.media[0].src}`);

const pageRes = await page.goto(`${BASE}/courses/${cid}/${encodeURIComponent(lesson.id)}`, { waitUntil: 'networkidle' });
pageRes.status() === 200 ? ok('the lesson URL returns 200') : fail(`the lesson URL returns ${pageRes.status()}`);
await page.waitForSelector('[data-player]');
const src = await page.evaluate(() => window.__learnAudio?.src || '');
src.startsWith('https://media.84000.digital/audio/') ? ok('audio source is on the media host') : fail(`audio source is ${src}`);
!src.startsWith(BASE) ? ok('audio source is not the app origin') : fail('audio source is the app origin');

await page.locator('[data-pp]').click();
await page.waitForFunction(() => (window.__learnAudio?.currentTime ?? 0) > 1, null, { timeout: 25000 }).catch(() => {});
const st = await page.evaluate(() => {
  const a = window.__learnAudio;
  return { paused: a.paused, t: a.currentTime, dur: a.duration, err: a.error && a.error.code, ready: a.readyState };
});
console.log('  state:', JSON.stringify(st));
st.err == null ? ok('no media error') : fail(`media error code ${st.err}`);
st.t > 1 && !st.paused ? ok(`playing: clock at ${st.t.toFixed(1)} s`) : fail('the clock did not advance');
Number.isFinite(st.dur) && st.dur > 60 ? ok(`duration ${Math.round(st.dur)} s`) : fail(`duration ${st.dur}`);
const good = audioResponses.find((r) => r.status === 200 || r.status === 206);
good && /^audio\//.test(good.type || '') ? ok(`element response ${good.status} ${good.type}`) : fail(`audio response: ${JSON.stringify(audioResponses)}`);

// A media element sends no Origin, so CORS and Range are checked with a real cross-origin fetch from the page.
const cors = await page.evaluate(async (u) => {
  try {
    const r = await fetch(u, { headers: { Range: 'bytes=0-1' } });
    return { status: r.status, type: r.headers.get('content-type'), acao: r.headers.get('access-control-allow-origin'), range: r.headers.get('content-range'), len: (await r.arrayBuffer()).byteLength };
  } catch (e) {
    return { error: String(e) };
  }
}, src);
console.log('  cors fetch:', JSON.stringify(cors));
cors.status === 206 && cors.len === 2 && /^bytes 0-1\//.test(cors.range || '') ? ok('Range works (206, bytes 0-1)') : fail(`Range: ${JSON.stringify(cors)}`);
// Access-Control-Allow-Origin itself is not readable by page scripts; a cross-origin fetch
// that resolves proves the server allowed this origin.
!cors.error && cors.status ? ok(`CORS allows ${BASE} (the cross-origin fetch succeeded)`) : fail(`CORS blocked: ${cors.error}`);
cors.type && /^audio\//.test(cors.type) ? ok(`Content-Type ${cors.type}`) : fail(`Content-Type: ${cors.type}`);
logs.length === 0 ? ok('no console errors or warnings') : fail('console: ' + JSON.stringify(logs));

await browser.close();
if (failures) {
  console.error(`\n[live-play] ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\n[live-play] all checks passed');
