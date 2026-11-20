/** Bulk 10: the Home "Partners" row is the entry to /partners; only when partner classes are served. */
import { describe, it, expect } from 'vitest';
import { homeView } from './views';
import { homePartnerSection } from './partners';
import { partnerData, EMPTY_PARTNERS } from '../data/partners';
import type { Catalog } from '../data/catalog';

const cat = { generated: '', provisional: false, courses: [] } as Catalog;
const st = { lang: 'en' as const, topic: 'all', savedIds: new Set<string>() };
const ON = partnerData({
  ...cat,
  partners: [{ slug: 'p-one', name_km: 'pk placeholder', name_en: 'pe placeholder', teacher_slugs: ['t-one'], course_ids: ['yt-pl-PLx1'] }],
  partner_courses: [{ id: 'yt-pl-PLx1', kind: 'partner', partner_slug: 'p-one', title: 'c', teacher_slugs: ['t-one'], lesson_count: 3, teaching_points: [] }],
} as unknown as Catalog);

describe('Home partners row', () => {
  it('no partner data → nothing, and Home is exactly as before', () => {
    expect(homePartnerSection(EMPTY_PARTNERS, 'en')).toBe('');
    expect(homeView(cat, [], new Map(), {}, st, [], [], undefined, '')).toBe(homeView(cat, [], new Map(), {}, st, [], []));
  });
  it('served → a Partners section with "See all" to /partners and one link per partner (name as stored)', () => {
    const h = homePartnerSection(ON, 'en');
    expect(h).toContain('data-nav="partners"');
    expect(h).toContain('data-nav="partner" data-slug="p-one"');
    expect(h).toContain('pe placeholder');
    expect(homePartnerSection(ON, 'km')).toContain('pk placeholder');
    expect(h).not.toMatch(/<iframe|data-nav="pclass"/);
    expect(homeView(cat, [], new Map(), {}, st, [], [], undefined, h)).toContain(h);
  });
});
