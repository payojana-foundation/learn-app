import { describe, it, expect, beforeEach } from 'vitest';
import {
  openLearnDB,
  setLessonProgress,
  awardLeafIfFinished,
  listLeaves,
  backfillLeaves,
  exportBackup,
  importBackup,
  isCourseFinished,
  LEAVES_BACKFILL_KEY,
  type Backup,
} from './index';
import { migrateAliases } from './aliases';

// Placeholder ids only (testing rule 6).
async function reset(): Promise<void> {
  const db = await openLearnDB();
  const stores = ['progress', 'saved', 'history', 'notes', 'leaves', 'settings'] as const;
  const tx = db.transaction([...stores], 'readwrite');
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
}

describe('isCourseFinished (pure)', () => {
  it('needs every visible lesson done; ignores extra progress ids; empty list is never finished', () => {
    const p = { a: { done: true }, b: { done: true }, gone: { done: false } };
    expect(isCourseFinished(p, ['a', 'b'])).toBe(true);
    expect(isCourseFinished(p, ['a', 'b', 'c'])).toBe(false);
    expect(isCourseFinished(p, [])).toBe(false);
    expect(isCourseFinished(undefined, ['a'])).toBe(false);
  });
});

describe('leaves', () => {
  beforeEach(reset);

  it('adds a leaf once when every visible lesson is done', async () => {
    await setLessonProgress('cT', 'cT-l001', { done: true });
    expect(await awardLeafIfFinished('cT', ['cT-l001', 'cT-l002'], 100)).toBe(false); // l002 not done
    expect(await listLeaves()).toEqual([]);
    await setLessonProgress('cT', 'cT-l002', { done: true });
    expect(await awardLeafIfFinished('cT', ['cT-l001', 'cT-l002'], 200)).toBe(true);
    expect(await awardLeafIfFinished('cT', ['cT-l001', 'cT-l002'], 300)).toBe(false); // already there
    expect(await listLeaves()).toEqual([{ course_id: 'cT', at: 200 }]); // not updated
  });

  it('concurrent calls (two tabs) still make exactly one leaf', async () => {
    await setLessonProgress('cT', 'cT-l001', { done: true });
    const r = await Promise.all([1, 2, 3, 4].map((n) => awardLeafIfFinished('cT', ['cT-l001'], n)));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await listLeaves()).toHaveLength(1);
  });

  it('keeps the leaf after a lesson is added to the course, or un-marked', async () => {
    await setLessonProgress('cT', 'cT-l001', { done: true });
    await awardLeafIfFinished('cT', ['cT-l001'], 10);
    // a new lesson appears: course no longer "finished", but the leaf stays
    expect(await awardLeafIfFinished('cT', ['cT-l001', 'cT-l002'], 20)).toBe(false);
    await setLessonProgress('cT', 'cT-l001', { done: false });
    expect(await awardLeafIfFinished('cT', ['cT-l001'], 30)).toBe(false);
    expect(await listLeaves()).toEqual([{ course_id: 'cT', at: 10 }]);
  });

  it('lists leaves oldest first', async () => {
    for (const [id, at] of [['cB', 2], ['cA', 1], ['cC', 3]] as const) {
      await setLessonProgress(id, `${id}-l001`, { done: true });
      await awardLeafIfFinished(id, [`${id}-l001`], at);
    }
    expect((await listLeaves()).map((l) => l.course_id)).toEqual(['cA', 'cB', 'cC']);
  });
});

describe('backfillLeaves (first run)', () => {
  beforeEach(reset);

  it('adds leaves for already-finished courses in one pass and marks itself done', async () => {
    await setLessonProgress('cF', 'cF-l001', { done: true });
    await setLessonProgress('cP', 'cP-l001', { done: true }); // partly done
    const ids: Record<string, string[]> = { cF: ['cF-l001'], cP: ['cP-l001', 'cP-l002'] };
    expect(await backfillLeaves(['cF', 'cP'], async (id) => ids[id])).toBe(1);
    expect((await listLeaves()).map((l) => l.course_id)).toEqual(['cF']);
    const db = await openLearnDB();
    expect(await db.get('settings', LEAVES_BACKFILL_KEY)).toBe(true);
    expect(await backfillLeaves(['cF', 'cP'], async (id) => ids[id])).toBe(0); // runs once
  });

  it('an unavailable course file does not mark it done (retry later)', async () => {
    await setLessonProgress('cF', 'cF-l001', { done: true });
    expect(await backfillLeaves(['cF'], async () => null)).toBe(0);
    const db = await openLearnDB();
    expect(await db.get('settings', LEAVES_BACKFILL_KEY)).toBeUndefined();
    expect(await backfillLeaves(['cF'], async () => ['cF-l001'])).toBe(1);
  });
});

describe('export / import of leaves', () => {
  beforeEach(reset);

  it('export includes leaves', async () => {
    await setLessonProgress('cT', 'cT-l001', { done: true });
    await awardLeafIfFinished('cT', ['cT-l001'], 5);
    expect((await exportBackup()).leaves).toEqual([{ course_id: 'cT', at: 5 }]);
  });

  it('import merges by course_id: union, existing leaf kept as is', async () => {
    await setLessonProgress('cL', 'cL-l001', { done: true });
    await awardLeafIfFinished('cL', ['cL-l001'], 1);
    const base = await exportBackup();
    await importBackup({
      ...base,
      leaves: [{ course_id: 'cL', at: 999 }, { course_id: 'cN', at: 2 }, { bad: true }],
    } as Backup);
    expect(await listLeaves()).toEqual([
      { course_id: 'cL', at: 1 },
      { course_id: 'cN', at: 2 },
    ]);
  });

  it('an older backup without leaves removes none', async () => {
    await setLessonProgress('cL', 'cL-l001', { done: true });
    await awardLeafIfFinished('cL', ['cL-l001'], 1);
    const old = { ...(await exportBackup()) } as Partial<Backup>;
    delete old.leaves;
    await importBackup(old as Backup);
    expect(await listLeaves()).toEqual([{ course_id: 'cL', at: 1 }]);
  });
});

describe('alias rewrite of leaves', () => {
  beforeEach(reset);

  it('moves the leaf key to the permanent id, once', async () => {
    await setLessonProgress('cOld', 'cOld-l001', { done: true });
    await awardLeafIfFinished('cOld', ['cOld-l001'], 7);
    await migrateAliases({ cOld: 'perm-new' });
    expect(await listLeaves()).toEqual([{ course_id: 'perm-new', at: 7 }]);
    await migrateAliases({ cOld: 'perm-new' });
    expect(await listLeaves()).toEqual([{ course_id: 'perm-new', at: 7 }]);
  });

  it('never loses a leaf when the permanent key already has one', async () => {
    const db = await openLearnDB();
    await db.put('leaves', { course_id: 'cOld', at: 1 });
    await db.put('leaves', { course_id: 'perm-new', at: 2 });
    await migrateAliases({ cOld: 'perm-new' });
    expect(await listLeaves()).toEqual([{ course_id: 'perm-new', at: 2 }]);
  });
});
