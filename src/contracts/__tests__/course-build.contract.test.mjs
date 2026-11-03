import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCourses,
  classifyMedia,
  englishTitle,
  teacherRecord,
  courseId,
  lessonId,
  lessonIdSuffixed,
  extractDriveId,
  isHardFail,
} from '../../../scripts/build-courses.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(join(here, 'fixtures', n), 'utf-8'));
const sourceCourses = load('source-courses.json').c;
const teachers = load('teachers.json');

describe('ids are provisional c###/c###-l###', () => {
  it('pads from source order', () => {
    expect(courseId(0)).toBe('c001');
    expect(courseId(11)).toBe('c012');
    expect(lessonId(0, 4)).toBe('c001-l005');
  });
  it('suffixes a duplicate num by occurrence (b, c) off the first position', () => {
    // First position for num (occ 1) → plain; occ 2 → b; occ 3 → c.
    expect(lessonIdSuffixed(6, 12, 1)).toBe('c007-l013');
    expect(lessonIdSuffixed(6, 12, 2)).toBe('c007-l013b');
    expect(lessonIdSuffixed(6, 12, 3)).toBe('c007-l013c');
  });
});

describe('media classification (P3 kinds)', () => {
  it('maps hosts to kinds and empties to null', () => {
    expect(classifyMedia('https://embed.acast.com/x')).toBe('acast');
    expect(classifyMedia('https://www.youtube.com/embed/a')).toBe('youtube');
    expect(classifyMedia('https://drive.google.com/file/d/ID/preview')).toBe('drive');
    expect(classifyMedia('')).toBeNull();
    expect(classifyMedia(null)).toBeNull();
  });
  it('extracts a Drive id', () => {
    expect(extractDriveId('https://drive.google.com/file/d/DRIVEID123/preview')).toBe('DRIVEID123');
  });
});

describe('english title rule', () => {
  it('nulls the en title when it equals the km title', () => {
    expect(englishTitle('x', 'x')).toBeNull();
    expect(englishTitle('x', 'y')).toBe('y');
    expect(englishTitle('x', '')).toBeNull();
  });
});

describe('teacher display rules', () => {
  it('name_km always; name_en only when show_english_name starts yes; bio only when approved starts yes', () => {
    const [t1, t2] = teachers.map(teacherRecord);
    expect(t1.name_km).toBe('name km one');
    expect(t1.name_en).toBeNull(); // show_english_name = "no …"
    expect(t1.bio_km).toBe('bio km one'); // approved = "yes …"
    expect(t2.name_en).toBe('Teacher Two EN'); // show_english_name = "yes"
    expect(t2.bio_km).toBeNull(); // approved = "Not in our files"
    expect(t2.topics).toEqual(['english', 'abhidhamma']);
  });
});

describe('buildCourses rules', () => {
  const built = buildCourses(sourceCourses, teachers, []);

  it('duplicate lesson num is a WARNING (not a hard fail), keeps both, suffixes the id', () => {
    const dups = built.issues.filter((i) => i.kind === 'duplicate-num');
    expect(dups.length).toBe(2); // both occurrences of num 2 are flagged
    expect(dups.every((d) => isHardFail(d) === false)).toBe(true);
    // c001 has nums 1, 2(empty title), 3(no media), 2(dup). Both num-2 lessons
    // have media and are KEPT; num 3 has no media (hidden). Displayed nums stay
    // byte-for-byte; the second num-2 gets an id suffix.
    const c1 = built.courses.find((c) => c.id === 'c001');
    const nums = c1.lessons.map((l) => l.num).sort();
    expect(nums).toEqual([1, 2, 2]);
    const ids = c1.lessons.map((l) => l.id);
    expect(ids).toContain('c001-l002'); // first num-2 (first position)
    expect(ids).toContain('c001-l002b'); // second num-2 → suffix b
    expect(ids).toContain('c001-l001');
  });

  it('the duplicate-num issue carries the course title, num, and both lesson titles', () => {
    const d = built.issues.find((i) => i.kind === 'duplicate-num');
    expect(d.detail).toContain('num 2');
    expect(d.detail).toContain('«'); // both lesson titles quoted
  });

  it('keeps an empty title as "no title" and reports it', () => {
    expect(built.issues.some((i) => i.kind === 'empty_title')).toBe(true);
    const c1 = built.courses.find((c) => c.id === 'c001');
    // The empty-title lesson is the FIRST num-2 (id c001-l002).
    const l = c1.lessons.find((x) => x.id === 'c001-l002');
    expect(l.title_km).toBe('no title');
  });

  it('hides a lesson with no media and reports it', () => {
    expect(built.issues.some((i) => i.kind === 'no_media')).toBe(true);
    const c1 = built.courses.find((c) => c.id === 'c001');
    expect(c1.lessons.some((l) => l.num === 3)).toBe(false);
  });

  it('flags an unknown teacher slug as a hard fail', () => {
    const bad = built.issues.find((i) => i.kind === 'unknown_teacher');
    expect(bad).toBeTruthy();
    expect(isHardFail(bad)).toBe(true);
  });

  it('marks ids and catalog provisional', () => {
    expect(built.catalog.provisional).toBe(true);
    expect(built.courses.every((c) => c.provisional === true)).toBe(true);
    expect(built.catalog.courses[0].id).toBe('c001');
  });

  it('nulls title_en when equal to title_km', () => {
    const c2 = built.catalog.courses.find((c) => c.id === 'c002');
    expect(c2.title_en).toBeNull();
  });
});

// P-19 (Q4, bulk-02) — course-level all-or-nothing r2. A course switches to r2
// ONLY when EVERY Drive-backed lesson has an approved (non-DRAFT) manifest
// entry. `src` stays the BARE R2 key (P-12: the player builds the URL); the r2
// media carries the real `duration_s` from the manifest. DRAFT entries never
// count.
describe('P-19 course-level all-or-nothing r2', () => {
  it('flips a course to r2 when ALL its Drive lessons are approved; src = bare key; carries duration_s', () => {
    // c002 has a single Drive lesson (DRIVEID123). Approve it → the course is r2.
    const manifest = [
      { drive_file_id: 'DRIVEID123', key: 'audio/DRIVEID123-a64.mp3', status: 'approved', bytes: 1, duration_s: 1234, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c2 = built.courses.find((c) => c.id === 'c002');
    expect(c2.lessons[0].media).toEqual([{ kind: 'r2', src: 'audio/DRIVEID123-a64.mp3', duration_s: 1234 }]);
    expect(built.catalog.courses.find((c) => c.id === 'c002').media_kinds).toEqual(['r2']);
  });

  it('a DRAFT entry does NOT count — the course stays drive', () => {
    const manifest = [
      { drive_file_id: 'DRIVEID123', key: 'audio/DRIVEID123-a64.mp3', status: 'DRAFT – needs reviewer approval', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c2 = built.courses.find((c) => c.id === 'c002');
    expect(c2.lessons[0].media[0].kind).toBe('drive');
  });

  it('a REJECTED entry does NOT count — the course stays drive (R4 reviewer decision)', () => {
    // R4 (bulk-03) lets a reviewer mark a file `rejected`; it is kept in the
    // manifest for the audit trail but must never play. Only an explicitly
    // `approved` status flips a lesson to r2.
    const manifest = [
      { drive_file_id: 'DRIVEID123', key: 'audio/DRIVEID123-a64.mp3', status: 'rejected', reviewer: 'R', reviewed_at: '2026-10-27', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c2 = built.courses.find((c) => c.id === 'c002');
    expect(c2.lessons[0].media[0].kind).toBe('drive');
  });

  it('NO mixed courses: if only SOME Drive lessons are approved, the whole course stays drive', () => {
    // c003 has two Drive lessons (DRIVEA, DRIVEB). Approve only one.
    const manifest = [
      { drive_file_id: 'DRIVEA', key: 'audio/DRIVEA-a64.mp3', status: 'approved', bytes: 1, duration_s: 10, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c3 = built.courses.find((c) => c.id === 'c003');
    expect(c3.lessons.every((l) => l.media.every((m) => m.kind === 'drive'))).toBe(true);
    expect(built.catalog.courses.find((c) => c.id === 'c003').media_kinds).toEqual(['drive']);
  });

  it('flips the whole course to r2 only when BOTH Drive lessons are approved', () => {
    const manifest = [
      { drive_file_id: 'DRIVEA', key: 'audio/DRIVEA-a64.mp3', status: 'approved', bytes: 1, duration_s: 10, sha256: 'a'.repeat(64) },
      { drive_file_id: 'DRIVEB', key: 'audio/DRIVEB-a64.mp3', status: 'approved', bytes: 1, duration_s: 20, sha256: 'b'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c3 = built.courses.find((c) => c.id === 'c003');
    expect(c3.lessons.map((l) => l.media[0])).toEqual([
      { kind: 'r2', src: 'audio/DRIVEA-a64.mp3', duration_s: 10 },
      { kind: 'r2', src: 'audio/DRIVEB-a64.mp3', duration_s: 20 },
    ]);
    expect(built.catalog.courses.find((c) => c.id === 'c003').media_kinds).toEqual(['r2']);
  });
});

// Job B v2 prep — lesson-media-overrides link an acast/youtube lesson to its
// canonical drive_file_id so the course can switch to r2 when all are approved.
describe('lesson-media-overrides (Job B v2 prep)', () => {
  const overrides = {
    courses: [
      { title_km: ' course A km', teacher_slug: 'teacher-one', lessons: { 1: 'DID1', 2: 'DID2' } },
    ],
  };
  const manifest = [
    { drive_file_id: 'DID1', source_md5: '1'.repeat(32), key: 'audio/1111111111111111-a64.mp3', status: 'approved', bytes: 1, duration_s: 11, sha256: 'a'.repeat(64) },
    { drive_file_id: 'DID2', source_md5: '2'.repeat(32), key: 'audio/2222222222222222-a64.mp3', status: 'approved', bytes: 1, duration_s: 22, sha256: 'b'.repeat(64) },
  ];

  it('flips the override course to r2: an acast lesson 1 → r2 with the linked key + duration', () => {
    const built = buildCourses(sourceCourses, teachers, manifest, [], overrides);
    const c1 = built.courses.find((c) => c.id === 'c001');
    expect(c1.lessons.find((l) => l.num === 1).media).toEqual([{ kind: 'r2', src: 'audio/1111111111111111-a64.mp3', duration_s: 11 }]);
    expect(built.catalog.courses.find((c) => c.id === 'c001').media_kinds).toEqual(['r2']);
  });

  it('a DRAFT override entry does NOT flip the course (stays acast/youtube)', () => {
    const draft = manifest.map((e) => ({ ...e, status: 'DRAFT – needs reviewer approval' }));
    const built = buildCourses(sourceCourses, teachers, draft, [], overrides);
    const c1 = built.courses.find((c) => c.id === 'c001');
    expect(c1.lessons.find((l) => l.num === 1).media[0].kind).toBe('acast');
  });
});

// B5 (Job B v2) — key/source integrity checks over the manifest.
describe('B5 manifest integrity', () => {
  it('one drive_file_id resolving to TWO keys is a hard-fail issue', () => {
    const manifest = [
      { drive_file_id: 'DUPKEY', key: 'audio/aaaa0000bbbb1111-a64.mp3', status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
      { drive_file_id: 'DUPKEY', key: 'audio/aaaa0000bbbb1111-a64-v2.mp3', status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const bad = built.issues.find((i) => i.kind === 'lesson_two_keys');
    expect(bad).toBeTruthy();
    expect(isHardFail(bad)).toBe(true);
  });

  it('two drive ids sharing one source_md5 is a WARNING (not hard-fail)', () => {
    const md5 = '0123456789abcdef0123456789abcdef';
    const manifest = [
      { drive_file_id: 'X1', source_md5: md5, key: 'audio/0123456789abcdef-a64.mp3', status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
      { drive_file_id: 'X2', source_md5: md5, key: 'audio/0123456789abcdef-a64.mp3', status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const warn = built.issues.find((i) => i.kind === 'shared_source');
    expect(warn).toBeTruthy();
    expect(isHardFail(warn)).toBe(false);
  });

  it('the shared-source warning is silenced when its key is listed', () => {
    const md5 = '0123456789abcdef0123456789abcdef';
    const key = 'audio/0123456789abcdef-a64.mp3';
    const manifest = [
      { drive_file_id: 'X1', source_md5: md5, key, status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
      { drive_file_id: 'X2', source_md5: md5, key, status: 'DRAFT', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest, [key]);
    expect(built.issues.find((i) => i.kind === 'shared_source')).toBeUndefined();
  });
});
