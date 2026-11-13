/**
 * scripts/master/title-en-check.mjs — the old English course titles, for the team to paste
 * into the master sheet's `course_title_en` (bulk 09 gap 10). REPORT ONLY.
 *
 * The old app (website data, 28 Sep) had English titles on some courses; its course ids were
 * positions in that file and are NOT the master ids. A candidate master course is found two
 * ways, both shown so a person can decide:
 *   - media: the lessons of the old course use the same recordings (Drive id, Acast episode
 *     id, YouTube id) as lessons of the master course; `votes` = how many old lessons point
 *     there (a lesson whose recording sits in several master courses splits its vote);
 *   - title: the old Khmer title and the master course title contain one another.
 * Nothing is decided here. Khmer is copied byte for byte from the sources.
 *
 * Output: docs/team/title-en-check.csv with columns
 *   old_title_en, candidate_course_id, course_title_km, note
 * (one row per candidate, best first; an old title without a candidate gets one row with an
 * empty candidate and the note "no candidate").
 *
 * Usage: node scripts/master/title-en-check.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { driveIds } from '../catalogue/sheets-map.mjs';
import { parseCsvObjects, toCsv } from './csv.mjs';

const ytId = (s) => {
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^#]*&)?v=|live\/|shorts\/))([A-Za-z0-9_-]{11})/.exec(String(s || ''));
  return m ? m[1] : null;
};
const acastIds = (s) => (/acast\.com/.test(s || '') ? [...String(s).matchAll(/[0-9a-f]{24}/gi)].map((m) => m[0].toLowerCase()) : []);
const clean = (t) => String(t ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
const stripNo = (t) => clean(t).replace(/^[0-9\u17E0-\u17E9]+-/, '');

/** key -> Set(master course ids), from the master lessons. */
export function masterKeys(lessonRows) {
  const keys = new Map();
  const add = (k, c) => {
    if (!k) return;
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k).add(c);
  };
  for (const r of lessonRows) {
    if (!r.course_id) continue;
    for (const col of ['mp3_link', 'mp4_link', 'minicourse_link', 'original_video_link', 'youtube_link']) {
      for (const id of driveIds(r[col])) add('d:' + id, r.course_id);
      add('y:' + ytId(r[col]), r.course_id);
    }
    if (r.acast_episode_id) add('a:' + r.acast_episode_id.toLowerCase(), r.course_id);
    for (const e of acastIds(r.acast_embed)) add('a:' + e, r.course_id);
  }
  return keys;
}

/**
 * websiteCourses = the old data (`c` array); overrides = data/lesson-media-overrides.json.
 * Returns [{ old_title_en, old_id, old_title_km, candidates: [{ course_id, votes, title_match }] }].
 */
export function titleCandidates(websiteCourses, lessonRows, courseRows, overrides = null) {
  const keys = masterKeys(lessonRows);
  const ovFor = new Map(((overrides && overrides.courses) || []).map((c) => [c.title_km, c.lessons || {}]));
  const out = [];
  websiteCourses.forEach((co, i) => {
    if (!(co.titleEn && co.titleEn !== co.titleKm)) return;
    const votes = new Map();
    for (const l of co.lessons || []) {
      const ks = [];
      const ov = (ovFor.get(co.titleKm) || {})[String(l.num)];
      if (ov) ks.push('d:' + ov);
      for (const s of [l.audioEmbedSrc, l.videoPreviewSrc]) {
        for (const d of driveIds(s)) ks.push('d:' + d);
        const y = ytId(s);
        if (y) ks.push('y:' + y);
        for (const e of acastIds(s)) ks.push('a:' + e);
      }
      const cand = new Set();
      for (const k of ks) if (keys.has(k)) for (const c of keys.get(k)) cand.add(c);
      for (const c of cand) votes.set(c, (votes.get(c) || 0) + 1 / cand.size);
    }
    const old = clean(co.titleKm);
    const titleHits = new Set(
      courseRows.filter((c) => {
        const m = stripNo(c.course_title_km);
        return old && m.length > 3 && (m.includes(old) || old.includes(m));
      }).map((c) => c.course_id)
    );
    const ids = new Set([...votes.keys(), ...titleHits]);
    const candidates = [...ids]
      .map((id) => ({ course_id: id, votes: +(votes.get(id) || 0).toFixed(1), title_match: titleHits.has(id) }))
      .sort((a, b) => Number(b.title_match) - Number(a.title_match) || b.votes - a.votes || a.course_id.localeCompare(b.course_id))
      .slice(0, 5);
    out.push({ old_title_en: co.titleEn, old_id: 'c' + String(i + 1).padStart(3, '0'), old_title_km: co.titleKm, lessons: (co.lessons || []).length, candidates });
  });
  return out;
}

export const COLUMNS = ['old_title_en', 'candidate_course_id', 'course_title_km', 'note'];

export function rowsFor(items, courseRows) {
  const title = new Map(courseRows.map((c) => [c.course_id, c.course_title_km]));
  const rows = [];
  for (const it of items) {
    if (it.candidates.length === 0) {
      rows.push({ old_title_en: it.old_title_en, candidate_course_id: '', course_title_km: '', note: `no candidate (old id ${it.old_id}, ${it.lessons} old lessons)` });
      continue;
    }
    for (const c of it.candidates) {
      const why = [c.title_match ? 'the Khmer titles match' : 'Khmer titles differ', `${c.votes} of ${it.lessons} old lessons use the same recordings`];
      rows.push({ old_title_en: it.old_title_en, candidate_course_id: c.course_id, course_title_km: title.get(c.course_id) ?? '', note: `${why.join('; ')} (old id ${it.old_id})` });
    }
  }
  return rows;
}

function main() {
  const web = JSON.parse(readFileSync('data/source/website-courses-2026-09-28.json', 'utf-8')).c;
  const lessons = parseCsvObjects(readFileSync('data/master/lessons.csv', 'utf-8'));
  const courses = parseCsvObjects(readFileSync('data/master/courses.csv', 'utf-8'));
  const overrides = existsSync('data/lesson-media-overrides.json') ? JSON.parse(readFileSync('data/lesson-media-overrides.json', 'utf-8')) : null;
  const items = titleCandidates(web, lessons, courses, overrides);
  mkdirSync('docs/team', { recursive: true });
  const rows = rowsFor(items, courses);
  writeFileSync('docs/team/title-en-check.csv', toCsv(COLUMNS, rows), 'utf-8');
  console.log(`${items.length} old English titles, ${rows.length} candidate rows, ${items.filter((i) => i.candidates.length === 0).length} without a candidate`);
}

if (process.argv[1] && process.argv[1].endsWith('title-en-check.mjs')) main();
