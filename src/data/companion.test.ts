import { describe, it, expect, vi } from 'vitest';
import {
  isPathsFile,
  isGuideLinesFile,
  pathCourseIds,
  unknownPathIds,
  draftAllowed,
  guideLine,
  chooseSign,
  isSafeSignName,
} from './companion';
import { resolveAlias } from '../db/aliases';

// Placeholder text only (testing rule 6): no real titles or guide wording.
const GUIDE = {
  version: 1,
  default_sign: 'leaf-sign-draft.svg',
  course_signs: { cA: 'moon-hare-draft.svg', cBad: '../evil.svg' },
  lines: {
    'k.approved': { km: 'km-ok', en: 'en-ok', approved: true },
    'k.draft': { km: 'km-draft', en: 'en-draft', approved: false },
    'k.empty': { km: '', en: '', approved: true },
  },
};

describe('guideLine gating', () => {
  it('shows an approved line in both languages', () => {
    expect(guideLine(GUIDE, 'k.approved', 'km')).toEqual({ text: 'km-ok', draft: false });
    expect(guideLine(GUIDE, 'k.approved', 'en')).toEqual({ text: 'en-ok', draft: false });
  });
  it('shows NOTHING for an unapproved line', () => {
    expect(guideLine(GUIDE, 'k.draft', 'km')).toBeNull();
    expect(guideLine(GUIDE, 'k.draft', 'en', false)).toBeNull();
  });
  it('shows NOTHING for a missing key, empty text, or missing/malformed file', () => {
    expect(guideLine(GUIDE, 'k.missing', 'en')).toBeNull();
    expect(guideLine(GUIDE, 'k.empty', 'en')).toBeNull();
    expect(guideLine(null, 'k.approved', 'en')).toBeNull();
    expect(guideLine({ nope: 1 }, 'k.approved', 'en')).toBeNull();
  });
  it('draft mode shows an unapproved line, flagged draft', () => {
    expect(guideLine(GUIDE, 'k.draft', 'en', true)).toEqual({ text: 'en-draft', draft: true });
  });
});

describe('draftAllowed (dev only)', () => {
  it('needs BOTH a dev build and ?guide=draft', () => {
    expect(draftAllowed('?guide=draft', true)).toBe(true);
    expect(draftAllowed('?guide=other', true)).toBe(false);
    expect(draftAllowed('', true)).toBe(false);
  });
  it('is never true in a production build', () => {
    expect(draftAllowed('?guide=draft', false)).toBe(false);
  });
});

describe('chooseSign', () => {
  it('uses default_sign when the course has no entry', () => {
    expect(chooseSign(GUIDE, 'cOther')).toBe('leaf-sign-draft.svg');
  });
  it('uses the course_signs entry when present', () => {
    expect(chooseSign(GUIDE, 'cA')).toBe('moon-hare-draft.svg');
  });
  it('unknown/unsafe file name → default_sign + a console warning', () => {
    const warn = vi.fn();
    expect(chooseSign(GUIDE, 'cBad', {}, warn)).toBe('leaf-sign-draft.svg');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('an OLD id in course_signs still finds the sign after the alias rewrite', () => {
    const aliases = { cA: 'perm-A' }; // cA was rewritten to perm-A
    expect(resolveAlias('cA', aliases)).toBe('perm-A');
    expect(chooseSign(GUIDE, 'perm-A', aliases)).toBe('moon-hare-draft.svg');
    expect(chooseSign(GUIDE, 'perm-other', aliases)).toBe('leaf-sign-draft.svg');
    // the data object itself is not rewritten
    expect(Object.keys(GUIDE.course_signs)).toContain('cA');
  });
  it('malformed file → no sign', () => {
    expect(chooseSign(null, 'cA')).toBeNull();
  });
  it('isSafeSignName accepts plain .svg names only', () => {
    expect(isSafeSignName('a-b_1.svg')).toBe(true);
    for (const bad of ['../x.svg', 'a/b.svg', 'x.png', 'https://x/y.svg', '', 5]) expect(isSafeSignName(bad)).toBe(false);
  });
});

const PATHS = {
  version: 1,
  paths: [
    { id: 'start-here', title_km: null, title_en: null, course_ids: ['c1', 'cX', 'c2'], approved: true },
    { id: 'later', title_km: null, title_en: null, course_ids: ['c1'], approved: false },
  ],
};

describe('paths parsing', () => {
  const known = new Set(['c1', 'c2']);
  it('accepts a well-formed file and rejects bad shapes', () => {
    expect(isPathsFile(PATHS)).toBe(true);
    expect(isPathsFile({ version: 1, paths: [{ id: 'x' }] })).toBe(false);
    expect(isPathsFile({ version: 1, paths: 'no' })).toBe(false);
    expect(isPathsFile(null)).toBe(false);
    expect(isGuideLinesFile(GUIDE)).toBe(true);
    expect(isGuideLinesFile({ ...GUIDE, lines: { a: { km: 'x' } } })).toBe(false);
  });
  it('skips unknown ids and keeps order', () => {
    expect(pathCourseIds(PATHS, 'start-here', known)).toEqual(['c1', 'c2']);
    expect(unknownPathIds(PATHS, known)).toEqual([{ path: 'start-here', id: 'cX' }]);
  });
  it('hidden when not approved, empty, missing path, or malformed', () => {
    expect(pathCourseIds(PATHS, 'later', known)).toEqual([]);
    expect(pathCourseIds(PATHS, 'nope', known)).toEqual([]);
    expect(pathCourseIds({ version: 1, paths: [{ id: 'start-here', title_km: null, title_en: null, course_ids: [], approved: true }] }, 'start-here', known)).toEqual([]);
    expect(pathCourseIds({ broken: true }, 'start-here', known)).toEqual([]);
    expect(pathCourseIds(null, 'start-here', known)).toEqual([]);
  });
});
