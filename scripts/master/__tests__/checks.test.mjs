/** PART 1 — public/ops/checks.json (placeholders only). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checksJson, failedMap, audioDetail, fmt, SCHEMA_VERSION } from '../checks.mjs';
import { readTab, tabGid } from '../sync.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const row = (o) => ({ row_key: '', lesson_id: '', course_id: 'c900', course_title_km: 'row course title', lesson_title: 'title', lesson_code: '', source_type: 'mp3', mp3_link: '', mp4_link: '', minicourse_link: '', check_decision: '', ...o });
const rows = [
  row({ row_key: 'M00001', lesson_code: 'CODE-1', lesson_title: 'placeholder one', mp3_link: url('A1'), mp4_link: url('V1') }),
  row({ row_key: 'M00002', lesson_code: 'CODE-2', mp3_link: url('A2'), check_decision: 'hold' }),
  row({ row_key: 'M00003', lesson_code: 'CODE-3', mp3_link: url('A3') }),
  row({ row_key: 'M00004', lesson_code: 'CODE-4', mp3_link: url('A1') }), // same source as M00001: reported once
];
const sha = (c) => c.repeat(64);
const manifest = [
  { drive_file_id: DID('A1'), key: 'audio/aaaaaaaaaaaaaaaa-a64.mp3', duration_s: 723, sha256: sha('a') },
  { drive_file_id: DID('A2'), key: 'audio/bbbbbbbbbbbbbbbb-a64.mp3', duration_s: 3000, sha256: sha('b') },
];
const precheck = {
  measured: { [DID('A1')]: { drive_s: 2710 }, [DID('A2')]: { tail_s: 119.6 } },
  results: { flagged: [
    { id: DID('A1'), reasons: ['duration 12:03 differs 73.3 % from the Drive source (45:10)'] },
    { id: DID('A2'), reasons: ['silence 120 s in the last 2 min'] },
  ] },
};
const videoManifest = [{ kind: 'video', drive_file_id: DID('V1'), key: 'video/cccccccccccccccc-480p.mp4', duration_s: 120, src_duration_s: 120 }];
const videoPrecheck = { results: { flagged: [{ id: DID('V1'), key: 'video/cccccccccccccccc-480p.mp4', reasons: ['duration 120 s is under 5 min'] }] } };
const base = {
  lessonRows: rows,
  sheetRows: new Map([['M00001', 2], ['M00002', 3], ['M00003', 4], ['M00004', 5]]),
  gid: 123,
  courseRows: [{ course_id: 'c900', course_title_km: 'course tab title' }],
  wanted: new Map(rows.map((r) => [r.row_key, { lesson_id: r.lesson_code }])),
  manifest, videoManifest, precheck, videoPrecheck,
  failed: new Map([[DID('A3'), 'conversion failed 2 times (course-autorun)']]),
  now: '2026-01-02T00:00:00.000Z',
};

describe('checks.json', () => {
  const out = checksJson(base);
  it('schema and one item per row/media/reason; a shared source counts once', () => {
    expect(out.schema_version).toBe(SCHEMA_VERSION);
    expect(out.generated_at).toBe(base.now);
    expect(out.items.map((i) => [i.row_key, i.media_type, i.reason])).toEqual([
      ['M00001', 'audio', 'duration differs > 2 % from the Drive source'],
      // PART 6 (16 Nov): every row of c900 is blocked (flagged / failed), none approved or waiting
      ['M00001', 'audio', 'no approved lesson'],
      ['M00001', 'video', 'duration under 5 min'],
      ['M00002', 'audio', 'silence > 60 s in the last 2 min'],
      ['M00003', 'audio', 'conversion failed'],
    ]);
  });
  it('fields: titles byte-exact, detail measured vs expected, sheet row + gid, play url, decision', () => {
    const [a, , v, s, f] = out.items;
    expect(a).toEqual({
      row_key: 'M00001', lesson_id: 'CODE-1', course_id: 'c900', course_title_km: 'course tab title', lesson_title: 'placeholder one',
      media_type: 'audio', reason: 'duration differs > 2 % from the Drive source', detail: 'duration 12:03 vs 45:10',
      first_flagged_at: base.now, sheet_row: 2, sheet_gid: 123, play_url: 'https://media.84000.digital/audio/aaaaaaaaaaaaaaaa-a64.mp3', check_decision: '',
    });
    expect(v.detail).toBe('duration 2:00 vs at least 5:00');
    expect(v.play_url).toBe('https://media.84000.digital/video/cccccccccccccccc-480p.mp4');
    expect(s).toMatchObject({ detail: 'silence 120 s vs at most 60 s', check_decision: 'hold', sheet_row: 3 });
    expect(f).toMatchObject({ detail: 'conversion failed 2 times (course-autorun)', play_url: null });
  });
  it('first_flagged_at is kept from the previous file, new items get now', () => {
    const again = checksJson({ ...base, now: '2026-02-01T00:00:00.000Z', prev: out });
    expect(again.items.every((i) => i.first_flagged_at === base.now)).toBe(true);
    const fresh = checksJson({ ...base, now: 'T2', prev: { items: [] } });
    expect(fresh.items.every((i) => i.first_flagged_at === 'T2')).toBe(true);
  });
  it('a converted id is no longer "conversion failed"', () => {
    const o = checksJson({ ...base, manifest: [...manifest, { drive_file_id: DID('A3'), key: 'audio/dddddddddddddddd-a64.mp3' }] });
    expect(o.items.some((i) => i.reason === 'conversion failed')).toBe(false);
  });
  it('no sheet id and no sheet URL anywhere in the file', () => {
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/docs\.google\.com|spreadsheets|sheet_id/);
  });
  it('the committed public/ops/checks.json (when present) carries no sheet id or URL', () => {
    let text = '';
    try { text = readFileSync('public/ops/checks.json', 'utf-8'); } catch { return; }
    expect(text).not.toMatch(/docs\.google\.com|spreadsheets\/d\/|12MOXAOH/);
    expect(JSON.parse(text).schema_version).toBe(1);
  });
});

describe('helpers', () => {
  it('failedMap: failed-review reasons, else autorun attempts', () => {
    const m = failedMap('drive_file_id,course_id,reason\nX1,c900,too quiet after 5 encodes\nX2,c900\n', { attempts: { X3: 2, X4: 1 } });
    expect([...m]).toEqual([['X1', 'too quiet after 5 encodes'], ['X2', 'conversion failed (reason not recorded)'], ['X3', 'conversion failed 2 times (course-autorun)']]);
  });
  it('fmt and audio detail', () => {
    expect(fmt(3661)).toBe('1:01:01');
    expect(audioDetail('duration under 5 min', { duration_s: 200 })).toBe('duration 3:20 vs at least 5:00');
    expect(audioDetail('same audio (sha256) as another lesson', {}, {}, ['CODE-9'])).toBe('same file as CODE-9');
  });
  it('tabGid reads the Lessons gid from sheet metadata (fake API); a failure is null', async () => {
    const fetchFn = async (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(u.includes('?fields=sheets') ? { sheets: [{ properties: { sheetId: 0, title: 'Courses' } }, { properties: { sheetId: 77, title: 'Lessons' } }] } : { values: [] }) });
    expect(await tabGid({ sheetId: 'S', token: 't', tab: 'Lessons', fetchFn })).toBe(77);
    expect(await tabGid({ sheetId: 'S', token: 't', tab: 'Lessons', fetchFn: async () => ({ ok: false, status: 500, text: async () => 'x' }) })).toBe(null);
    void readTab;
  });
});

describe('master-sync workflow commits checks.json with status.json', () => {
  const wf = readFileSync('.github/workflows/master-sync.yml', 'utf-8');
  it('git add of checks.json, in the artifact too', () => {
    expect(wf).toContain('git add public/ops/checks.json');
    expect(wf).toMatch(/public\/ops\/status\.json\n\s+public\/ops\/checks\.json/);
  });
});
