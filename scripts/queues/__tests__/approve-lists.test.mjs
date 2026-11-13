import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { renderIndex, renderList, idsLine, mediaUrl } from '../approve-lists.mjs';

// Placeholder titles only. The real-data checks read the committed files.
const item = (n, id) => ({ num: String(n), lesson_id: `L${n}`, drive_file_id: id, minutes: '10.0', I: -18.2, result: 'ok', url: mediaUrl(`audio/${id}-a64.mp3`), title: `t${n}` });
const entry = (cid, n) => ({ cid, title: `title ${cid}`, teacher: 'teacher', queued: n + 2, converted: n, approved: 0, failed: 1, notStarted: 1, items: Array.from({ length: n }, (_, i) => item(i + 1, `${cid}-id${i + 1}`)) });

describe('approve index', () => {
  const md = renderIndex([entry('c002', 2), entry('c001', 5), entry('c003', 2)], '2026-01-01');
  const rows = md.split('\n').filter((l) => /^\| c\d+ /.test(l));
  it('one row per course, largest first, ties by course id', () => {
    expect(rows.map((r) => r.split('|')[1].trim())).toEqual(['c001', 'c002', 'c003']);
    expect(rows.map((r) => r.split('|')[3].trim())).toEqual(['5', '2', '2']);
  });
  it('each row has the title, ONE sample play link as a markdown link, and a link to its list', () => {
    expect(rows[0]).toContain('title c001');
    expect(rows[0]).toMatch(/\[▶ lesson 1\]\(https:\/\/media\.84000\.digital\/audio\/c001-id1-a64\.mp3\)/);
    expect((rows[0].match(/\]\(https:\/\/media/g) || []).length).toBe(1);
    expect(rows[0]).toContain('[c001.txt](c001.txt)');
  });
  it('a pipe in a title cannot break the table', () => {
    const m = renderIndex([{ ...entry('c001', 1), title: 'a|b' }], 'x');
    expect(m).toContain('a\\|b');
  });
});

describe('approve list', () => {
  it('the LAST line is the comma-separated ids, in lesson order', () => {
    const t = renderList(entry('c001', 3), 'x');
    expect(idsLine(t)).toBe('c001-id1,c001-id2,c001-id3');
    expect(t.trimEnd().endsWith('c001-id3')).toBe(true);
  });
  it('mediaUrl encodes each path segment', () => {
    expect(mediaUrl('audio/a b-a64.mp3')).toBe('https://media.84000.digital/audio/a%20b-a64.mp3');
  });
});

describe('the committed lists', () => {
  const dir = 'data/queues/approve';
  const txt = readdirSync(dir).filter((f) => /^c\d+\.txt$/.test(f));
  const index = readFileSync(`${dir}/INDEX.md`, 'utf-8');
  it('INDEX.md has exactly one row per list, and the counts match the ids line', () => {
    const rows = index.split('\n').filter((l) => /^\| c\d+ /.test(l));
    expect(rows.map((r) => r.split('|')[1].trim()).sort()).toEqual(txt.map((f) => f.replace('.txt', '')).sort());
    for (const r of rows) {
      const cid = r.split('|')[1].trim();
      const ids = idsLine(readFileSync(`${dir}/${cid}.txt`, 'utf-8')).split(',');
      expect(Number(r.split('|')[3].trim())).toBe(ids.length);
      expect(ids.every((x) => /^[A-Za-z0-9_-]{20,}$/.test(x))).toBe(true);
    }
    const counts = rows.map((r) => Number(r.split('|')[3].trim()));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
  it('every sample link is a tappable markdown link on the media host', () => {
    for (const r of index.split('\n').filter((l) => /^\| c\d+ /.test(l))) expect(r).toMatch(/\[▶ lesson [^\]]+\]\(https:\/\/media\.84000\.digital\/audio\/[^)]+\.mp3\)/);
  });
});
