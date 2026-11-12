/**
 * e2e/mock-data.mjs — route-mocked catalog for the e2e suites (bulk 09).
 *
 * After the switch to the master sheet the real catalog holds only the approved
 * course(s) (today: one course, c080). Suites that need several courses (buds, the
 * branch, Start here, 13 finished classes) therefore serve a SYNTHETIC catalog:
 * the real catalog plus placeholder courses, each with placeholder lessons that play
 * r2 mock audio. Titles are placeholders ("e2e course 01"), never real data.
 *
 * The app hash-verifies every data file against /data/manifest.json (P-01), so the
 * manifest response is patched with the SHA-256 of every served body, exactly the
 * integrity contract the app enforces, just with test bytes.
 *
 * Needs `serviceWorkers: 'block'` on the context (page routes do not see requests
 * that a service worker handles).
 */
import { createHash } from 'node:crypto';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const json = (v) => JSON.stringify(v, null, 2) + '\n';

/**
 * @param page   Playwright page (its context must block service workers)
 * @param origin e.g. http://localhost:4321
 * @param opts   { ids: string[] placeholder course ids to add (default none),
 *                 lessonsPer: lessons per placeholder course (default 3),
 *                 ongoing: ids of placeholder courses flagged ongoing,
 *                 partial: ids of placeholder courses with all_shown false }
 */
export async function installMockData(page, origin, opts = {}) {
  const { ids = [], lessonsPer = 3, ongoing = [], partial = [] } = opts;
  const realCatalog = await (await fetch(`${origin}/data/catalog.json`)).json();
  const base = realCatalog.courses[0];
  if (!base) throw new Error('the real catalog has no course to borrow a teacher from');

  const files = new Map(); // manifest key -> { rel, body }
  const makeCourse = (id, n = lessonsPer) => ({
    id,
    provisional: false,
    title_km: `e2e course ${id}`,
    title_en: null,
    teacher: base.teacher,
    teacher_slug: base.teacher_slug,
    topics: [],
    ongoing: ongoing.includes(id),
    all_shown: !partial.includes(id),
    lessons: Array.from({ length: n }, (_, k) => ({
      id: `${id}-m${k + 1}`,
      num: k + 1,
      title_km: `e2e lesson ${k + 1}`,
      topic: '',
      media: [{ kind: 'r2', src: `audio/e2e-${id}-${k + 1}-a64.mp3`, duration_s: 12 }],
    })),
  });
  const entryOf = (c) => ({
    id: c.id, provisional: false, title_km: c.title_km, title_en: null, teacher: c.teacher, teacher_slug: c.teacher_slug,
    topics: [], lesson_count: c.lessons.length, media_kinds: ['r2'], ongoing: c.ongoing, all_shown: c.all_shown,
  });

  const courses = new Map();
  for (const id of ids) {
    const c = makeCourse(id);
    courses.set(id, c);
    files.set(id, { rel: `courses/${id}.json`, body: json(c) });
  }
  const putCatalog = () => {
    const synth = [...courses.values()].map(entryOf);
    files.set('catalog', { rel: 'catalog.json', body: json({ ...realCatalog, courses: [...realCatalog.courses, ...synth] }) });
  };
  putCatalog();

  const md = {
    ids,
    base,
    /** a placeholder course object (not served until setCourse) */
    makeCourse,
    /** the served placeholder course */
    course: (id) => courses.get(id),
    /** serve (or replace) a placeholder course; the catalog entry follows */
    setCourse(c) {
      courses.set(c.id, c);
      files.set(c.id, { rel: `courses/${c.id}.json`, body: json(c) });
      putCatalog();
    },
    /** serve any data file in place of the real one (paths, guide-lines, ...) */
    serve(key, rel, body) {
      files.set(key, { rel, body: typeof body === 'string' ? body : json(body) });
    },
  };

  await page.route('**/data/manifest.json*', async (route) => {
    const m = await (await route.fetch()).json();
    for (const [key, f] of files) m.files[key] = { file: f.rel, updated: m.generated, sha256: sha256(Buffer.from(f.body, 'utf-8')) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
  });
  await page.route(/\/data\/(?!manifest\.json)[^?#]+\.json/, (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    for (const f of files.values()) {
      if (f.rel === rel) return route.fulfill({ status: 200, contentType: 'application/json', body: f.body });
    }
    return route.continue();
  });
  return md;
}
