import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeSystem, diffTab, toRanges, statusJson, readTab, writeRanges, checkHeader, sourceIdOf, audioStatus,
  LESSON_SYNC_COLUMNS, COURSE_SYNC_COLUMNS, HeaderMismatchError, BATCH_RANGES,
} from '../sync.mjs';

// Placeholder ids and strings only.
const columns = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
const LK = columns.columns.map((c) => c.key);
const CK = columns.courses.columns.map((c) => c.key);
const TEAM = new Set([...columns.columns, ...columns.courses.columns].filter((c) => c.owner === 'TEAM').map((c) => c.key));
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const lrow = (o) => ({ ...Object.fromEntries(LK.map((k) => [k, ''])), course_id: 'c001', lesson_title: 'title', source_type: 'mp3', ...o });
const asSheet = (keys, objs) => ({ header: keys, rows: objs.map((o) => keys.map((k) => o[k] ?? '')) });
const man = (id, status) => ({ drive_file_id: DID(id), key: `audio/${id}.mp3`, status });

describe('values', () => {
  it('source id = the source_type link, else mp3 > mp4 > minicourse', () => {
    expect(sourceIdOf(lrow({ source_type: 'minicourse', mp3_link: url('A'), minicourse_link: url('B') }))).toBe(DID('B'));
    expect(sourceIdOf(lrow({ source_type: '', mp4_link: url('C'), minicourse_link: url('D') }))).toBe(DID('C'));
    expect(sourceIdOf(lrow({ source_type: '' }))).toBeNull();
  });
  it('audio_status order', () => {
    const ap = new Set(['a']); const fr = new Set(['f']); const im = new Set(['a', 'f', 'c']);
    expect(['a', 'f', 'c', 'x', null].map((s) => audioStatus(s, ap, fr, im))).toEqual(['approved', 'needs review', 'converted', 'not started', 'not started']);
  });
  it('lesson_id, learn_live, issues, acast from the teacher sheets; lesson_count', () => {
    const rows = [
      lrow({ row_key: 'M1', lesson_code: 'CODE1', mp3_link: url('A'), source_file: 'F', source_tab: 'T', source_row: '3', acast_status: 'posted' }),
      lrow({ row_key: 'M2', mp3_link: url('B'), lesson_title: '' }),
      lrow({ row_key: 'M3', course_id: '', mp3_link: url('C') }),
      lrow({ row_key: 'M4', source_type: '' }),
    ];
    const w = computeSystem(rows, [{ course_id: 'c001', teacher: 'x' }, { course_id: 'c002', teacher: 'pending' }], {
      manifest: [man('A', 'approved'), man('B', 'DRAFT')],
      shownLessonIds: new Set(['c001|CODE1']),
      acastBySource: new Map([['F\tT\t3', { acast_embed: '', acast_episode_id: 'abc' }]]),
    });
    expect(w.lessons.get('M1')).toEqual({ lesson_id: 'CODE1', audio_status: 'approved', learn_live: 'yes', acast_embed: '', acast_episode_id: 'abc', issues: '' });
    expect(w.lessons.get('M2')).toMatchObject({ lesson_id: `d-${DID('B')}`, audio_status: 'converted', learn_live: 'no' });
    expect(w.lessons.get('M2').issues).toBe('no approved media yet; no title');
    expect(w.lessons.get('M3').issues).toBe('hidden tab');
    expect(w.lessons.get('M4')).toMatchObject({ lesson_id: '', audio_status: 'not started' });
    expect(w.lessons.get('M4').issues).toContain('no source, no code');
    expect(w.courses.get('c001')).toEqual({ lesson_count: '3' });
    expect(w.courses.get('c002')).toEqual({ lesson_count: '0' });
  });
  it('acast embed missing when posted with neither embed nor episode id', () => {
    const w = computeSystem([lrow({ row_key: 'M1', mp3_link: url('A'), acast_status: 'posted' })], [], { manifest: [] });
    expect(w.lessons.get('M1').issues).toContain('acast embed missing');
  });
});

describe('diff: only SYSTEM columns, by row_key, never new rows', () => {
  const sheet = asSheet(LK, [
    lrow({ row_key: 'M1', lesson_id: 'old', notes: 'team note', lesson_title: 'team title' }),
    lrow({ row_key: '', lesson_title: 'a row the team added' }),
    lrow({ row_key: 'M2' }), lrow({ row_key: 'M2' }),
    lrow({ row_key: 'M3', audio_status: 'converted' }),
  ]);
  const wanted = new Map([
    ['M1', { lesson_id: 'new', audio_status: '', learn_live: '', acast_embed: '', acast_episode_id: '', issues: '', notes: 'SHOULD NOT', lesson_title: 'SHOULD NOT' }],
    ['M2', { lesson_id: 'x' }],
    ['M3', { lesson_id: '', audio_status: 'converted', learn_live: '', acast_embed: '', acast_episode_id: '', issues: '' }],
    ['M9', { lesson_id: 'not in the sheet' }],
  ]);
  const d = diffTab(sheet, 'row_key', wanted, LESSON_SYNC_COLUMNS);
  it('writes changed SYSTEM cells only; TEAM columns are never compared', () => {
    expect(d.changes.map((c) => [c.key, c.column, c.from, c.to])).toEqual([['M1', 'lesson_id', 'old', 'new']]);
    expect(d.changes.every((c) => LESSON_SYNC_COLUMNS.includes(c.column) && !TEAM.has(c.column))).toBe(true);
  });
  it('reports rows without row_key and duplicate keys, and leaves them alone; a key not in the sheet adds no row', () => {
    expect(d.unkeyed).toEqual([3]);
    expect(d.duplicate).toEqual(['M2']);
    expect(d.changes.some((c) => c.key === 'M2' || c.key === 'M9')).toBe(false);
  });
  it('the sync columns are all SYSTEM in columns.json', () => {
    for (const k of [...LESSON_SYNC_COLUMNS, ...COURSE_SYNC_COLUMNS]) expect(TEAM.has(k)).toBe(false);
  });
});

describe('ranges', () => {
  it('consecutive rows of one column become one range; others stay separate', () => {
    const ch = [{ row: 5, col: 1, to: 'a' }, { row: 6, col: 1, to: 'b' }, { row: 9, col: 1, to: 'c' }, { row: 5, col: 3, to: 'd' }];
    expect(toRanges('Lessons', ch)).toEqual([
      { range: 'Lessons!B5:B6', values: [['a'], ['b']] },
      { range: 'Lessons!B9:B9', values: [['c']] },
      { range: 'Lessons!D5:D5', values: [['d']] },
    ]);
  });
});

describe('status.json', () => {
  it('counts per course and status, live count, totals', () => {
    const rows = [lrow({ row_key: 'M1' }), lrow({ row_key: 'M2' }), lrow({ row_key: 'M3', course_id: 'c002' }), lrow({ row_key: 'M4', course_id: '' })];
    const w = new Map([
      ['M1', { audio_status: 'approved', learn_live: 'yes' }], ['M2', { audio_status: 'converted', learn_live: 'no' }],
      ['M3', { audio_status: 'not started', learn_live: 'no' }], ['M4', { audio_status: 'converted', learn_live: 'no' }],
    ]);
    const s = statusJson(rows, w, 'T');
    expect(s.totals).toEqual({ lessons: 3, live: 1, audio: { 'not started': 1, converted: 1, 'needs review': 0, approved: 1 } });
    expect(s.courses.map((c) => [c.course_id, c.lessons, c.live])).toEqual([['c001', 2, 1], ['c002', 1, 0]]);
    expect(s.as_of).toBe('T');
  });
});

// ── fake Sheets API with a 1000 x 30 grid ─────────────────────────────────────

function fakeSheets(tabs) {
  const grid = { rows: 1000, cols: 30 };
  const writes = [];
  const fetchFn = async (u, init) => {
    const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEET', ''));
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET') {
      const tab = /\/values\/([^?]+)/.exec(p)[1];
      return ok({ values: tabs[tab] });
    }
    if (p === '/values:batchUpdate') {
      const body = JSON.parse(init.body);
      for (const d of body.data) {
        const m = /^(\w+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(d.range);
        const col = [...m[4]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        if (Number(m[5]) > grid.rows || col > grid.cols) return { ok: false, status: 400, text: async () => `Range (${d.range}) exceeds grid limits. Max rows: ${grid.rows}, max columns: ${grid.cols}` };
      }
      writes.push(body);
      return ok({});
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { fetchFn, writes };
}

describe('sheet I/O (fake API, 1000-row grid)', () => {
  const n = 950;
  const objs = Array.from({ length: n }, (_, i) => lrow({ row_key: `M${i + 1}`, lesson_code: `C${i + 1}`, mp3_link: url(`S${i}`) }));
  const values = [LK, ...objs.map((o) => LK.map((k) => o[k]))];
  it('reads a tab, writes only changed SYSTEM cells inside the grid, in chunks', async () => {
    const api = fakeSheets({ Lessons: values });
    const tab = await readTab({ sheetId: 'SHEET', token: 't', tab: 'Lessons', fetchFn: api.fetchFn });
    expect(tab.rows.length).toBe(n);
    checkHeader('Lessons', tab.header, LK);
    const rows = tab.rows.map((r) => Object.fromEntries(LK.map((k, i) => [k, r[i]])));
    const w = computeSystem(rows, [], { manifest: [] });
    const d = diffTab(tab, 'row_key', w.lessons, LESSON_SYNC_COLUMNS);
    const ranges = toRanges('Lessons', d.changes);
    expect(d.changes.length).toBe(n * 4); // lesson_id, audio_status, learn_live and issues were empty
    expect(ranges.length).toBe(4); // one contiguous range per column
    const done = await writeRanges({ sheetId: 'SHEET', token: 't', ranges, fetchFn: api.fetchFn });
    expect(done).toBe(4);
    const written = api.writes.flatMap((b) => b.data.map((x) => x.range));
    const letterOf = (k) => String.fromCharCode(65 + LK.indexOf(k));
    expect(written.every((r) => ['lesson_id', 'audio_status', 'learn_live', 'issues'].some((k) => r.startsWith(`Lessons!${letterOf(k)}`)))).toBe(true);
    expect(api.writes.every((b) => b.valueInputOption === 'RAW')).toBe(true);
  });
  it('a write beyond the grid stops with the count written so far', async () => {
    const api = fakeSheets({});
    const ranges = Array.from({ length: BATCH_RANGES + 1 }, (_, i) => ({ range: `Lessons!B${i + 2}:B${i + 2}`, values: [['x']] }));
    ranges.push({ range: 'Lessons!B1001:B1001', values: [['x']] });
    await expect(writeRanges({ sheetId: 'SHEET', token: 't', ranges, fetchFn: api.fetchFn })).rejects.toThrow(/after 400 of 402 ranges.*exceeds grid limits/);
  });
  it('a header that differs from columns.json is refused before any write', () => {
    expect(() => checkHeader('Lessons', [...LK.slice(1)], LK)).toThrow(HeaderMismatchError);
    expect(() => checkHeader('Courses', CK, CK)).not.toThrow();
  });
});

describe('workflow file', () => {
  const wf = readFileSync('.github/workflows/master-sync.yml', 'utf-8');
  it('dispatch + daily 03:47 UTC, concurrency data-rebuild-main, spreadsheets scope', () => {
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/cron: "47 3 \* \* \*"/);
    expect(wf).toMatch(/group: data-rebuild-main/);
    expect(wf).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(wf).toContain('scripts/master/sync.mjs');
    expect(wf).toContain('git add public/ops/status.json');
  });
});
