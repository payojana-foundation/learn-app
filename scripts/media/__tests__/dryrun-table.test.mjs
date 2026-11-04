import { describe, it, expect } from 'vitest';
import { dryTable } from '../dryrun-table.mjs';

const row = (id, o = {}) => ({ id, I1: -24, TP1: -9, loop: 2, G: 9.5, I_final: -16.1, depth: 3.5, busy: 0.4, result: 'ok', ...o });

describe('dryTable', () => {
  it('has the agreed columns', () => {
    const md = dryTable([row('A')], ['A']);
    expect(md.split('\n')[0]).toBe('| part | I1 | TP1 | loops | final G | I_lim or I_cap | depth | busy | expected result |');
  });
  it('orders rows by queue position and shows the 1-based part number', () => {
    const md = dryTable([row('C'), row('A'), row('B')], ['A', 'B', 'C']);
    const parts = md.split('\n').slice(2).filter(Boolean).map((l) => l.split('|')[1].trim());
    expect(parts).toEqual(['1', '2', '3']);
  });
  it('formats numbers to 2 dp and shows the expected result', () => {
    const md = dryTable([row('A', { result: 'cap', I_final: -17.234, depth: 12.0 })], ['A']);
    expect(md).toMatch(/\| 1 \| -24\.00 \| -9\.00 \| 2 \| 9\.50 \| -17\.23 \| 12\.00 \| 0\.40 \| cap \|/);
  });
  it('an id not in the queue shows its id; missing numbers show a dash', () => {
    const md = dryTable([row('ZZ', { I_final: null })], ['A']);
    expect(md).toMatch(/\| ZZ \|/);
    expect(md).toMatch(/\| — \|/);
  });
});
