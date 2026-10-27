import { describe, it, expect } from 'vitest';
import { num, time, cleanForSearch, esc } from './format';

describe('num', () => {
  it('localises digits to Khmer for km', () => {
    expect(num(2026, 'km')).toBe('២០២៦');
    expect(num(2026, 'en')).toBe('2026');
  });
});

describe('time', () => {
  it('formats m:ss with localised digits', () => {
    expect(time(75, 'en')).toBe('1:15');
    expect(time(75, 'km')).toBe('១:១៥');
    expect(time(-5, 'en')).toBe('0:00');
  });
});

describe('cleanForSearch', () => {
  it('removes U+200B and lowercases', () => {
    expect(cleanForSearch('ABC\u200BDef')).toBe('abcdef');
  });
});

describe('esc', () => {
  it('escapes html special chars', () => {
    expect(esc('<a>&"')).toBe('&lt;a&gt;&amp;&quot;');
  });
});
