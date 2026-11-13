import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { candidates, shaCounts, parseSilence, evaluate, results, renderFlagged, reasonKind, MIN_S, MAX_S } from '../precheck.mjs';

// Placeholder ids and titles only.
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (o) => ({ course_id: 'c001', lesson_id: 'L', lesson_no: '1', lesson_title: 'title', source_type: 'mp3', mp3_link: '', mp4_link: '', minicourse_link: '', ...o });
const entry = (s, o = {}) => ({ drive_file_id: DID(s), key: `audio/${s}-a64.mp3`, duration_s: 1800, sha256: `sha-${s}`, status: 'DRAFT – needs reviewer approval', ...o });
const allMeasured = { drive_s: 1800, head_s: 0, tail_s: 0 };

describe('candidates', () => {
  const lessons = [
    row({ lesson_id: 'A', mp3_link: url('A') }),
    row({ lesson_id: 'B', mp3_link: url('B') }), // approved: out
    row({ lesson_id: 'C', mp3_link: url('C') }), // no manifest entry: out
    row({ lesson_id: 'A2', mp3_link: url('A') }), // shared source: counted once
    row({ course_id: '', lesson_id: 'H', mp3_link: url('H') }), // hidden tab: out
  ];
  const manifest = [entry('A'), entry('B', { status: 'approved' }), entry('H')];
  const c = candidates(lessons, [{ course_id: 'c001', course_title_km: 'course title' }], manifest);
  it('converted, not approved, with a course; one per source', () => {
    expect(c.map((x) => x.lesson_id)).toEqual(['A']);
    expect(c[0]).toMatchObject({ id: DID('A'), course_title: 'course title', url: 'https://media.84000.digital/audio/A-a64.mp3', duration_s: 1800 });
  });
});

describe('silence parsing', () => {
  it('closed spans, the longest wins', () => {
    const err = '[silencedetect @ 0x1] silence_start: 3.2\n[silencedetect @ 0x1] silence_end: 70.4 | silence_duration: 67.2\nsilence_start: 90\nsilence_end: 95 | silence_duration: 5';
    expect(parseSilence(err, 120)).toBeCloseTo(67.2);
  });
  it('a silence still open at the end of the segment lasts to the segment end', () => {
    expect(parseSilence('silence_start: 50.5', 120)).toBeCloseTo(69.5);
  });
  it('no silence = 0', () => {
    expect(parseSilence('size=N/A time=00:02:00', 120)).toBe(0);
  });
});

describe('evaluate', () => {
  const c = (o) => ({ id: 'x', duration_s: 1800, sha256: 'u', ...o });
  it('passes when every check ran and none flagged', () => {
    expect(evaluate(c(), allMeasured, new Map([['u', 1]]))).toEqual({ flags: [], pending: [] });
  });
  it('duration bounds', () => {
    expect(evaluate(c({ duration_s: MIN_S - 1 }), allMeasured).flags[0]).toMatch(/under 5 min/);
    expect(evaluate(c({ duration_s: MIN_S }), { ...allMeasured, drive_s: MIN_S }).flags).toEqual([]);
    expect(evaluate(c({ duration_s: MAX_S + 1 }), { ...allMeasured, drive_s: MAX_S + 1 }).flags[0]).toMatch(/over 4 h/);
  });
  it('drift over 2 % from the Drive source; an unreadable source is a flag', () => {
    expect(evaluate(c(), { ...allMeasured, drive_s: 1800 * 1.019 }).flags).toEqual([]);
    expect(evaluate(c(), { ...allMeasured, drive_s: 1800 * 1.03 }).flags[0]).toMatch(/differs 2\.9 % from the Drive source/);
    expect(evaluate(c(), { ...allMeasured, drive_s: null }).flags).toEqual(['source duration unknown']);
  });
  it('the same sha256 as another entry', () => {
    expect(evaluate(c(), allMeasured, new Map([['u', 2]])).flags).toEqual(['same audio (sha256) as another lesson']);
  });
  it('silence over 60 s at the start or the end', () => {
    expect(evaluate(c(), { ...allMeasured, head_s: 61 }).flags).toEqual(['silence 61 s in the first 2 min']);
    expect(evaluate(c(), { ...allMeasured, tail_s: 60 }).flags).toEqual([]);
    expect(evaluate(c(), { ...allMeasured, tail_s: 90 }).flags).toEqual(['silence 90 s in the last 2 min']);
  });
  it('missing measurements are pending, not passing', () => {
    expect(evaluate(c(), {}).pending).toEqual(['source', 'silence']);
    expect(evaluate(c(), { drive_s: 1800, head_s: 0 }).pending).toEqual(['silence']);
  });
});

describe('results and FLAGGED.md', () => {
  const cands = [
    { id: 'p', course_id: 'c001', course_title: 'one', lesson_no: '1', title: 'pass me', url: 'https://media.84000.digital/audio/p.mp3', duration_s: 1800, sha256: 'p' },
    { id: 'f', course_id: 'c001', course_title: 'one', lesson_no: '2', title: 'a|b', url: 'https://media.84000.digital/audio/f.mp3', duration_s: 100, sha256: 'f' },
    { id: 'q', course_id: 'c002', course_title: 'two', lesson_no: '1', title: 'later', url: 'https://media.84000.digital/audio/q.mp3', duration_s: 1800, sha256: 'q' },
  ];
  const res = results(cands, { p: allMeasured, f: { ...allMeasured, drive_s: 100 } }, new Map());
  it('pass / flagged / pending', () => {
    expect(res.pass.map((x) => x.id)).toEqual(['p']);
    expect(res.pass[0].sha256).toBe('p');
    expect(res.flagged.map((x) => x.id)).toEqual(['f']);
    expect(res.pending.map((x) => x.id)).toEqual(['q']);
  });
  it('one row per flagged lesson with the title, reason and a tappable play link; per-course counts', () => {
    const md = renderFlagged(cands, res, 'T');
    expect(md).toContain('| c001 | 2 | a\\|b | duration 1:40 is under 5 min | [▶ play](https://media.84000.digital/audio/f.mp3) |');
    expect(md).not.toContain('pass me |');
    expect(md).toContain('| c001 | one | 1 | 1 | 0 |');
    expect(md).toContain('| c002 | two | 0 | 0 | 1 |');
    expect(md).toContain('**1 pass**');
    expect(md).toContain('| duration under 5 min | 1 |');
  });
});

describe('reason kinds', () => {
  it('every reason maps to a fixed category', () => {
    expect(reasonKind('duration 1:40 is under 5 min')).toBe('duration under 5 min');
    expect(reasonKind('silence 61 s in the last 2 min')).toBe('silence > 60 s in the last 2 min');
    expect(reasonKind('duration 30:00 differs 3.0 % from the Drive source (29:00)')).toBe('duration differs > 2 % from the Drive source');
    expect(shaCounts([{ sha256: 'a' }, { sha256: 'a' }, { sha256: 'b' }]).get('a')).toBe(2);
  });
});

describe('workflow file', () => {
  const wf = readFileSync('.github/workflows/approve-check.yml', 'utf-8');
  it('read-only Drive scope, ffmpeg, budget, commits only the two files', () => {
    expect(wf).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(wf).not.toMatch(/auth\/drive(?!\.readonly)/);
    expect(wf).toContain('apt-get install -y ffmpeg');
    expect(wf).toContain('--drive --silence --budget-min');
    expect(wf).toContain('git add data/queues/approve/precheck.json data/queues/approve/FLAGGED.md');
    expect(wf).toMatch(/group: data-rebuild-main/);
  });
});
