import { describe, it, expect } from 'vitest';
import {
  findHeaderRow, mapColumns, parseTab, buildCatalogue, cutClass, renderCsv, renderReport,
  parseQueueIds, pilotCheck, driveIds, parseInventoryNames,
} from '../sheets-map.mjs';

const T = {
  title: 'ចំណងជើង មេរៀន',
  code: 'លេខកូដមេរៀន',
  teacher: 'ឈ្មោះគ្រូ',
};

/** A small, realistic tab: link labels one row above the label row. Columns:
 *  0 number · 1 teacher · 2 title · 3 lesson code · 4 cut MP3 · 5 cut MP4. */
function fixtureTab() {
  const blank = ['', '', '', '', '', ''];
  const text = [
    ['', '', '', '', 'MP3 link', 'MP4 link'],
    ['ល.រ', T.teacher, T.title, T.code, '', ''],
    ['1', 'teacher one', 'title one', 'C001', 'https://drive.google.com/file/d/BBBBBBBBBBBBBBBBBBBBBBBBB/view', ''],
    ['2', 'teacher one', 'title two', 'C002', '', ''],
    [...blank], // blank row, skipped
    ['3', 'teacher one', '', '', '', ''], // numbered, but no code and no Drive file
  ];
  const links = text.map(() => [...blank]);
  links[2][5] = 'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAAAAA/view'; // MP4 id only in the hyperlink target
  return { name: 'Tab A', text, links };
}

describe('findHeaderRow / mapColumns', () => {
  it('finds the label row by title+teacher/code, wherever it sits', () => {
    const t = fixtureTab();
    expect(findHeaderRow(t.text)).toBe(1);
  });
  it('returns -1 when no label row has the title label', () => {
    expect(findHeaderRow([['a', 'b'], ['1', '2']])).toBe(-1);
  });
  it('maps the link columns from the row ABOVE the label row', () => {
    const t = fixtureTab();
    const cols = mapColumns(t.text, 1);
    expect(cols.link.mp3).toBe(4);
    expect(cols.link.mp4).toBe(5);
    expect(cols.lessonCode).toBe(3);
  });
});

describe('driveIds', () => {
  it('reads /file/d/<id> from text and from a hyperlink target', () => {
    expect(driveIds('see https://drive.google.com/file/d/ABCDEFGHIJKLMNOPQRSTUVWX/view')).toEqual(['ABCDEFGHIJKLMNOPQRSTUVWX']);
    expect(driveIds('', 'https://drive.google.com/open?id=ABCDEFGHIJKLMNOPQRSTUVWX&usp=drive_copy')).toEqual(['ABCDEFGHIJKLMNOPQRSTUVWX']);
  });
  it('de-dupes and ignores empty/short values', () => {
    expect(driveIds('x/file/d/ID1234567890123456789012', 'x/file/d/ID1234567890123456789012')).toHaveLength(1);
    expect(driveIds('', '', 'short')).toEqual([]);
  });
});

describe('parseTab', () => {
  it('parses lesson rows byte-for-byte (title/teacher/code untouched)', () => {
    const p = parseTab(fixtureTab());
    expect(p.status).toBe('ok');
    expect(p.lessons).toHaveLength(3);
    expect(p.lessons[0]).toMatchObject({ number: '1', teacher: 'teacher one', title: 'title one', lesson_code: 'C001' });
    expect(p.lessons[0].mp3).toHaveLength(1); // text-url BBBB id
    expect(p.lessons[0].mp4).toHaveLength(1); // hyperlink-target AAAA id
  });
  it('a row with a title/code but no lesson number is unnumbered, not a lesson', () => {
    const t = fixtureTab();
    t.text.push(['', 'teacher one', 'stray section title', '', '', '']);
    const p = parseTab(t);
    expect(p.unnumbered).toContain(t.text.length);
    expect(p.lessons).toHaveLength(3);
  });
  it('skips an empty tab, and a tab with no header row, with a reason', () => {
    expect(parseTab({ name: 'x', text: [], links: [] }).status).toBe('skipped');
    expect(parseTab({ name: 'x', text: [['foo', 'bar']], links: [[]] }).reason).toMatch(/no header row/);
  });
  it('skips a tab whose header row has no numbered lesson rows', () => {
    const t = { name: 'x', text: [['ល.រ', T.teacher, T.title], ['', '', '']], links: [[], []] };
    expect(parseTab(t).reason).toMatch(/no numbered lesson rows/);
  });
});

describe('cutClass / buildCatalogue duplicates', () => {
  it('classifies both / mp3_only / mp4_only / none', () => {
    expect(cutClass({ mp3: ['a'], mp4: ['b'] })).toBe('both');
    expect(cutClass({ mp3: ['a'], mp4: [] })).toBe('mp3_only');
    expect(cutClass({ mp3: [], mp4: ['b'] })).toBe('mp4_only');
    expect(cutClass({ mp3: [], mp4: [] })).toBe('none');
  });

  it('flags duplicate lesson codes and duplicate Drive ids across tabs', () => {
    const tabA = fixtureTab();
    const tabB = fixtureTab(); // same codes and same Drive ids as tab A
    tabB.name = 'Tab B';
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'file one', tabs: [tabA] }, { file_id: 'F2', file_name: 'file two', tabs: [tabB] }]);
    expect(cat.dupCodes.find((d) => d.code === 'C001')).toBeTruthy();
    expect(cat.dupIds.map((d) => d.id)).toEqual(expect.arrayContaining(['AAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBB']));
    const r = cat.rows.find((r) => r.file_id === 'F1' && r.lesson_code === 'C001');
    expect(r.flags).toContain('dup_code');
    expect(r.flags).toContain('dup_drive');
  });

  it('flags no_code and no_drive_file independently', () => {
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [fixtureTab()] }]);
    const row3 = cat.rows.find((r) => r.number === '3');
    expect(row3.flags).toContain('no_code');
    expect(row3.flags).toContain('no_drive_file');
  });

  it('never invents a code or id — a lesson with none stays empty, flagged', () => {
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [fixtureTab()] }]);
    const row3 = cat.rows.find((r) => r.number === '3');
    expect(row3.lesson_code).toBe('');
    expect(row3.mp3).toEqual([]);
    expect(row3.mp4).toEqual([]);
  });
});

describe('renderCsv', () => {
  it('one row per lesson, ids joined with |, flags listed', () => {
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [fixtureTab()] }]);
    const csv = renderCsv(cat.rows);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1 + cat.rows.length);
    expect(lines[0].split(',')[0]).toBe('file_name');
  });
  it('quotes a value containing a comma', () => {
    const csv = renderCsv([{ file_name: 'a, b', file_id: 'F', tab: 'T', row: 1, number: '1', teacher: 't', title: 'x', lesson_code: '', video_code: '', mp3: [], mp4: [], minicourse: [], original: [], acast: false, youtube: false, flags: [] }]);
    expect(csv).toContain('"a, b"');
  });
});

describe('parseQueueIds / pilotCheck', () => {
  const queue = 'drive_file_id\nBBBBBBBBBBBBBBBBBBBBBBBBB\nZZZZZZZZZZZZZZZZZZZZZZZZZ\n';
  it('parses the queue, skipping the header', () => {
    expect(parseQueueIds(queue)).toEqual(['BBBBBBBBBBBBBBBBBBBBBBBBB', 'ZZZZZZZZZZZZZZZZZZZZZZZZZ']);
  });
  it('finds a queue id in the pilot tab by column, and reports a missing one', () => {
    const tabA = fixtureTab();
    tabA.name = '16-A.S.ថ្នាក់កុមារ វេស្សន្តរជាត (cut)';
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [tabA] }]);
    const p = pilotCheck(cat, parseQueueIds(queue), 'វេស្សន្តរជាត');
    expect(p.tabs).toHaveLength(1);
    const found = p.queue.find((e) => e.id === 'BBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(found.hits[0].column).toBe('mp3');
    const missing = p.queue.find((e) => e.id === 'ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(missing.hits).toHaveLength(0);
    expect(p.byColumn.none).toBe(1);
  });
  it('reports NO tabs found when the pilot course has no matching tab', () => {
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [fixtureTab()] }]);
    const p = pilotCheck(cat, parseQueueIds(queue), 'វេស្សន្តរជាត');
    expect(p.tabs).toHaveLength(0);
  });
});

describe('parseInventoryNames', () => {
  it('pairs ## <name> headings with the Drive file id line that follows', () => {
    const md = '## លោកគ្រូ A.xlsx\n\n- Drive file id: `ID123`\n- Tabs: 2\n\n## លោកគ្រូ B.xlsx\n- Drive file id: `ID456`\n';
    const m = parseInventoryNames(md);
    expect(m.get('ID123')).toBe('លោកគ្រូ A.xlsx');
    expect(m.get('ID456')).toBe('លោកគ្រូ B.xlsx');
  });
});

describe('renderReport', () => {
  it('includes the summary, per-teacher/course totals, duplicates, skipped tabs, header variants, pilot', () => {
    const tabA = fixtureTab();
    tabA.name = '16-A.S.ថ្នាក់កុមារ វេស្សន្តរជាត (cut)';
    const bad = { name: 'empty tab', text: [], links: [] };
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'file one', tabs: [tabA, bad] }]);
    const pilot = pilotCheck(cat, parseQueueIds('drive_file_id\nBBBBBBBBBBBBBBBBBBBBBBBBB\n'), 'វេស្សន្តរជាត');
    const md = renderReport(cat, pilot, { queuePath: 'data/audio-queue.pilot.csv' });
    expect(md).toMatch(/Teacher-sheet catalogue report/);
    expect(md).toMatch(/Totals per teacher/);
    expect(md).toMatch(/Totals per course/);
    expect(md).toMatch(/Duplicate lesson codes/);
    expect(md).toMatch(/Tabs skipped, and why/);
    expect(md).toMatch(/empty tab/);
    expect(md).toMatch(/Header variants found/);
    expect(md).toMatch(/Pilot check/);
    expect(md).toMatch(/Stopped after the report/);
  });

  it('says NONE FOUND when no tab matches the pilot course', () => {
    const cat = buildCatalogue([{ file_id: 'F1', file_name: 'f', tabs: [fixtureTab()] }]);
    const pilot = pilotCheck(cat, [], 'វេស្សន្តរជាត');
    expect(renderReport(cat, pilot, {})).toMatch(/NONE FOUND/);
  });
});
