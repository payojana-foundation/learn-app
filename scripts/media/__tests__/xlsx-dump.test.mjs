import { describe, it, expect } from 'vitest';
import { workbookToTabs, parseNames } from '../xlsx-dump.mjs';

describe('workbookToTabs', () => {
  it('splits header from data rows and caps the sample at 3', () => {
    const tabs = workbookToTabs({
      Sheet1: [
        ['Code', 'Title'],
        ['c001', 'one'],
        ['c002', 'two'],
        ['c003', 'three'],
        ['c004', 'four'],
      ],
    });
    expect(tabs).toHaveLength(1);
    expect(tabs[0].name).toBe('Sheet1');
    expect(tabs[0].header).toEqual(['Code', 'Title']);
    expect(tabs[0].rowCount).toBe(4);
    expect(tabs[0].sample).toHaveLength(3);
    expect(tabs[0].sample[0]).toEqual(['c001', 'one']);
  });

  it('handles an empty sheet', () => {
    const tabs = workbookToTabs({ Empty: [] });
    expect(tabs[0]).toEqual({ name: 'Empty', header: [], rowCount: 0, sample: [] });
  });

  it('stringifies cells without trimming or retyping', () => {
    const tabs = workbookToTabs({ S: [['A'], [42], [null]] });
    expect(tabs[0].sample).toEqual([['42'], ['']]);
  });
});

describe('parseNames', () => {
  it('maps drive id → name from a TSV', () => {
    const m = parseNames('id1\tplaceholder one\nid2\tplaceholder two\n');
    expect(m.get('id1')).toBe('placeholder one');
    expect(m.get('id2')).toBe('placeholder two');
  });
  it('ignores blank lines and lines without a tab', () => {
    const m = parseNames('\nbroken-line\nid3\tok\n');
    expect(m.size).toBe(1);
    expect(m.get('id3')).toBe('ok');
  });
});
