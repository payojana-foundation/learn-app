/**
 * e2e/a11y.e2e.mjs — accessibility pass with axe-core (bulk-04 S4).
 *
 * Runs axe-core (exact-pinned devDependency) on the seven screens at 360 px,
 * light AND dark, and FAILS on any serious/critical violation. Also checks
 * keyboard reach + visible focus on the lesson player controls.
 *
 * Screens (P-07 routes): Home `/`, course `/courses/c080`, lesson
 * `/courses/c080/<firstLessonId>`, search `/search?q=…`, My Learning `/my`,
 * More `/more`, teacher `/teachers/<slug>`.
 *
 * Mock media only (the lesson needs the r2 player to render); never a real
 * R2/embed fetch.
 */

import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.env.E2E_PORT || '4321';
const BASE = `http://localhost:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const AXE_PATH = join(here, '..', 'node_modules', 'axe-core', 'axe.min.js');
const AXE_SRC = readFileSync(AXE_PATH, 'utf-8');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function wavBytes(seconds = 20, rate = 8000) {
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

async function installMocks(page, origin) {
  const course = await (await fetch(`${origin}/data/courses/c080.json`)).json();
  course.lessons[0].media = [{ kind: 'r2', src: 'audio/e2e-a11y-a64.mp3', duration_s: 20 }];
  const body = JSON.stringify(course, null, 2) + '\n';
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
  await page.route('**/audio/e2e-a11y-a64.mp3', async (route) => {
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBytes(20) });
  });
  return course;
}

/** Run axe against the current page; return serious/critical violations. */
async function axeViolations(page) {
  await page.addScriptTag({ content: AXE_SRC });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  });
  return result.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

/** Resolve the first teacher slug and the first lesson id from the data. */
async function discover(origin, course) {
  const teachers = await (await fetch(`${origin}/data/teachers.json`)).json();
  const slug = teachers.teachers?.[0]?.slug ?? 'yon-yi';
  const firstLesson = course.lessons[0].id;
  return { slug, firstLesson };
}

async function run() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failures = 0;
  const fail = (m) => {
    console.error('  ✗ ' + m);
    failures++;
  };
  const ok = (m) => console.log('  ✓ ' + m);

  // Discover slug + lesson id once.
  const course0 = await (await fetch(`${BASE}/data/courses/c080.json`)).json();
  const { slug, firstLesson } = await discover(BASE, course0);

  const screens = [
    { name: 'Home', path: '/', ready: '#tabbar button' },
    { name: 'course', path: '/courses/c080', ready: '.les button' },
    { name: 'lesson', path: `/courses/c080/${firstLesson}`, ready: '[data-player]' },
    { name: 'search', path: `/search?q=${encodeURIComponent('អភិធម្ម')}`, ready: '#app-main' },
    { name: 'My Learning', path: '/my', ready: '#app-main' },
    { name: 'More', path: '/more', ready: '#app-main' },
    { name: 'teacher', path: `/teachers/${slug}`, ready: '#app-main' },
  ];

  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      viewport: { width: 360, height: 780 },
      colorScheme: scheme,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await installMocks(page, BASE);
    console.log(`[a11y 360px ${scheme}]`);

    for (const s of screens) {
      await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(s.ready, { timeout: 10000 }).catch(() => {});
      const v = await axeViolations(page);
      if (v.length === 0) {
        ok(`${s.name}: no serious/critical axe violations`);
      } else {
        fail(`${s.name}: ${v.length} serious/critical violation(s)`);
        for (const x of v) console.error(`      [${x.impact}] ${x.id} — ${x.help} @ ${x.nodes.join(', ')}`);
      }
    }

    await context.close();
  }

  // Keyboard reach + visible focus on the lesson player controls (light only).
  const kctx = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 780 },
    colorScheme: 'light',
    serviceWorkers: 'block',
  });
  const kpage = await kctx.newPage();
  await installMocks(kpage, BASE);
  await kpage.goto(`${BASE}/courses/c080/${firstLesson}`, { waitUntil: 'networkidle' });
  await kpage.waitForSelector('[data-player]');

  // Each control must be focusable and show a visible focus indicator.
  const controls = [
    { sel: '[data-pp]', label: 'play/pause' },
    { sel: '[data-skip="15"]', label: '+15 s' },
    { sel: '[data-skip="-15"]', label: '−15 s' },
    { sel: '[data-speed]', label: 'speed' },
    { sel: 'textarea[name="note"]', label: 'notes' },
  ];
  for (const c of controls) {
    const visible = await kpage.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, reason: 'missing' };
      el.focus();
      const focused = document.activeElement === el;
      const st = getComputedStyle(el);
      const ring =
        st.outlineStyle !== 'none' && st.outlineWidth !== '0px'
          ? true
          : st.boxShadow !== 'none';
      return { ok: focused && ring, focused, ring };
    }, c.sel);
    visible.ok ? ok(`keyboard: ${c.label} focusable with visible focus`) : fail(`keyboard: ${c.label} not reachable/visible (${JSON.stringify(visible)})`);
  }

  await kctx.close();
  await browser.close();

  if (failures) {
    console.error(`\n[a11y.e2e] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[a11y.e2e] all checks passed');
}

run().catch((err) => {
  console.error('[a11y.e2e] error:', err);
  process.exit(1);
});
