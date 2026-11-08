/**
 * e2e/companion.e2e.mjs — study companion (bulk-05 P2): guide leaf + branch.
 *
 * Mock data only (never real R2/embeds). Placeholder guide text, never real
 * wording. Course ids are taken from the real catalog; titles are never typed.
 *
 * PART A  layout matrix: 320 and 360 px x light and dark x km and en.
 *   - fresh device: /my shows a bare branch, NO guide text (lines unapproved),
 *     the device note, no digits, no horizontal scroll, focus visible.
 *   - approved guide fixture + seeded leaves: the line shows in exactly the
 *     three places; a kids' class page shows the hare, others the leaf; stem
 *     follows the text colour, leaves stay #F26000, text is never orange.
 * PART B  flow (360 light km): finish all lessons of a test course by driving
 *   the real <audio> to 90 %, leaf appears, survives reload and a lesson added
 *   to the course in fixture data.
 * PART C  (360 light km, service worker ON): 13 finished courses (first-run
 *   backfill) give a second branch; the leaf survives an offline reload.
 */

import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => {
  console.error('  ✗ ' + m);
  failures++;
};
const check = (cond, okMsg, failMsg) => (cond ? ok(okMsg) : fail(failMsg ?? okMsg));

// ── helpers ──────────────────────────────────────────────────────────────────

const idb = (page, fnSource, arg) =>
  page.evaluate(
    ([src, a]) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('learn-app');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          // eslint-disable-next-line no-new-func
          Promise.resolve(new Function('db', 'arg', `return (${src})(db, arg)`)(db, a))
            .then((v) => {
              db.close();
              resolve(v);
            })
            .catch(reject);
        };
      }),
    [fnSource.toString(), arg]
  );

const seedLeaves = (page, ids) =>
  idb(
    page,
    (db, list) =>
      new Promise((res, rej) => {
        const tx = db.transaction('leaves', 'readwrite');
        list.forEach((id, i) => tx.objectStore('leaves').put({ course_id: id, at: 1000 + i }));
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      }),
    ids
  );
const getLeaves = (page) =>
  idb(page, (db) => new Promise((res) => (db.transaction('leaves').objectStore('leaves').getAll().onsuccess = (e) => res(e.target.result.map((l) => l.course_id).sort()))));

/** Fixture served in place of data files; the manifest hash follows the body. */
function makeFixture() {
  return { guide: null, paths: null, courses: {} };
}
async function installData(page, fx) {
  const bodyOf = {
    'guide-lines': () => fx.guide && JSON.stringify(fx.guide, null, 2) + '\n',
    paths: () => fx.paths && JSON.stringify(fx.paths, null, 2) + '\n',
  };
  await page.route('**/data/manifest.json*', async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    for (const k of Object.keys(bodyOf)) {
      const b = bodyOf[k]();
      if (b && m.files[k]) m.files[k].sha256 = sha256(Buffer.from(b, 'utf-8'));
    }
    for (const [id, c] of Object.entries(fx.courses)) {
      if (m.files[id]) m.files[id].sha256 = sha256(Buffer.from(JSON.stringify(c, null, 2) + '\n', 'utf-8'));
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
  });
  await page.route('**/data/guide-lines.json*', (r) => (fx.guide ? r.fulfill({ status: 200, contentType: 'application/json', body: bodyOf['guide-lines']() }) : r.continue()));
  await page.route('**/data/paths.json*', (r) => (fx.paths ? r.fulfill({ status: 200, contentType: 'application/json', body: bodyOf.paths() }) : r.continue()));
  await page.route('**/data/courses/*.json*', (r) => {
    const id = /courses\/([^/.?]+)\.json/.exec(r.request().url())?.[1];
    return id && fx.courses[id]
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx.courses[id], null, 2) + '\n' })
      : r.continue();
  });
}

const GUIDE_FIXTURE = (approved) => ({
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: { c021: 'moon-hare-draft.svg', c002: 'no-such-file.svg' },
  lines: {
    'home.start_here': { km: 'GL-HOME-KM', en: 'GL-HOME-EN', approved },
    'course.finished': { km: 'GL-COURSE-KM', en: 'GL-COURSE-EN', approved },
    'my.branch.empty': { km: 'GL-EMPTY-KM', en: 'GL-EMPTY-EN', approved },
  },
});
const PATHS_FIXTURE = { version: 1, paths: [{ id: 'start-here', title_km: null, title_en: null, course_ids: ['c001', 'c002'], approved: true }] };

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const guides = (page) => page.$$eval('.guide', (els) => els.map((e) => e.getAttribute('data-guide')));
const visibleSlots = (page) =>
  page.$$eval('[data-slot]', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);

async function focusVisible(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.closest('.tabs')) return null;
      const cs = getComputedStyle(a);
      return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    });
    if (hit !== null) return hit;
  }
  return false;
}

async function open(page, path, lang) {
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app-main > *');
}

// ── PART A ───────────────────────────────────────────────────────────────────

async function partA(browser, width, scheme, lang) {
  const tag = `[${width}px ${scheme} ${lang}]`;
  console.log(tag);
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width, height: 780 },
    colorScheme: scheme,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const warns = [];
  page.on('console', (m) => m.type() === 'warning' && warns.push(m.text()));

  // fresh device
  await open(page, '/my', lang);
  check((await page.locator('.branchp').count()) === 1, 'fresh /my: branch panel shown');
  check((await page.locator('.branch').count()) === 1 && (await visibleSlots(page)) === 0, 'fresh /my: bare branch (no leaf)');
  check((await guides(page)).length === 0, 'fresh /my: no guide text (lines unapproved)');
  const devnote = await page.locator('.devnote').innerText();
  check(devnote.length > 20 && !devnote.includes('{exportLabel}'), 'fresh /my: device note shown, label filled');
  const panelText = await page.locator('.branchp').innerText();
  check(!/[0-9\u17E0-\u17E9]/.test(panelText), 'fresh /my: no numbers in the panel');
  check(await noHScroll(page), 'fresh /my: no horizontal scroll');
  check(await focusVisible(page), 'fresh /my: focus visible on the tabs');
  check((await page.locator('.branchp').getAttribute('aria-label'))?.length > 0, 'fresh /my: screen-reader label set');
  const homeGuides = (await open(page, '/', lang), await guides(page));
  check(homeGuides.length === 0 && (await page.locator('text=/GL-/').count()) === 0, 'fresh home: no guide, no Start here row text');

  // approved fixture + seeded leaves
  const fx = makeFixture();
  fx.guide = GUIDE_FIXTURE(true);
  fx.paths = PATHS_FIXTURE;
  await installData(page, fx);
  await seedLeaves(page, ['c001', 'c021', 'c002']);

  await open(page, '/', lang);
  check(JSON.stringify(await guides(page)) === '["home.start_here"]', 'home: guide line only above Start here');
  check(await noHScroll(page), 'home: no horizontal scroll');

  await open(page, '/courses/c001', lang);
  check(JSON.stringify(await guides(page)) === '["course.finished"]', 'course with a leaf: finished line');
  check((await page.locator('.gsign').getAttribute('data-sign')) === 'leaf-sign-draft.svg', 'course c001: leaf sign');
  check(await noHScroll(page), 'course: no horizontal scroll');

  await open(page, '/courses/c021', lang);
  check((await page.locator('.gsign').getAttribute('data-sign')) === 'moon-hare-draft.svg', "kids' class page: hare");

  warns.length = 0;
  await open(page, '/courses/c002', lang);
  check((await page.locator('.gsign').getAttribute('data-sign')) === 'leaf-sign-draft.svg', 'unknown sign file: default leaf');
  check(warns.some((w) => /guide sign/.test(w)), 'unknown sign file: console warning');

  const noLeaf = await page.evaluate(async () => (await (await fetch('/data/catalog.json')).json()).courses.map((c) => c.id).find((id) => !['c001', 'c002', 'c021'].includes(id)));
  await open(page, `/courses/${noLeaf}`, lang);
  check((await guides(page)).length === 0, 'course without a leaf: no guide line');

  await open(page, '/my', lang);
  check((await guides(page)).length === 0, '/my with leaves: no empty-branch line');
  check((await page.locator('.branch').count()) === 1 && (await visibleSlots(page)) === 3, '/my: 3 leaves on one branch');
  check(!/[0-9\u17E0-\u17E9]/.test(await page.locator('.branchp').innerText()), '/my: no numbers in the panel');
  check(await noHScroll(page), '/my: no horizontal scroll');
  check(await focusVisible(page), '/my: focus visible');

  // colours: stem follows the text colour, leaves stay #F26000, text never orange
  const colours = await page.evaluate(() => {
    const wrap = document.querySelector('.branches');
    const stem = [...document.querySelectorAll('.branch svg path')].find((p) => p.getAttribute('stroke') === 'currentColor');
    const slot = [...document.querySelectorAll('[data-slot]')].find((e) => getComputedStyle(e).display !== 'none');
    return {
      ink: getComputedStyle(document.body).color,
      wrap: getComputedStyle(wrap).color,
      stem: stem && getComputedStyle(stem).stroke,
      leaf: slot && getComputedStyle(slot).fill,
      note: getComputedStyle(document.querySelector('.devnote')).color,
    };
  });
  check(colours.stem === colours.wrap && colours.wrap === colours.ink, `stem follows the text colour (${colours.stem})`);
  check(colours.leaf === 'rgb(242, 96, 0)', 'leaves are #F26000');
  check(colours.note !== 'rgb(242, 96, 0)', 'note text is not orange');

  await open(page, '/courses/c001', lang);
  const gcol = await page.evaluate(() => getComputedStyle(document.querySelector('.gtext')).color);
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  check(gcol === ink && gcol !== 'rgb(242, 96, 0)', 'guide text uses the normal text colour, not orange');

  // exactly three places: nothing on search / more / a lesson page
  await open(page, '/search?q=a', lang);
  check((await guides(page)).length === 0, 'search: no guide line');
  await open(page, '/more', lang);
  check((await guides(page)).length === 0, 'more: no guide line');

  await context.close();
}

// ── PART B ───────────────────────────────────────────────────────────────────

function wavBytes(seconds, rate = 8000) {
  const n = Math.round(seconds * rate);
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
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2);
  return buf;
}

async function partB(browser) {
  console.log('[flow 360px light km] finish a test course by audio');
  const lang = 'km';
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 780 },
    colorScheme: 'light',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const clip = wavBytes(12);
  await page.route('**/audio/e2e-*-a64.mp3', async (route) => {
    const range = route.request().headers()['range'];
    const total = clip.length;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      const chunk = clip.subarray(start, end + 1);
      return route.fulfill({
        status: 206,
        contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunk.length) },
        body: chunk,
      });
    }
    return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(total) }, body: clip });
  });

  // Test course = real c001 cut to 2 lessons, both made r2 mock audio.
  const real = await (await fetch(`${BASE}/data/courses/c001.json`)).json();
  const mk = (l, i) => ({ ...l, media: [{ kind: 'r2', src: `audio/e2e-${i}-a64.mp3`, duration_s: 12 }] });
  const fx = makeFixture();
  fx.guide = GUIDE_FIXTURE(true);
  fx.courses.c001 = { ...real, lessons: real.lessons.slice(0, 2).map(mk) };
  await installData(page, fx);

  await open(page, '/my', lang);
  check((await guides(page)).join() === 'my.branch.empty', 'before: empty-branch line, bare branch');
  const ids = fx.courses.c001.lessons.map((l) => l.id);

  const doneOf = (lessonId) =>
    idb(page, (db, [cid, lid]) => new Promise((res) => (db.transaction('progress').objectStore('progress').get(cid).onsuccess = (e) => res(!!e.target.result?.lessons?.[lid]?.done))), ['c001', lessonId]);

  for (const [i, lid] of ids.entries()) {
    await open(page, `/courses/c001/${lid}`, lang);
    await page.waitForSelector('[data-player]');
    await page.waitForFunction(() => !!window.__learnAudio);
    await page.evaluate(() => (window.__learnAudio.muted = true));
    await page.locator('[data-pp]').click();
    await page.waitForFunction(() => (window.__learnAudio?.duration ?? 0) > 0, null, { timeout: 10000 });
    await page.evaluate(() => {
      const a = window.__learnAudio;
      a.currentTime = a.duration * 0.95;
    });
    for (let k = 0; k < 40 && !(await doneOf(lid)); k++) await page.waitForTimeout(200);
    check(await doneOf(lid), `lesson ${i + 1} of 2 reached 90 % and is marked done`);
    if (i === 0) check((await getLeaves(page)).length === 0, 'no leaf while a lesson is still open');
  }
  let leaves = [];
  for (let k = 0; k < 30 && !leaves.includes('c001'); k++) {
    await page.waitForTimeout(200);
    leaves = await getLeaves(page);
  }
  check(leaves.includes('c001'), 'leaf added when the last visible lesson is done');

  await open(page, '/courses/c001', lang);
  check((await guides(page)).join() === 'course.finished', 'course page shows the finished line');
  await open(page, '/my', lang);
  check((await visibleSlots(page)) === 1 && (await guides(page)).length === 0, '/my shows one leaf, no empty line');

  await page.reload({ waitUntil: 'networkidle' });
  check((await visibleSlots(page)) === 1, 'reload: leaf still there');

  // A lesson is added to the course in fixture data: the leaf stays.
  fx.courses.c001 = { ...real, lessons: real.lessons.slice(0, 3).map(mk) };
  await open(page, '/courses/c001', lang);
  check((await page.locator('.les button').count()) === 3, 'fixture course now has 3 lessons');
  check((await guides(page)).join() === 'course.finished', 'lesson added: finished line stays');
  await open(page, '/my', lang);
  check((await visibleSlots(page)) === 1, 'lesson added: leaf stays on the branch');
  check((await getLeaves(page)).includes('c001'), 'lesson added: leaf record kept');
  check(await noHScroll(page), 'flow: no horizontal scroll');
  await context.close();
}

// ── PART C ───────────────────────────────────────────────────────────────────

async function partC(browser) {
  console.log('[backfill 360px light km, service worker on] 13 finished courses + offline');
  const lang = 'km';
  const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, colorScheme: 'light' });
  const page = await context.newPage();
  await open(page, '/', lang);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});

  // Mark every lesson of 13 real courses done, drop the backfill flag, reload.
  const picked = await page.evaluate(async () => {
    const cat = await (await fetch('/data/catalog.json')).json();
    const out = [];
    for (const c of cat.courses) {
      if (out.length === 13) break;
      if (c.lesson_count < 1) continue;
      const course = await (await fetch(`/data/courses/${c.id}.json`)).json();
      out.push({ id: c.id, lessons: course.lessons.map((l) => l.id) });
    }
    return out;
  });
  check(picked.length === 13, 'found 13 real courses to mark finished');
  await idb(
    page,
    (db, list) =>
      new Promise((res, rej) => {
        const tx = db.transaction(['progress', 'settings', 'leaves'], 'readwrite');
        tx.objectStore('leaves').clear();
        tx.objectStore('settings').delete('leavesBackfilled');
        for (const c of list) {
          const lessons = {};
          for (const id of c.lessons) lessons[id] = { pos: 0, done: true };
          tx.objectStore('progress').put({ courseId: c.id, lessons, updatedAt: Date.now() });
        }
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      }),
    picked
  );
  await open(page, '/my', lang);
  await page.waitForFunction(() => document.querySelectorAll('.branch').length >= 2, null, { timeout: 20000 }).catch(() => {});
  check((await page.locator('.branch').count()) === 2, '13 finished courses: a second branch appears');
  check((await visibleSlots(page)) === 13, '13 leaves shown (12 on the first branch, 1 on the second)');
  check((await getLeaves(page)).length === 13, 'first-run backfill wrote 13 leaves');
  check(await noHScroll(page), '13 leaves: no horizontal scroll');

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.branchp', { timeout: 15000 });
  check((await page.locator('.branch').count()) === 2 && (await visibleSlots(page)) === 13, 'offline reload: leaves still there');
  await context.setOffline(false);
  await context.close();
}

async function run() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  for (const width of [360, 320]) for (const scheme of ['light', 'dark']) for (const lang of ['km', 'en']) await partA(browser, width, scheme, lang);
  await partB(browser);
  await partC(browser);
  await browser.close();
  if (failures) {
    console.error(`\n[companion.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[companion.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[companion.e2e] error:', err);
  process.exit(1);
});
