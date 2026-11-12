import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME } from '../config';
import { openLearnDB, resetDbForTests, getLessonProgress, isSaved, listNotes, getSetting, listLeaves } from './index';
// This file must be the only one that opens the db BEFORE the upgrade, so it
// builds a version-1 database by hand (as an installed v1 app would have it).
// bulk 09 (P-20 clean cut): the upgrade to v3 keeps only the pilot course c080, with
// its lessons rewritten through the lesson map; every other old id is dropped.
describe('DB upgrade v1 to v3 (leaves store added; bulk 09 clean cut)', () => {
  it('adds the leaves store, keeps settings, drops what is keyed by an old id, keeps c080 through the map', async () => {
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
    await old.put('progress', { courseId: 'cM', lessons: { 'cM-l001': { pos: 3, done: true } }, updatedAt: 1 });
    await old.put('progress', { courseId: 'c080', lessons: { 'c080-l002': { pos: 9, done: true }, 'c080-l099': { pos: 1, done: true } }, updatedAt: 2 });
    await old.put('saved', { courseId: 'cM', at: 1 }, 'cM');
    await old.put('saved', { courseId: 'c080', at: 1 }, 'c080');
    await old.put('history', { courseId: 'c080', lessonNum: 2, lessonId: 'c080-l002', at: 5 }, 'c080:2');
    await old.put('history', { courseId: 'cM', lessonNum: 1, lessonId: 'cM-l001', at: 5 }, 'cM:1');
    await old.add('notes', { courseId: 'cM', lessonId: 'cM-l001', lessonNum: 1, atS: 0, text: 'placeholder', createdAt: 1 });
    await old.add('notes', { courseId: 'c080', lessonId: 'c080-l002', lessonNum: 2, atS: 1, text: 'kept', createdAt: 3 });
    await old.add('notes', { courseId: 'c080', lessonId: 'c080-l099', lessonNum: 99, atS: 1, text: 'no map', createdAt: 3 });
    await old.put('settings', 'km', 'lang');
    await old.put('files', { marker: true }, 'catalog');
    await old.put('dataHashes', 'abc', 'catalog');
    old.close();
    resetDbForTests();
    const db = await openLearnDB();
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['dataHashes', 'files', 'history', 'leaves', 'notes', 'progress', 'saved', 'settings'].sort()
    );
    // an old id: dropped (never pointed at another course)
    expect(await getLessonProgress('cM', 'cM-l001')).toEqual({ pos: 0, done: false });
    expect(await isSaved('cM')).toBe(false);
    expect(await db.get('history', 'cM:1')).toBeUndefined();
    // c080: only the lessons in the map survive, under their NEW ids
    expect(await getLessonProgress('c080', 'AJAD00YYX0102')).toEqual({ pos: 9, done: true });
    expect(await getLessonProgress('c080', 'c080-l099')).toEqual({ pos: 0, done: false });
    expect(await getLessonProgress('c080', 'c080-l002')).toEqual({ pos: 0, done: false });
    expect(await isSaved('c080')).toBe(true);
    expect((await db.get('history', 'c080:2'))?.lessonId).toBe('AJAD00YYX0102');
    expect((await listNotes()).map((n) => [n.text, n.lessonId])).toEqual([['kept', 'AJAD00YYX0102']]);
    // not keyed by an id: kept; cached data files are cleared so fresh, verified ones are fetched
    expect(await getSetting('lang')).toBe('km');
    expect(await db.get('files', 'catalog')).toBeUndefined();
    expect(await db.get('dataHashes', 'catalog')).toBeUndefined();
    expect(await listLeaves()).toEqual([]);
  });
});
