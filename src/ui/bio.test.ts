/** PART C — teacher bio behind a disclosure button (placeholder text; Khmer labels read from strings.ts). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { teacherView, bioToggleHtml, bioId } from './views';
import { STRINGS } from '../strings';
import type { Teacher } from '../data/catalog';

const base: Teacher = { slug: 't-one', name_km: 'name placeholder', name_en: null, bio_km: 'bio km placeholder', bio_en: 'bio en placeholder', topics: [], photo: null, profile_kind: 'monk' };

describe('bio disclosure', () => {
  it('closed by default: a real button, aria-expanded=false, aria-controls = the hidden panel, arrow ▸', () => {
    const h = teacherView(base, [], new Map(), {}, 'en');
    expect(h).toContain(`<button type="button" class="biotoggle" data-bio-toggle aria-expanded="false" aria-controls="${bioId(base)}"><span aria-hidden="true" data-arrow>▸</span> About the teacher</button>`);
    expect(h).toMatch(new RegExp(`<div class="bio" id="${bioId(base)}"[^>]* hidden>bio en placeholder</div>`));
    expect(h.indexOf('data-bio-toggle')).toBeLessThan(h.indexOf('class="bio"'));
    expect(h.indexOf('<h1>')).toBeLessThan(h.indexOf('data-bio-toggle')); // below the name
  });
  it('label by the stored profile_kind (km), en "About the teacher" for both', () => {
    expect(bioToggleHtml(base, 'km')).toContain(STRINGS.BIO_MONK.km);
    expect(bioToggleHtml({ ...base, profile_kind: 'lay' }, 'km')).toContain(STRINGS.BIO_LAY.km);
    expect(bioToggleHtml({ ...base, profile_kind: 'lay' }, 'km')).not.toContain(STRINGS.BIO_MONK.km);
    expect(bioToggleHtml({ ...base, profile_kind: null }, 'km')).toContain(STRINGS.BIO_MONK.km);
    for (const k of ['monk', 'lay'] as const) expect(bioToggleHtml({ ...base, profile_kind: k }, 'en')).toContain('About the teacher');
  });
  it('no approved bio → no button and no panel', () => {
    const h = teacherView({ ...base, bio_km: null, bio_en: null }, [], new Map(), {}, 'km');
    expect(h).not.toContain('data-bio-toggle');
    expect(h).not.toContain('class="bio"');
  });
  it('km shows bio_km; en shows bio_en (else bio_km), as before', () => {
    expect(teacherView(base, [], new Map(), {}, 'km')).toContain('>bio km placeholder<');
    expect(teacherView({ ...base, bio_en: null }, [], new Map(), {}, 'en')).toContain('>bio km placeholder<');
  });
});

describe('profile_kind in the teacher source (set once, stored)', () => {
  const src = JSON.parse(readFileSync('data/source/teachers-2026-11-02/teachers-2026-11-02.json', 'utf-8')) as { slug: string; name_km: string; profile_kind: string }[];
  // The lay title = what BIO_LAY adds after the part it shares with BIO_MONK (never retyped here).
  const m = STRINGS.BIO_MONK.km;
  const l = STRINGS.BIO_LAY.km;
  let i = 0;
  while (i < m.length && m[i] === l[i]) i++;
  const layTitle = l.slice(i);
  it('every record has monk | lay; lay exactly when name_km starts with the lay title', () => {
    expect(layTitle.length).toBeGreaterThan(0);
    for (const t of src) {
      expect(['monk', 'lay'], t.slug).toContain(t.profile_kind);
      expect(t.profile_kind, t.slug).toBe(t.name_km.startsWith(layTitle) ? 'lay' : 'monk');
    }
    expect(src.filter((t) => t.profile_kind === 'lay').length).toBeGreaterThan(0);
  });
  it('the served teachers.json carries the stored value (no runtime rule in src/)', () => {
    const served = JSON.parse(readFileSync('public/data/teachers.json', 'utf-8')).teachers as { slug: string; profile_kind: string }[];
    for (const t of served) expect(t.profile_kind, t.slug).toBe(src.find((x) => x.slug === t.slug)!.profile_kind);
    const app = readFileSync('src/app.ts', 'utf-8') + readFileSync('src/ui/views.ts', 'utf-8');
    expect(app).not.toMatch(/name_km\.startsWith/);
  });
});
