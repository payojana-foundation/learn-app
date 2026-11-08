import { describe, it, expect, vi } from 'vitest';
import {
  BUNDLE,
  prepareSvg,
  showSlots,
  resolveSignFile,
  signHtml,
  guideLineHtml,
  branchesHtml,
  branchPanelHtml,
  deviceNote,
  type CompanionCtx,
} from './companion';
import { homeView, courseView, myView } from './views';

// Placeholder text only (testing rule 6).
const GUIDE = {
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: { kid1: 'moon-hare-draft.svg', bad: 'missing-file.svg' },
  lines: {
    'home.start_here': { km: 'KM-HOME', en: 'EN-HOME', approved: true },
    'course.finished': { km: 'KM-COURSE', en: 'EN-COURSE', approved: true },
    'my.branch.empty': { km: 'KM-EMPTY', en: 'EN-EMPTY', approved: false },
  },
};
const ctx = (over: Partial<CompanionCtx> = {}): CompanionCtx => ({
  lang: 'en',
  guide: GUIDE,
  aliases: {},
  draft: false,
  ...over,
});

const visibleSlots = (html: string): number => (html.match(/data-slot="\d+"/g) ?? []).length - (html.match(/display="none"/g) ?? []).length;

describe('bundled drafts', () => {
  it('has the three draft files', () => {
    for (const f of ['leaf-sign-draft.svg', 'moon-hare-draft.svg', 'branch-draft.svg']) expect(BUNDLE[f]).toContain('<svg');
  });
  it('branch file has the 12 slots by data-slot', () => {
    const slots = [...BUNDLE['branch-draft.svg'].matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('prepareSvg', () => {
  it('drops title/role/labelledby and makes ids unique per copy', () => {
    const a = prepareSvg(BUNDLE['branch-draft.svg'], 'x1');
    const b = prepareSvg(BUNDLE['branch-draft.svg'], 'x2');
    expect(a).not.toMatch(/<title|role=|aria-labelledby/);
    expect(a).toContain('id="bl-x1"');
    expect(a).toContain('href="#bl-x1"');
    expect(a).not.toContain('"#bl"');
    expect(b).toContain('href="#bl-x2"');
    expect(a).toContain('stroke="currentColor"');
    expect(a).toContain('#F26000');
  });
});

describe('branch slots', () => {
  it('shows slots 1..N and hides the rest; 0 = bare branch', () => {
    const raw = prepareSvg(BUNDLE['branch-draft.svg'], 'y');
    expect(visibleSlots(showSlots(raw, 0))).toBe(0);
    expect(visibleSlots(showSlots(raw, 5))).toBe(5);
    expect(visibleSlots(showSlots(raw, 12))).toBe(12);
    // the hidden ones are the HIGH numbers
    expect(showSlots(raw, 5)).toMatch(/<use[^>]*display="none"[^>]*data-slot="6"|<use[^>]*data-slot="6"[^>]*>/);
    const s5 = showSlots(raw, 5);
    expect(s5).not.toMatch(/display="none"[^>]*data-slot="5"|data-slot="5"[^>]*display="none"/);
  });
  it('one branch per 12 leaves; 13+ adds a second branch; order maps 13..24 to 1..12', () => {
    const count = (n: number): number => (branchesHtml(n).match(/data-branch=/g) ?? []).length;
    expect([0, 1, 12].map(count)).toEqual([1, 1, 1]);
    expect([13, 24].map(count)).toEqual([2, 2]);
    expect(count(25)).toBe(3);
    const html13 = branchesHtml(13);
    const parts = html13.split('data-branch=').slice(1);
    expect(visibleSlots(parts[0])).toBe(12);
    expect(visibleSlots(parts[1])).toBe(1);
  });
});

describe('guide line + sign', () => {
  it('shows an approved line with the default sign; aria-hidden sign; no text colour hack', () => {
    const h = guideLineHtml(ctx(), 'home.start_here', null);
    expect(h).toContain('EN-HOME');
    expect(h).toContain('data-sign="leaf-sign-draft.svg"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toMatch(/F26000[^<]*<\/span>\s*$/);
  });
  it('shows NOTHING for an unapproved line (and no placeholder), a missing key, or no companion', () => {
    expect(guideLineHtml(ctx(), 'my.branch.empty', null)).toBe('');
    expect(guideLineHtml(ctx(), 'no.such.key', null)).toBe('');
    expect(guideLineHtml(undefined, 'home.start_here', null)).toBe('');
    expect(guideLineHtml(ctx({ guide: null }), 'home.start_here', null)).toBe('');
  });
  it('draft mode shows the unapproved line with a DRAFT tag', () => {
    const h = guideLineHtml(ctx({ draft: true }), 'my.branch.empty', null);
    expect(h).toContain('EN-EMPTY');
    expect(h).toContain('DRAFT');
  });
  it('km text is used in km', () => {
    expect(guideLineHtml(ctx({ lang: 'km' }), 'home.start_here', null)).toContain('KM-HOME');
  });
  it('escapes HTML in a line', () => {
    const g = { ...GUIDE, lines: { 'home.start_here': { km: 'k', en: '<b>x</b>', approved: true } } };
    expect(guideLineHtml(ctx({ guide: g }), 'home.start_here', null)).not.toContain('<b>');
  });
  it('sign: kids course → hare; other course → leaf; unknown file → default + warning', () => {
    expect(signHtml(ctx(), 'kid1')).toContain('data-sign="moon-hare-draft.svg"');
    expect(signHtml(ctx(), 'other')).toContain('data-sign="leaf-sign-draft.svg"');
    const warn = vi.fn();
    expect(resolveSignFile('missing-file.svg', 'leaf-sign-draft.svg', BUNDLE, warn)).toBe('leaf-sign-draft.svg');
    expect(warn).toHaveBeenCalled();
    expect(resolveSignFile(null, null, {})).toBeNull();
  });
  it('an old (provisional) id in course_signs still gets the hare after the alias rewrite', () => {
    expect(signHtml(ctx({ aliases: { kid1: 'perm-kid' } }), 'perm-kid')).toContain('moon-hare-draft.svg');
  });
});

describe('branch panel', () => {
  it('always has the device note with the Export label filled in; branch hidden from SR; label set', () => {
    for (const lang of ['km', 'en'] as const) {
      const h = branchPanelHtml(ctx({ lang, leafCount: 0 }));
      expect(h).toContain('class="devnote"');
      expect(h).not.toContain('{exportLabel}');
      expect(deviceNote(lang)).not.toContain('{exportLabel}');
      expect(h).toContain('aria-label=');
      expect(h).toContain('<div class="branches" aria-hidden="true">');
    }
    expect(deviceNote('en')).toContain('Export backup');
  });
  it('has no digits in any visible text, for 0 and for 13 leaves', () => {
    for (const n of [0, 1, 13]) {
      for (const lang of ['km', 'en'] as const) {
        const h = branchPanelHtml(ctx({ lang, leafCount: n, guide: { ...GUIDE, lines: { ...GUIDE.lines, 'my.branch.empty': { km: 'k', en: 'e', approved: true } } } }));
        const text = h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/[0-9\u17E0-\u17E9]/);
      }
    }
  });
  it('empty-branch line shows only at 0 leaves and only when approved', () => {
    const g = { ...GUIDE, lines: { ...GUIDE.lines, 'my.branch.empty': { km: 'k', en: 'EN-EMPTY', approved: true } } };
    expect(branchPanelHtml(ctx({ guide: g, leafCount: 0 }))).toContain('EN-EMPTY');
    expect(branchPanelHtml(ctx({ guide: g, leafCount: 2 }))).not.toContain('EN-EMPTY');
    expect(branchPanelHtml(ctx({ leafCount: 0 }))).not.toContain('EN-EMPTY'); // unapproved
  });
  it('no companion given → no panel (old callers unchanged)', () => {
    expect(branchPanelHtml(undefined)).toBe('');
  });
});

// Screens: the line appears in exactly the three named places.
const course = (id: string) => ({
  id, provisional: true, title_km: `t-${id}`, title_en: null, teacher: 'x', teacher_slug: 's',
  topics: [], lesson_count: 1, media_kinds: ['r2'],
});
const catalog = { generated: 'g', provisional: true, courses: [course('c1')] };
const vstate = { lang: 'en' as const, topic: 'all', savedIds: new Set<string>() };
const fullCourse = {
  ...course('c1'),
  lessons: [{ id: 'c1-l001', num: 1, title_km: 'x', topic: '', media: [{ kind: 'r2' as const, src: 'a' }] }],
};

describe('screens place GuideLine in exactly three places', () => {
  const guides = (html: string): string[] => [...html.matchAll(/data-guide="([^"]+)"/g)].map((m) => m[1]);

  it('home: above Start here, only when the row shows', () => {
    const withRow = homeView(catalog as never, [], new Map(), {}, vstate as never, ['c1'], [], ctx());
    expect(guides(withRow)).toEqual(['home.start_here']);
    expect(withRow.indexOf('data-guide="home.start_here"')).toBeLessThan(withRow.indexOf('class="hrow"'));
    const noRow = homeView(catalog as never, [], new Map(), {}, vstate as never, [], [], ctx());
    expect(guides(noRow)).toEqual([]);
  });
  it('course: only when the course has a leaf', () => {
    const args = [fullCourse as never, undefined, {}, vstate as never, '', null] as const;
    expect(guides(courseView(...args, ctx({ hasLeaf: true })))).toEqual(['course.finished']);
    expect(guides(courseView(...args, ctx({ hasLeaf: false })))).toEqual([]);
    expect(guides(courseView(...args))).toEqual([]);
  });
  it('my: branch panel above the tabs; empty line only at 0 leaves', () => {
    const g = { ...GUIDE, lines: { ...GUIDE.lines, 'my.branch.empty': { km: 'k', en: 'EN-EMPTY', approved: true } } };
    const args = ['inprog', catalog as never, new Map(), {}, vstate as never, [], [], []] as const;
    const h0 = myView(...args, ctx({ guide: g, leafCount: 0 }));
    expect(guides(h0)).toEqual(['my.branch.empty']);
    expect(h0.indexOf('class="branchp"')).toBeLessThan(h0.indexOf('class="tabs"'));
    expect(guides(myView(...args, ctx({ guide: g, leafCount: 3 })))).toEqual([]);
  });
});
