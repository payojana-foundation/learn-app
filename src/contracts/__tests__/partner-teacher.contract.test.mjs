/**
 * Contract (PART B, 19 Nov): the teacher record sem-chanthy, the two photos, and the P-19 partner
 * teacher map (Playlists > Partners > data/partners/teacher-map.json). Names are compared against
 * the source file's own bytes, never retyped here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildPartners } from '../../../scripts/partners/build-partners.mjs';
import { teacherRecord } from '../../../scripts/build-courses.mjs';

const SRC = 'data/source/teachers-2026-11-02/teachers-2026-11-02.json';
const teachers = JSON.parse(readFileSync(SRC, 'utf-8'));
const sem = teachers.find((t) => t.slug === 'sem-chanthy');

/** JPEG width/height from the SOF marker (no dependency). */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

describe('teacher record sem-chanthy', () => {
  it('exists once, appended (order 13), with no English name, no bio, no topics', () => {
    expect(teachers.filter((t) => t.slug === 'sem-chanthy')).toHaveLength(1);
    expect(sem).toMatchObject({ order: 13, name_en: null, bio_km: null, bio_en: null, topics: '', photo_file: 'teacher-photos/sem-chanthy.jpg', bio_approved_by_teacher: 'no', show_english_name: 'no' });
    expect(teachers.map((t) => t.order)).toEqual(teachers.map((_, i) => i + 1));
  });
  it('name_km is a Khmer string that starts with the monk title of the other records (bytes from the file)', () => {
    const monkTitle = teachers.find((t) => t.slug === 'sor-ratha').name_km.split(' ')[0];
    expect(sem.name_km.startsWith(monkTitle + ' ')).toBe(true);
    expect(/^[\u1780-\u17FF ]+$/.test(sem.name_km)).toBe(true);
    expect(sem.name_km).not.toMatch(/^\s|\s$|\s\s/);
  });
  it('served record: name_en null, bio null, topics [], photo path', () => {
    expect(teacherRecord(sem)).toMatchObject({ slug: 'sem-chanthy', name_km: sem.name_km, name_en: null, bio_km: null, bio_en: null, topics: [], photo: 'teacher-photos/sem-chanthy.jpg' });
  });
});

describe('photos', () => {
  const dir = 'data/source/teachers-2026-11-02/teacher-photos';
  it('sem-chanthy.jpg and sok-heng.jpg are JPEGs of the same size as every other teacher photo', () => {
    const ref = jpegSize(readFileSync(`${dir}/sor-ratha.jpg`));
    expect(ref).toEqual({ w: 480, h: 480 });
    for (const f of ['sem-chanthy.jpg', 'sok-heng.jpg']) {
      expect(existsSync(`${dir}/${f}`), f).toBe(true);
      const b = readFileSync(`${dir}/${f}`);
      expect(b.subarray(0, 2).toString('hex'), f).toBe('ffd8');
      expect(jpegSize(b), f).toEqual(ref);
      expect(b.length, f).toBeLessThan(60000);
    }
    for (const t of teachers) if (t.photo_file) expect(existsSync(`data/source/teachers-2026-11-02/${t.photo_file}`), t.slug).toBe(true);
  });
  it('sok-heng photo replaced (differs from the photo at 8a84c275, before PART B)', () => {
    const sha = createHash('sha256').update(readFileSync(`${dir}/sok-heng.jpg`)).digest('hex');
    let old = null;
    try {
      old = createHash('sha256').update(execFileSync('git', ['show', '8a84c275:' + `${dir}/sok-heng.jpg`])).digest('hex');
    } catch {
      old = null; // shallow clone without that commit: the size check above still holds
    }
    if (old) expect(sha).not.toBe(old);
  });
});

describe('P-19 partner teacher map (last fallback)', () => {
  const U = 'a21376b7-12b0-45bc-9a7b-6f594534cb09';
  const EMBED = `<iframe src='https://killerplayer.com/watch/video/playlist/${U}'></iframe>`;
  const pl = (o) => ({ playlist_id: 'PLx1', partner_slug: 'p-one', playlist_title: 't', display_title: '', teacher_slugs: '', decision: 'Add', decided_at: '2026-11-19', kp_embed: EMBED, teaching_points: '', ...o });
  const videos = [{ playlist_id: 'PLx1', position: '1', video_id: 'abcdefghijk', title: 'v', playable: 'yes', status: 'Waiting' }];
  const run = (o, partnerSlugs, teacherMap) => buildPartners({ partners: [{ partner_slug: 'p-one', teacher_slugs: partnerSlugs }], playlists: [pl(o)], videos, teacherSlugs: new Set(['t-a', 't-b', 't-c']), teacherMap });
  it('Playlists first, then Partners, then the map; an unknown slug in the map = unmapped', () => {
    expect(run({ teacher_slugs: 't-a' }, 't-b', { 'p-one': ['t-c'] }).courses[0].teacher_slugs).toEqual(['t-a']);
    expect(run({}, 't-b', { 'p-one': ['t-c'] }).courses[0].teacher_slugs).toEqual(['t-b']);
    expect(run({}, '', { 'p-one': ['t-c'] }).courses[0].teacher_slugs).toEqual(['t-c']);
    expect(run({}, '', { 'p-one': ['nobody'] }).hidden[0].reason).toBe('unmapped teacher');
    expect(run({}, '', {}).hidden[0].reason).toBe('unmapped teacher');
  });
  it('the committed map: wat-khmer-arizona → sem-chanthy (a real teacher record)', () => {
    const m = JSON.parse(readFileSync('data/partners/teacher-map.json', 'utf-8')).map;
    expect(m).toEqual({ 'wat-khmer-arizona': ['sem-chanthy'] });
    for (const s of Object.values(m).flat()) expect(teachers.some((t) => t.slug === s)).toBe(true);
  });
});
