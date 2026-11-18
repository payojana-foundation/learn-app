import { describe, it, expect } from 'vitest';
import { liveCounts, heldByReason, issueCounts, scheduledWorkflows } from '../readiness-report.mjs';
import { readFileSync, readdirSync } from 'node:fs';

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

describe('PART 7e scheduled workflows', () => {
  it('cron and after-another-workflow triggers; manual-only workflows are left out', () => {
    const w = scheduledWorkflows([
      { file: 'a.yml', text: 'name: a\n\n# PART 1 — does A. More text.\n\non:\n  schedule:\n    - cron: "5 * * * *"\n' },
      { file: 'b.yml', text: 'name: b\n# B runs after a. Second.\non:\n  workflow_run:\n    workflows: [a, c]\n' },
      { file: 'm.yml', text: 'name: m\n# manual\non:\n  workflow_dispatch: {}\n' },
    ]);
    expect(w).toEqual([
      { name: 'a', file: 'a.yml', when: 'cron `5 * * * *` (UTC)', does: 'does A. More text.' },
      { name: 'b', file: 'b.yml', when: 'after a, c', does: 'B runs after a. Second.' },
    ]);
  });
  it('covers every scheduled workflow in the repo', () => {
    const texts = readdirSync('.github/workflows').filter((x) => x.endsWith('.yml')).map((x) => ({ file: x, text: readFileSync(`.github/workflows/${x}`, 'utf-8') }));
    const crons = texts.filter((t) => /^\s*-\s*cron:/m.test(t.text)).map((t) => t.file);
    const names = scheduledWorkflows(texts).map((w) => w.file);
    for (const f of crons) expect(names).toContain(f);
  });
});
