import { describe, it, expect } from 'vitest';
import { num, time, cleanForSearch, esc, displayTitle } from './format';

describe('num', () => {
  it('localises digits to Khmer for km', () => {
    expect(num(2026, 'km')).toBe('២០២៦');
    expect(num(2026, 'en')).toBe('2026');
  });
  it('renders zero as ០ for km, not dropped (falsy-zero bug)', () => {
    expect(num(0, 'km')).toBe('០');
    expect(num(0, 'en')).toBe('0');
    expect(num('0/57', 'km')).toBe('០/៥៧');
  });
});

describe('time', () => {
  it('formats m:ss with localised digits', () => {
    expect(time(75, 'en')).toBe('1:15');
    expect(time(75, 'km')).toBe('១:១៥');
    expect(time(-5, 'en')).toBe('0:00');
  });
  it('renders zero as ០:០០ for km (falsy-zero bug)', () => {
    expect(time(0, 'km')).toBe('០:០០');
    expect(time(0, 'en')).toBe('0:00');
  });
});

describe('displayTitle', () => {
  it('hides a trailing .mp4/.mp3 extension (any case), display only', () => {
    expect(displayTitle('lesson one.mp4')).toBe('lesson one');
    expect(displayTitle('lesson one.MP3')).toBe('lesson one');
    expect(displayTitle('lesson one.Mp4')).toBe('lesson one');
  });
  it('leaves a title without a trailing media extension unchanged', () => {
    expect(displayTitle('lesson one')).toBe('lesson one');
    expect(displayTitle('file.mp4 part two')).toBe('file.mp4 part two');
    expect(displayTitle('notes.mp3.txt')).toBe('notes.mp3.txt');
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
