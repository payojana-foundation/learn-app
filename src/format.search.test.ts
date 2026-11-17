import { describe, it, expect } from 'vitest';
import { searchable, cleanForSearch } from './format';

describe('PART 9 search aliases', () => {
  it('the old title after a rename is searched; zero-width spaces removed', () => {
    const s = searchable(['new title', null], ['old\u200Btitle']);
    expect(s.includes(cleanForSearch('oldtitle'))).toBe(true);
    expect(s.includes('new title')).toBe(true);
    expect(searchable(['only'])).toBe('only');
  });
});
