import { describe, it, expect } from 'vitest';
import { parseRoute, routePath, tabForRoute } from './router';

describe('parseRoute', () => {
  it('maps the main paths', () => {
    expect(parseRoute('/', '')).toEqual({ name: 'home' });
    expect(parseRoute('/my', '')).toEqual({ name: 'my' });
    expect(parseRoute('/more', '')).toEqual({ name: 'more' });
    expect(parseRoute('/teachers', '')).toEqual({ name: 'teachers' });
    expect(parseRoute('/teachers/leng-sideoun', '')).toEqual({ name: 'teacher', slug: 'leng-sideoun' });
    expect(parseRoute('/courses/c007', '')).toEqual({ name: 'course', id: 'c007' });
    expect(parseRoute('/courses/c007/c007-l013b', '')).toEqual({ name: 'lesson', id: 'c007', lessonId: 'c007-l013b' });
    expect(parseRoute('/search', '?q=abc')).toEqual({ name: 'search', q: 'abc' });
  });

  it('honours legacy /courses/ query params', () => {
    expect(parseRoute('/courses/', '?q=hello')).toEqual({ name: 'search', q: 'hello' });
    expect(parseRoute('/courses/', '?teacher=yon-yi')).toEqual({ name: 'teacher', slug: 'yon-yi' });
    expect(parseRoute('/courses/', '?topic=sutta')).toEqual({ name: 'home' });
  });

  it('unknown top-level path is notfound', () => {
    expect(parseRoute('/nope', '')).toEqual({ name: 'notfound' });
  });
});

describe('routePath round-trips', () => {
  it('builds lesson and search paths', () => {
    expect(routePath({ name: 'lesson', id: 'c080', lessonId: 'c080-l001' })).toBe('/courses/c080/c080-l001');
    expect(routePath({ name: 'search', q: 'a b' })).toBe('/search?q=a%20b');
    expect(routePath({ name: 'teacher', slug: 'yon-yi' })).toBe('/teachers/yon-yi');
  });
});

describe('tabForRoute', () => {
  it('course/lesson/teacher map to the home tab', () => {
    expect(tabForRoute({ name: 'course', id: 'c001' })).toBe('home');
    expect(tabForRoute({ name: 'lesson', id: 'c001', lessonId: 'c001-l001' })).toBe('home');
    expect(tabForRoute({ name: 'teacher', slug: 'x' })).toBe('home');
    expect(tabForRoute({ name: 'search', q: '' })).toBe('search');
    expect(tabForRoute({ name: 'my' })).toBe('my');
  });
});
