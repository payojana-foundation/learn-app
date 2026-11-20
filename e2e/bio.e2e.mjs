/**
 * e2e/bio.e2e.mjs — PART C (19 Nov): a teacher bio is closed by default behind a real button
 * below the name (▸ closed, ▾ open). Label by profile_kind: monk (sor-ratha) / lay (sok-heng);
 * en "About the teacher". No approved bio (hun-khemara) = no button. Click, Enter and Space
 * toggle; aria-expanded follows; focus visible; no horizontal scroll open or closed.
 * Matrix: 360/320 px × light/dark × km/en. The expected Khmer labels are read from the built
 * strings (STRINGS on window), never typed here.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

/** The labels as written in src/strings.ts (read, never retyped). */
const SRC = readFileSync(new URL('../src/strings.ts', import.meta.url), 'utf-8');
const label = (key, lang) => new RegExp(`${key}: \\{ km: '([^']+)', en: '([^']+)' \\}`).exec(SRC)[lang === 'km' ? 1 : 2];

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;

async function run() {
  const browser = await chromium.launch();
  let failures = 0;
  const fail = (m) => { console.error('  ✗ ' + m); failures++; };
  const ok = (m) => console.log('  ✓ ' + m);
  const check = (cond, m) => (cond ? ok(m) : fail(m));
  for (const w of [360, 320]) for (const scheme of ['light', 'dark']) for (const lang of ['km', 'en']) {
    console.log(`[bio ${w}px ${scheme} ${lang}]`);
    const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: w, height: 780 }, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await context.newPage();
    const noScroll = async (where) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll (${where})`);
    const state = () => page.evaluate(() => {
      const b = document.querySelector('[data-bio-toggle]');
      const p = b && document.getElementById(b.getAttribute('aria-controls'));
      return { exp: b?.getAttribute('aria-expanded'), hidden: p ? p.hidden : null, shown: p ? p.offsetHeight > 0 : null, arrow: b?.querySelector('[data-arrow]')?.textContent, label: b?.textContent.replace(/^[▸▾]\s*/, '').trim() };
    });
    for (const [slug, kind] of [['sor-ratha', 'monk'], ['sok-heng', 'lay']]) {
      await page.goto(`${BASE}/teachers/${slug}?lang=${lang}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-bio-toggle]');
      const want = label(kind === 'lay' ? 'BIO_LAY' : 'BIO_MONK', lang);
      let s = await state();
      check(s.exp === 'false' && s.hidden === true && s.shown === false && s.arrow === '▸', `${slug}: closed by default`);
      check(s.label === want && (lang !== 'en' || want === 'About the teacher'), `${slug}: ${kind} label (${lang})`);
      await noScroll(`${slug} closed`);
      await page.click('[data-bio-toggle]');
      s = await state();
      check(s.exp === 'true' && s.hidden === false && s.shown === true && s.arrow === '▾', `${slug}: click opens`);
      await noScroll(`${slug} open`);
      await page.focus('[data-bio-toggle]');
      const outline = await page.evaluate(() => { const el = document.querySelector('[data-bio-toggle]'); el.blur(); el.focus({ focusVisible: true }); return getComputedStyle(el).outlineStyle; });
      check(outline !== 'none', `${slug}: focus visible (outline ${outline})`);
      await page.keyboard.press('Space');
      s = await state();
      check(s.exp === 'false' && s.hidden === true, `${slug}: Space closes`);
      await page.keyboard.press('Enter');
      s = await state();
      check(s.exp === 'true' && s.hidden === false, `${slug}: Enter opens`);
    }
    await page.goto(`${BASE}/teachers/hun-khemara?lang=${lang}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tprof h1');
    check((await page.locator('[data-bio-toggle]').count()) === 0 && (await page.locator('.bio').count()) === 0, 'no approved bio: no button, no panel');
    await noScroll('no bio');
    await context.close();
  }
  await browser.close();
  if (failures) {
    console.error(`[bio.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('[bio.e2e] all checks passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
