/**
 * e2e/buds.e2e.mjs — buds on the branch + Start here leaf marks (bulk-06 P1).
 *
 * Real course data from the catalog (ids and lesson ids are read, never typed);
 * lessons are marked with the real "mark done" button; embeds are blocked so
 * nothing outside the preview server is fetched. No titles or names are typed.
 *
 * PART A (320 and 360 px x light and dark x km and en, service worker blocked):
 *   fresh /my bare; open a lesson without finishing: no bud; mark one lesson
 *   done: one bud; finish that class: bud gone, one leaf; reload keeps it;
 *   3 leaves + 2 buds: leaves first, then buds; Start here fixture: leaf mark
 *   on the finished card only; no horizontal scroll; no digits in the panel.
 * PART B (360 light km, service worker ON): 3 leaves + 2 buds survive reload
 *   and an offline reload.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const idb = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('learn-app');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          // eslint-disable-next-line no-new-func
          Promise.resolve(new Function('db', 'arg', `return (${src})(db, arg)`)(db, a))
            .then((v) => (db.close(), resolve(v)))
            .catch(reject);
        };
      }),
    [fn.toString(), arg]
  );

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Visible slot kinds across all branches, in order: 'leaf' | 'bud'. */
const kinds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.branch')].flatMap((b) =>
      [...b.querySelectorAll('[data-slot]')]
        .filter((u) => getComputedStyle(u).display !== 'none')
        .map((u) => ((u.getAttribute('href') || '').startsWith('#bb') ? 'bud' : 'leaf'))
    )
  );

async function open(page, path, lang) {
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app-main > *');
}

/** Pick real, small courses: A (to play through), 3 for leaves, 2 for buds. */
async function pickCourses(page) {
  return page.evaluate(async () => {
    const cat = await (await fetch('/data/catalog.json')).json();
    const cands = cat.courses.filter((c) => c.lesson_count >= 2).sort((a, b) => a.lesson_count - b.lesson_count || a.id.localeCompare(b.id)).slice(0, 8);
    const lessons = {};
    for (const c of cands) lessons[c.id] = (await (await fetch(`/data/courses/${c.id}.json`)).json()).lessons.map((l) => l.id);
    const ids = cands.map((c) => c.id);
    return { A: ids[0], leaves: ids.slice(1, 4), buds: ids.slice(4, 6), lessons };
  });
}

/** Replace progress + leaves with: leaves L (at 1..), buds B (one lesson done, updatedAt 10, 20). */
const seed = (page, plan) =>
  idb(
    page,
    (db, p) =>
      new Promise((res, rej) => {
        const tx = db.transaction(['progress', 'leaves', 'settings', 'history'], 'readwrite');
        tx.objectStore('history').clear(); // so the Continue row is absent and Start here is the first row
        tx.objectStore('progress').clear();
        tx.objectStore('leaves').clear();
        tx.objectStore('settings').put(true, 'leavesBackfilled');
        p.leaves.forEach((id, i) => tx.objectStore('leaves').put({ course_id: id, at: i + 1 }));
        p.buds.forEach((id, i) =>
          tx.objectStore('progress').put({ courseId: id, lessons: { [p.lessons[id][0]]: { pos: 3, done: true } }, updatedAt: 10 * (i + 1) })
        );
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      }),
    plan
  );

const isDone = (page, courseId, lessonId) =>
  idb(page, (db, [c, l]) => new Promise((res) => (db.transaction('progress').objectStore('progress').get(c).onsuccess = (e) => res(!!e.target.result?.lessons?.[l]?.done))), [courseId, lessonId]);
const leafIds = (page) =>
  idb(page, (db) => new Promise((res) => (db.transaction('leaves').objectStore('leaves').getAll().onsuccess = (e) => res(e.target.result.map((l) => l.course_id).sort()))));

/** Open a lesson and click "mark done" once (only if not already done). */
async function markDone(page, courseId, lessonId, lang) {
  await open(page, `/courses/${courseId}/${lessonId}`, lang);
  await page.waitForSelector('[data-done]');
  if (!(await isDone(page, courseId, lessonId))) await page.locator('[data-done]').click();
  for (let k = 0; k < 40 && !(await isDone(page, courseId, lessonId)); k++) await page.waitForTimeout(150);
}

async function newContext(browser, width, scheme, sw) {
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width, height: 780 },
    colorScheme: scheme,
    serviceWorkers: sw ? 'allow' : 'block',
  });
  // Nothing outside the preview server: block the embed hosts.
  await context.route(/embed\.acast\.com|youtube(-nocookie)?\.com|drive\.google\.com/, (r) => r.abort());
  return context;
}

async function partA(browser, width, scheme, lang) {
  console.log(`[${width}px ${scheme} ${lang}]`);
  const context = await newContext(browser, width, scheme, false);
  const page = await context.newPage();

  await open(page, '/my', lang);
  const plan = await pickCourses(page);
  const lessons = plan.lessons[plan.A];

  check(same(await kinds(page), []), 'fresh /my: bare branch, no buds');
  check(await noHScroll(page), 'fresh /my: no horizontal scroll');

  // opened (not finished) → no bud
  await open(page, `/courses/${plan.A}/${lessons[0]}`, lang);
  await open(page, '/my', lang);
  check(same(await kinds(page), []), 'opened a lesson without finishing: no bud');

  // one lesson done → one bud
  await markDone(page, plan.A, lessons[0], lang);
  await open(page, '/my', lang);
  check(same(await kinds(page), ['bud']), 'one lesson done: one bud');
  await page.reload({ waitUntil: 'networkidle' });
  check(same(await kinds(page), ['bud']), 'reload: the bud is still there');
  const panel1 = await page.locator('.branchp').innerText();
  check(!/[0-9\u17E0-\u17E9]/.test(panel1), 'bud panel: no digits');
  check((await page.locator('.guide').count()) === 0, 'bud panel: no guide line');

  // finish the class → bud gone, one leaf
  for (const l of lessons.slice(1)) await markDone(page, plan.A, l, lang);
  for (let k = 0; k < 30 && !(await leafIds(page)).includes(plan.A); k++) await page.waitForTimeout(150);
  await open(page, '/my', lang);
  check(same(await kinds(page), ['leaf']), 'class finished: bud replaced by one leaf');
  check((await leafIds(page)).includes(plan.A), 'class finished: leaf record exists');

  // 3 leaves + 2 buds: leaves first, then buds
  await seed(page, plan);
  await open(page, '/my', lang);
  check(same(await kinds(page), ['leaf', 'leaf', 'leaf', 'bud', 'bud']), '3 leaves + 2 buds: leaves first, then buds');
  await page.reload({ waitUntil: 'networkidle' });
  check(same(await kinds(page), ['leaf', 'leaf', 'leaf', 'bud', 'bud']), 'reload: leaves and buds still there');
  check(!/[0-9\u17E0-\u17E9]/.test(await page.locator('.branchp').innerText()), '3+2: no digits in the panel');
  check(await noHScroll(page), '3+2: no horizontal scroll');

  // Start here fixture: approved path of 2 classes (one with a leaf, one a bud)
  const paths = { version: 1, paths: [{ id: 'start-here', title_km: null, title_en: null, course_ids: [plan.leaves[0], plan.buds[0]], approved: true }] };
  const body = JSON.stringify(paths, null, 2) + '\n';
  await page.route('**/data/manifest.json*', async (route) => {
    const m = await (await route.fetch()).json();
    m.files.paths.sha256 = sha256(Buffer.from(body, 'utf-8'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
  });
  await page.route('**/data/paths.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }));
  await open(page, '/', lang);
  const marks = await page.evaluate(() => {
    const first = document.querySelector('#app-main section');
    return [...document.querySelectorAll('.gmark')].map((m) => ({
      id: m.closest('button')?.getAttribute('data-id'),
      inFirstSection: !!first && first.contains(m),
      hidden: m.getAttribute('aria-hidden'),
      text: m.textContent.trim(),
    }));
  });
  check(marks.length === 1, 'Start here: exactly one leaf mark on the page');
  check(marks[0]?.id === plan.leaves[0] && marks[0]?.inFirstSection, 'Start here: the mark is on the finished card, in the row');
  check(marks[0]?.hidden === 'true' && marks[0]?.text === '', 'Start here: mark is aria-hidden with no text');
  const rowCards = await page.evaluate(() => [...document.querySelectorAll('#app-main section')[0].querySelectorAll('button.card')].map((b) => b.getAttribute('data-id')));
  check(same(rowCards, [plan.leaves[0], plan.buds[0]]), 'Start here: the row shows the 2 classes in order');
  check(await noHScroll(page), 'home with Start here: no horizontal scroll');

  await context.close();
}

async function partB(browser) {
  console.log('[offline 360px light km, service worker on]');
  const lang = 'km';
  const context = await newContext(browser, 360, 'light', true);
  const page = await context.newPage();
  await open(page, '/my', lang);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
  const plan = await pickCourses(page);
  await seed(page, plan);
  await open(page, '/my', lang);
  check(same(await kinds(page), ['leaf', 'leaf', 'leaf', 'bud', 'bud']), 'online: 3 leaves + 2 buds');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.branchp', { timeout: 15000 });
  check(same(await kinds(page), ['leaf', 'leaf', 'leaf', 'bud', 'bud']), 'offline reload: leaves and buds still there');
  await context.setOffline(false);
  await context.close();
}

async function run() {
  const browser = await chromium.launch();
  for (const width of [360, 320]) for (const scheme of ['light', 'dark']) for (const lang of ['km', 'en']) await partA(browser, width, scheme, lang);
  await partB(browser);
  await browser.close();
  if (failures) {
    console.error(`\n[buds.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[buds.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[buds.e2e] error:', err);
  process.exit(1);
});
