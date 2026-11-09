import { describe, it, expect, vi } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME, DB_VERSION } from '../config';
import { openLearnDB, resetDbForTests, setVersionChangeHandler, setLessonProgress, getLessonProgress, listLeaves } from './index';

// bulk-07 P3: two connections to the same database, as two tabs would have.
// Placeholder ids only. This file owns its own fake IndexedDB (isolate on).
describe('DB versionchange handling', () => {
  it('an OLD connection that blocks the upgrade makes our open wait, then succeed (no data lost)', async () => {
    // Tab A (older build) holds version 1 open and does not close by itself.
    const old = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('progress', { keyPath: 'courseId' });
        db.createObjectStore('saved');
        db.createObjectStore('history');
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings');
        db.createObjectStore('files');
        db.createObjectStore('dataHashes');
      },
    });
    await old.put('progress', { courseId: 'cV', lessons: { 'cV-l001': { pos: 4, done: true } }, updatedAt: 1 });

    resetDbForTests();
    let settled = false;
    const opening = openLearnDB().then((db) => ((settled = true), db));
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false); // blocked, waiting — not failed, nothing cleared

    old.close(); // tab A goes away
    const db = await opening;
    expect(db.version).toBe(DB_VERSION);
    expect(await getLessonProgress('cV', 'cV-l001')).toEqual({ pos: 4, done: true });
    expect(await listLeaves()).toEqual([]);
    db.close(); // one tab = one connection: close this test's tab before the next
  });

  it('when a NEWER tab upgrades, this connection closes itself and calls the update prompt; the newer tab is not blocked', async () => {
    const prompt = vi.fn();
    setVersionChangeHandler(prompt);
    resetDbForTests();
    await openLearnDB();
    await setLessonProgress('cW', 'cW-l001', { done: true });

    // Tab B (a newer build) opens version DB_VERSION + 1.
    const blocked = vi.fn();
    const newer = await openDB(DB_NAME, DB_VERSION + 1, { blocked });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
    expect(newer.version).toBe(DB_VERSION + 1);
    // every store and record is still there for the newer tab
    expect([...newer.objectStoreNames]).toEqual(expect.arrayContaining(['progress', 'leaves', 'settings', 'notes']));
    expect((await newer.get('progress', 'cW'))?.lessons['cW-l001'].done).toBe(true);
    newer.close();
  });

  it('this (now older) tab opening again fails with VersionError, is not cached, and prompts again', async () => {
    const prompt = vi.fn();
    setVersionChangeHandler(prompt);
    resetDbForTests();
    await expect(openLearnDB()).rejects.toMatchObject({ name: 'VersionError' });
    expect(prompt).toHaveBeenCalledTimes(1);
    // the failed open is not cached: a second call tries again
    await expect(openLearnDB()).rejects.toMatchObject({ name: 'VersionError' });
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
