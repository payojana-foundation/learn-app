import { describe, it, expect, beforeEach } from 'vitest';
import {
  langFromQuery,
  readLangCookie,
  resolveLang,
  writeLangCookie,
  DEFAULT_LANG,
} from './lang';

/** A minimal Document stub whose `cookie` setter mimics a single-cookie store. */
function makeDoc(initial = ''): Document {
  let store = initial;
  return {
    get cookie() {
      return store;
    },
    set cookie(v: string) {
      // Record only the name=value pair, like a real jar would expose on read.
      const pair = v.split(';')[0];
      store = pair;
    },
    documentElement: { setAttribute() {} } as unknown as HTMLElement,
  } as unknown as Document;
}

describe('langFromQuery (P-04)', () => {
  it('reads a valid ?lang', () => {
    expect(langFromQuery('?lang=en')).toBe('en');
    expect(langFromQuery('?lang=km')).toBe('km');
  });
  it('returns null for absent or invalid values', () => {
    expect(langFromQuery('')).toBeNull();
    expect(langFromQuery('?lang=fr')).toBeNull();
    expect(langFromQuery('?x=1')).toBeNull();
  });
});

describe('resolveLang precedence (P-04)', () => {
  const loc = { search: '', hostname: 'learn.84000.digital', protocol: 'https:' };

  it('query wins and is persisted', () => {
    const doc = makeDoc();
    const lang = resolveLang({ ...loc, search: '?lang=en' }, doc);
    expect(lang).toBe('en');
    expect(readLangCookie(doc)).toBe('en');
  });

  it('falls back to the cookie', () => {
    const doc = makeDoc('lang_84000=en');
    expect(resolveLang({ ...loc, search: '' }, doc)).toBe('en');
  });

  it('defaults to km', () => {
    const doc = makeDoc();
    expect(resolveLang({ ...loc, search: '' }, doc)).toBe(DEFAULT_LANG);
    expect(DEFAULT_LANG).toBe('km');
  });
});

describe('writeLangCookie attributes (P-05)', () => {
  let written = '';
  const doc = {
    set cookie(v: string) {
      written = v;
    },
    get cookie() {
      return written;
    },
  } as unknown as Document;

  beforeEach(() => {
    written = '';
  });

  it('includes Domain on an 84000.digital host, with Secure on https', () => {
    writeLangCookie('km', { hostname: 'learn.84000.digital', protocol: 'https:' }, doc);
    expect(written).toContain('Domain=.84000.digital');
    expect(written).toContain('SameSite=Lax');
    expect(written).toContain('Secure');
    expect(written).toContain('Path=/');
    expect(written).toContain('Max-Age=');
  });

  it('omits Domain off that host and drops Secure on http', () => {
    writeLangCookie('km', { hostname: 'localhost', protocol: 'http:' }, doc);
    expect(written).not.toContain('Domain=');
    expect(written).not.toContain('Secure');
  });
});
