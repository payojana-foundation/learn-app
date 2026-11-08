/**
 * src/ui/companion.ts — GuideLine and the study branch (bulk-05 P2).
 *
 * The SVG files in public/brand/companion/ are DRAFT visuals the brand team
 * will replace under the same names. They are bundled as text at build time (so
 * they work offline with the app shell). This code depends on ONLY:
 *   - the sign file names (from guide-lines.json), and
 *   - in the branch file, elements with data-slot="1..12".
 * Everything else in a file (titles, ids, roles, sizes) is replaced or ignored.
 *
 * Nothing here invents text: a guide line shows only if approved (or, in a DEV
 * build with ?guide=draft, flagged DRAFT). No numbers appear in the branch panel.
 */

import type { Lang } from '../lang';
import { t } from '../strings';
import { esc } from '../format';
import { guideLine, chooseSign, isSafeSignName, type GuideLinesFile } from '../data/companion';
import type { AliasMap } from '../db/aliases';

/** What the screens need to draw the companion. */
export interface CompanionCtx {
  lang: Lang;
  guide: GuideLinesFile | null;
  aliases: AliasMap;
  /** DEV build with ?guide=draft (never true in production). */
  draft: boolean;
  /** Course page: this course has a leaf. */
  hasLeaf?: boolean;
  /** /my: number of leaves (used only to decide how many slots to show). */
  leafCount?: number;
}

const RAW = import.meta.glob('../../public/brand/companion/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** file name → raw svg text, e.g. "leaf-sign-draft.svg" → "<svg…". */
export const BUNDLE: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, text]) => [path.split('/').pop() as string, text])
);
export const BRANCH_FILE = 'branch-draft.svg';

let uid = 0;

/**
 * PURE: make a bundled SVG safe to inline more than once. Removes <title>, role
 * and aria-labelledby (the wrapper carries aria-hidden or the label), and gives
 * every id a unique suffix, rewriting `#id` references to match. The caller
 * wraps the result in an element that sets the size.
 */
export function prepareSvg(raw: string, suffix: string): string {
  let s = raw
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/\srole="[^"]*"/g, '')
    .replace(/\saria-labelledby="[^"]*"/g, '')
    .trim();
  const ids = [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const re = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = `${id}-${suffix}`;
    s = s
      .replace(new RegExp(`(\\sid=")${re}(")`, 'g'), `$1${next}$2`)
      .replace(new RegExp(`(["'(])#${re}(["')])`, 'g'), `$1#${next}$2`);
  }
  return s;
}

/**
 * PURE: hide branch slots above `shown` (data-slot="n", n > shown) with the SVG
 * `display="none"` attribute. Slots 1..shown stay as the file draws them.
 */
export function showSlots(svg: string, shown: number): string {
  return svg.replace(/<[a-zA-Z][^>]*?\sdata-slot="(\d+)"[^>]*>/g, (tag, n: string) =>
    Number(n) > shown ? tag.replace(/^<([a-zA-Z][\w:-]*)/, '<$1 display="none"') : tag
  );
}

/**
 * Which bundled file to draw for a sign name: the named file, else the default
 * file (with a console warning), else null (the line shows without a graphic).
 */
export function resolveSignFile(
  name: string | null,
  defaultName: string | null,
  bundle: Record<string, string> = BUNDLE,
  warn: (m: string) => void = (m) => console.warn(m)
): string | null {
  if (name && bundle[name]) return name;
  if (defaultName && bundle[defaultName]) {
    if (name && name !== defaultName) warn(`guide sign: file not found (${name}); using default_sign`);
    return defaultName;
  }
  return null;
}

/** The inline sign graphic (aria-hidden), or '' if none can be drawn. */
export function signHtml(c: CompanionCtx, courseId: string | null, bundle: Record<string, string> = BUNDLE): string {
  if (!c.guide) return '';
  const def = isSafeSignName(c.guide.default_sign) ? c.guide.default_sign : null;
  const wanted = courseId ? chooseSign(c.guide, courseId, c.aliases) : def;
  const file = resolveSignFile(wanted, def, bundle);
  if (!file) return '';
  return `<span class="gsign" data-sign="${esc(file)}" aria-hidden="true">${prepareSvg(bundle[file], `s${++uid}`)}</span>`;
}

/**
 * GuideLine: sign (22 px) + one fixed line of text. '' unless the line is
 * approved (or DEV ?guide=draft, then tagged DRAFT). `courseId` picks the
 * course's sign; null uses the default sign.
 */
export function guideLineHtml(c: CompanionCtx | undefined, key: string, courseId: string | null): string {
  if (!c) return '';
  const gl = guideLine(c.guide, key, c.lang, c.draft);
  if (!gl) return '';
  const tag = gl.draft ? ' <span class="draft-tag">DRAFT</span>' : '';
  return `<p class="guide" data-guide="${esc(key)}">${signHtml(c, courseId)}<span class="gtext">${esc(gl.text)}${tag}</span></p>`;
}

/**
 * The study branch for `leafCount` leaves: one branch per 12 leaves (13+ adds
 * a second branch below, and so on). 0 leaves = one bare branch. No numbers.
 */
export function branchesHtml(leafCount: number, bundle: Record<string, string> = BUNDLE): string {
  const raw = bundle[BRANCH_FILE];
  if (!raw) return '';
  const count = Math.max(0, Math.floor(leafCount));
  const n = Math.max(1, Math.ceil(count / 12));
  let out = '';
  for (let k = 0; k < n; k++) {
    const shown = Math.min(12, Math.max(0, count - 12 * k));
    out += `<div class="branch" data-branch="${k}">${showSlots(prepareSvg(raw, `b${++uid}`), shown)}</div>`;
  }
  return out;
}

/** The interface note under the branch, with {exportLabel} filled in. */
export function deviceNote(lang: Lang): string {
  return t('my.branch.device_note', lang).replace('{exportLabel}', t('EXPORT', lang));
}

/** The /my branch panel: branches, the empty-branch line (0 leaves), device note. */
export function branchPanelHtml(c: CompanionCtx | undefined): string {
  if (!c) return '';
  const count = c.leafCount ?? 0;
  return `<div class="branchp" role="group" aria-label="${esc(t('my.branch.label', c.lang))}">
  <div class="branches" aria-hidden="true">${branchesHtml(count)}</div>
  ${count === 0 ? guideLineHtml(c, 'my.branch.empty', null) : ''}
  <p class="devnote">${esc(deviceNote(c.lang))}</p></div>`;
}
