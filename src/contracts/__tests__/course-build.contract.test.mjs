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

describe('r2 override when a Drive recording is approved on R2', () => {
  it('replaces a drive kind with r2 when the manifest has a non-DRAFT entry', () => {
    const manifest = [
      { drive_file_id: 'DRIVEID123', key: 'audio/DRIVEID123-a64.mp3', status: 'approved', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c2 = built.courses.find((c) => c.id === 'c002');
    expect(c2.lessons[0].media).toEqual([{ kind: 'r2', src: 'audio/DRIVEID123-a64.mp3' }]);
  });

  it('ignores a DRAFT entry (keeps drive)', () => {
    const manifest = [
      { drive_file_id: 'DRIVEID123', key: 'audio/DRIVEID123-a64.mp3', status: 'DRAFT – needs reviewer approval', bytes: 1, duration_s: 1, sha256: 'a'.repeat(64) },
    ];
    const built = buildCourses(sourceCourses, teachers, manifest);
    const c2 = built.courses.find((c) => c.id === 'c002');
    expect(c2.lessons[0].media[0].kind).toBe('drive');
  });
});
