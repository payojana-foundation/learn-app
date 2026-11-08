import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME } from '../config';
import { openLearnDB, resetDbForTests, getLessonProgress, isSaved, listNotes, getSetting, listLeaves } from './index';

// This file must be the only one that opens the db BEFORE the upgrade, so it
// builds a version-1 database by hand (as an installed v1 app would have it).
describe('DB upgrade v1 → v2', () => {
  it('adds the leaves store and keeps every existing store and record', async () => {
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
    await old.put('saved', { courseId: 'cM', at: 1 }, 'cM');
    await old.add('notes', { courseId: 'cM', lessonId: 'cM-l001', lessonNum: 1, atS: 0, text: 'placeholder', createdAt: 1 });
    await old.put('settings', 'km', 'lang');
    await old.put('files', { marker: true }, 'catalog');
    await old.put('dataHashes', 'abc', 'catalog');
    old.close();

    resetDbForTests();
    const db = await openLearnDB();
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['dataHashes', 'files', 'history', 'leaves', 'notes', 'progress', 'saved', 'settings'].sort()
    );
    expect(await getLessonProgress('cM', 'cM-l001')).toEqual({ pos: 3, done: true });
    expect(await isSaved('cM')).toBe(true);
    expect((await listNotes())[0].text).toBe('placeholder');
    expect(await getSetting('lang')).toBe('km');
    expect(await db.get('files', 'catalog')).toEqual({ marker: true });
    expect(await db.get('dataHashes', 'catalog')).toBe('abc');
    expect(await listLeaves()).toEqual([]);
  });
});
