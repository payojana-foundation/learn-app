/**
 * e2e/layout.e2e.mjs — /my tabs and the bottom tab bar fit (bulk-07 P4).
 *
 * At 320 and 360 px x light and dark x km and en:
 *   - /my tabs: all four labels fully visible (not cut: no overflow in their
 *     box, inside the viewport), no horizontal page scroll.
 *   - bottom tab bar: all four items the same height, each at least 44 x 44 px;
 *     the My Learning label is ONE line at 360 px (two lines allowed at 320).
 * Labels are read from the page; no text is typed. Service worker blocked.
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
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

/** Number of rendered text lines inside an element (distinct line boxes). */
const LINES = (el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const tops = [...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top));
  return new Set(tops).size;
};

async function run() {
  const browser = await chromium.launch();
  for (const width of [360, 320]) {
    for (const scheme of ['light', 'dark']) {
      for (const lang of ['km', 'en']) {
        console.log(`[${width}px ${scheme} ${lang}]`);
        const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width, height: 780 }, colorScheme: scheme, serviceWorkers: 'block' });
        const page = await context.newPage();
        await page.goto(`${BASE}/my?lang=${lang}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.tabs button');
        await page.evaluate(() => document.fonts.ready);

        const tabs = await page.$$eval('.tabs button', (els) =>
          els.map((b) => {
            const r = b.getBoundingClientRect();
            return { sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight, left: r.left, right: r.right, h: r.height, text: b.textContent.trim() };
          })
        );
        check(tabs.length === 4, '/my: four tabs');
        check(tabs.every((t) => t.sw <= t.cw + 1 && t.sh <= t.ch + 1), '/my tabs: every label fully visible (no clipped text)');
        check(tabs.every((t) => t.left >= -1 && t.right <= width + 1), '/my tabs: all four inside the screen');
        check(tabs.every((t) => t.text.length > 0 && !t.text.endsWith('…')), '/my tabs: labels are whole (no ellipsis)');
        check(tabs.every((t) => t.h >= 44), '/my tabs: each at least 44 px tall');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '/my: no horizontal page scroll');

        const bar = await page.$$eval('#tabbar button', (els, linesSrc) => {
          // eslint-disable-next-line no-new-func
          const lines = new Function(`return (${linesSrc})`)();
          return els.map((b) => {
            const r = b.getBoundingClientRect();
            return { nav: b.dataset.nav, w: r.width, h: r.height, lines: lines(b), sw: b.scrollWidth, cw: b.clientWidth };
          });
        }, LINES.toString());
        const hs = bar.map((b) => b.h);
        check(bar.length === 4, 'tab bar: four items');
        check(Math.max(...hs) - Math.min(...hs) <= 1, `tab bar: all items the same height (${hs.map(Math.round).join('/')})`);
        check(bar.every((b) => b.h >= 44 && b.w >= 44), 'tab bar: every item at least 44 x 44 px');
        check(bar.every((b) => b.sw <= b.cw + 1), 'tab bar: no label overflows its item');
        const my = bar.find((b) => b.nav === 'my');
        if (width >= 360) check(my.lines === 1, `tab bar: My Learning on one line at ${width} px (lines=${my.lines})`);
        else check(my.lines <= 2, `tab bar: My Learning at most two lines at ${width} px (lines=${my.lines})`);

        // tappable: a tap on the My Learning item's centre hits that item
        const hit = await page.evaluate(() => {
          const b = document.querySelector('#tabbar button[data-nav="my"]');
          const r = b.getBoundingClientRect();
          return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === b;
        });
        check(hit, 'tab bar: My Learning item is tappable at its centre');
        await context.close();
      }
    }
  }
  await browser.close();
  if (failures) {
    console.error(`\n[layout.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[layout.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[layout.e2e] error:', err);
  process.exit(1);
});
