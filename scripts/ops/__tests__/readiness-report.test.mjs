import { describe, it, expect } from 'vitest';
import { liveCounts, heldByReason, issueCounts } from '../readiness-report.mjs';

describe('readiness report', () => {
  it('live counts: courses, lessons with audio / video', () => {
    const cat = { courses: [{ id: 'c900', has_video: true }, { id: 'c901' }] };
    const courses = [
      { lessons: [{ media: [{ kind: 'r2' }], video: { src: 'v' } }, { media: [{ kind: 'r2' }] }] },
      { lessons: [{ media: [{ kind: 'r2' }] }] },
    ];
    expect(liveCounts(cat, courses)).toEqual({ courses: 2, coursesWithVideo: 1, lessons: 3, audio: 3, video: 1 });
  });
  it('held by reason, most first; issues by kind', () => {
    expect(heldByReason({ items: [{ media_type: 'audio', reason: 'a' }, { media_type: 'audio', reason: 'a' }, { media_type: 'video', reason: 'b' }] })).toEqual([['audio: a', 2], ['video: b', 1]]);
    expect(issueCounts([{ kind: 'course_hidden', detail: 'no approved lesson' }, { kind: 'empty_title' }, { kind: 'course_hidden', detail: 'no approved lesson' }])).toEqual([['course_hidden: no approved lesson', 2], ['empty_title', 1]]);
  });
});
