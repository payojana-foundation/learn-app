import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STRINGS } from '../../strings';
import { startedCourseIds, orderBranchItems } from '../../data/companion';
import { branchesHtml, branchPanelHtml, leafMarkHtml, type CompanionCtx } from '../../ui/companion';
import { homeView, courseCard } from '../../ui/views';

// Placeholder ids and text only (testing rule 6). Contract tests for P-26..P-28.

/** Every non-test source file under src/. */
function srcFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...srcFiles(p));
    } else if (/\.(ts|css)$/.test(name) && !/\.test\.ts$/.test(name) && !p.endsWith('test-setup.ts')) {
      out.push(p);
    }
  }
  return out;
}

const GUIDE = {
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: {},
  lines: { 'my.branch.empty': { km: 'k', en: 'e', approved: true } },
};
const ctx = (over: Partial<CompanionCtx> = {}): CompanionCtx => ({ lang: 'en', guide: GUIDE, aliases: {}, draft: false, ...over });
const visibleText = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');

// P-26 — no guilt.
describe('P-26 no guilt', () => {
  it('no notifications, push, or app-badge APIs anywhere in src/', () => {
    const banned = /\bNotification\b|showNotification|requestPermission|PushManager|pushManager|setAppBadge|periodicSync/;
    for (const f of srcFiles()) expect(readFileSync(f, 'utf-8'), f).not.toMatch(banned);
  });
  it('no streak / day-count / points / rank / leaderboard / missing / losing / failing / sad wording in interface strings or guide lines', () => {
    const banned = /\b(streaks?|points?|ranks?|ranking|leaderboards?|days? in a row|miss|missed|missing|lose|losing|lost|fail|failed|failing|sad|sadness)\b/i;
    for (const [key, s] of Object.entries(STRINGS)) expect(s.en, key).not.toMatch(banned);
    const g = JSON.parse(readFileSync('data/guide-lines.json', 'utf-8'));
    for (const [key, l] of Object.entries(g.lines) as [string, { en: string }][]) expect(l.en, key).not.toMatch(banned);
  });
  it('no digits in the branch panel, for any number of leaves and buds', () => {
    for (const [l, b] of [[0, 0], [0, 1], [3, 2], [12, 0], [12, 1], [30, 7]] as const) {
      for (const lang of ['km', 'en'] as const) {
        expect(visibleText(branchPanelHtml(ctx({ lang, leafCount: l, budCount: b })))).not.toMatch(/[0-9\u17E0-\u17E9%]/);
      }
    }
  });
  it('nothing on the branch depends on time: same input, same drawing; no fade or animation code', () => {
    const strip = (h: string) => h.replace(/-[bsm]\d+/g, '-X'); // unique id suffixes only
    expect(strip(branchesHtml(3, 2))).toBe(strip(branchesHtml(3, 2)));
    const comp = readFileSync('src/ui/companion.ts', 'utf-8');
    expect(comp).not.toMatch(/Date\.now|new Date|setTimeout|setInterval|opacity|animation|transition/);
    const css = readFileSync('src/style.css', 'utf-8');
    const branchCss = css.split('\n').filter((line) => /\.(branchp|branches|branch|gsign|gmark|guide|devnote)\b/.test(line)).join('\n');
    expect(branchCss).not.toMatch(/opacity|animation|transition|filter/);
  });
});

// P-27 — buds: started (>=1 lesson done) and not finished; derived; leaves first.
describe('P-27 buds', () => {
  const rec = (courseId: string, done: boolean[], updatedAt = 1) => ({
    courseId,
    lessons: Object.fromEntries(done.map((d, i) => [`${courseId}-l${i}`, { pos: 1, done: d }])),
    updatedAt,
  });
  it('a bud needs >= 1 done lesson, a catalogue course, and no leaf', () => {
    const cat = new Set(['a', 'b', 'c']);
    expect(startedCourseIds([rec('a', [false]), rec('b', [true]), rec('c', [true]), rec('z', [true])], cat, new Set(['c']))).toEqual(['b']);
  });
  it('leaves first, then buds, across branches', () => {
    expect(orderBranchItems([{ course_id: 'L', at: 1 }], ['B']).map((i) => i.kind)).toEqual(['leaf', 'bud']);
    const kinds = branchesHtml(12, 2)
      .split('data-branch=')
      .slice(1)
      .map((p) => (p.match(/<[a-zA-Z][^>]*\sdata-slot="\d+"[^>]*>/g) ?? []).filter((tg) => !tg.includes('display="none"')).map((tg) => (tg.includes('#bb-') ? 'bud' : 'leaf')));
    expect(kinds).toEqual([Array(12).fill('leaf'), ['bud', 'bud']]);
  });
  it('the bud list is not stored: no IndexedDB store named buds', () => {
    expect(readFileSync('src/db/index.ts', 'utf-8')).not.toMatch(/createObjectStore\('buds'/);
  });
});

// P-28 — Start here leaf mark: row only, leaf sign only, no text or numbers.
describe('P-28 Start here leaf mark', () => {
  const course = (id: string) => ({
    id, provisional: true, title_km: `t-${id}`, title_en: null, teacher: 'x', teacher_slug: 's',
    topics: [], lesson_count: 1, media_kinds: ['r2'],
  });
  const catalog = { generated: 'g', provisional: true, courses: [course('c1'), course('c2')] };
  const c = ctx({ leafIds: new Set(['c1', 'c2']) });

  it('only cards in the Start here row get the mark', () => {
    const html = homeView(catalog as never, [], new Map(), {}, { lang: 'en', topic: 'all', savedIds: new Set() } as never, ['c1'], [], c);
    expect((html.match(/class="gmark"/g) ?? []).length).toBe(1); // c2 also has a leaf but is not in the row
    expect(courseCard(course('c1') as never, undefined, {}, 'en')).not.toContain('gmark'); // default card: no mark
  });
  it('the mark is the leaf sign only: aria-hidden, no text, no digits', () => {
    const m = leafMarkHtml(c, 'c1');
    expect(m).toContain('data-sign="leaf-sign-draft.svg"');
    expect(m).toContain('aria-hidden="true"');
    expect(visibleText(m).trim()).toBe('');
  });
});
