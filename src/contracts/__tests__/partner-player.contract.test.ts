/**
 * Contract (bulk 10 P4): P-14 KillerPlayer on partner class pages only, after a tap; P-11
 * started / done; partner progress in the backup (P-15) without a schema change (P-20).
 * Placeholders only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildKpFrame, ensureKpHelper, kpFrameUrl, type KpDoc } from '../../ui/kp';
import { KP_PLAYLIST_BASE, KP_HELPER_SRC, DB_VERSION } from '../../config';
import { partnerClassView } from '../../ui/partners';
import { lessonView } from '../../ui/views';
import {
  resetDbForTests, openLearnDB, listPartnerProgress, markPartnerStarted, togglePartnerDone, exportBackup, importBackup, PARTNER_PROGRESS_KEY,
} from '../../db';

const U = 'a21376b7-12b0-45bc-9a7b-6f594534cb09';

/** A tiny fake DOM: enough for buildKpFrame / ensureKpHelper. */
function fakeDoc(): KpDoc & { headKids: { tag: string; attrs: Record<string, string> }[] } {
  const headKids: { tag: string; attrs: Record<string, string> }[] = [];
  const make = (tag: string) => {
    const attrs: Record<string, string> = {};
    return { tag, attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; } } as unknown as HTMLElement;
  };
  return {
    headKids,
    createElement: (tag) => make(tag),
    querySelector: (sel) => (sel === 'script[data-kp-embed-helper]' ? ((headKids.find((k) => 'data-kp-embed-helper' in k.attrs) as unknown as Element) ?? null) : null),
    head: { appendChild: (n: Node) => { headKids.push(n as never); return n; } },
  };
}

describe('P-14 KillerPlayer frame built by Learn from the UUID', () => {
  it('fixed constants: the KillerPlayer playlist base and helper script', () => {
    expect(KP_PLAYLIST_BASE).toBe('https://killerplayer.com/watch/video/playlist/');
    expect(KP_HELPER_SRC).toBe('https://killerplayer.com/watch/embed.js');
  });
  it('the iframe src is the base + a strict uuid v4; anything else → no iframe', () => {
    const d = fakeDoc();
    const f = buildKpFrame(d, U, 'class placeholder') as unknown as { tag: string; attrs: Record<string, string> };
    expect(f.tag).toBe('iframe');
    expect(f.attrs.src).toBe(`https://killerplayer.com/watch/video/playlist/${U}`);
    expect(f.attrs.title).toBe('class placeholder');
    expect(f.attrs.allow).toBe('autoplay; fullscreen; encrypted-media');
    for (const bad of ['', 'javascript:alert(1)', `${U}?x=1`, `${U}"><script>`, U.toUpperCase(), U.replace('-45bc', '-15bc'), '../../evil']) {
      expect(kpFrameUrl(bad), bad).toBe(null);
      expect(buildKpFrame(fakeDoc(), bad, 't'), bad).toBe(null);
    }
  });
  it('the helper script is added once, from the fixed constant', () => {
    const d = fakeDoc();
    expect(ensureKpHelper(d)).toBe(true);
    expect(ensureKpHelper(d)).toBe(false);
    expect(d.headKids).toHaveLength(1);
    expect(d.headKids[0].attrs.src).toBe(KP_HELPER_SRC);
  });
  it('no pasted HTML path: kp.ts never uses innerHTML/outerHTML/insertAdjacentHTML; app.ts builds the frame only via buildKpFrame', () => {
    const kp = readFileSync('src/ui/kp.ts', 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join('\n');
    expect(kp).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    const app = readFileSync('src/app.ts', 'utf-8');
    expect(app.match(/createElement\('iframe'\)/g)).toBeNull();
    expect((app.match(/buildKpFrame\(/g) || []).length).toBe(1);
    expect(app).not.toMatch(/kp_embed/);
  });
  it('the class page has the cover button before the tap and only an empty slot after it (no iframe in the HTML)', () => {
    const P = { slug: 'p-one', name_km: 'pk', name_en: 'pe', teacher_slugs: [], course_ids: ['yt-pl-PLx1'] };
    const K = { id: 'yt-pl-PLx1', kind: 'partner', partner_slug: 'p-one', title: 'class placeholder', teacher_slugs: ['t-one'], playlist_uuid: U, teaching_points: [], lessons: [] };
    const before = partnerClassView(K as never, P, new Map(), 'en', '', undefined, 'cover');
    expect(before).toMatch(/<button type="button" class="pcover" data-kp-play/);
    expect(before).not.toContain('data-kp-slot');
    const after = partnerClassView(K as never, P, new Map(), 'en', '', undefined, 'frame');
    expect(after).toContain('data-kp-slot');
    expect(after).not.toContain('data-kp-play');
    for (const h of [before, after]) expect(h).not.toMatch(/<iframe|<script|killerplayer/);
    expect(partnerClassView(K as never, P, new Map(), 'en', '', undefined, 'offline')).toContain('needs an internet connection');
  });
  it('own lessons unchanged: no iframe, no KillerPlayer anywhere on a lesson page', () => {
    const c = { id: 'c900', provisional: false, title_km: 'x', title_en: null, teacher: 'x', teacher_slug: 't', topics: [], lessons: [{ id: 'L1', num: 1, title_km: 'l', topic: '', media: [{ kind: 'r2' as const, src: 'audio/x.mp3' }] }] };
    const h = lessonView(c, c.lessons[0], {}, { lang: 'en', topic: 'all', savedIds: new Set() }, [], false, 1, 0, true);
    expect(h).not.toMatch(/<iframe|killerplayer|data-kp/);
  });
});

describe('P-11 partner "started" / "mark class done" (settings store, schema unchanged)', () => {
  beforeEach(() => resetDbForTests());
  it('started once on the first tap; done toggles; nothing per lesson', async () => {
    const db0 = await openLearnDB();
    await db0.delete('settings', PARTNER_PROGRESS_KEY);
    expect(await listPartnerProgress()).toEqual({});
    const a = await markPartnerStarted('yt-pl-A');
    expect(a).toMatchObject({ course_id: 'yt-pl-A', done_at: null });
    const again = await markPartnerStarted('yt-pl-A');
    expect(again!.started_at).toBe(a!.started_at);
    const d = await togglePartnerDone('yt-pl-A');
    expect(typeof d!.done_at).toBe('number');
    expect((await markPartnerStarted('yt-pl-A'))!.done_at).toBe(d!.done_at); // a later tap keeps done
    expect((await togglePartnerDone('yt-pl-A'))!.done_at).toBe(null);
    const b = await togglePartnerDone('yt-pl-B'); // done without a tap = also started
    expect(b).toMatchObject({ course_id: 'yt-pl-B' });
    expect(Object.keys(await listPartnerProgress()).sort()).toEqual(['yt-pl-A', 'yt-pl-B']);
    const db = await openLearnDB();
    expect(db.version).toBe(3);
    expect(DB_VERSION).toBe(3);
    expect(await db.getAll('progress')).toEqual([]); // never in per-lesson progress (no leaf/bud)
    expect(await db.getAll('leaves')).toEqual([]);
  });
  it('two concurrent writes (two tabs) are both kept', async () => {
    const db0 = await openLearnDB();
    await db0.delete('settings', PARTNER_PROGRESS_KEY);
    await Promise.all([markPartnerStarted('yt-pl-X'), markPartnerStarted('yt-pl-Y'), togglePartnerDone('yt-pl-Z')]);
    expect(Object.keys(await listPartnerProgress()).sort()).toEqual(['yt-pl-X', 'yt-pl-Y', 'yt-pl-Z']);
  });
  it('P-15: Export carries it, Import restores it (settings are a user store)', async () => {
    const db0 = await openLearnDB();
    await db0.delete('settings', PARTNER_PROGRESS_KEY);
    await markPartnerStarted('yt-pl-A');
    await togglePartnerDone('yt-pl-B');
    const backup = await exportBackup();
    expect(backup.schema).toBe(3);
    expect(Object.keys((backup.settings as Record<string, Record<string, unknown>>)[PARTNER_PROGRESS_KEY]).sort()).toEqual(['yt-pl-A', 'yt-pl-B']);
    const want = await listPartnerProgress();
    await db0.delete('settings', PARTNER_PROGRESS_KEY);
    expect(await listPartnerProgress()).toEqual({});
    await importBackup(JSON.parse(JSON.stringify(backup)));
    expect(await listPartnerProgress()).toEqual(want);
  });
  it('a bad stored value reads as none and is not deleted', async () => {
    const db = await openLearnDB();
    await db.put('settings', 'garbage' as never, PARTNER_PROGRESS_KEY);
    expect(await listPartnerProgress()).toEqual({});
    expect(await db.get('settings', PARTNER_PROGRESS_KEY)).toBe('garbage');
  });
});
