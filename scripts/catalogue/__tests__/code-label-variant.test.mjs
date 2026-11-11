import { describe, it, expect } from 'vitest';
import { LABELS, CODE_LABEL_VARIANTS, parseTab, findHeaderRow } from '../sheets-map.mjs';
import { planCatalogue } from '../catalogue-build.mjs';

const FILE = 'FILEID00000000000000000000000000001';
const d = (id) => `https://drive.google.com/file/d/${(id + '0000000000000000000000000').slice(0, 28)}/view`;
// The misspelled code label found in a teacher sheet (missing ខ) — see CODE_LABEL_VARIANTS[1].
const VARIANT = CODE_LABEL_VARIANTS[1];

/** cols: 0 number · 1 teacher · 2 title · 3 code label · 4 MP3 */
const tab = (name, codeLabel) => {
  const text = [
    ['', '', '', '', 'MP3 link'],
    ['L.R', LABELS.teacher, LABELS.title, codeLabel, ''],
    ['1', 't', 'title 1', 'CODE0001', d('A')],
    ['2', 't', 'title 2', 'CODE0002', d('B')],
  ];
  return { name, text, links: text.map((r) => r.map(() => '')) };
};

describe('Part G: accepted variant of the lesson-code label', () => {
  it('the variant differs from the standard label', () => {
    expect(CODE_LABEL_VARIANTS).toHaveLength(2);
    expect(VARIANT).not.toBe(LABELS.code);
  });
  it('header with the variant → header row and code column found', () => {
    const g = tab('T', VARIANT);
    expect(findHeaderRow(g.text)).toBe(1);
    const p = parseTab(g);
    expect(p.status).toBe('ok');
    expect(p.cols.lessonCode).toBe(3);
    expect(p.lessons.map((l) => l.lesson_code)).toEqual(['CODE0001', 'CODE0002']);
  });
  it('lesson ids = the codes (not d-<id>)', () => {
    const plan = planCatalogue([{ file_id: FILE, file_name: '', tabs: [tab('T', VARIANT)] }], { teacherFiles: { [FILE]: 't' } });
    expect(plan.courses[0].queueable.map((l) => l.lesson_id)).toEqual(['CODE0001', 'CODE0002']);
  });
  it('the standard label still works, and an unrelated label still finds no code column', () => {
    expect(parseTab(tab('T', LABELS.code)).cols.lessonCode).toBe(3);
    const none = parseTab(tab('T', 'other label'));
    expect(none.cols.lessonCode).toBe(-1);
    expect(none.status).toBe('ok'); // still readable: title + teacher found
  });
});
