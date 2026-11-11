import { describe, it, expect } from 'vitest';
import { planCatalogue } from '../catalogue-build.mjs';
import { LABELS } from '../sheets-map.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const FILE = 'FILEID00000000000000000000000000001';
const folderUrl = `https://drive.google.com/drive/folders/${DID('FOLD')}?usp=sharing`;
const opts = { teacherFiles: { [FILE]: 't' } };

/** cols: 0 number · 1 teacher · 2 title · 3 code · 4 MP3 */
function tab(name, mp3Cells) {
  const text = [['', '', '', '', 'MP3 link'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, '']];
  mp3Cells.forEach((c, i) => text.push([String(i + 1), 't', `title ${i + 1}`, '', c]));
  return { name, text, links: text.map((r) => r.map(() => '')) };
}

describe('Part C: HIDDEN.md wording', () => {
  it('a folder media cell is hidden with reason "folder link"', () => {
    const { hidden } = planCatalogue([{ file_id: FILE, file_name: '', tabs: [tab('T', [folderUrl, 'plain-name.mp3', ''])] }], opts);
    const byNum = (n) => hidden.find((h) => h.num === n);
    expect(byNum('1').reason).toMatch(/^folder link/);
    expect(byNum('2').reason).toMatch(/^no source/); // a plain file name is not a folder
    expect(byNum('3').reason).toMatch(/^no source/);
  });
  it('a tab skipped for "no header row" is listed even with no lessons counted', () => {
    const noHeader = { name: 'No header tab', text: [['a', 'b'], ['c', 'd']], links: [['', ''], ['', '']] };
    const empty = { name: 'Empty tab', text: [], links: [] };
    const { hidden } = planCatalogue([{ file_id: FILE, file_name: '', tabs: [noHeader, empty, tab('T', [])] }], opts);
    const h = hidden.filter((x) => x.title === 'No header tab');
    expect(h).toHaveLength(1);
    expect(h[0].reason).toMatch(/no header row/);
    expect(h[0].lesson_id).toBeNull();
    expect(hidden.some((x) => x.title === 'Empty tab')).toBe(false); // empty tabs stay unlisted
  });
});
