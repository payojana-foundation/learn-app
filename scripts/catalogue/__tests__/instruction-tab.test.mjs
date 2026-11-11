import { describe, it, expect } from 'vitest';
import { LABELS, parseTab, buildCatalogue, isInstructionTab, INSTRUCTION_TAB_REASON, renderReport } from '../sheets-map.mjs';
import { planCatalogue } from '../catalogue-build.mjs';

const FILE = 'FILEID00000000000000000000000000001';
const d = (id) => `https://drive.google.com/file/d/${(id + '0000000000000000000000000').slice(0, 28)}/view`;

/** Instruction tab: the label words sit INSIDE sentences, and it has numbered rows. */
const instr = (name) => {
  const text = [
    [`Fill the column ${LABELS.title} for each lesson and ${LABELS.teacher} once.`, '', '', ''],
    ['1', `Then write ${LABELS.title} here`, `and ${LABELS.teacher} there`, d('INSTR')],
  ];
  return { name, text, links: text.map((r) => r.map(() => '')) };
};
const klass = (name) => {
  const text = [['', '', '', '', 'MP3 link'], ['L.R', LABELS.teacher, LABELS.title, LABELS.code, ''], ['1', 't', 'title 1', 'CODE0001', d('CLASS')]];
  return { name, text, links: text.map((r) => r.map(() => '')) };
};
const files = [{ file_id: FILE, file_name: '', tabs: [instr('0_instructions'), klass('1_class')] }];

describe('Part F: "0_" instruction tabs', () => {
  it('isInstructionTab: prefix only', () => {
    expect(isInstructionTab('0_x')).toBe(true);
    expect(isInstructionTab('0')).toBe(false);
    expect(isInstructionTab('a0_x')).toBe(false);
    expect(isInstructionTab('1_x')).toBe(false);
  });
  it('without the 0_ name the instruction sentences WOULD be read as a header', () => {
    expect(parseTab(instr('1_instructions')).status).toBe('ok'); // proves the guard does the work
  });
  it('parseTab ignores a 0_ tab', () => {
    const p = parseTab(instr('0_instructions'));
    expect(p.status).toBe('skipped');
    expect(p.reason).toBe(INSTRUCTION_TAB_REASON);
    expect(p.lessons).toEqual([]);
  });
  it('report lists it as "ignored: instruction tab"; the class tab is unchanged', () => {
    const cat = buildCatalogue(files);
    expect(cat.rows.map((r) => r.tab)).toEqual(['1_class']);
    const md = renderReport(cat, null, {});
    expect(md).toContain('0_instructions');
    expect(md).toContain('ignored: instruction tab');
  });
  it('catalogue: no course and no hidden row for a 0_ tab; class course unchanged', () => {
    const plan = planCatalogue(files, { teacherFiles: { [FILE]: 't' } });
    expect(plan.courses.map((c) => c.tab)).toEqual(['1_class']);
    expect(plan.hidden.some((h) => h.title === '0_instructions')).toBe(false);
    expect(Object.keys(plan.registry)).toEqual([`${FILE}\t1_class`]);
    expect(plan.courses[0].queueable).toHaveLength(1);
  });
});
