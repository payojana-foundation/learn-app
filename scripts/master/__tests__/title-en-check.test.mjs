import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { titleCandidates, rowsFor, COLUMNS } from '../title-en-check.mjs';
import { parseCsvObjects } from '../csv.mjs';

// Placeholder titles and ids only; the real-file checks read the committed CSV.
const id = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${id(s)}/view`;
const old = (en, km, lessons) => ({ titleEn: en, titleKm: km, teacher: 't', lessons: lessons.map((s, i) => ({ num: i + 1, titleKm: 'x', audioEmbedSrc: url(s), videoPreviewSrc: '' })) });
const lrow = (course_id, link) => ({ course_id, mp3_link: link, mp4_link: '', minicourse_link: '', original_video_link: '', youtube_link: '', acast_embed: '', acast_episode_id: '' });
const crow = (course_id, t) => ({ course_id, course_title_km: t });

describe('title candidates', () => {
  const web = [old('English one', 'old title one', ['A', 'B']), { titleEn: 'same', titleKm: 'same', lessons: [] }, old('English two', 'zzz', ['Q'])];
  const lessons = [lrow('c010', url('A')), lrow('c010', url('B')), lrow('c011', url('B')), lrow('c012', '')];
  const courses = [crow('c010', '1-old title one'), crow('c011', 'other'), crow('c012', 'unrelated')];
  const items = titleCandidates(web, lessons, courses);
  it('only courses whose English title differs from the Khmer one', () => {
    expect(items.map((i) => i.old_title_en)).toEqual(['English one', 'English two']);
    expect(items[0].old_id).toBe('c001');
  });
  it('media votes split when a recording sits in several master courses; title match ranks first', () => {
    expect(items[0].candidates).toEqual([
      { course_id: 'c010', votes: 1.5, title_match: true },
      { course_id: 'c011', votes: 0.5, title_match: false },
    ]);
  });
  it('an old title without any candidate still gets a row', () => {
    expect(items[1].candidates).toEqual([]);
    const rows = rowsFor(items, courses);
    const r = rows.find((x) => x.old_title_en === 'English two');
    expect(r.candidate_course_id).toBe('');
    expect(r.note).toMatch(/no candidate/);
  });
  it('the Khmer course title is copied exactly', () => {
    const odd = ' \u1780\u200B"x",y ';
    const rows = rowsFor(titleCandidates([old('E', 'k', ['A'])], [lrow('c9', url('A'))], [crow('c9', odd)]), [crow('c9', odd)]);
    expect(rows[0].course_title_km).toBe(odd);
  });
});

describe('the committed CSV', () => {
  const text = readFileSync('docs/team/title-en-check.csv', 'utf-8');
  const rows = parseCsvObjects(text);
  const web = JSON.parse(readFileSync('data/source/website-courses-2026-09-28.json', 'utf-8')).c;
  const withEn = web.filter((c) => c.titleEn && c.titleEn !== c.titleKm);
  it('has the four columns and covers every old English title', () => {
    expect(text.split('\n')[0]).toBe(COLUMNS.join(','));
    expect(new Set(rows.map((r) => r.old_title_en))).toEqual(new Set(withEn.map((c) => c.titleEn)));
    expect(withEn.length).toBe(22);
  });
  it('every candidate course title equals the master export byte for byte', () => {
    const courses = new Map(parseCsvObjects(readFileSync('data/master/courses.csv', 'utf-8')).map((c) => [c.course_id, c.course_title_km]));
    for (const r of rows) if (r.candidate_course_id) expect(r.course_title_km).toBe(courses.get(r.candidate_course_id));
  });
});
