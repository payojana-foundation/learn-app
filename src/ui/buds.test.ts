import { describe, it, expect, beforeEach } from 'vitest';
import { startedCourseIds, orderBranchItems } from '../data/companion';
import { branchesHtml, branchPanelHtml, leafMarkHtml, type CompanionCtx } from './companion';
import { homeView } from './views';
import { openLearnDB, setLessonProgress, listProgress, awardLeafIfFinished, listLeaves } from '../db';

// Placeholder ids and text only (testing rule 6).
const GUIDE = {
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: { k1: 'moon-hare-draft.svg' },
  lines: { 'my.branch.empty': { km: 'KM-EMPTY', en: 'EN-EMPTY', approved: true } },
};
const ctx = (over: Partial<CompanionCtx> = {}): CompanionCtx => ({ lang: 'en', guide: GUIDE, aliases: {}, draft: false, ...over });

/** Per branch: for each visible slot, in slot order, its href kind. */
function slotKinds(html: string): string[][] {
  return html.split('data-branch=').slice(1).map((part) =>
    (part.match(/<[a-zA-Z][^>]*\sdata-slot="\d+"[^>]*>/g) ?? [])
      .filter((tag) => !tag.includes('display="none"'))
      .map((tag) => (/href="#bb-/.test(tag) ? 'bud' : /href="#bl-/.test(tag) ? 'leaf' : '?'))
  );
}

describe('started rule (startedCourseIds)', () => {
  const rec = (courseId: string, done: boolean[], updatedAt = 1) => ({
    courseId,
    lessons: Object.fromEntries(done.map((d, i) => [`${courseId}-l${i}`, { pos: 5, done: d }])),
    updatedAt,
  });
  const cat = new Set(['a', 'b', 'c', 'd']);

  it('needs at least one lesson DONE; opening a lesson (position only) does not count', () => {
    expect(startedCourseIds([rec('a', [false, false])], cat, new Set())).toEqual([]);
    expect(startedCourseIds([rec('a', [false, true])], cat, new Set())).toEqual(['a']);
    expect(startedCourseIds([{ courseId: 'a', updatedAt: 1 }], cat, new Set())).toEqual([]);
  });
  it('ignores a course that is not in the catalogue', () => {
    expect(startedCourseIds([rec('zzz', [true])], cat, new Set())).toEqual([]);
  });
  it('ignores a course that already has a leaf', () => {
    expect(startedCourseIds([rec('a', [true]), rec('b', [true])], cat, new Set(['a']))).toEqual(['b']);
  });
  it('oldest progress update first', () => {
    expect(startedCourseIds([rec('c', [true], 30), rec('a', [true], 10), rec('b', [true], 20)], cat, new Set())).toEqual(['a', 'b', 'c']);
  });
});

describe('ordering: leaves first, then buds', () => {
  it('leaves by at, then the buds as given', () => {
    const items = orderBranchItems(
      [{ course_id: 'L2', at: 2 }, { course_id: 'L1', at: 1 }, { course_id: 'L3', at: 3 }],
      ['B1', 'B2']
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['leaf:L1', 'leaf:L2', 'leaf:L3', 'bud:B1', 'bud:B2']);
  });
  it('a finished bud leaves the bud list and its leaf goes after the other leaves', () => {
    const before = orderBranchItems([{ course_id: 'L1', at: 1 }], ['B1', 'B2']);
    expect(before.map((i) => i.kind)).toEqual(['leaf', 'bud', 'bud']);
    const after = orderBranchItems([{ course_id: 'L1', at: 1 }, { course_id: 'B1', at: 9 }], ['B2']);
    expect(after.map((i) => `${i.kind}:${i.id}`)).toEqual(['leaf:L1', 'leaf:B1', 'bud:B2']);
  });
});

describe('branch drawing', () => {
  it('3 leaves + 2 buds: slots 1-3 leaf, 4-5 bud', () => {
    expect(slotKinds(branchesHtml(3, 2))).toEqual([['leaf', 'leaf', 'leaf', 'bud', 'bud']]);
  });
  it('buds only: bud slots from the first slot', () => {
    expect(slotKinds(branchesHtml(0, 2))).toEqual([['bud', 'bud']]);
  });
  it('13+ items continue on the next branch (leaves first, then buds across the break)', () => {
    const k = slotKinds(branchesHtml(11, 3)); // 14 items
    expect(k).toHaveLength(2);
    expect(k[0]).toEqual([...Array(11).fill('leaf'), 'bud']);
    expect(k[1]).toEqual(['bud', 'bud']);
    expect(slotKinds(branchesHtml(12, 1))).toEqual([Array(12).fill('leaf'), ['bud']]);
    expect(slotKinds(branchesHtml(0, 0))).toEqual([[]]); // bare branch
  });
  it('panel: empty-branch line only with 0 leaves AND 0 buds; never any digit', () => {
    expect(branchPanelHtml(ctx({ leafCount: 0, budCount: 0 }))).toContain('EN-EMPTY');
    expect(branchPanelHtml(ctx({ leafCount: 0, budCount: 2 }))).not.toContain('EN-EMPTY');
    expect(branchPanelHtml(ctx({ leafCount: 2, budCount: 0 }))).not.toContain('EN-EMPTY');
    for (const [l, b] of [[0, 0], [0, 3], [4, 2], [12, 3], [25, 5]] as const) {
      for (const lang of ['km', 'en'] as const) {
        const html = branchPanelHtml(ctx({ lang, leafCount: l, budCount: b }));
        const text = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/[0-9\u17E0-\u17E9]/);
      }
    }
  });
});

describe('buds from the real progress store', () => {
  beforeEach(async () => {
    const db = await openLearnDB();
    const tx = db.transaction(['progress', 'leaves'], 'readwrite');
    await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('leaves').clear(), tx.done]);
  });
  const known = new Set(['cA']);
  const buds = async (leafIds: string[] = []) => startedCourseIds(await listProgress(), known, new Set(leafIds));

  it('opened-only → no bud; one lesson done → bud; un-mark every lesson → bud gone', async () => {
    await setLessonProgress('cA', 'cA-l001', { pos: 12 }); // opened / played, not done
    expect(await buds()).toEqual([]);
    await setLessonProgress('cA', 'cA-l001', { done: true });
    expect(await buds()).toEqual(['cA']);
    await setLessonProgress('cA', 'cA-l001', { done: false });
    expect(await buds()).toEqual([]);
  });
  it('finishing the class turns the bud into a leaf, and the leaf is never removed', async () => {
    await setLessonProgress('cA', 'cA-l001', { done: true });
    expect(await buds()).toEqual(['cA']);
    await setLessonProgress('cA', 'cA-l002', { done: true });
    expect(await awardLeafIfFinished('cA', ['cA-l001', 'cA-l002'], 5)).toBe(true);
    expect(await buds((await listLeaves()).map((l) => l.course_id))).toEqual([]);
    await setLessonProgress('cA', 'cA-l001', { done: false }); // un-marked afterwards
    await setLessonProgress('cA', 'cA-l002', { done: false });
    expect(await listLeaves()).toEqual([{ course_id: 'cA', at: 5 }]);
    expect(await buds((await listLeaves()).map((l) => l.course_id))).toEqual([]); // has a leaf: no bud
  });
});

describe('Start here leaf mark', () => {
  const course = (id: string) => ({
    id, provisional: true, title_km: `t-${id}`, title_en: null, teacher: 'x', teacher_slug: 's',
    topics: [], lesson_count: 1, media_kinds: ['r2'],
  });
  const catalog = { generated: 'g', provisional: true, courses: [course('c1'), course('c2'), course('c3')] };
  const home = (c: CompanionCtx | undefined) =>
    homeView(catalog as never, [], new Map(), {}, { lang: 'en', topic: 'all', savedIds: new Set() } as never, ['c1', 'c2'], [], c);

  it('mark = leaf sign only, aria-hidden, no text, only when the class has a leaf', () => {
    const m = leafMarkHtml(ctx({ leafIds: new Set(['c1']) }), 'c1');
    expect(m).toContain('class="gmark"');
    expect(m).toContain('aria-hidden="true"');
    expect(m.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim()).toBe('');
    expect(leafMarkHtml(ctx({ leafIds: new Set(['c1']) }), 'c2')).toBe('');
    expect(leafMarkHtml(ctx(), 'c1')).toBe('');
    expect(leafMarkHtml(undefined, 'c1')).toBe('');
    expect(leafMarkHtml(ctx({ guide: null, leafIds: new Set(['c1']) }), 'c1')).toBe('');
  });
  it('uses the default sign even for a kids class', () => {
    expect(leafMarkHtml(ctx({ leafIds: new Set(['k1']) }), 'k1')).toContain('data-sign="leaf-sign-draft.svg"');
  });
  it('shows on the finished card of the Start here row only; none on the Courses row', () => {
    const html = home(ctx({ leafIds: new Set(['c1', 'c3']) }));
    expect((html.match(/class="gmark"/g) ?? []).length).toBe(1); // c1 in the row; c3 is not in the row
    const startSection = html.slice(html.indexOf('<section>'), html.indexOf('</section>'));
    expect(startSection).toContain('class="gmark"');
    expect(startSection.indexOf('data-id="c1"')).toBeLessThan(startSection.indexOf('class="gmark"') + 200);
  });
  it('no companion → home is unchanged (no mark)', () => {
    expect(home(undefined)).not.toContain('gmark');
  });
});
