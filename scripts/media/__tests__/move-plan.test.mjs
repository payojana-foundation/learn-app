import { describe, it, expect } from 'vitest';
import {
  buildPlan,
  plannedKey,
  countByKind,
  countByTeacher,
  uniqueDriveIds,
  toCsv,
  pilotQueueCsv,
  PILOT_TEACHER_SLUG,
  PILOT_TITLE,
} from '../move-plan.mjs';

const drive = (id) => `https://drive.google.com/file/d/${id}/preview`;
const acast = 'https://embed.acast.com/x/y';
const youtube = 'https://www.youtube.com/embed/abc';

// Fixture only — placeholder titles, never real course/lesson text.
const fixture = [
  {
    titleKm: 'course-one',
    teacher: 'T-One',
    teacherSlug: 'teacher-one',
    lessons: [
      { num: 1, titleKm: 'l1', audioEmbedSrc: '', videoPreviewSrc: drive('DID1') }, // drive-video
      { num: 2, titleKm: 'l2', audioEmbedSrc: acast, videoPreviewSrc: '' }, // acast
      { num: 3, titleKm: 'l3', audioEmbedSrc: '', videoPreviewSrc: youtube }, // youtube
      { num: 4, titleKm: 'l4', audioEmbedSrc: drive('DID2'), videoPreviewSrc: youtube }, // two rows
    ],
  },
  {
    // The pilot, matched by slug + exact title (copied from the data, not retyped by hand here —
    // this is a FIXTURE placeholder that happens to equal the constant).
    titleKm: PILOT_TITLE,
    teacher: 'Pilot Teacher',
    teacherSlug: PILOT_TEACHER_SLUG,
    lessons: [
      { num: 1, titleKm: 'p1', audioEmbedSrc: '', videoPreviewSrc: youtube }, // no drive
      { num: 2, titleKm: 'p2', audioEmbedSrc: drive('PDID1'), videoPreviewSrc: '' }, // drive
      { num: 3, titleKm: 'p3', audioEmbedSrc: acast, videoPreviewSrc: '' }, // no drive
    ],
  },
];

describe('plannedKey', () => {
  it('uses the real pipeline convention for a Drive id', () => {
    expect(plannedKey('ABC')).toBe('audio/ABC-a64.mp3');
  });
  it('is empty when there is no Drive id', () => {
    expect(plannedKey('')).toBe('');
    expect(plannedKey(null)).toBe('');
  });
});

describe('buildPlan rows', () => {
  const { rows } = buildPlan(fixture);

  it('emits one row per lesson-field with media (a two-media lesson → two rows)', () => {
    // course-one: 1 (drive-video) + 1 (acast) + 1 (youtube) + 2 (drive-audio + youtube) = 5
    // pilot:      1 (youtube) + 1 (drive-audio) + 1 (acast) = 3
    expect(rows.length).toBe(8);
  });

  it('classifies drive audio vs video by the source field', () => {
    const c1l1 = rows.find((r) => r.course_id === 'c001' && r.lesson_id === 'c001-l001');
    expect(c1l1.kind).toBe('drive-video');
    expect(c1l1.drive_file_id).toBe('DID1');
    expect(c1l1.planned_key).toBe('audio/DID1-a64.mp3');
    expect(c1l1.status).toBe('ready');

    const c1l4audio = rows.find((r) => r.lesson_id === 'c001-l004' && r.kind === 'drive-audio');
    expect(c1l4audio.drive_file_id).toBe('DID2');
  });

  it('marks acast/youtube rows needs-original with no key', () => {
    const ac = rows.find((r) => r.kind === 'acast');
    expect(ac.status).toBe('needs-original');
    expect(ac.drive_file_id).toBe('');
    expect(ac.planned_key).toBe('');
    const yt = rows.find((r) => r.kind === 'youtube');
    expect(yt.status).toBe('needs-original');
  });

  it('assigns course ids by source order', () => {
    expect(new Set(rows.map((r) => r.course_id))).toEqual(new Set(['c001', 'c002']));
  });
});

describe('counts', () => {
  const { rows } = buildPlan(fixture);
  it('byKind', () => {
    // drive-audio = c001-l004 (DID2) + pilot c002-l002 (PDID1) = 2
    expect(countByKind(rows)).toEqual({ 'drive-audio': 2, 'drive-video': 1, acast: 2, youtube: 3 });
  });
  it('byTeacher totals', () => {
    const t = countByTeacher(rows);
    expect(t['teacher-one'].total).toBe(5);
    expect(t['yon-yi'].total).toBe(3);
  });
  it('uniqueDriveIds dedupes', () => {
    expect([...uniqueDriveIds(rows)].sort()).toEqual(['DID1', 'DID2', 'PDID1']);
  });
});

describe('pilot', () => {
  const { pilot } = buildPlan(fixture);
  it('is found by slug + exact title', () => {
    expect(pilot.found).toBe(true);
    expect(pilot.course_id).toBe('c002');
    expect(pilot.lessonCount).toBe(3);
  });
  it('lists Drive ids in lesson order and the lessons with no Drive id', () => {
    expect(pilot.driveIds).toEqual(['PDID1']);
    expect(pilot.noDriveLessons).toEqual(['c002-l001', 'c002-l003']);
  });
  it('pilotQueueCsv is header + ids, one per line', () => {
    expect(pilotQueueCsv(pilot)).toBe('drive_file_id\nPDID1\n');
  });
});

describe('toCsv', () => {
  it('has the fixed header and a line per row', () => {
    const { rows } = buildPlan(fixture);
    const csv = toCsv(rows);
    expect(csv.split('\n')[0]).toBe(
      'course_id,lesson_id,teacher,kind,drive_file_id,planned_key,status'
    );
    expect(csv.trimEnd().split('\n').length).toBe(rows.length + 1);
  });
});
