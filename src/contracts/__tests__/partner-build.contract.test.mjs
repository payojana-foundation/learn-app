/**
 * Contract: P-19 partner classes (bulk 10 P2) — release rule, embed parser, ids, duplicate guard,
 * retirement, adoption; and the partners switch (off = served data unchanged, on = served).
 * Placeholders only (no real titles); the on/off build runs on a temp copy of the repo data.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildPartners, kpPlaylistUuid, youtubeId, retirePlan, termsIndex } from '../../../scripts/partners/build-partners.mjs';

const U = 'a21376b7-12b0-45bc-9a7b-6f594534cb09';
const EMBED = `<iframe style='display:block' src='https://killerplayer.com/watch/video/playlist/${U}' title='placeholder' frameborder="0" allow="autoplay; fullscreen"></iframe><script src='https://killerplayer.com/watch/embed.js?v=b00acee1' data-kp-embed-helper async></script>`;
const VID = (n) => `vid${String(n).padStart(8, '0')}`; // 11 chars
const pl = (o) => ({ playlist_id: 'PLx1', partner_slug: 'p-one', playlist_title: 'pl title', display_title: '', teacher_slugs: '', decision: 'Add', decided_at: '2026-11-18', kp_embed: EMBED, teaching_points: '', notes: 'never parsed: decision=Skip teacher_slugs=zzz', ...o });
const vids = (pid, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ playlist_id: pid, position: String(n - i), video_id: VID(i + 1), title: `v${n - i}`, duration_s: '60', playable: 'yes', status: 'Waiting', ...extra }));
const base = (o = {}) => ({
  partners: [{ partner_slug: 'p-one', name_km: 'pk', name_en: 'pe', teacher_slugs: 't-one' }, { partner_slug: 'p-two', name_km: 'pk2', name_en: 'pe2', teacher_slugs: '' }],
  playlists: [pl({})],
  videos: vids('PLx1', 3),
  terms: [],
  teacherSlugs: new Set(['t-one', 't-two']),
  ownCourses: [],
  ownYoutube: new Map(),
  ...o,
});

describe('P-19 partner classes: ids and release rule', () => {
  it('ids are yt-pl-<playlist_id> / yt-<11-char video id>, never c###; lessons in position order, titles byte-exact', () => {
    const r = buildPartners(base());
    expect(r.courses.map((c) => c.id)).toEqual(['yt-pl-PLx1']);
    expect(r.files[0].lessons.map((l) => [l.id, l.num, l.title])).toEqual([[`yt-${VID(3)}`, 1, 'v1'], [`yt-${VID(2)}`, 2, 'v2'], [`yt-${VID(1)}`, 3, 'v3']]);
    for (const id of [...r.courses.map((c) => c.id), ...r.files.flatMap((f) => f.lessons.map((l) => l.id))]) expect(id).not.toMatch(/^c\d{3}/);
    expect(r.files[0].playlist_uuid).toBe(U);
    expect(JSON.stringify(r)).not.toMatch(/<iframe|<script|never parsed/); // pasted HTML and notes never served
  });
  it('released only with Add + decided_at + valid kp_embed + mapped teacher; Partial hidden; reasons reported', () => {
    const cases = [
      [{ decision: 'Partial' }, 'Partial (not used in wave 1)'],
      [{ decision: 'Skip' }, 'decision Skip'],
      [{ decision: '' }, 'no decision'],
      [{ decided_at: '' }, 'no decided_at'],
      [{ kp_embed: '' }, 'bad kp_embed'],
      [{ kp_embed: EMBED.replace('killerplayer.com/watch/video', 'evil.example/watch/video') }, 'bad kp_embed'],
      [{ partner_slug: 'p-two' }, 'unmapped teacher'],
      [{ teacher_slugs: 'nobody' }, 'unmapped teacher'],
    ];
    for (const [o, reason] of cases) {
      const r = buildPartners(base({ playlists: [pl(o)] }));
      expect(r.courses, reason).toEqual([]);
      expect(r.hidden.map((h) => h.reason), reason).toEqual([reason]);
    }
    expect(buildPartners(base({ playlists: [pl({ teacher_slugs: 't-two' })] })).courses[0].teacher_slugs).toEqual(['t-two']); // Playlists first
    expect(buildPartners(base()).courses[0].teacher_slugs).toEqual(['t-one']); // else Partners
  });
  it('videos: playable = yes and status not Skip/Hidden/Moved; a class with none is hidden', () => {
    const v = [...vids('PLx1', 2), { playlist_id: 'PLx1', position: '9', video_id: VID(9), title: 'x', playable: 'no', status: 'Waiting' }, ...['Skip', 'Hidden', 'Moved'].map((s, i) => ({ playlist_id: 'PLx1', position: String(10 + i), video_id: VID(10 + i), title: 's', playable: 'yes', status: s }))];
    expect(buildPartners(base({ videos: v })).files[0].lessons).toHaveLength(2);
    expect(buildPartners(base({ videos: vids('PLx1', 2, { playable: 'no' }) })).hidden[0].reason).toBe('no playable videos');
  });
  it('duplicate guard: same normalised title + teacher as an own course is refused', () => {
    const own = [{ id: 'c001', title_km: 'Same  Title\u200B', teacher_slug: 't-one' }];
    expect(buildPartners(base({ playlists: [pl({ display_title: 'same title' })], ownCourses: own })).hidden[0].reason).toBe('duplicate of an own course');
    expect(buildPartners(base({ playlists: [pl({ display_title: 'same title', teacher_slugs: 't-two' })], ownCourses: own })).courses).toHaveLength(1);
  });
  it('a partner only appears with a released class', () => {
    expect(buildPartners(base()).partners.map((p) => p.slug)).toEqual(['p-one']);
  });
});

describe('P-19 embed safety: kpPlaylistUuid', () => {
  it('accepts the strict KillerPlayer playlist URL (with or without the helper script)', () => {
    expect(kpPlaylistUuid(EMBED)).toBe(U);
    expect(kpPlaylistUuid(`https://killerplayer.com/watch/video/playlist/${U}`)).toBe(U);
  });
  it('rejects other hosts, other scripts, inline scripts, javascript:/data: URLs, handlers, http, non-v4 ids, two playlists', () => {
    const bad = [
      EMBED.replace('https://killerplayer.com/watch/video', 'https://killerplayer.com.evil.io/watch/video'),
      EMBED.replace("https://killerplayer.com/watch/embed.js?v=b00acee1", 'https://cdn.example/x.js'),
      EMBED + '<script>alert(1)</script>',
      EMBED.replace("src='https://killerplayer", "src='javascript:alert(1)//https://killerplayer"),
      EMBED + "<img src='data:image/png;base64,AAAA'>",
      EMBED.replace('<iframe ', '<iframe onload="x()" '),
      EMBED.replace('https://killerplayer.com/watch/video', 'http://killerplayer.com/watch/video'),
      EMBED.replace(U, 'a21376b7-12b0-15bc-9a7b-6f594534cb09'),
      EMBED + `<iframe src='https://killerplayer.com/watch/video/playlist/${U.replace('a2', 'b2')}'></iframe>`,
      '<div>no url</div>',
      '',
    ];
    for (const b of bad) expect(kpPlaylistUuid(b), b).toBe(null);
  });
});

describe('P-19 retirement and adoption', () => {
  it('a class/lesson that stops being released is retired with the date; released again = not retired; nothing dropped', () => {
    const r1 = buildPartners(base());
    const s1 = retirePlan(null, null, r1.files, r1.adopted, '2026-11-19');
    expect(s1.retired).toEqual({ courses: {}, lessons: {} });
    const r2 = buildPartners(base({ playlists: [pl({ decision: 'Skip' })] }));
    const s2 = retirePlan(s1.ever, s1.retired, r2.files, r2.adopted, '2026-11-20');
    expect(Object.keys(s2.retired.courses)).toEqual(['yt-pl-PLx1']);
    expect(Object.keys(s2.retired.lessons)).toHaveLength(3);
    expect(s2.ever).toEqual(s1.ever);
    const s3 = retirePlan(s2.ever, s2.retired, r1.files, r1.adopted, '2026-11-21');
    expect(s3.retired).toEqual({ courses: {}, lessons: {} });
  });
  it('adoption: an own lesson with that video retires the partner lesson with an alias to the own lesson id', () => {
    const r1 = buildPartners(base());
    const s1 = retirePlan(null, null, r1.files, r1.adopted, '2026-11-19');
    const r2 = buildPartners(base({ ownYoutube: new Map([[VID(1), 'OWN-LESSON-1']]) }));
    expect(r2.files[0].lessons.map((l) => l.id)).not.toContain(`yt-${VID(1)}`);
    expect(r2.adopted).toEqual({ [`yt-${VID(1)}`]: 'OWN-LESSON-1' });
    const s2 = retirePlan(s1.ever, s1.retired, r2.files, r2.adopted, '2026-11-20');
    expect(s2.retired.lessons[`yt-${VID(1)}`]).toEqual({ since: '2026-11-20', alias: 'OWN-LESSON-1' });
  });
  it('youtube ids from own links; teaching points via term_km then other_spellings', () => {
    expect(['https://www.youtube.com/watch?v=Ek7D0IYLCx4', 'https://youtu.be/Ek7D0IYLCx4?t=3', 'https://youtube.com/shorts/Ek7D0IYLCx4'].map(youtubeId)).toEqual(['Ek7D0IYLCx4', 'Ek7D0IYLCx4', 'Ek7D0IYLCx4']);
    expect(youtubeId('https://evil.example/watch?v=Ek7D0IYLCx4')).toBe(null);
    const terms = [{ term_id: 'T1', term_km: 'k1', other_spellings: 'alt1; alt2' }];
    expect([...termsIndex(terms)]).toEqual([['k1', 'T1'], ['alt1', 'T1'], ['alt2', 'T1']]);
    const r = buildPartners(base({ terms, playlists: [pl({ teaching_points: 'alt2; unknown' })] }));
    expect(r.courses[0].teaching_points).toEqual(['T1']);
    expect(r.unknownTerms).toEqual([{ id: 'yt-pl-PLx1', term: 'unknown' }]);
  });
});

describe('partners switch: the real build on a temp copy (off = served data unchanged, on = served)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'partner-build-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const copy = (p) => cpSync(p, join(tmp, p), { recursive: true });
  for (const p of ['scripts', 'data/master', 'data/source', 'data/partners', 'public/data']) copy(p);
  for (const f of ['media-manifest.json', 'video-manifest.json', 'video-switch.json', 'id-aliases.json', 'retired-lessons.json', 'paths.json', 'guide-lines.json', 'partners-switch.json']) if (existsSync(`data/${f}`)) cpSync(`data/${f}`, join(tmp, 'data', f));
  if (existsSync('data/ops/removals.json')) { mkdirSync(join(tmp, 'data', 'ops'), { recursive: true }); cpSync('data/ops/removals.json', join(tmp, 'data', 'ops', 'removals.json')); }
  const build = () => spawnSync(process.execPath, [join(tmp, 'scripts', 'build-courses.mjs')], { cwd: tmp, encoding: 'utf-8', env: { ...process.env, SOURCE_DATE_EPOCH: '1763500000' } });
  const snap = () => Object.fromEntries(['catalog.json', 'manifest.json'].map((f) => [f, readFileSync(join(tmp, 'public', 'data', f), 'utf-8')]));
  it('switch file is committed off', () => {
    expect(JSON.parse(readFileSync('data/partners-switch.json', 'utf-8'))).toEqual({ enabled: false });
  });
  it('off: no partner keys, no partner files; on: catalog partner entries + hashed files; off again: back to the off output', () => {
    writeFileSync(join(tmp, 'data', 'partners-switch.json'), '{\n  "enabled": false\n}\n');
    let r = build();
    expect(r.status, r.stderr).toBe(0);
    const off = snap();
    const cat = JSON.parse(off['catalog.json']);
    expect(Object.keys(cat).sort()).toEqual(['courses', 'generated', 'provisional']);
    expect(existsSync(join(tmp, 'public', 'data', 'partners'))).toBe(false);
    expect(off['manifest.json']).not.toMatch(/partners\//);
    writeFileSync(join(tmp, 'data', 'partners-switch.json'), '{\n  "enabled": true\n}\n');
    r = build();
    expect(r.status, r.stderr).toBe(0);
    const on = JSON.parse(readFileSync(join(tmp, 'public', 'data', 'catalog.json'), 'utf-8'));
    expect(on.courses).toEqual(cat.courses); // own courses untouched
    expect(on.partner_courses.length).toBeGreaterThan(0);
    expect(on.partner_courses.every((c) => /^yt-pl-/.test(c.id) && c.kind === 'partner')).toBe(true);
    const man = JSON.parse(readFileSync(join(tmp, 'public', 'data', 'manifest.json'), 'utf-8'));
    const files = readdirSync(join(tmp, 'public', 'data', 'partners'));
    expect(files.length).toBe(on.partner_courses.length);
    for (const c of on.partner_courses) expect(man.files[c.id].file).toBe(`partners/${c.id}.json`);
    writeFileSync(join(tmp, 'data', 'partners-switch.json'), '{\n  "enabled": false\n}\n');
    r = build();
    expect(r.status, r.stderr).toBe(0);
    expect(snap()).toEqual(off);
    expect(existsSync(join(tmp, 'public', 'data', 'partners'))).toBe(false);
  }, 60000);
  it('a bad switch file fails the build', () => {
    writeFileSync(join(tmp, 'data', 'partners-switch.json'), '{"enabled": "yes"}');
    expect(build().status).toBe(1);
    writeFileSync(join(tmp, 'data', 'partners-switch.json'), '{\n  "enabled": false\n}\n');
  });
});
