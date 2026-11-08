/**
 * src/data/companion.ts — study-companion data (bulk-05).
 *
 * PURE helpers over two hash-verified data files:
 *   - paths.json        ordered course ids per learning path ("start-here")
 *   - guide-lines.json  fixed guide lines + the sign (SVG) per course
 *
 * People edit data/paths.json and data/guide-lines.json; the build copies them
 * to public/data/. This module never writes data and never invents text: a
 * line is shown ONLY if its `approved` flag is true (or, in a DEV build with
 * `?guide=draft`, shown with a DRAFT tag). A malformed file reads as "empty".
 */

import type { Lang } from '../lang';
import { resolveAlias, type AliasMap } from '../db/aliases';

export interface LearnPath {
  id: string;
  title_km: string | null;
  title_en: string | null;
  course_ids: string[];
  approved: boolean;
}
export interface PathsFile {
  version: number;
  paths: LearnPath[];
}

export interface GuideLine {
  km: string;
  en: string;
  approved: boolean;
}
export interface GuideLinesFile {
  version: number;
  default_sign: string;
  course_signs: Record<string, string>;
  lines: Record<string, GuideLine>;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shape guard for paths.json. */
export function isPathsFile(v: unknown): v is PathsFile {
  if (!isObj(v) || typeof v.version !== 'number' || !Array.isArray(v.paths)) return false;
  return v.paths.every(
    (p) =>
      isObj(p) &&
      isStr(p.id) &&
      isStrOrNull(p.title_km) &&
      isStrOrNull(p.title_en) &&
      Array.isArray(p.course_ids) &&
      p.course_ids.every(isStr) &&
      typeof p.approved === 'boolean'
  );
}

/** Shape guard for guide-lines.json. */
export function isGuideLinesFile(v: unknown): v is GuideLinesFile {
  if (!isObj(v) || typeof v.version !== 'number') return false;
  if (!isStr(v.default_sign)) return false;
  if (!isObj(v.course_signs) || !Object.values(v.course_signs).every(isStr)) return false;
  if (!isObj(v.lines)) return false;
  return Object.values(v.lines).every((l) => isObj(l) && isStr(l.km) && isStr(l.en) && typeof l.approved === 'boolean');
}

/**
 * Course ids for a path. Hidden (empty list) unless the path exists, is
 * approved, and has at least one KNOWN course id. Unknown ids are skipped;
 * order is kept. A malformed or missing file gives [].
 */
export function pathCourseIds(file: unknown, pathId: string, knownIds: Set<string>): string[] {
  if (!isPathsFile(file)) return [];
  const p = file.paths.find((x) => x.id === pathId);
  if (!p || !p.approved) return [];
  return p.course_ids.filter((id) => knownIds.has(id));
}

/** Course ids in a path that are not in the catalogue (for the build/check report). */
export function unknownPathIds(file: unknown, knownIds: Set<string>): { path: string; id: string }[] {
  if (!isPathsFile(file)) return [];
  const out: { path: string; id: string }[] = [];
  for (const p of file.paths) for (const id of p.course_ids) if (!knownIds.has(id)) out.push({ path: p.id, id });
  return out;
}

/**
 * Dev-only draft switch. True only when the build is a DEV build AND the query
 * has `guide=draft`. In a production build `dev` is false, so never true.
 */
export function draftAllowed(search: string, dev: boolean = import.meta.env.DEV): boolean {
  if (!dev) return false;
  try {
    return new URLSearchParams(search).get('guide') === 'draft';
  } catch {
    return false;
  }
}

/**
 * The guide line for a key, or null. Shown only if approved; an unapproved line
 * shows only when `draft` is true, flagged `draft: true` (caller adds the tag).
 * Missing key, missing file, or empty text → null (no fallback, no placeholder).
 */
export function guideLine(
  file: unknown,
  key: string,
  lang: Lang,
  draft = false
): { text: string; draft: boolean } | null {
  if (!isGuideLinesFile(file)) return null;
  const l = file.lines[key];
  if (!l) return null;
  const text = l[lang];
  if (!text) return null;
  if (l.approved) return { text, draft: false };
  return draft ? { text, draft: true } : null;
}

/** A sign file name must be a plain `.svg` name: no path, no scheme. */
export function isSafeSignName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/.test(name);
}

/**
 * Sign file for a course: course_signs[id] if present, else default_sign.
 * A key written with an OLD (provisional) id still matches after the id was
 * rewritten: any course_signs key whose alias resolves to this id counts. The
 * data file is never rewritten. An unusable file name → default_sign + warning.
 * Returns null when there is no usable sign at all.
 */
export function chooseSign(
  file: unknown,
  courseId: string,
  aliases: AliasMap = {},
  warn: (msg: string) => void = (m) => console.warn(m)
): string | null {
  if (!isGuideLinesFile(file)) return null;
  let wanted: string | undefined = file.course_signs[courseId];
  if (wanted === undefined) {
    for (const [key, name] of Object.entries(file.course_signs)) {
      if (resolveAlias(key, aliases) === courseId) {
        wanted = name;
        break;
      }
    }
  }
  if (wanted === undefined) return isSafeSignName(file.default_sign) ? file.default_sign : null;
  if (isSafeSignName(wanted)) return wanted;
  warn(`guide sign: unknown file name for ${courseId}; using default_sign`);
  return isSafeSignName(file.default_sign) ? file.default_sign : null;
}
