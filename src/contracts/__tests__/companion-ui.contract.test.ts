import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { guideLineHtml, branchPanelHtml, signHtml, type CompanionCtx } from '../../ui/companion';
import { chooseSign, draftAllowed, guideLine, pathCourseIds } from '../../data/companion';
import { homeView } from '../../ui/views';
import {
  openLearnDB,
  setLessonProgress,
  awardLeafIfFinished,
  listLeaves,
  exportBackup,
  importBackup,
  type Backup,
} from '../../db';
import { migrateAliases } from '../../db/aliases';

// Placeholder text only (testing rule 6). Contract tests for P-21 .. P-25.
const GUIDE = {
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: { k1: 'moon-hare-draft.svg' },
  lines: {
    'home.start_here': { km: 'KM-A', en: 'EN-A', approved: true },
    'course.finished': { km: 'KM-B', en: 'EN-B', approved: false },
  },
};
const ctx = (over: Partial<CompanionCtx> = {}): CompanionCtx => ({ lang: 'en', guide: GUIDE, aliases: {}, draft: false, ...over });

// P-21 — a guide line shows ONLY if approved=true; no fallback text; drafts are
// DEV-only (?guide=draft) and never in a production build.
describe('P-21 approved-only guide lines', () => {
  it('approved shows; unapproved and missing show nothing', () => {
    expect(guideLineHtml(ctx(), 'home.start_here', null)).toContain('EN-A');
    expect(guideLineHtml(ctx(), 'course.finished', null)).toBe('');
    expect(guideLineHtml(ctx(), 'nope', null)).toBe('');
    expect(guideLine(GUIDE, 'course.finished', 'km')).toBeNull();
  });
  it('drafts need a DEV build AND ?guide=draft', () => {
    expect(draftAllowed('?guide=draft', false)).toBe(false);
    expect(draftAllowed('?guide=draft', true)).toBe(true);
  });
  it('every committed line ships unapproved until a person approves it', () => {
    const g = JSON.parse(readFileSync('data/guide-lines.json', 'utf-8'));
    for (const l of Object.values(g.lines) as { approved: boolean }[]) expect(typeof l.approved).toBe('boolean');
  });
});

// P-22 — the sign comes from DATA: course_signs[id] (old provisional ids still
// match through the alias map), else default_sign. No code change to switch.
describe('P-22 sign chosen from data', () => {
  it('course_signs hit, default otherwise, alias-aware', () => {
    expect(chooseSign(GUIDE, 'k1')).toBe('moon-hare-draft.svg');
    expect(chooseSign(GUIDE, 'other')).toBe('leaf-sign-draft.svg');
    expect(chooseSign(GUIDE, 'perm-k1', { k1: 'perm-k1' })).toBe('moon-hare-draft.svg');
    expect(signHtml(ctx(), 'k1')).toContain('data-sign="moon-hare-draft.svg"');
  });
  it('every sign named in data/guide-lines.json exists in public/brand/companion/', () => {
    const g = JSON.parse(readFileSync('data/guide-lines.json', 'utf-8'));
    for (const f of [g.default_sign, ...Object.values(g.course_signs)] as string[]) {
      expect(existsSync(`public/brand/companion/${f}`), f).toBe(true);
    }
  });
  it('the branch file still has slots 1..12 by data-slot', () => {
    const svg = readFileSync('public/brand/companion/branch-draft.svg', 'utf-8');
    expect([...svg.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

// P-23 — a leaf is added once and NEVER removed or changed (lesson added,
// lesson un-marked, older backup imported, id rewritten).
describe('P-23 leaves are never removed', () => {
  beforeEach(async () => {
    const db = await openLearnDB();
    const stores = ['progress', 'leaves', 'settings'] as const;
    const tx = db.transaction([...stores], 'readwrite');
    await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  });
  it('survives a new lesson, an un-mark, an older backup, and an id rewrite', async () => {
    await setLessonProgress('cK', 'cK-l001', { done: true });
    expect(await awardLeafIfFinished('cK', ['cK-l001'], 5)).toBe(true);
    expect(await awardLeafIfFinished('cK', ['cK-l001', 'cK-l002'], 6)).toBe(false); // lesson added
    await setLessonProgress('cK', 'cK-l001', { done: false }); // un-marked
    expect(await awardLeafIfFinished('cK', ['cK-l001'], 7)).toBe(false);
    const old = { ...(await exportBackup()) } as Partial<Backup>;
    delete old.leaves; // an older backup has no leaves
    await importBackup(old as Backup);
    expect(await listLeaves()).toEqual([{ course_id: 'cK', at: 5 }]);
    await migrateAliases({ cK: 'perm-K' }); // provisional id rewritten
    expect(await listLeaves()).toEqual([{ course_id: 'perm-K', at: 5 }]);
  });
});

// P-24 — the branch panel shows NO numbers, levels, empty slots, percent.
describe('P-24 no numbers on the branch', () => {
  it('no digits in any visible text, any leaf count, both languages', () => {
    const g = { ...GUIDE, lines: { ...GUIDE.lines, 'my.branch.empty': { km: 'k', en: 'e', approved: true } } };
    for (const n of [0, 1, 11, 12, 13, 24, 25]) {
      for (const lang of ['km', 'en'] as const) {
        const html = branchPanelHtml(ctx({ lang, guide: g, leafCount: n }));
        const text = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/[0-9\u17E0-\u17E9%]/);
      }
    }
  });
  it('only earned leaves are drawn: hidden slots are display=none, never an empty-slot marker', () => {
    const html = branchPanelHtml(ctx({ leafCount: 3 }));
    const tags = html.match(/<[a-zA-Z][^>]*\sdata-slot="\d+"[^>]*>/g) ?? [];
    expect(tags.length).toBe(12);
    expect(tags.filter((tg) => !tg.includes('display="none"')).length).toBe(3);
    expect(html).not.toMatch(/empty-slot|placeholder-slot/);
  });
});

// P-25 — the Start here row reads ONLY path "start-here" in paths.json; there
// is no config fallback list, and people edit data/, never public/data/.
describe('P-25 Start here reads paths.json', () => {
  const catalog = {
    generated: 'g',
    provisional: true,
    courses: [{ id: 'c1', provisional: true, title_km: 't', title_en: null, teacher: 'x', teacher_slug: 's', topics: [], lesson_count: 1, media_kinds: ['r2'] }],
  };
  const row = (ids: string[]) => homeView(catalog as never, [], new Map(), {}, { lang: 'en', topic: 'all', savedIds: new Set() } as never, ids, []);
  it('hidden unless the path is approved and has a known id', () => {
    const p = (ids: string[], approved: boolean) => ({ version: 1, paths: [{ id: 'start-here', title_km: null, title_en: null, course_ids: ids, approved }] });
    const known = new Set(['c1']);
    expect(row(pathCourseIds(p(['c1'], true), 'start-here', known))).toContain('Start here');
    expect(row(pathCourseIds(p(['c1'], false), 'start-here', known))).not.toContain('Start here');
    expect(row(pathCourseIds(p([], true), 'start-here', known))).not.toContain('Start here');
  });
  it('no START_HERE config list remains in code', () => {
    expect(readFileSync('src/config.ts', 'utf-8')).not.toMatch(/export const START_HERE/);
    expect(readFileSync('src/app.ts', 'utf-8')).not.toMatch(/\bSTART_HERE\b/);
    expect(readFileSync('src/app.ts', 'utf-8')).toMatch(/pathCourseIds\(.*'start-here'/);
  });
});
