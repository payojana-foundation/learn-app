/** Bulk 10 P1 — partner sheet export (fake Sheets API; placeholder text only). */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPartners, headerCheck, tableFrom, csvOf, TABS, HeaderContractError } from '../export.mjs';

function fakeSheets(tabs) {
  const calls = [];
  const fetchFn = async (u, init) => {
    calls.push({ url: u, method: init.method });
    const tab = decodeURIComponent(/\/values\/([^?]+)/.exec(u)[1]);
    if (!(tab in tabs)) return { ok: false, status: 400, text: async () => 'Unable to parse range' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ values: tabs[tab] }) };
  };
  return { fetchFn, calls };
}
const SHEET = () => ({
  Partners: [['slug', 'name'], ['p-one', 'Partner, "one"']],
  Playlists: [['playlist_id', 'notes'], ['PL1', 'line1\nline2'], [], ['PL2']],
  Videos: [['video_id', 'title'], ['v1', 'ថ្មី placeholder ']],
  "'Terms (copy)'": [['term_id', 'term_km'], ['t1', 'x']],
  README: [['must not be read']],
});
const CONTRACT = { Partners: ['slug', 'name'], Playlists: ['playlist_id', 'notes'], Videos: ['video_id', 'title'], 'Terms (copy)': ['term_id', 'term_km'] };
const dir = () => mkdtempSync(join(tmpdir(), 'partners-'));

describe('partner export', () => {
  it('writes the four CSVs byte-exact (no trim, quotes doubled, empty rows dropped, short rows padded); README never read', async () => {
    const api = fakeSheets(SHEET());
    const out = dir();
    const r = await exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: out, fetchFn: api.fetchFn });
    expect(r.files.map((f) => [f.file, f.rows])).toEqual([['partners.csv', 1], ['playlists.csv', 2], ['videos.csv', 1], ['terms.csv', 1]]);
    expect(readFileSync(join(out, 'partners.csv'), 'utf-8')).toBe('slug,name\np-one,"Partner, ""one"""\n');
    expect(readFileSync(join(out, 'playlists.csv'), 'utf-8')).toBe('playlist_id,notes\nPL1,"line1\nline2"\nPL2,\n');
    expect(readFileSync(join(out, 'videos.csv'), 'utf-8')).toBe('video_id,title\nv1,ថ្មី placeholder \n');
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(api.calls.some((c) => /README|Example|Meta/.test(decodeURIComponent(c.url)))).toBe(false);
    expect(TABS.map((t) => t.file)).toEqual(['partners.csv', 'playlists.csv', 'videos.csv', 'terms.csv']);
  });
  it('a renamed or missing header fails loudly and writes nothing; a new column is exported and reported', async () => {
    const s = SHEET();
    s.Videos[0] = ['video_id', 'title_renamed'];
    const out = dir();
    await expect(exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: out, fetchFn: fakeSheets(s).fetchFn })).rejects.toThrow(HeaderContractError);
    await expect(exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: out, fetchFn: fakeSheets(s).fetchFn })).rejects.toThrow(/Videos: header renamed or missing: title/);
    expect(existsSync(join(out, 'partners.csv'))).toBe(false);
    const s2 = SHEET();
    s2.Partners = [['slug', 'name', 'extra'], ['p-one', 'n', 'e']];
    const r = await exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: dir(), fetchFn: fakeSheets(s2).fetchFn });
    expect(r.added).toEqual({ Partners: ['extra'] });
  });
  it('no contract: fails unless recording; recording takes the live headers', async () => {
    await expect(exportPartners({ sheetId: 'S', token: 't', contract: null, outDir: dir(), fetchFn: fakeSheets(SHEET()).fetchFn })).rejects.toThrow(/record-contract/);
    const r = await exportPartners({ sheetId: 'S', token: 't', contract: null, record: true, outDir: dir(), fetchFn: fakeSheets(SHEET()).fetchFn });
    expect(r.contract).toEqual(CONTRACT);
  });
  it('a missing tab fails (no partial export); re-run with the same sheet = unchanged', async () => {
    const s = SHEET();
    delete s.Videos;
    await expect(exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: dir(), fetchFn: fakeSheets(s).fetchFn })).rejects.toThrow(/400/);
    const out = dir();
    await exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: out, fetchFn: fakeSheets(SHEET()).fetchFn });
    const again = await exportPartners({ sheetId: 'S', token: 't', contract: CONTRACT, outDir: out, fetchFn: fakeSheets(SHEET()).fetchFn });
    expect(again.changed).toBe(false);
  });
  it('pure helpers', () => {
    expect(headerCheck('T', ['a', 'a', 'b'], ['a', 'c'])).toEqual({ tab: 'T', missing: ['c'], added: ['b'], duplicate: ['a'] });
    expect(csvOf(tableFrom([['h'], [' x ']]))).toBe('h\n x \n');
  });
  it('workflow: daily + dispatch, read-only scope, commits data/partners only, push with retry', () => {
    const y = readFileSync('.github/workflows/partner-export.yml', 'utf-8');
    expect(y).toMatch(/cron: "13 5 \* \* \*"/);
    expect(y).toContain('workflow_dispatch');
    expect(y).toContain('spreadsheets.readonly');
    expect(y).toContain('git add data/partners\n');
    expect(y).toContain('push-with-retry.sh');
    expect(y).not.toMatch(/youtube\.com|killerplayer/i);
  });
});
