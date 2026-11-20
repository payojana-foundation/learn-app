/**
 * src/data/partners.ts — bulk 10 P3: partner YouTube classes as served by the build
 * (scripts/partners/build-partners.mjs) ONLY when data/partners-switch.json is on.
 *
 * catalog.json then carries `partners`, `partner_courses`, `partner_terms` and
 * `partner_retired`; each class file is `partners/<id>.json` in the manifest (key = the
 * class id), loaded on demand through the same hash-verified loader as course files (P-01..P-03).
 * The shape is checked strictly: anything unexpected = no partner data at all (the routes then
 * show "not found", exactly as with the switch off). Titles and names are shown as stored (P-17).
 */
import type { Catalog } from './catalog';

export interface Partner {
  slug: string;
  name_km: string;
  name_en: string;
  teacher_slugs: string[];
  course_ids: string[];
}
export interface PartnerCourse {
  id: string;
  kind: 'partner';
  partner_slug: string;
  title: string;
  teacher_slugs: string[];
  lesson_count: number;
  teaching_points: string[];
}
export interface PartnerTerm {
  term_id: string;
  term_km: string;
  term_pali: string;
  term_en: string;
  other_spellings: string[];
}
export interface PartnerLesson {
  id: string;
  num: number;
  title: string;
  duration_s: number;
}
export interface PartnerClassFile {
  id: string;
  kind: 'partner';
  partner_slug: string;
  title: string;
  teacher_slugs: string[];
  playlist_uuid: string;
  teaching_points: string[];
  lessons: PartnerLesson[];
}
export interface PartnerData {
  partners: Partner[];
  courses: PartnerCourse[];
  terms: PartnerTerm[];
  retired: { courses: Record<string, { since?: string }>; lessons: Record<string, { since?: string; alias?: string }> };
}

export const CLASS_ID = /^yt-pl-[A-Za-z0-9_-]+$/;
export const LESSON_ID = /^yt-[A-Za-z0-9_-]{11}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Strict uuid v4 (the same pattern as the build's kpPlaylistUuid). */
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const EMPTY_PARTNERS: PartnerData = Object.freeze({ partners: [], courses: [], terms: [], retired: { courses: {}, lessons: {} } }) as PartnerData;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrList = (v: unknown, re?: RegExp): v is string[] => Array.isArray(v) && v.every((x) => isStr(x) && (!re || re.test(x)));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function isPartner(v: unknown): v is Partner {
  return isObj(v) && isStr(v.slug) && SLUG.test(v.slug) && isStr(v.name_km) && isStr(v.name_en) && isStrList(v.teacher_slugs, SLUG) && isStrList(v.course_ids, CLASS_ID);
}
function isPartnerCourse(v: unknown): v is PartnerCourse {
  return isObj(v) && isStr(v.id) && CLASS_ID.test(v.id) && v.kind === 'partner' && isStr(v.partner_slug) && isStr(v.title)
    && isStrList(v.teacher_slugs, SLUG) && v.teacher_slugs.length > 0 && Number.isInteger(v.lesson_count) && (v.lesson_count as number) > 0 && isStrList(v.teaching_points);
}
function isTerm(v: unknown): v is PartnerTerm {
  return isObj(v) && isStr(v.term_id) && v.term_id !== '' && isStr(v.term_km) && isStr(v.term_pali) && isStr(v.term_en) && isStrList(v.other_spellings);
}

/** The partner data of a catalog, or EMPTY_PARTNERS (absent or any bad shape). Pure. */
export function partnerData(catalog: Catalog | null | undefined): PartnerData {
  const c = catalog as unknown as Record<string, unknown> | null | undefined;
  if (!c || !('partner_courses' in c)) return EMPTY_PARTNERS;
  const { partners, partner_courses: courses, partner_terms: terms = [], partner_retired: retired = { courses: {}, lessons: {} } } = c as Record<string, unknown>;
  if (!Array.isArray(partners) || !partners.every(isPartner)) return EMPTY_PARTNERS;
  if (!Array.isArray(courses) || !courses.every(isPartnerCourse)) return EMPTY_PARTNERS;
  if (!Array.isArray(terms) || !terms.every(isTerm)) return EMPTY_PARTNERS;
  if (!isObj(retired) || !isObj(retired.courses ?? {}) || !isObj(retired.lessons ?? {})) return EMPTY_PARTNERS;
  const slugs = new Set(partners.map((p) => p.slug));
  if (courses.some((k) => !slugs.has(k.partner_slug))) return EMPTY_PARTNERS;
  if (new Set(courses.map((k) => k.id)).size !== courses.length) return EMPTY_PARTNERS;
  return {
    partners,
    courses,
    terms,
    retired: { courses: (retired.courses ?? {}) as PartnerData['retired']['courses'], lessons: (retired.lessons ?? {}) as PartnerData['retired']['lessons'] },
  };
}

/** A hash-verified class file is used only when its shape and id match. Pure. */
export function isPartnerClassFile(v: unknown, id: string): v is PartnerClassFile {
  return isObj(v) && v.id === id && CLASS_ID.test(id) && v.kind === 'partner' && isStr(v.partner_slug) && isStr(v.title)
    && isStrList(v.teacher_slugs, SLUG) && isStr(v.playlist_uuid) && UUID4.test(v.playlist_uuid) && isStrList(v.teaching_points)
    && Array.isArray(v.lessons) && v.lessons.every((l) => isObj(l) && isStr(l.id) && LESSON_ID.test(l.id) && typeof l.num === 'number' && isStr(l.title));
}

/** The cleaned texts a class is searched by: its title and its teaching points' words. Pure. */
export function classSearchTexts(k: PartnerCourse, terms: PartnerTerm[]): string[] {
  const byId = new Map(terms.map((x) => [x.term_id, x]));
  const out = [k.title];
  for (const id of k.teaching_points) {
    const tm = byId.get(id);
    if (tm) out.push(tm.term_km, tm.term_pali, tm.term_en, ...tm.other_spellings);
  }
  return out.filter((x) => x !== '');
}

/** Teacher slugs with at least one served partner class. Pure. */
export const partnerTeacherSlugs = (d: PartnerData): Set<string> => new Set(d.courses.flatMap((k) => k.teacher_slugs));
